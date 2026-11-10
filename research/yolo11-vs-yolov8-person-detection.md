# YOLOv8 vs YOLO11 for Person Detection in CCTV Footage

**A field benchmark on security-camera frames: is a newer detector actually more reliable?**

*Test date: 2026-11-03 · Ultralytics 8.4.184/8.4.198 · RTX 2060 SUPER 8 GB + GTX 1050 4 GB*

---

## Abstract

Ultralytics' YOLO11 is newer, faster, and scores higher mean confidence than YOLOv8. On the standard COCO-style benchmark images used to market it, it detects small and partially occluded people that YOLOv8 misses. So when a home CCTV stack needed a better person detector, the obvious move was to upgrade.

It was measured on 30 real frames from a seven-camera installation instead. **YOLO11 found fewer people than YOLOv8n on this footage — including people that were plainly visible.** Every YOLO11 variant from `n` to `l` detected a person in fewer frames than the older nano model, and three of the misses were confirmed by eye to be real people (a person on a ladder hanging laundry, a person standing at a door, a person walking up a staircase). On a generic photograph the same models behaved exactly as advertised — YOLO11 was clearly superior. The degradation is specific to surveillance imagery, and it is large enough that the upgrade was **rejected** in favour of keeping YOLOv8n.

This report documents the numbers, the likely cause, and why "newer model" is not a safe default in this domain.

---

## 1. Background

The system under test is a home CCTV installation: seven ONVIF/DVRIP cameras feeding a go2rtc relay, with a Python collector performing continuous person detection in software. Detection runs YOLOv8n at `imgsz=640`, person class only, with a confidence threshold of `0.40` deciding whether a sighting is reported. A missed person means a missed event record and a missed evidence snapshot, so **recall matters more than precision**.

The question asked was narrow: *does replacing YOLOv8n with a YOLO11 model of similar or larger size improve person recall on this footage?*

---

## 2. Test environment

| Component | Detail |
| --- | --- |
| Primary GPU | NVIDIA GeForce RTX 2060 SUPER, 8 GB (Ubuntu 24.04, driver 582.78) |
| Fallback GPU | NVIDIA GeForce GTX 1050, 4 GB (Windows 11, driver 582.78) |
| Inference stack | PyTorch 2.14.1+cu130, Ultralytics 8.4.184 (Linux), 8.4.198 (Windows) |
| Models | `yolov8n.pt`, `yolo11n.pt`, `yolo11s.pt`, `yolo11m.pt`, `yolo11l.pt` (official weights) |
| Input | 30 frames, 1920×1080 JPEG, captured by the production collector |
| Inference size | `imgsz=640` |
| Class filter | `person` (COCO class 0) only |
| Timing | Wall-clock per `model.predict()` call, GPU warm, single image per call |

Frames were taken from the collector's own event archive — that is, frames where the running system had already recorded a person. This mirrors production input rather than curated test imagery.

---

## 3. Method

For each model:

1. Load official weights, run one warm-up inference to allocate the CUDA context and cuDNN kernels.
2. Run every frame through `model.predict(frame, imgsz=640, device=0)`.
3. Record the number of `person` detections and the maximum confidence on that frame.
4. Aggregate: mean latency, total people found, and frames containing a person at thresholds 0.25 / 0.30 / 0.40.

Accuracy was also eyeballed on the disputed frames — a disagreement is only meaningful once you know whether the person is really there.

---

## 4. Results — primary GPU (RTX 2060 SUPER)

| Model | ms/frame | People found | frames ≥0.25 | ≥0.30 | **≥0.40** |
| --- | --- | --- | --- | --- | --- |
| **yolov8n** (incumbent) | 26 | **36** | **30** | **30** | **24** |
| yolo11n | 18 | 32 | 23 | 21 | 19 |
| yolo11s | 19 | 26 | 20 | 20 | 17 |
| yolo11m | 27 | 22 | 20 | 19 | 19 |
| yolo11l | 30 | 23 | 20 | 20 | 20 |

The trend is monotonic in the wrong direction: every YOLO11 model detected a person in **fewer** frames than YOLOv8n, at every threshold, including the thresholds below the production cut-off. YOLO11 is 30–40 % faster and reports higher confidence values, but on frames it still recognised at all.

Note that `yolo11s` and `yolo11m` scored *worse* than `yolo11n` — the ranking is not simply a function of capacity, which is characteristic of a domain-shift effect rather than an under-trained model.

---

## 5. Results — fallback GPU (GTX 1050, 6 frames)

| Model | avg ms/frame |
| --- | --- |
| yolov8n | 44 |
| yolo11n | 36 |
| yolo11s | 42 |

Consistent with the primary GPU: YOLO11 is faster here too. Speed was never the constraint.

---

## 6. Per-frame detail (RTX 2060 SUPER)

Maximum person confidence per frame; `—` means no person was detected at all. Rows 07, 08 and 20 are the visually confirmed cases discussed in §8.

| Frame | yolov8n | yolo11n | yolo11s |
| --- | --- | --- | --- |
| 00 | 0.86 | 0.69 | 0.87, 0.35 |
| 01 | 0.89, 0.84 | 0.86, 0.72 | 0.92, 0.87 |
| 02 | 0.83 | 0.89 | 0.93 |
| 03 | 0.55 | 0.76 | 0.71 |
| 04 | 0.41 | 0.26 | — |
| 05 | 0.67 | 0.84 | 0.90 |
| 06 | 0.85 | 0.85 | 0.92 |
| **07** | **0.42** | **—** | **—** |
| **08** | **0.58** | **0.39** | **—** |
| 09 | 0.71, 0.70 | 0.63, 0.36 | 0.74, 0.69 |
| 10 | 0.35 | — | — |
| 11 | 0.39 | — | — |
| 12 | 0.50 | 0.68 | 0.37 |
| 13 | 0.60 | 0.75 | 0.34 |
| 14 | 0.90 | 0.91 | 0.93 |
| 15 | 0.85 | 0.86 | 0.90 |
| 16 | 0.90 | 0.90 | 0.93 |
| 17 | 0.44, 0.37 | 0.31 | 0.33 |
| 18 | 0.43 | — | — |
| 19 | 0.32 | 0.42, 0.29 | — |
| **20** | **0.47** | **—** | **0.92** |
| 21 | 0.48 | 0.45, 0.29 | 0.91 |
| 22 | 0.62, 0.28, 0.26 | 0.65, 0.47, 0.33 | 0.91, 0.43 |
| 23 | 0.88 | 0.89, 0.41 | 0.93, 0.36 |
| 24 | 0.33 | 0.26 | — |
| 25 | 0.56 | 0.74, 0.44 | 0.92, 0.47 |
| 26 | 0.38, 0.29 | — | — |
| 27 | 0.35 | — | — |
| 28 | 0.89 | 0.84 | 0.93 |
| 29 | 0.87 | 0.79 | 0.88 |

Frames where a person is found at all, at the production threshold of 0.40:

| Model | Frames |
| --- | --- |
| yolov8n | 24 / 30 |
| yolo11n | 19 / 30 |
| yolo11s | 17 / 30 |

---

## 7. Control experiment — a generic image

To separate "the models are broken" from "this footage is unusual", all five models were run on Ultralytics' standard `bus.jpg` test image.

| Model | Detections |
| --- | --- |
| yolov8n | bus 0.87; person 0.87 / 0.85 / 0.83; person 0.26; stop sign 0.26 |
| yolo11n | bus 0.94; person 0.89 / 0.88 / 0.86 / 0.62 |
| yolo11s | bus 0.93; person 0.90 / 0.88 / 0.87 / 0.66 |
| yolo11m | bus 0.93; person 0.92 / 0.91 / 0.89 / 0.79 |
| yolo11l | bus 0.94; person 0.91 / 0.91 / 0.89 / 0.82 |

Here YOLO11 behaves exactly as advertised: it finds the small background person at 0.62–0.82 where YOLOv8n barely registers it at 0.26, and confidence rises with model size. **The models and the inference stack are correct.** The difference in §4 is a property of the camera frames.

---

## 8. Visually confirmed misses

Three disputed frames were opened and inspected. In all three the person is unambiguous.

| Frame | Scene | yolov8n | yolo11n | yolo11s |
| --- | --- | --- | --- | --- |
| 07 | Person on a ladder, hanging laundry above a raised frame | 0.42 | — | — |
| 08 | Woman in a light top and dark skirt standing at a doorway | 0.58 | 0.39 | — |
| 20 | Person walking up an interior staircase | 0.47 | — | 0.92 |

These are typical residential CCTV events — precisely the ones an event system exists to capture. That YOLO11 dropped them while the older nano model retained them is what ruled the upgrade out.

---

## 9. Discussion — why newer is worse here

The frames differ from COCO-style imagery in ways that are known to hurt detectors:

- **Burned-in OSD text.** Every frame carries a large date/time stamp and a camera name overlay near the subject.
- **Wide-angle, low-mounted optics.** People appear small, edge-on and strongly keystoned rather than centred and upright.
- **Night/IR and compression artefacts.** Heavy noise reduction and blocking from low-bitrate RTSP streams.
- **Occlusion by fixtures.** Doorways, railings, ladders and furniture break up the silhouette.
- **Extreme aspect ratios.** One camera is 2304×2592 (portrait), which after letterboxing to 640 leaves the subject occupying very few pixels.

A plausible explanation for the inversion is that YOLO11's anchor-free head and its training distribution favour clean, well-centred subjects, and are less forgiving of the heavy OSD overlay and edge-framing that dominate this domain. Whatever the mechanism, the practical consequence is clear: **on this data the newer model is less reliable, not more.**

### Sample bias — stated plainly

The 30 frames were selected from events where **YOLOv8n had already detected a person**. That biases the sample toward YOLOv8n's strengths and is not a neutral evaluation of the two families. It is adequate for the decision at hand (replacing a working detector), but it is not a general accuracy claim, and a proper study would require a hand-labelled sample of frames independent of either model.

---

## 10. Conclusion and decision

- YOLO11 is **faster** (18–30 ms vs 26 ms) and reports **higher confidence** on what it does detect.
- YOLO11 detects **fewer people** on this footage at every threshold tested, from `n` to `l`.
- Three of those misses were verified by eye as real people in typical event scenes.
- On a generic image the same models outperform YOLOv8n, so nothing is misconfigured.

**Decision: the production detector remains YOLOv8n.**

For deployments where latency dominates and recall can be traded, YOLO11n remains attractive — it is ~30 % faster. For a system whose purpose is to not miss people, the benchmark does not support the upgrade.

A hybrid (run both models and accept a detection if either fires) would recover recall at roughly 50 ms/frame on this GPU, still far below the scan interval. It was not adopted because the second model only exists to correct the first model's regressions, and it doubles the memory footprint on a 4 GB card.

---

## 11. Reproduction

```python
import glob, os, time
import torch
from ultralytics import YOLO

frames = sorted(glob.glob("/path/to/frames/*.jpg"))
print(torch.cuda.get_device_name(0))

for w in ("yolov8n.pt", "yolo11n.pt", "yolo11s.pt", "yolo11m.pt", "yolo11l.pt"):
    m = YOLO(w)
    m.predict(frames[0], imgsz=640, device=0, verbose=False)      # warm up

    total = 0.0
    hit40 = people = 0
    for f in frames:
        t = time.time()
        r = m.predict(f, imgsz=640, device=0, verbose=False)[0]
        total += (time.time() - t) * 1000

        confs = [float(c) for c, cl in zip(r.boxes.conf.tolist(), r.boxes.cls.tolist())
                 if r.names[int(cl)] == "person"]
        people += len(confs)
        if confs and max(confs) >= 0.40:
            hit40 += 1

    print(f"{w:12} {total/len(frames):5.0f} ms  people={people:3}  frames@0.40={hit40}/{len(frames)}")
```

Weights are the official Ultralytics releases, e.g.
`https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11l.pt`.

---

## 12. Limitations

- 30 frames, one installation, daylight and IR mixed; not a statistically robust sample.
- Frames were pre-filtered by the incumbent model's own detections (see §9).
- Only the max-confidence detection per frame is reported; localisation quality (IoU/mAP) was not measured.
- Latency is single-image wall clock, not sustained throughput under batching or concurrent camera load.
- Two GPU generations were tested but only the RTX 2060 SUPER received the full 30-frame comparison.

---

## Appendix — raw summary

```
RTX 2060 SUPER, 30 frames, imgsz=640, person only
yolov8n.pt      26 ms  people= 36  frames@0.25=30  @0.30=30  @0.40=24
yolo11n.pt      18 ms  people= 32  frames@0.25=23  @0.30=21  @0.40=19
yolo11s.pt      19 ms  people= 26  frames@0.25=20  @0.30=20  @0.40=17
yolo11m.pt      27 ms  people= 22  frames@0.25=20  @0.30=19  @0.40=19
yolo11l.pt      30 ms  people= 23  frames@0.25=20  @0.30=20  @0.40=20

GTX 1050, 6 frames
yolov8n.pt      44 ms
yolo11n.pt      36 ms
yolo11s.pt      42 ms
```

## References

1. Ultralytics, *YOLO11* model documentation and official weights. <a href="https://docs.ultralytics.com/models/yolo11/">https://docs.ultralytics.com/models/yolo11/</a>
2. Ultralytics, *YOLOv8* model documentation. <a href="https://docs.ultralytics.com/models/yolov8/">https://docs.ultralytics.com/models/yolov8/</a>
3. Jocher, G. et al., *Ultralytics YOLO* (software), AGPL-3.0. <a href="https://github.com/ultralytics/ultralytics">https://github.com/ultralytics/ultralytics</a>
4. Lin, T.-Y. et al., *Microsoft COCO: Common Objects in Context*, ECCV 2014.
