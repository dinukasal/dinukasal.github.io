/* Theme handling: set before first paint, then wire up every .theme-toggle. */
(function () {
    var root = document.documentElement;
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function stored() {
        try { return localStorage.getItem('theme'); } catch (e) { return null; }
    }

    function current() {
        return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function sync() {
        var isDark = current() === 'dark';
        var label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
        var buttons = document.querySelectorAll('.theme-toggle');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].setAttribute('aria-label', label);
            buttons[i].setAttribute('title', label);
            buttons[i].setAttribute('aria-pressed', isDark ? 'true' : 'false');
        }
    }

    /* Apply immediately (this file is loaded synchronously in <head>). */
    var saved = stored();
    root.setAttribute('data-theme', saved === 'dark' || saved === 'light' ? saved : (mq && mq.matches ? 'dark' : 'light'));

    function start() {
        sync();

        var buttons = document.querySelectorAll('.theme-toggle');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener('click', function () {
                var next = current() === 'dark' ? 'light' : 'dark';
                root.setAttribute('data-theme', next);
                try { localStorage.setItem('theme', next); } catch (e) { }
                sync();
            });
        }

        /* Follow the OS only while the visitor has never chosen explicitly. */
        if (mq) {
            var onChange = function (e) {
                if (stored()) return;
                root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
                sync();
            };
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
