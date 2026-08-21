import React, { useRef, useState } from "react";
import { identifyFish } from "../services/echoVision";

/**
 * FishIdentifier — hand Echo a photo and let her look at it.
 *
 * The user-facing half of step 6 in docs/ECHO_CHARACTER_SPEC.md. Poseidon is the
 * brain and does the identifying; Echo is the body and visibly concentrates while
 * he does, because `services/echoVision.js` brackets the request with the two DOM
 * events both of her mounts listen for. That pairing is the entire point: her
 * EXAMINING state has existed since the rework with nothing to trigger it.
 *
 * ── Why the copy is so hedged ────────────────────────────────────────────────
 * A photo identification is a SUGGESTION, and this database means to be the
 * accurate one. Juveniles, females, line-bred colour morphs and hybrids routinely
 * cannot be separated from a photograph at all. So the UI shows RANKED candidates
 * with real confidence numbers rather than one verdict, states the limitation in
 * plain sight, and never offers to write the result anywhere — a user who logs a
 * confident wrong ID against a specimen carries that error into a pedigree, which
 * is the one place it becomes permanent.
 *
 * `inCatalog` is drawn deliberately: a species we hold is offered as a link into
 * the database, and a name we do not hold is labelled as being outside it. Without
 * that line a model's guess reads exactly like a catalog record.
 *
 * Renders its own row rather than sitting inside the chat's <form>, so a submit
 * cannot be triggered by the photo button and the results have somewhere to live.
 */
export function FishIdentifier({
  mode = "casual",
  accentColor = "#2dd4bf",
  borderColor = "rgba(45,212,191,0.3)",
  isPro = false,
  onAskPoseidon,
}) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    // Reset immediately so picking the SAME file twice still fires a change event.
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    setResult(null);
    try {
      setResult(await identifyFish(file, { mode }));
    } finally {
      setBusy(false);
    }
  };

  const radius = isPro ? "0" : "6px";

  return (
    <div
      style={{
        padding: "0.5rem 0.75rem",
        borderTop: `1px solid ${borderColor}`,
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        // Opens the camera directly on mobile, same as SpawnGrowoutTracker.
        capture="environment"
        onChange={onPick}
        style={{ display: "none" }}
        // Hidden from the tab order on purpose: the visible button below is the
        // control, and a focusable invisible input is a keyboard trap.
        tabIndex={-1}
        aria-hidden="true"
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        style={{
          background: "transparent",
          border: `1px dashed ${borderColor}`,
          borderRadius: radius,
          color: accentColor,
          padding: "0.45rem 0.75rem",
          fontSize: "0.78rem",
          fontFamily: "inherit",
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.65 : 1,
          textAlign: "left",
        }}
      >
        {busy
          ? isPro ? "ANALYSING IMAGE_" : "Echo is taking a look…"
          : isPro ? "IDENTIFY FROM IMAGE" : "📷 What fish is this?"}
      </button>

      {result && (
        <div
          // Announced when it arrives — the answer appears well after the click.
          role="status"
          aria-live="polite"
          style={{
            fontSize: "0.75rem",
            color: "rgba(255,255,255,0.85)",
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
          }}
        >
          {!result.success && (
            <div style={{ color: result.needsAuth ? accentColor : "#fca5a5" }}>
              {result.error}
            </div>
          )}

          {result.success && result.isFish === false && (
            <div>{result.observation || "That doesn't look like a fish to me."}</div>
          )}

          {result.success && result.isFish && result.candidates?.length === 0 && (
            <div>
              {result.observation ||
                "I can't place this one from the photo. A clearer side-on shot usually helps."}
            </div>
          )}

          {result.success && result.candidates?.length > 0 && (
            <>
              {result.observation && (
                <div style={{ fontStyle: "italic", opacity: 0.85 }}>{result.observation}</div>
              )}

              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {result.candidates.map((c) => (
                  <li
                    key={`${c.scientificName}-${c.commonName}`}
                    style={{
                      border: `1px solid ${borderColor}`,
                      borderRadius: radius,
                      padding: "0.4rem 0.5rem",
                      background: "rgba(0,0,0,0.2)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                      <span style={{ fontWeight: 700, color: accentColor }}>
                        {c.catalogCommonName || c.commonName || c.scientificName}
                      </span>
                      {/* A number, not just a bar. "72%" is checkable; a bar is a vibe. */}
                      <span style={{ opacity: 0.8, whiteSpace: "nowrap" }}>
                        {Math.round(c.confidence * 100)}% match
                      </span>
                    </div>

                    <div style={{ fontStyle: "italic", opacity: 0.7 }}>{c.scientificName}</div>

                    <div style={{ marginTop: "0.3rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                      {c.inCatalog ? (
                        <a
                          href={`/species.html?specCode=${encodeURIComponent(c.specCode)}`}
                          style={{ color: accentColor, textDecoration: "underline" }}
                        >
                          View in database
                        </a>
                      ) : (
                        <span style={{ opacity: 0.6 }}>Not in our catalog yet</span>
                      )}

                      {onAskPoseidon && (
                        <button
                          type="button"
                          onClick={() =>
                            onAskPoseidon(
                              `Tell me about keeping ${c.scientificName}${
                                c.commonName ? ` (${c.commonName})` : ""
                              }.`,
                            )
                          }
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            color: accentColor,
                            textDecoration: "underline",
                            cursor: "pointer",
                            font: "inherit",
                          }}
                        >
                          Ask Poseidon about it
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {/* Stated every time, not tucked behind a tooltip. */}
              <div style={{ opacity: 0.6, fontSize: "0.7rem" }}>
                A photo can only suggest. Juveniles, females and colour morphs often
                can&apos;t be told apart from an image — confirm before you record it.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default FishIdentifier;
