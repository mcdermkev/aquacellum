/**
 * useReefAudio — Manages ambient underwater audio.
 * Uses Web Audio API for spatial sound and volume ducking during narration.
 */
import { useState, useEffect, useRef, useCallback } from "react";

export function useReefAudio({ isSpeaking = false }) {
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);
  const audioCtxRef = useRef(null);
  const gainRef = useRef(null);
  const sourceRef = useRef(null);
  const bufferRef = useRef(null);

  // Create AudioContext on first user gesture
  const initAudio = useCallback(async () => {
    if (audioCtxRef.current) return;

    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;

      const gain = ctx.createGain();
      gain.gain.value = 0.3; // Low ambient volume
      gain.connect(ctx.destination);
      gainRef.current = gain;

      // Generate synthetic underwater ambient (brown noise + LP filter)
      // This avoids needing an audio file for the MVP
      const bufferSize = ctx.sampleRate * 10; // 10 seconds, looped
      const buffer = ctx.createBuffer(2, bufferSize, ctx.sampleRate);

      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        let lastOut = 0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          // Brown noise approximation
          lastOut = (lastOut + (0.02 * white)) / 1.02;
          data[i] = lastOut * 3.5;
        }
      }

      bufferRef.current = buffer;

      // Create source
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      // Low-pass filter for "underwater" feel
      const lpFilter = ctx.createBiquadFilter();
      lpFilter.type = "lowpass";
      lpFilter.frequency.value = 400;
      lpFilter.Q.value = 1;

      source.connect(lpFilter);
      lpFilter.connect(gain);
      source.start(0);
      sourceRef.current = source;

      setReady(true);
    } catch (err) {
      console.warn("[useReefAudio] Failed to init audio:", err);
    }
  }, []);

  // Duck audio when TTS is speaking
  useEffect(() => {
    if (!gainRef.current) return;
    const targetVolume = isSpeaking ? 0.08 : muted ? 0 : 0.3;
    gainRef.current.gain.linearRampToValueAtTime(
      targetVolume,
      (audioCtxRef.current?.currentTime || 0) + 0.5
    );
  }, [isSpeaking, muted]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    setMuted((m) => !m);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch (e) { /* ignore */ }
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close();
      }
    };
  }, []);

  return {
    ready,
    muted,
    initAudio,
    toggleMute
  };
}
