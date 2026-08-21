/**
 * VideoPlayer.test.js
 *
 * Pins the source-selection decision, which is where Reef video playback broke.
 *
 * The player asked `video.canPlayType("application/vnd.apple.mpegurl")` and used
 * native HLS whenever the answer was truthy. That method returns `""`, `"maybe"` or
 * `"probably"` — and Chrome answers `"maybe"` for HLS while being unable to play it.
 * So every Chrome user was sent down the native path and shown "Video unavailable",
 * while hls.js — installed, and verified working against the real Mux stream — sat
 * in a branch that never ran on the majority browser.
 *
 * The `"maybe"` value below is measured from real Chrome, not assumed.
 */
import { describe, it, expect } from "vitest";
import { pickPlaybackStrategy } from "./VideoPlayer";

describe("choosing how to play an HLS stream", () => {
  it("uses hls.js in Chrome, which claims 'maybe' and then cannot play HLS", () => {
    // The regression, stated as a test. Truthiness is the trap: "maybe" is truthy.
    expect(pickPlaybackStrategy({ hlsSupported: true, nativeSupport: "maybe" })).toBe("hlsjs");
  });

  it("still prefers hls.js even when the browser claims 'probably'", () => {
    // Where hls.js runs it is the more predictable of the two, and it is the path
    // that gets error recovery. A browser confident about HLS is not a reason to
    // give up that handling.
    expect(pickPlaybackStrategy({ hlsSupported: true, nativeSupport: "probably" })).toBe("hlsjs");
  });

  it("falls back to native exactly where hls.js cannot run", () => {
    // iOS/Safari: no MSE for hls.js, and native HLS genuinely works. "cannot use
    // hls.js" and "native actually works" are the same set of browsers, which is
    // what makes this fallback safe.
    expect(pickPlaybackStrategy({ hlsSupported: false, nativeSupport: "probably" })).toBe("native");
    expect(pickPlaybackStrategy({ hlsSupported: false, nativeSupport: "maybe" })).toBe("native");
  });

  it("reports unsupported rather than hanging on a spinner", () => {
    // Neither MSE nor native HLS. Saying so beats a loading state that never ends.
    expect(pickPlaybackStrategy({ hlsSupported: false, nativeSupport: "" })).toBe("unsupported");
  });

  it("treats a missing canPlayType result as no support", () => {
    expect(pickPlaybackStrategy({ hlsSupported: false, nativeSupport: undefined })).toBe(
      "unsupported",
    );
  });
});
