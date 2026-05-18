import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import { networkInterfaces } from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import type { BrowserWindow } from 'electron';

/**
 * Local cast server — broadcasts content to receivers on the same
 * Wi-Fi network. Two modes:
 *
 *   - **mirror** (`setMirrorSource(window)`): capture the given
 *     BrowserWindow at ~5 fps, encode to JPEG, broadcast as base64
 *     data URLs. Used by the Cast page's full-app mirror.
 *
 *   - **html** (`setHtmlPayload(html)`): send a single self-contained
 *     HTML document over the WebSocket. The receiver replaces its
 *     own document with it. Used by the per-song "Lyrics only" /
 *     "Lyrics + chords" cast modes from the song toolbar.
 *
 * Switching modes via the corresponding setter is the only way to
 * change behavior — the server doesn't try to do both at once.
 */

export type CastView = 'app' | 'song' | 'fullscreen' | 'performance';
export type CastBroadcastMode = 'mirror' | 'html' | 'idle';

export interface CastStatus {
  running: boolean;
  host: string | null;
  port: number | null;
  clients: number;
  view: CastView;
  mode: CastBroadcastMode;
}

const DEFAULT_PORT = 4321;
const FRAME_INTERVAL_MS = 200;
const JPEG_QUALITY = 70;

function getLocalIp(): string {
  const ifaces = networkInterfaces();
  const candidates: string[] = [];
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      candidates.push(net.address);
    }
  }
  const home = candidates.find((ip) => ip.startsWith('192.168.'));
  if (home) return home;
  const ten = candidates.find((ip) => ip.startsWith('10.'));
  if (ten) return ten;
  const onetwo = candidates.find((ip) => {
    const m = ip.match(/^172\.(\d+)\./);
    if (!m) return false;
    const second = parseInt(m[1]!, 10);
    return second >= 16 && second <= 31;
  });
  if (onetwo) return onetwo;
  const real = candidates.find((ip) => !ip.startsWith('169.254.'));
  if (real) return real;
  return candidates[0] ?? '127.0.0.1';
}

/**
 * Inline HTML for the receiver page. Self-contained — no React, no
 * external deps. The WebSocket carries one of three message kinds:
 *   - `data:image/jpeg;base64,...` strings → JPEG mirror frames,
 *     dropped into the `<img>` tag.
 *   - JSON with `{"type":"html","html":"..."}` → full HTML document
 *     payload; the receiver swaps its own document for it.
 *   - JSON with `{"type":"clear"}` → reset to the connecting screen.
 *
 * The receiver auto-reconnects on disconnect.
 */
function receiverHtml(view: CastView): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Song Chords — Cast (${view})</title>
<style>
  html, body {
    margin: 0;
    padding: 0;
    /* Use the dynamic viewport units so the receiver always sizes to
       the visible area, not the full document height. Without this,
       on desktop browsers the captured frame slightly overflows the
       visible viewport (the browser's URL bar / tab strip pushes the
       top of the image off-screen). 100dvh is supported on all
       evergreen browsers; the 100% fallback keeps very old browsers
       working. */
    height: 100%;
    height: 100dvh;
    width: 100%;
    width: 100dvw;
    background: #0f172a;
    color: #94a3b8;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
    -webkit-tap-highlight-color: transparent;
  }
  #frame {
    position: fixed;
    width: 100vw;
    height: 100dvh;
    /* Always preserve the WHOLE desktop window on the receiver — top
       toolbar, sidebar, and content — even when the receiver's aspect
       ratio differs from the desktop window. object-fit contain
       guarantees no cropping; any extra space becomes a thin
       letterbox bar that blends with the dark page background.
       Sizing the frame with 100dvh ensures we use the VISIBLE
       viewport, so the browser's URL bar / tab strip can't push the
       top of the image off-screen. */
    object-fit: contain;
    background: #0f172a;
    display: none;
    /* User zoom/pan is driven through these custom properties so the
       single transform below composes cleanly with the orientation
       rotate (set per-media-query). --fs-rot holds the base rotation
       (none in landscape, 90deg in portrait); --z / --px / --py are
       the live pinch-zoom scale and pan offsets. Order matters: pan
       then zoom then base-rotate, all around the centered element. */
    --fs-rot: rotate(0deg);
    --z: 1;
    --px: 0px;
    --py: 0px;
    transform: translate(-50%, -50%) translate(var(--px), var(--py)) scale(var(--z)) var(--fs-rot);
    /* Centered on the viewport. NOTE: do not add the inset shorthand
       here — it resets top/left, so listing it after these would
       re-jam the frame into a corner (the exact centering bug fixed
       previously for the portrait rule). Use the individual offsets
       only. */
    top: 50%;
    left: 50%;
    right: auto;
    bottom: auto;
    transform-origin: center center;
    touch-action: none;
    /* Promote to its own compositor layer. The mirror img gets a new
       src ~5x/sec; without this the per-frame decode/paint runs on
       the same layer as the pan transform and the drag stutters.
       will-change keeps the transformed element GPU-composited so
       pan stays smooth regardless of the frame churn. */
    will-change: transform;
    backface-visibility: hidden;
  }
  /* ANY device held in portrait (phone OR tablet/iPad — no width
     gate): rotate the landscape desktop capture 90 degrees so it is
     ALWAYS cast horizontally and fills the tall screen. Previously
     this was gated on max-width:640px, so tablets/iPads in portrait
     showed a tiny letterboxed strip instead of rotating. Swapping
     width/height (100vh / 100vw) before the rotate makes the rotated
     frame occupy the full screen real estate. */
  @media (orientation: portrait) {
    #frame {
      /* Portrait: the frame box is sized to the SWAPPED viewport
         (pre-rotation width = screen height, height = screen width)
         and --fs-rot adds the 90deg turn, so the single composed
         transform on the base rule (pan -> zoom -> rotate, around
         the centered element) fills the portrait screen with the
         landscape capture, AND user pinch-zoom keeps working because
         it shares that same transform. We only override the swapped
         dimensions and the rotation variable here. */
      width: 100vh;
      width: 100dvh;
      height: 100vw;
      height: 100dvw;
      --fs-rot: rotate(90deg);
    }
  }
  /* HTML payload host — fills the viewport when active. The
     payload itself sets its own background / padding / fonts. */
  #html-host {
    position: fixed;
    inset: 0;
    overflow: auto;
    background: #0f172a;
    display: none;
  }
  #html-host iframe { width: 100%; height: 100%; border: 0; display: block; }
  #status {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    padding: 24px;
    text-align: center;
    pointer-events: none;
  }
  #status .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #f59e0b;
    box-shadow: 0 0 6px #f59e0b;
    animation: pulse 1s ease-in-out infinite;
  }
  #status.live .dot { background: #22c55e; box-shadow: 0 0 6px #22c55e; animation: none; }
  #status .label { font-size: 13px; letter-spacing: 0.04em; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  /* Receiver-side fullscreen toggle. Sits in the top-right corner so
     it doesn't cover lyrics; only visible on hover / tap so it
     doesn't permanently dim a corner of the cast view. */
  #fs-toggle {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 100;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.65);
    color: #f1f5f9;
    border: 1px solid rgba(241, 245, 249, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0.35;
    transition: opacity 180ms;
    -webkit-tap-highlight-color: transparent;
  }
  #fs-toggle:hover, #fs-toggle:focus, body:hover #fs-toggle { opacity: 1; }
  #fs-toggle svg { width: 16px; height: 16px; display: block; }
  @media (hover: none) {
    /* Touch devices don't fire hover — keep the button visible. */
    #fs-toggle { opacity: 0.7; }
  }
  /* Pseudo-fullscreen fallback for iOS (every iOS browser is WebKit
     and none do real element fullscreen). True OS-chrome hiding is
     impossible for non-<video> content on iOS — that is an Apple
     platform limit we cannot bypass. What we CAN do, and what makes
     the button actually do something visible on iOS, is:
       1. let the page be 1px taller than the viewport and scroll to
          the top so iOS Safari/Chrome COLLAPSES its URL bar (this is
          the only way to reclaim that strip; the previous code locked
          the body with position:fixed + overflow:hidden, which made
          the URL-bar-collapsing scroll a no-op — so pseudo-fs did
          nothing visible on iOS, the reported bug);
       2. paint the page background opaque black and push the cast
          frame under the safe-area insets so it fills the maximum
          real estate the OS allows, edge to edge.
     100dvh already tracks the post-collapse height. We deliberately
     do NOT set position:fixed on html/body here. */
  html.pseudo-fs {
    /* 1px taller than the visual viewport so a one-shot scroll can
       trigger the URL-bar collapse; dvh keeps it exact afterwards. */
    min-height: calc(100dvh + 1px);
    background: #000;
  }
  html.pseudo-fs body { background: #000; }
  html.pseudo-fs #frame {
    /* Cover the whole dynamic viewport INCLUDING the safe-area inset
       region (notch / home indicator) so nothing letterboxes. */
    height: 100dvh;
    height: calc(100dvh + env(safe-area-inset-top) + env(safe-area-inset-bottom));
  }
  @media (orientation: portrait) {
    html.pseudo-fs #frame {
      width: 100dvh;
      width: calc(100dvh + env(safe-area-inset-top) + env(safe-area-inset-bottom));
      height: 100dvw;
    }
  }
  /* Hide the receiver's own chrome while pseudo-fs is on so the cast
     is as clean as a real fullscreen — only the exit button remains. */
  html.pseudo-fs #status { display: none !important; }
</style>
</head>
<body>
  <img id="frame" alt="cast frame" />
  <div id="html-host"></div>
  <div id="status"><div class="dot"></div><div class="label">Connecting…</div><div class="sub" style="font-size:11px;opacity:0.7;margin-top:4px"></div></div>
  <button id="fs-toggle" aria-label="Toggle full screen" title="Toggle full screen">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path id="fs-icon-enter" d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>
      <path id="fs-icon-exit" d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" style="display:none"/>
    </svg>
  </button>
  <script>
    (function () {
      var img = document.getElementById('frame');
      var host = document.getElementById('html-host');
      var status = document.getElementById('status');
      var label = status.querySelector('.label');
      var sub = status.querySelector('.sub');
      var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
      var ws;
      var lastFrame = 0;
      var frames = 0;
      var inHtmlMode = false;

      function setSub(t) { if (sub) sub.textContent = t || ''; }

      function showFrame(dataUrl) {
        if (inHtmlMode) {
          host.style.display = 'none';
          host.innerHTML = '';
          inHtmlMode = false;
        }
        img.src = dataUrl;
        frames++;
        if (img.style.display !== 'block') {
          img.style.display = 'block';
          status.style.display = 'none';
          status.classList.add('live');
        }
        lastFrame = Date.now();
      }

      function showHtml(html) {
        // Render the payload inside a sandboxed iframe so its <head>
        // / <body> / <script> can't conflict with the receiver scaffold.
        // srcdoc lets us inject the entire document in one go.
        if (img.style.display === 'block') img.style.display = 'none';
        host.innerHTML = '';
        var iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
        iframe.setAttribute('srcdoc', html);
        host.appendChild(iframe);
        host.style.display = 'block';
        status.style.display = 'none';
        status.classList.add('live');
        inHtmlMode = true;
      }

      function showClear() {
        img.style.display = 'none';
        host.style.display = 'none';
        host.innerHTML = '';
        inHtmlMode = false;
        status.style.display = 'flex';
        status.classList.remove('live');
        label.textContent = 'Waiting…';
        setSub('');
      }

      function handleMessage(data) {
        if (typeof data !== 'string') return;
        // JPEG-frame fast path.
        if (data.charAt(0) === 'd' && data.indexOf('data:image') === 0) {
          showFrame(data);
          return;
        }
        // Otherwise expect JSON.
        var msg;
        try { msg = JSON.parse(data); } catch (e) {
          setSub('Bad message: ' + data.slice(0, 40));
          return;
        }
        if (msg && msg.type === 'html' && typeof msg.html === 'string') {
          showHtml(msg.html);
          return;
        }
        if (msg && msg.type === 'clear') {
          showClear();
          return;
        }
        setSub('Unknown message type: ' + (msg && msg.type));
      }

      function connect() {
        setSub('Connecting to ' + url);
        try {
          ws = new WebSocket(url);
        } catch (err) {
          label.textContent = 'WebSocket failed';
          setSub(String(err && err.message || err));
          setTimeout(connect, 2000);
          return;
        }
        ws.onopen = function () {
          label.textContent = 'Waiting for content…';
          setSub('Connected to ' + url);
        };
        ws.onmessage = function (ev) { handleMessage(ev.data); };
        ws.onclose = function (ev) {
          label.textContent = 'Disconnected. Reconnecting…';
          setSub('Close code ' + ev.code + (ev.reason ? ' (' + ev.reason + ')' : ''));
          status.style.display = 'flex';
          status.classList.remove('live');
          setTimeout(connect, 1500);
        };
        ws.onerror = function () { setSub('WebSocket error'); try { ws.close(); } catch (e) {} };
      }
      connect();

      // Stale-frame watchdog only matters in mirror mode.
      setInterval(function () {
        if (img.style.display === 'block' && Date.now() - lastFrame > 8000) {
          status.style.display = 'flex';
          status.classList.remove('live');
          label.textContent = 'Stream paused…';
          setSub('Last frame ' + Math.floor((Date.now() - lastFrame) / 1000) + 's ago · total ' + frames);
        }
      }, 2000);

      // Fullscreen toggle. The native Fullscreen API works on desktop
      // and Android Chrome, but iPhone Safari does NOT implement it
      // for non-<video> elements (requestFullscreen is undefined /
      // a silent no-op) — that's why the button "did nothing on iOS".
      // So: try the real API; if it isn't actually available, fall
      // back to a CSS pseudo-fullscreen (the .pseudo-fs class) which
      // expands the page to the full dynamic viewport and locks
      // scroll. Either way the button ALWAYS does something visible.
      var fsBtn = document.getElementById('fs-toggle');
      var fsEnterIcon = document.getElementById('fs-icon-enter');
      var fsExitIcon = document.getElementById('fs-icon-exit');
      var docEl = document.documentElement;

      // EVERY browser on iOS / iPadOS is WebKit (Chrome, Edge, Firefox
      // on iOS are all Safari underneath) and NONE support the
      // Fullscreen API for a non-<video> element. webkitRequestFullscreen
      // often EXISTS on the element (so a feature test passes) yet is a
      // silent no-op that returns undefined and never throws — so the
      // old "try native, fall back on reject" logic could neither
      // succeed nor reliably detect failure on iOS Chrome. Detect iOS
      // up front and skip straight to the CSS pseudo-fullscreen path.
      // (iPadOS 13+ reports as "MacIntel" with touch, hence the
      // maxTouchPoints check.)
      function isIOS() {
        var ua = navigator.userAgent || '';
        if (/iPad|iPhone|iPod/.test(ua)) return true;
        return navigator.platform === 'MacIntel' &&
          (navigator.maxTouchPoints || 0) > 1;
      }

      function nativeEnter() {
        if (isIOS()) return null; // force the pseudo-fs fallback
        return docEl.requestFullscreen || docEl.webkitRequestFullscreen || null;
      }
      function nativeExit() {
        return document.exitFullscreen || document.webkitExitFullscreen || null;
      }
      function nativeActive() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement);
      }
      function pseudoActive() {
        return docEl.classList.contains('pseudo-fs');
      }
      function anyFsActive() { return nativeActive() || pseudoActive(); }

      function syncFsIcon() {
        var on = anyFsActive();
        if (fsEnterIcon) fsEnterIcon.style.display = on ? 'none' : '';
        if (fsExitIcon) fsExitIcon.style.display = on ? '' : 'none';
      }

      function enterPseudo() {
        docEl.classList.add('pseudo-fs');
        syncFsIcon();
        // Collapse the iOS URL bar. The page is now 1px taller than
        // the viewport (see .pseudo-fs CSS); scrolling to the bottom
        // makes iOS hide the address bar. A single synchronous
        // scrollTo is unreliable — iOS needs it AFTER the class's
        // layout change and sometimes a second nudge — so retry on
        // rAF and a short timeout. Harmless on non-iOS (page isn't
        // scrollable there, scrollTo is a no-op).
        var nudge = function () { window.scrollTo(0, document.body.scrollHeight); };
        requestAnimationFrame(function () { requestAnimationFrame(nudge); });
        setTimeout(nudge, 120);
        setTimeout(nudge, 360);
      }
      function exitPseudo() {
        docEl.classList.remove('pseudo-fs');
        syncFsIcon();
      }

      if (fsBtn) {
        fsBtn.addEventListener('click', function () {
          if (anyFsActive()) {
            // Exit whichever mode is active.
            if (nativeActive()) {
              var exit = nativeExit();
              if (exit) { try { exit.call(document); } catch (e) {} }
            }
            if (pseudoActive()) exitPseudo();
            return;
          }
          // Try the real API first. requestFullscreen returns a
          // Promise that REJECTS on iOS-style unsupported cases —
          // catch that and fall back to pseudo-fullscreen. Some old
          // WebKit returns undefined instead of a Promise; handle both.
          var enter = nativeEnter();
          if (enter) {
            var ret;
            try { ret = enter.call(docEl); } catch (e) { ret = null; }
            if (ret && typeof ret.then === 'function') {
              ret.catch(function () { enterPseudo(); });
              // Safety net: if neither native nor pseudo engaged
              // shortly after the gesture, force the pseudo fallback.
              setTimeout(function () { if (!anyFsActive()) enterPseudo(); }, 300);
            } else if (!nativeActive()) {
              // No Promise AND not in fullscreen → unsupported (iOS).
              enterPseudo();
            }
          } else {
            enterPseudo();
          }
        });
        document.addEventListener('fullscreenchange', syncFsIcon);
        document.addEventListener('webkitfullscreenchange', syncFsIcon);
      }

      // ── Pinch / wheel zoom + drag pan on the mirror frame ──
      // ONLY enabled while fullscreen (native OR pseudo) is on, per
      // product spec: the audience can zoom into a region of the cast
      // app once it's filling the screen. Outside fullscreen the
      // gestures are inert so normal page scroll/tap is unaffected.
      //
      // Zoom/pan are written to the CSS custom properties --z/--px/--py
      // which the #frame transform composes with the orientation
      // rotate, so this works identically in landscape and portrait.
      // In portrait the element is rotated 90deg and the pan translate
      // is applied BEFORE that rotate, so a raw screen delta would pan
      // along the wrong axis — we remap the screen delta into the
      // element's pre-rotation space (x' = y, y' = -x) so dragging
      // always moves the image the way the finger moves on screen.
      var MIN_Z = 1, MAX_Z = 6;
      var z = 1, px = 0, py = 0;
      var pointers = {};        // active pointers by id (screen coords)
      var pinchStartDist = 0, pinchStartZ = 1;
      var panLastX = 0, panLastY = 0, panning = false;
      var lastTapTime = 0;

      function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

      function applyZoom() {
        // Snap to exactly 1x near the bottom of the range. Pinch /
        // wheel approach 1.0 asymptotically (floating point), so an
        // exact === 1 test never fired and the view could never
        // return to the original size or clear its pan offset. Any
        // z within 2% of 1 collapses to a clean, unpanned fit.
        if (z < 1.02) { z = 1; px = 0; py = 0; }
        // Clamp pan SYMMETRICALLY in screen space. In the composed
        // transform (translate-50pct then translate px/py then scale
        // then rotate) the px/py translate is the OUTERMOST
        // parent/screen move — it is NOT inside the rotate — so px is
        // always screen-X and py is always screen-Y regardless of the
        // 90deg portrait rotation. The previous code (a) clamped py
        // against the small innerWidth in portrait, pinning vertical
        // pan to ~0 at low zoom (only pans sideways), and (b) the
        // move handler remapped axes for portrait, doubling the bug.
        // Fix: clamp both axes by zoom against the LARGER screen
        // dimension so
        // neither is starved, and let the user reach the whole image.
        var span = Math.max(window.innerWidth, window.innerHeight);
        var maxPan = Math.max(0, z - 1) * 0.5 * span;
        px = clamp(px, -maxPan, maxPan);
        py = clamp(py, -maxPan, maxPan);
        img.style.setProperty('--z', String(z));
        img.style.setProperty('--px', px + 'px');
        img.style.setProperty('--py', py + 'px');
      }
      function resetZoom() {
        z = 1; px = 0; py = 0; applyZoom();
      }

      // NOTE: zoom is intentionally NOT reset when entering/leaving
      // fullscreen — the user wants zoom + pan to behave the same in
      // both states, and a zoom set outside fullscreen should carry
      // over (and vice-versa). Manual reset is still available via
      // double-tap / double-click / pinching back to 1x.

      function zoomActiveAllowed() {
        // Active whenever the mirror image is showing — fullscreen is
        // NOT required (product spec: same zoom/pan behaviour in and
        // out of fullscreen).
        return img.style.display === 'block';
      }

      function dist(a, b) {
        var dx = a.x - b.x, dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
      }
      function ids() { return Object.keys(pointers); }

      // Track where a single-finger gesture started so pointerup can
      // tell a TAP (down+up, barely moved) from a PAN drag. The old
      // code did double-tap detection on the SECOND pointerdown, which
      // collided with pan-start and made "tap twice to reset" almost
      // impossible to trigger once zoomed — so the user couldn't get
      // back to the original size. Now: two quick low-movement taps
      // anywhere reset the zoom, reliably.
      var downX = 0, downY = 0, downMoved = false;

      img.addEventListener('pointerdown', function (e) {
        if (!zoomActiveAllowed()) return;
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        var k = ids();
        if (k.length >= 2) {
          // PINCH. Do NOT use pointer capture for multi-touch: on iOS
          // Safari capturing a 2nd pointer to the same element while
          // the 1st is captured stops the 1st pointer's pointermove
          // from firing, so the pinch distance never updates and zoom
          // appears dead ("can't zoom in/out"). Release any capture
          // taken for a prior single-finger pan; the full-screen img
          // hit-tests every touch anyway, so both moves still arrive.
          for (var ci = 0; ci < k.length; ci++) {
            try { img.releasePointerCapture(Number(k[ci])); } catch (er) {}
          }
          var a = pointers[k[0]], b = pointers[k[1]];
          pinchStartDist = dist(a, b);
          pinchStartZ = z;
          panning = false;
        } else {
          // SINGLE finger: capture so a pan that slides off the img
          // still tracks. Safe for one pointer.
          try { img.setPointerCapture(e.pointerId); } catch (er) {}
          panLastX = e.clientX; panLastY = e.clientY;
          downX = e.clientX; downY = e.clientY; downMoved = false;
          panning = z > 1; // only pan when zoomed in
        }
        e.preventDefault();
      });

      img.addEventListener('pointermove', function (e) {
        if (!zoomActiveAllowed()) return;
        if (!pointers[e.pointerId]) return;
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        var k = ids();
        if (k.length === 2) {
          // Pinch zoom about the gesture midpoint.
          var d = dist(pointers[k[0]], pointers[k[1]]);
          if (pinchStartDist > 0) {
            z = clamp(pinchStartZ * (d / pinchStartDist), MIN_Z, MAX_Z);
            applyZoom();
          }
          e.preventDefault();
        } else if (k.length === 1) {
          var dx = e.clientX - panLastX;
          var dy = e.clientY - panLastY;
          // Mark the gesture as a drag once it moves past a small
          // threshold (so a slightly-imperfect tap still counts as a
          // tap for double-tap reset).
          if (Math.abs(e.clientX - downX) > 6 || Math.abs(e.clientY - downY) > 6) {
            downMoved = true;
          }
          if (panning) {
            panLastX = e.clientX; panLastY = e.clientY;
            // px/py are SCREEN-space (the translate is the outermost
            // transform, outside the rotate), so the finger delta
            // maps 1:1 to both axes in every orientation. The old
            // portrait remap (px += dy / py += -dx) is what made the
            // image only pan sideways and feel stuck — removed.
            px += dx;
            py += dy;
            applyZoom();
          }
          e.preventDefault();
        }
      });

      function endPointer(e) {
        var hadOne = ids().length === 1;
        if (pointers[e.pointerId]) delete pointers[e.pointerId];
        try { img.releasePointerCapture(e.pointerId); } catch (er) {}
        var k = ids();
        if (k.length < 2) pinchStartDist = 0;
        if (k.length === 0) {
          panning = false;
          // TAP detection on release: a single finger that went down
          // and came up without moving (downMoved false). Two such
          // taps within 300ms = reset to original size. This is the
          // reliable "zoom back out" gesture.
          if (hadOne && !downMoved) {
            var now = Date.now();
            if (now - lastTapTime < 300) { resetZoom(); lastTapTime = 0; }
            else lastTapTime = now;
          }
        } else if (k.length === 1) {
          // Continue panning with the remaining finger.
          panLastX = pointers[k[0]].x; panLastY = pointers[k[0]].y;
          panning = z > 1;
        }
      }
      img.addEventListener('pointerup', endPointer);
      img.addEventListener('pointercancel', endPointer);

      // Desktop: wheel / trackpad zooms about center; dblclick resets.
      // Active whenever the mirror image is showing (no fullscreen
      // requirement). applyZoom() snaps to exactly 1x and clears pan
      // near the bottom of the range, so scrolling back out always
      // returns to the original fitted size.
      img.addEventListener('wheel', function (e) {
        if (!zoomActiveAllowed()) return;
        e.preventDefault();
        var factor = Math.exp(-e.deltaY * 0.0015);
        z = clamp(z * factor, MIN_Z, MAX_Z);
        applyZoom();
      }, { passive: false });
      img.addEventListener('dblclick', function (e) {
        if (!zoomActiveAllowed()) return;
        e.preventDefault();
        resetZoom();
      });

      // iOS Safari pinch fallback. Safari emits non-standard
      // gesturestart/gesturechange/gestureend with a cumulative
      // e.scale; this is far more reliable than synthesizing pinch
      // from two pointer events on iOS (where the 2nd touch's moves
      // are flaky). Listening on document so the gesture is caught
      // even if a touch starts just off the img. preventDefault also
      // stops Safari's OWN page pinch-zoom from hijacking it.
      var gestureStartZ = 1;
      document.addEventListener('gesturestart', function (e) {
        if (!zoomActiveAllowed()) return;
        e.preventDefault();
        gestureStartZ = z;
      }, { passive: false });
      document.addEventListener('gesturechange', function (e) {
        if (!zoomActiveAllowed()) return;
        e.preventDefault();
        z = clamp(gestureStartZ * e.scale, MIN_Z, MAX_Z);
        applyZoom();
      }, { passive: false });
      document.addEventListener('gestureend', function (e) {
        if (!zoomActiveAllowed()) return;
        e.preventDefault();
        applyZoom();
      }, { passive: false });
    })();
  </script>
</body>
</html>`;
}

class CastServer {
  private http: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private captureTimer: NodeJS.Timeout | null = null;
  private clients: Set<WebSocket> = new Set();
  private view: CastView = 'performance';
  private port: number = DEFAULT_PORT;
  private host: string = '127.0.0.1';
  private mirrorWindow: BrowserWindow | null = null;
  private capturing = false;
  private firstFrameLogged = false;
  /** Active broadcast mode. 'idle' is allowed: the server can be running
   *  with no clients yet but no content source either. */
  private mode: CastBroadcastMode = 'idle';
  /** Latest HTML payload (only used when mode === 'html'). New
   *  WebSocket connections receive this immediately after connecting. */
  private htmlPayload: string | null = null;

  async start(window: BrowserWindow, view: CastView): Promise<{ host: string; port: number }> {
    if (this.http) return { host: this.host, port: this.port };

    this.mirrorWindow = window;
    this.view = view;
    this.host = getLocalIp();
    // Default to mirror mode for backward compatibility with the Cast
    // page's full-app mirror behaviour.
    this.mode = 'mirror';

    return new Promise((resolve, reject) => {
      const http = createServer((req, res) => this.handleHttp(req, res));
      const wss = new WebSocketServer({ server: http });

      wss.on('connection', (ws) => {
        // eslint-disable-next-line no-console
        console.log('[cast] client connected, total =', this.clients.size + 1, 'mode =', this.mode);
        this.clients.add(ws);
        ws.on('close', () => {
          this.clients.delete(ws);
          // eslint-disable-next-line no-console
          console.log('[cast] client disconnected, remaining =', this.clients.size);
          if (this.clients.size === 0 && this.mode === 'mirror') this.stopCapture();
        });
        ws.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.warn('[cast] ws error', err);
        });
        // Resume / start whichever broadcast loop is appropriate.
        if (this.mode === 'mirror') {
          if (this.clients.size === 1) this.startCapture();
          void this.captureOne();
        } else if (this.mode === 'html' && this.htmlPayload) {
          // Send the cached HTML payload to the new client right away.
          try { ws.send(JSON.stringify({ type: 'html', html: this.htmlPayload })); }
          catch { /* ignore */ }
        }
      });

      http.on('error', (err) => {
        this.http = null;
        this.wss = null;
        reject(err);
      });

      http.listen(this.port, '0.0.0.0', () => {
        this.http = http;
        this.wss = wss;
        // eslint-disable-next-line no-console
        console.log(`[cast] server listening on http://${this.host}:${this.port} (bound to 0.0.0.0)`);
        resolve({ host: this.host, port: this.port });
      });
    });
  }

  async stop(): Promise<void> {
    this.stopCapture();
    this.firstFrameLogged = false;
    this.htmlPayload = null;
    this.mode = 'idle';
    for (const ws of this.clients) {
      try { ws.close(); } catch { /* ignore */ }
    }
    this.clients.clear();
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
      this.wss = null;
    }
    if (this.http) {
      await new Promise<void>((resolve) => this.http?.close(() => resolve()));
      this.http = null;
    }
  }

  setView(view: CastView): void { this.view = view; }

  /** Switch to mirror mode and capture the given window. Cancels any
   *  active HTML payload so the next captured frame replaces it on the
   *  receiver. Idempotent. */
  setMirrorSource(window: BrowserWindow): void {
    this.mirrorWindow = window;
    this.firstFrameLogged = false;
    this.htmlPayload = null;
    this.mode = 'mirror';
    if (this.clients.size > 0) this.startCapture();
    // eslint-disable-next-line no-console
    console.log('[cast] mode → mirror');
  }

  /** Switch to HTML payload mode. Caches the document and pushes it to
   *  every connected client. New clients get it on connect. */
  setHtmlPayload(html: string): void {
    this.stopCapture();
    this.htmlPayload = html;
    this.mode = 'html';
    const msg = JSON.stringify({ type: 'html', html });
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(msg); } catch { /* drop for this client */ }
      }
    }
    // eslint-disable-next-line no-console
    console.log('[cast] mode → html, payload size =', html.length, 'bytes');
  }

  status(): CastStatus {
    return {
      running: this.http !== null,
      host: this.http ? this.host : null,
      port: this.http ? this.port : null,
      clients: this.clients.size,
      view: this.view,
      mode: this.mode,
    };
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    // eslint-disable-next-line no-console
    console.log(`[cast] http ${req.method} ${url} from ${req.socket.remoteAddress}`);
    if (url === '/' || url.startsWith('/?')) {
      const html = receiverHtml(this.view);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html, 'utf8').toString(),
        'Cache-Control': 'no-store',
      });
      res.end(html);
      return;
    }
    if (url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  }

  private startCapture(): void {
    if (this.captureTimer) return;
    this.captureTimer = setInterval(() => void this.captureOne(), FRAME_INTERVAL_MS);
  }

  private stopCapture(): void {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
    this.capturing = false;
  }

  private async captureOne(): Promise<void> {
    if (this.mode !== 'mirror') return;
    if (!this.mirrorWindow || this.mirrorWindow.isDestroyed()) {
      // eslint-disable-next-line no-console
      console.warn('[cast] mirror window destroyed, stopping capture');
      this.stopCapture();
      return;
    }
    if (this.clients.size === 0) {
      this.stopCapture();
      return;
    }
    if (this.capturing) return;
    this.capturing = true;
    try {
      const image = await this.mirrorWindow.webContents.capturePage();
      if (image.isEmpty()) {
        // eslint-disable-next-line no-console
        console.warn('[cast] capturePage returned empty image (window minimized?)');
        return;
      }
      const jpeg = image.toJPEG(JPEG_QUALITY);
      if (jpeg.length === 0) {
        // eslint-disable-next-line no-console
        console.warn('[cast] toJPEG produced empty buffer');
        return;
      }
      const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
      let sent = 0;
      for (const ws of this.clients) {
        if (ws.readyState === ws.OPEN) {
          try { ws.send(dataUrl); sent++; } catch { /* drop */ }
        }
      }
      if (!this.firstFrameLogged && sent > 0) {
        this.firstFrameLogged = true;
        // eslint-disable-next-line no-console
        console.log('[cast] first frame sent, size =', jpeg.length, 'bytes,', sent, 'client(s)');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[cast] capture failed', err);
    } finally {
      this.capturing = false;
    }
  }
}

export const castServer = new CastServer();
