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
 * It self-mounts on DOM ready and exposes a small API for the page to point her
 * at things:
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

  var SIZE = 56;

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
    if (!isEnabled()) return;
    if (document.querySelector(".echo-ambient")) return; // already mounted

    var reducedMotion = prefersReducedMotion();

    var wrap = document.createElement("div");
    wrap.className = "echo-ambient";
    wrap.setAttribute("aria-hidden", "true"); // decorative and inert
    wrap.style.width = SIZE + "px";
    wrap.style.height = SIZE + "px";

    var inner = document.createElement("div");
    inner.className = "echo-renderer";
    inner.style.width = "100%";
    inner.style.height = "100%";

    var art = document.createElement("img");
    art.className = "echo-art";
    art.src = EB.ECHO_ART;
    art.alt = "";
    art.draggable = false;

    inner.appendChild(art);
    wrap.appendChild(inner);
    document.body.appendChild(wrap);

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
      wrap.className = "echo-ambient echo-ambient--" + view.state;

      var visuals = EB.wrapperVisuals(view);
      wrap.style.transform = visuals.transform;
      wrap.style.opacity = visuals.opacity;
      wrap.style.scale = visuals.scale;
      wrap.style.filter = visuals.filter;
      wrap.style.transitionDuration = visuals.transitionDuration;

      art.style.transform = EB.artTransform(view);
      art.className = view.animate && !reducedMotion ? "echo-art echo-art--animated" : "echo-art";

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
      if (reducedMotion) return;
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
      });
    });

    /**
     * Point her at an element.
     *
     * The DOM measuring is the only part of gaze that could not live in the core.
     * She looks at the CENTRE of the target relative to her own centre, so an
     * off-screen or zero-size element yields a zero offset rather than a wild
     * tilt.
     */
    function attend(element) {
      if (!element || !element.getBoundingClientRect) return;
      var t = element.getBoundingClientRect();
      if (t.width === 0 && t.height === 0) return;
      var me = wrap.getBoundingClientRect();
      send(EB.ECHO_EVENT.ATTEND, {
        dx: t.left + t.width / 2 - (me.left + me.width / 2),
        dy: t.top + t.height / 2 - (me.top + me.height / 2),
      });
    }

    function release() {
      send(EB.ECHO_EVENT.RELEASE);
    }

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
