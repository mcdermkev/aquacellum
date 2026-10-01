/**
 * echo-ambient.js — Echo, mounted on the static pages.
 *
 * Step 5 of docs/ECHO_CHARACTER_SPEC.md. Echo was absent from `database.html`
 * entirely, which is the page where a guide earns its keep: it is what a new
 * keeper actually browses, and the report that started this whole rework was
 * someone landing there and not knowing where to go.
 *
 * THIS FILE DECIDES NOTHING. Every question — what state she is in, which way she
 * faces, how big a reaction is, when she rests — is answered by
 * `window.EchoBehaviour` (/js/echo-behaviour.js), the same core the React app
 * imports, kept in lockstep by a parity test. This is a mount: build the element,
 * translate page events into behaviour events, apply what the core returns.
 *
 * Spec §8 forbids a second renderer. A vanilla page cannot use the React one, so
 * the honest version of that rule is: neither renderer may make a decision. Both
 * call `describe()`, `artTransform()` and `wrapperVisuals()` and apply the result
 * verbatim, so they cannot drift on art, facing, tilt, or reaction size.
 *
 * Usage — load after the behaviour core, then:
 *
 *   <link rel="stylesheet" href="/css/echo.css">
 *   <script src="/js/echo-behaviour.js"></script>
 *   <script src="/js/echo-ambient.js"></script>
 *
 * It self-mounts on DOM ready, in the bottom-left corner, or inside an element
 * marked `data-echo-stage` (optional `data-echo-size` in px) when the page has
 * one. It exposes a small API for the page to point her at things:
 *
 *   window.AquadexEcho.attend(element)   // look at it
 *   window.AquadexEcho.release()         // stop looking
 *
 * Both are safe to call with optional chaining if Echo failed to load.
 */
(function () {
  "use strict";

  var EB = window.EchoBehaviour;
  if (!EB) {
    // The core is the only hard dependency. Missing it is a page-authoring error,
    // not a user-facing one, so warn and do nothing rather than throwing into an
    // unrelated page's console.
    if (window.console) console.warn("[Echo] /js/echo-behaviour.js must load first.");
    return;
  }

  var SIZE = 74;

  /**
   * Honour the app's Settings toggle.
   *
   * `aquadex_echo_enabled` is written by Settings → AI Companions in the React
   * app and lives in localStorage on the same origin, so turning Echo off in the
   * app also silences her on the public pages. Anything but the exact string
   * "false" reads as enabled — the scheme `useAiPrefs.js` documents and warns
   * against changing, since a stray value must not silently disable a feature.
   */
  function isEnabled() {
    try {
      return localStorage.getItem("aquadex_echo_enabled") !== "false";
    } catch (err) {
      // Private mode / blocked storage. Default to present.
      return true;
    }
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (err) {
      return false;
    }
  }

  function mount() {
    // A page can give her a stage instead of the corner: an element with
    // `data-echo-stage` (and optionally `data-echo-size`, her height in px).
    // Her own page (poseidon.html) does, because there she is the content,
    // so the stage mounts even with the corner Echo switched off in Settings.
    var stage = document.querySelector("[data-echo-stage]");
    if (!stage && !isEnabled()) return;
    if (document.querySelector(".echo-ambient")) return; // already mounted

    var reducedMotion = prefersReducedMotion();
    var size = stage ? Number(stage.getAttribute("data-echo-size")) || 220 : SIZE;
    var baseClass = stage ? "echo-ambient echo-ambient--stage" : "echo-ambient";

    var wrap = document.createElement("div");
    wrap.className = baseClass;

    // She is a button: tapping her opens a chat. A page with its own chat
    // (poseidon.html, database.html) listens for `echo:toggle` and calls
    // preventDefault(); anywhere else she takes you to her page.
    var button = document.createElement("button");
    button.type = "button";
    button.className = "echo-ambient__button";
    button.setAttribute("aria-label", "Ask Echo");
    button.title = "Ask Echo";
    button.addEventListener("click", function () {
      var ev;
      try {
        ev = new CustomEvent("echo:toggle", { cancelable: true });
      } catch (err) {
        ev = null;
      }
      if (ev) window.dispatchEvent(ev);
      if (!ev || !ev.defaultPrevented) window.location.href = "/poseidon.html";
    });

    var inner = document.createElement("div");
    inner.className = "echo-renderer";
    inner.setAttribute("aria-hidden", "true");
    inner.style.width = Math.round(size * EB.ECHO_ASPECT) + "px";
    inner.style.height = size + "px";

    // The same seven faces the app draws, from the same list in the core.
    var art = document.createElement("div");
    art.className = "echo-art";
    var faces = {};
    for (var name in EB.ECHO_ART) {
      if (!Object.prototype.hasOwnProperty.call(EB.ECHO_ART, name)) continue;
      var img = document.createElement("img");
      img.src = EB.ECHO_ART[name];
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      img.className = "echo-face";
      faces[name] = img;
      art.appendChild(img);
    }

    inner.appendChild(art);
    button.appendChild(inner);
    wrap.appendChild(button);
    (stage || document.body).appendChild(wrap);
    var shownFace = null;

    var state = EB.createEchoState(Date.now());
    var wakeTimer = null;
    var driftTimer = null;
    var glanceTimer = null;

    function send(type, extra) {
      var event = { type: type, now: Date.now() };
      if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) event[k] = extra[k];
      state = EB.reduce(state, event);
      paint();
    }

    function paint() {
      var now = Date.now();
      var view = EB.describe(state, now);

      // Class carries the state name so the stylesheet can style examining and
      // speaking without this file knowing what those look like.
      wrap.className = baseClass + " echo-ambient--" + view.state;

      var visuals = EB.wrapperVisuals(view);
      wrap.style.transform = visuals.transform;
      wrap.style.opacity = visuals.opacity;
      wrap.style.scale = visuals.scale;
      wrap.style.filter = visuals.filter;
      wrap.style.transitionDuration = visuals.transitionDuration;

      art.style.transform = EB.artTransform(view);
      art.className = view.animate && !reducedMotion ? "echo-art echo-art--animated" : "echo-art";

      var face = faces[view.expression] ? view.expression : "idle";
      if (face !== shownFace) {
        if (shownFace && faces[shownFace]) faces[shownFace].className = "echo-face";
        faces[face].className = "echo-face echo-face--on";
        shownFace = face;
      }

      scheduleWake(now);
    }

    /**
     * ONE scheduled wake-up, not one per concern. The core reports the single
     * soonest instant at which `observe()` could change its answer, so a
     * reaction, a speaking window and a rest deadline share one timer. Null means
     * nothing is pending, and then no timer exists at all — an idle Echo in a
     * background tab costs nothing.
     */
    function scheduleWake(now) {
      if (wakeTimer) {
        clearTimeout(wakeTimer);
        wakeTimer = null;
      }
      var at = EB.nextTransitionAt(state, now);
      if (at === null) return;
      wakeTimer = setTimeout(paint, Math.max(0, at - now));
    }

    // ─── Irregular drift and glancing (rule 2) ──────────────────────────────
    //
    // Each leg schedules the next with its own jittered delay from the core. A
    // shared interval is the tell that reads as a screensaver.
    function scheduleDrift() {
      // On a stage she stays put; the corner is where she wanders.
      if (reducedMotion || stage) return;
      driftTimer = setTimeout(function () {
        var o = EB.nextDriftOffset();
        send(EB.ECHO_EVENT.DRIFT, { x: o.x, y: o.y });
        scheduleDrift();
      }, EB.nextDriftDelay());
    }

    function scheduleGlance() {
      if (reducedMotion) return;
      glanceTimer = setTimeout(function () {
        send(EB.ECHO_EVENT.GLANCE);
        scheduleGlance();
      }, EB.nextGlanceDelay());
    }

    // ─── Page events → behaviour events ─────────────────────────────────────

    function onActivity() {
      send(EB.ECHO_EVENT.ACTIVITY);
    }

    var activityEvents = ["pointerdown", "keydown", "scroll"];
    for (var i = 0; i < activityEvents.length; i++) {
      window.addEventListener(activityEvents[i], onActivity, { passive: true });
    }

    document.addEventListener("visibilitychange", function () {
      send(document.hidden ? EB.ECHO_EVENT.HIDDEN : EB.ECHO_EVENT.VISIBLE);
    });

    // Same event the React app listens to, so an easter egg or a Poseidon reply
    // moves her identically on both. Nothing dispatches it on the static pages
    // yet; wiring it costs nothing and means it works the day something does.
    window.addEventListener("poseidon:echo-reaction", function (e) {
      var d = (e && e.detail) || {};
      send(EB.ECHO_EVENT.POSEIDON_REACTION, {
        durationMs: d.durationMs,
        swimSpeedMultiplier: d.swimSpeedMultiplier,
        mood: d.mood,
      });
    });
    // A page chat brackets each question, so she thinks, then talks.
    window.addEventListener("echo:thinking-start", function () {
      send(EB.ECHO_EVENT.THINKING_START);
    });
    window.addEventListener("echo:thinking-end", function () {
      send(EB.ECHO_EVENT.THINKING_END);
    });
    window.addEventListener("echo:speaking", function (e) {
      send(EB.ECHO_EVENT.POSEIDON_SPEAKING, { durationMs: e && e.detail && e.detail.durationMs });
    });

    // Vision (spec §6). `src/services/echoVision.js` brackets an identification
    // request with these two, so she visibly concentrates while the model looks.
    // Mirrored here so a static page that adds an identify button gets the same
    // behaviour without a second implementation.
    window.addEventListener("echo:vision-start", function () {
      send(EB.ECHO_EVENT.VISION_START);
    });
    window.addEventListener("echo:vision-end", function () {
      send(EB.ECHO_EVENT.VISION_END);
    });

    /**
     * ─── Gaze ───────────────────────────────────────────────────────────────
     *
     * Mirrors `src/services/echoGaze.js attachGazeTracking()`. Same protocol as
     * the React app: a page names an element, the MOUNT does the geometry,
     * because only the mount knows where Echo is and she drifts.
     *
     * The arithmetic itself is `EB.offsetBetweenRects`, shared with the app and
     * parity-tested, so the two surfaces cannot disagree about where she looks.
     */
    var target = null;
    var frame = null;
    // See src/services/echoGaze.js for why this is tracked separately from the
    // rAF handle: `frame = requestAnimationFrame(fn)` assigns only after the
    // callback returns, so guarding on `frame` alone breaks under any synchronous
    // scheduler and silently skips every re-measure after the first.
    var pending = false;

    function measureGaze() {
      pending = false;
      frame = null;

      // Element gone — a closed popup, a re-rendered card. Let go rather than
      // keep staring at a position that no longer means anything.
      if (!target || !target.isConnected) {
        if (target) {
          target = null;
          send(EB.ECHO_EVENT.RELEASE);
        }
        return;
      }

      var offset = EB.offsetBetweenRects(
        target.getBoundingClientRect(),
        wrap.getBoundingClientRect()
      );
      // Null means "not worth looking at" — leave her gaze where it was rather
      // than snapping to the viewport corner.
      if (offset) send(EB.ECHO_EVENT.ATTEND, { dx: offset.dx, dy: offset.dy });
    }

    // rAF-coalesced: scroll fires far more often than a layout settles, and
    // measuring per event means a forced reflow per scroll tick for a decorative
    // fish.
    function scheduleGaze() {
      if (pending) return;
      pending = true;
      frame = requestAnimationFrame(measureGaze);
    }

    function attend(element) {
      if (!element || typeof element.getBoundingClientRect !== "function") return;
      target = element;
      measureGaze();
    }

    function release() {
      if (!target) return;
      target = null;
      send(EB.ECHO_EVENT.RELEASE);
    }

    window.addEventListener("scroll", scheduleGaze, { passive: true, capture: true });
    window.addEventListener("resize", scheduleGaze, { passive: true });

    // The same two events the React app uses, so a page can talk to whichever
    // Echo happens to be mounted without knowing which one it is.
    window.addEventListener("echo:attend", function (e) {
      attend(e && e.detail && e.detail.target);
    });
    window.addEventListener("echo:release", release);

    /**
     * Convenience API for static pages, which have no import system.
     * `window.AquadexEcho?.attend(el)` reads better inline than constructing a
     * CustomEvent, and it dispatches nothing extra — it is the same two calls.
     */
    window.AquadexEcho = {
      attend: attend,
      release: release,
      /** For pages that want to nudge her without a target. */
      activity: onActivity,
    };

    paint();
    scheduleDrift();
    scheduleGlance();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
