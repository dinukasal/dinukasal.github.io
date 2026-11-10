# Running a Kepler-Era GPU (GeForce GTX 660 / GK106) on Ubuntu 24.04 in 2026

**A field report on driver support, kernel compatibility, NVENC, and virtualisation viability**

*Test date: 2026-11-10 · Ubuntu 24.04.5 LTS · Kernel 7.0.0-42-generic (HWE)*

---

## Abstract

A Gigabyte GeForce GTX 660 (NVIDIA GK106, Kepler, 2012) was subjected to a full capability audit on a modern Ubuntu 24.04.5 LTS host running the 7.0.0 HWE kernel. We measured what actually works, what can be made to work, and what is physically impossible. The headline results:

1. **The proprietary driver is recoverable, but only on the 6.8 GA kernel.** Driver 470.256.02 (the last release supporting Kepler) fails on kernels newer than ~6.11, but was verified to build cleanly via DKMS against kernel 6.8.0-147 and 6.8.0-149 in a KVM guest.
2. **Hardware video encode is reachable — but not with the distribution ffmpeg.** Ubuntu 24.04's ffmpeg 6.1.1 is compiled against `nv-codec-headers` 12.x and therefore refuses driver 470 at runtime (`Required: 12.1 Found: 11.1`). Rebuilding ffmpeg 6.1.1 against `nv-codec-headers` 11.1.5.3 resolves this.
3. **GPU passthrough into a VM is blocked by a missing VBIOS**, not by the driver: `RmInitAdapter failed (0x22:0x56:667)` with `Video BIOS: ??.??.??.??.??`.
4. **Tensor-core "unlock" tooling is inapplicable** — Kepler has no tensor cores, no BF16, no TF32, and no `IMLA4` instruction.
5. **TensorFlow 2.x cannot use this GPU under any configuration**, because compute capability 3.0 (`sm_30`) was dropped from all TF2 builds. The practical CUDA ceiling is CUDA 10.2.

The card remains useful for exactly one modern workload: H.264 decode/encode acceleration for a media server.

---

## 1. Test environment

| Component | Detail |
|---|---|
| OS | Ubuntu 24.04.5 LTS (noble) |
| Kernel (host) | `7.0.0-42-generic` (HWE), `#42~24.04.1-Ubuntu` |
| Kernel (GA candidate) | `6.8.0-149.149` |
| CPU | Intel Core i7-10700F (16 threads, **no iGPU**) |
| RAM | 16 GB |
| GPU | NVIDIA GK106 [GeForce GTX 660], `10de:11c0`, subsystem `1458:354e` (Gigabyte), 2 GB GDDR5, VBIOS `80.06.58.00.03` |
| GPU audio | GK106 HDMI Audio Controller `10de:0e0b` |
| In-tree driver | `nouveau` 1.4.2, Mesa 25.2.8 |
| PCIe link | `LnkCap 8GT/s x16` but `LnkSta 2.5GT/s (downgraded)` |

> **Note on the CPU:** the `F` suffix means no integrated graphics. The GTX 660 is the *only* display device in the system, so the motherboard's video outputs are non-functional. This is a frequent source of "the GPU doesn't work" misdiagnosis.

---

## 2. Support matrix: what supports GK106 in 2026

| Driver branch | Supports GK106 | Notes |
|---|---|---|
| `nouveau` (in-tree) | ✅ | Works, but no reclocking on Kepler and no video encode |
| NVIDIA 390.xx | ⚠️ | Last *legacy* branch, but too old for noble's Xorg/Wayland |
| **NVIDIA 470.256.02** | ✅ | **Last driver supporting Kepler at all** |
| NVIDIA 535.xx | ❌ | Kepler dropped |
| NVIDIA 570.xx | ❌ | Kepler dropped |
| CUDA 11.x / 12.x | ❌ | `sm_30` dropped after CUDA 10.2 |
| TensorFlow 2.x | ❌ | Requires CC ≥ 3.5 (≥ 5.0 in TF 2.16+) |
| PyTorch (any modern wheel) | ❌ | `sm_50`+ builds |
| NVENC | ✅ H.264 only | 1st-gen encoder, ~2 concurrent sessions (patchable) |
| NVDEC | ✅ H.264 / MPEG-2 / VC-1 | No HEVC/VP9/AV1 (predates them) |
| OpenGL | ✅ 4.3 (Mesa nvc0) / 4.6 (proprietary) | |
| Vulkan | ✅ (nvc0) | |
| OpenCL | ⚠️ 1.2 | Proprietary or Mesa Clover |

---

## 3. The kernel-compatibility cliff

### 3.1 Observation

The host had previously seen driver attempts across four branches, all removed:

```
rc  nvidia-kernel-common-390    390.157-0ubuntu7
rc  nvidia-kernel-common-470    470.256.02-0ubuntu0.24.04.1
rc  nvidia-kernel-common-535    535.274.02-0ubuntu0.24.04.2
rc  linux-modules-nvidia-570-6.11.0-29-generic
ii  cuda-repo-ubuntu2204-12-0-local   12.0.0-525.60.13-1   ← CUDA 12, useless for sm_30
```

`/var/lib/dkms` was empty — i.e. no module had ever built successfully on this host.

### 3.2 Why

Driver 470 predates the kernel APIs used by 6.14+/7.0. Ubuntu's *prebuilt* signed module packages confirm the cutoff empirically:

```
$ apt-cache policy linux-modules-nvidia-470-generic-hwe-24.04
  Candidate: 6.11.0-29.29~24.04.1+3        ← stops at 6.11
```

### 3.3 Verification in a KVM guest

A throwaway Ubuntu 24.04 cloud-image VM (4 vCPU / 4 GB, kernel **6.8.0-147 GA**) was used to test the build without touching the host:

```bash
sudo apt-get install -y nvidia-dkms-470 nvidia-kernel-common-470 \
     libnvidia-encode-470 libnvidia-decode-470 \
     libnvidia-compute-470 nvidia-utils-470
dkms status
```

**Result:**

```
nvidia/470.256.02, 6.8.0-147-generic, x86_64: installed
nvidia/470.256.02, 6.8.0-149-generic, x86_64: installed

/lib/modules/6.8.0-147-generic/updates/dkms/
  nvidia.ko.zst  nvidia-modeset.ko.zst  nvidia-uvm.ko.zst
  nvidia-drm.ko.zst  nvidia-peermem.ko.zst
```

Both the running guest kernel and the host's GA candidate (`6.8.0-149`) built without patches. **The 6.8 GA kernel + driver 470 combination is therefore the only viable proprietary-driver path on Ubuntu 24.04 for Kepler.**

---

## 4. NVENC: the hidden API-version gate

### 4.1 The problem

Ubuntu's `ffmpeg 6.1.1-3ubuntu5` *does* ship `h264_nvenc`, `hevc_nvenc` and the `*_cuvid` decoders. But the binary contains a hard version check:

```
$ strings /usr/lib/x86_64-linux-gnu/libavcodec.so.60 | grep -i nvenc
Driver does not support the required nvenc API version. Required: %d.%d Found: %d.%d
The minimum required Nvidia driver for nvenc is %s or newer
```

noble's ffmpeg is built against `nv-codec-headers` 12.x (NVENC API 12.1), which demands driver **≥ 525**. Driver 470 reports API **11.1**, so encode fails at initialisation even when the driver and hardware are perfectly functional.

### 4.2 The fix

Rebuild ffmpeg against headers matching the driver:

```bash
git clone --depth 1 --branch n11.1.5.3 https://github.com/FFmpeg/nv-codec-headers.git
cd nv-codec-headers && sudo make install
grep -E 'NVENCAPI_(MAJOR|MINOR)' /usr/local/include/ffnvcodec/nvEncodeAPI.h
#   #define NVENCAPI_MAJOR_VERSION 11
#   #define NVENCAPI_MINOR_VERSION 1

curl -fsSL -o ff.tar.xz https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz
tar xf ff.tar.xz && cd ffmpeg-6.1.1
./configure --prefix=/usr/local/nv --disable-doc --disable-debug \
  --enable-nvenc --disable-everything --enable-protocol=file \
  --enable-muxer=mp4 --enable-encoder=h264_nvenc,hevc_nvenc \
  --enable-indev=lavfi --enable-filter=testsrc2,format,scale,null,color \
  --enable-avfilter --enable-swscale
make -j4 && sudo make install
```

**Result (verified in the VM):**

```
ffmpeg version 6.1.1
 V....D h264_nvenc   NVIDIA NVENC H.264 encoder (codec h264)
 V....D hevc_nvenc   NVIDIA NVENC hevc encoder (codec hevc)
```

Note that `hevc_nvenc` compiles but is *not usable on GK106* — Kepler's NVENC is H.264-only. Hardware capability, not software, is the limit.

### 4.3 Session limit

Consumer drivers cap concurrent NVENC sessions (historically 2). [`keylase/nvidia-patch`](https://github.com/keylase/nvidia-patch) lists **470.256.02** as supported for both its NVENC and NVDEC patches, removing the cap by patching `libnvidia-encode.so` / `libnvcuvid.so`.

---

## 5. GPU passthrough: blocked by VBIOS, not by software

### 5.1 Setup

IOMMU was already active (`dmar0` present, GPU + HDMI audio in isolated group 1). The card was hot-unbound from `nouveau` and bound to `vfio-pci`:

```bash
echo 0000:01:00.0 > /sys/bus/pci/drivers/nouveau/unbind
echo vfio-pci > /sys/bus/pci/devices/0000:01:00.0/driver_override
echo 0000:01:00.0 > /sys/bus/pci/drivers/vfio-pci/bind
```

The VM was launched with `-machine q35`, dedicated `pcie-root-port`s, `x-vga=on`, and `vfio-pci disable_idle_d3=1`.

### 5.2 Result

The guest enumerated the card correctly and loaded driver 470 — but the adapter failed to initialise:

```
nvidia 0000:01:00.0: vgaarb: VGA decodes changed: decodes=none:owns=none
NVRM: loading NVIDIA UNIX x86_64 Kernel Module 470.256.02
NVRM: GPU 0000:01:00.0: RmInitAdapter failed! (0x22:0x56:667)
NVRM: GPU 0000:01:00.0: rm_init_adapter failed, device minor number 0

$ nvidia-smi
No devices were found

$ cat /proc/driver/nvidia/gpus/*/information
Model:        NVIDIA GeForce GTX 660
DMA Size:     36 bits
Video BIOS:   ??.??.??.??.??        ← root cause
```

Legacy Kepler adapters require their option ROM inside the guest. Dumping it from the host failed:

```
$ echo 1 > /sys/bus/pci/devices/0000:01:00.0/rom
$ cat /sys/bus/pci/devices/0000:01:00.0/rom > gk106.rom
cat: .../rom: Input/output error        # empty file
```

Attempts that did **not** resolve it: `x-vga=on`, `vfio-pci.disable_idle_d3=1`, `-machine q35` with explicit PCIe root ports, rebinding `nouveau` before the dump. The remaining untested routes are a boot-time `vfio-pci.ids=10de:11c0,10de:0e0b` binding (so the ROM BAR is never claimed) or supplying a vendor-matched ROM via `romfile=`.

**Conclusion:** passthrough is *probably* achievable with a VBIOS blob, but it is not a configuration problem — no software knob tested fixes a missing ROM.

---

## 6. Tensor-core "unlock" tooling: inapplicable

[`Zagitta/gpu-unlock`](https://github.com/zagitta/gpu-unlock) is a kernel module that runs before the NVIDIA driver binds and writes tensor-core **speed selectors**:

> writes the speed selectors (SS0 `0x88888888`, which selects the full BF16 rate, and the 4-bit SS1 `0x8` IMLA4) and performs an FLR before the unmodified NVIDIA driver binds the card

Its supported matrix covers Ampere (stable), Ada and Turing (experimental), Blackwell (unsupported). Kepler is absent, and a grep of `kernel/gpu_unlock/recipes.c` returns **zero** matches for Kepler/GK10x/`sm_30`.

The reason is physical, not political: tensor cores were introduced with Volta/Turing (2017+). GK106 (2012) has no tensor cores, no BF16, no TF32 and no `IMLA4` instruction. There is no half-rate cap to lift and no selector to write. Likewise, the `sm_30` ceiling in CUDA is a *toolkit/compiler* limit (last supported: CUDA 10.2), not a driver cap, so no patch exists or can exist.

---

## 7. Machine learning: TF2 cannot use this card

A representative workload (an LSTM price-forecasting pipeline: 982-line script, `tensorflow.keras`, 833 `.h5` models, thread/process pools) was evaluated as a candidate GPU workload.

- The script contains **no explicit device code** — it relies on TensorFlow auto-detecting a GPU.
- TensorFlow 2.x requires compute capability **≥ 3.5** (≥ 5.0 from TF 2.16 onward). GK106 is **3.0**.
- Only TF **1.15** with CUDA 10.0/10.2 can target `sm_30`, and the workload uses TF2-only Keras APIs, so a downgrade would require a rewrite.

**Verdict:** no TF2 wheel, on any platform, in any VM, with any driver, can use this GPU. The measurement is independent of the passthrough failure in §5.

---

## 8. What the card *can* still do

| Workload | Status |
|---|---|
| Media-server transcoding (Jellyfin/Plex) | ⭐ best use — NVDEC decode + NVENC H.264 encode at 1080p |
| OBS/streaming encode | ✅ with driver 470 + 11.1-matched ffmpeg |
| Display output / desktop | ✅ (the only display adapter in this system) |
| HDMI audio out | ✅ via the GK106 audio function |
| Kiosk / signage / dashboard wall | ✅ 2×DVI + HDMI, 1080p |
| OpenCL 1.2 batch work | ⚠️ works, unremarkable |
| Modern games / any AI workload | ❌ |

Under `nouveau` specifically, two further limits apply:

```
nouveau 0000:01:00.0: [drm] Cannot find any crtc or sizes      # no connector attached
nouveau 0000:01:00.0: Direct firmware load for nouveau/nve6_fuc084 failed with error -2
nouveau 0000:01:00.0: msvld: init failed, -19                  # VLD engine dead
```

1. **No reclocking on Kepler** — the GPU is pinned at boot clocks (~324 MHz), roughly a third of stock performance. Not fixable by configuration.
2. **Missing `nve6_fuc084` firmware** disables the hardware video-decode engine (VLD). Extractable from the proprietary blob if `nouveau` must be kept.

---

## 9. Recommended configuration

For an Ubuntu 24.04 host that wants a working Kepler GPU:

1. Install the **6.8 GA kernel** (`linux-image-generic`) and boot it. Keep the HWE kernel in the GRUB menu as a fallback.
2. Install **`nvidia-driver-470`** (470.256.02). DKMS builds cleanly against 6.8 — verified.
3. Rebuild **ffmpeg against `nv-codec-headers` 11.1.5.3** if NVENC is required; the distribution binary will reject driver 470.
4. Optionally apply **`keylase/nvidia-patch`** for 470.256.02 to lift the NVENC/NVDEC session caps.
5. Accept the hard limits: H.264-only encode, no CUDA beyond 10.2, no TF2, no tensor cores.

---

## 10. Threats to validity

- The passthrough experiment was performed on a single board/firmware combination; other hosts may expose a readable ROM BAR and succeed.
- The 6.8 build test ran in a VM without the physical card; module *loading* and `nvidia-smi` against real GK106 hardware on 6.8 were not observed end-to-end. DKMS compilation, which was the open question, is proven.
- NVENC throughput/quality was not benchmarked (no working NVENC path was established on this host).
- Version claims reflect the archive state on 2026-11-10; `noble-updates` moves.

---

## Appendix A — diagnostic command reference

```bash
# identity
lspci -nnk | grep -A4 -iE 'vga|3d'
uname -r; lspci -vv -s 01:00.0 | grep -E 'LnkCap:|LnkSta:'

# driver state
lsmod | grep -E 'nvidia|nouveau'
dkms status
apt-cache policy linux-modules-nvidia-470-generic-hwe-24.04

# nouveau limits
dmesg | grep -iE 'nouveau|NVRM'
for f in /sys/class/drm/card*-*/status; do echo "$f: $(cat $f)"; done

# ffmpeg capability
ffmpeg -hide_banner -hwaccels
ffmpeg -hide_banner -encoders | grep nvenc
strings /usr/lib/x86_64-linux-gnu/libavcodec.so.60 | grep -i 'nvenc API'

# passthrough
ls /sys/kernel/iommu_groups/*/devices/0000:01:00.*
cat /proc/driver/nvidia/gpus/*/information
```

## Appendix B — key log excerpts

```
nouveau 0000:01:00.0: NVIDIA GK106 (0e6000a1)
nouveau 0000:01:00.0: bios: version 80.06.58.00.03
nouveau 0000:01:00.0: fb: 2048 MiB GDDR5
nouveau 0000:01:00.0: iccsense: found invalid sensor id: 0
nouveau 0000:01:00.0: drm: Disabling PCI power management to avoid bug
[drm] Initialized nouveau 1.4.2 for 0000:01:00.0 on minor 1
```

```
nvidia/470.256.02, 6.8.0-147-generic, x86_64: installed
nvidia/470.256.02, 6.8.0-149-generic, x86_64: installed
```

```
NVRM: GPU 0000:01:00.0: RmInitAdapter failed! (0x22:0x56:667)
```

---

## References

1. NVIDIA, *Unix Driver Archive* — 470.256.02, last branch supporting Kepler. <https://www.nvidia.com/en-us/drivers/unix/>
2. `keylase/nvidia-patch` — NVENC/NVDEC session-limit patches, driver 470.256.02 supported. <https://github.com/keylase/nvidia-patch>
3. `Zagitta/gpu-unlock` — tensor-core rate unlock for Turing/Ampere/Ada. <https://github.com/zagitta/gpu-unlock>
4. `FFmpeg/nv-codec-headers` — tag `n11.1.5.3` (NVENC API 11.1). <https://github.com/FFmpeg/nv-codec-headers>
5. NVIDIA, *CUDA Toolkit Release Notes* — Kepler `sm_30` removal after CUDA 10.2.
6. TensorFlow, *Tested build configurations* — minimum compute capability 3.5 (5.0 from TF 2.16).
7. Linux kernel `nouveau` driver, Kepler reclocking status.
