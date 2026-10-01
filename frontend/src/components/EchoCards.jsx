import React from "react";

/**
 * EchoCards — the answer cards Echo puts under a reply.
 *
 * The facts on a card come from the catalog (services/echoMatch.js), never
 * from the model. Poseidon writes the friendly sentence above it; the card is
 * what the sentence is about, with the numbers it used.
 *
 * Styling lives in EchoChat.css.
 */

const STATUS_WORD = Object.freeze({ good: "OK", care: "Watch", bad: "Problem", unknown: "Not recorded" });
const STATUS_GLYPH = Object.freeze({ good: "✓", care: "!", bad: "✕", unknown: "?" });

const speciesHref = (specCode) =>
  specCode != null ? `/species.html?specCode=${encodeURIComponent(specCode)}` : null;

/**
 * "Can these live together?" as a card.
 *
 * @param {{ result: ReturnType<import("../services/echoMatch").checkGroup>, footer?: React.ReactNode }} props
 */
export function CompatCard({ result, footer = null }) {
  if (!result) return null;
  const members = Array.isArray(result.members) ? result.members : [];
  return (
    <section className={`echo-card echo-card--${result.verdict}`} aria-label={`Compatibility: ${result.title}. ${result.headline}.`}>
      <div className="echo-card__head">
        {members.length > 0 && (
          <div className="echo-card__faces" aria-hidden="true">
            {members.slice(0, 4).map((m) => (
              m.photo
                ? <img key={m.scientificName || m.name} src={m.photo} alt="" loading="lazy" decoding="async" />
                : <span key={m.scientificName || m.name} className="echo-card__noface">🐟</span>
            ))}
          </div>
        )}
        <div className="echo-card__heading">
          <p className="echo-card__verdict">
            <span className="echo-card__glyph" aria-hidden="true">{STATUS_GLYPH[result.verdict]}</span>
            {result.headline}
          </p>
          <h3 className="echo-card__title">{result.title}</h3>
        </div>
      </div>

      {result.rows.length > 0 && (
        <ul className="echo-card__rows">
          {result.rows.map((row) => (
            <li key={row.key} className={`echo-card__row echo-card__row--${row.status}`}>
              <span className="echo-card__dot" aria-hidden="true">{STATUS_GLYPH[row.status]}</span>
              <div className="echo-card__rowtext">
                <strong>
                  <span className="echo-sr">{STATUS_WORD[row.status]}: </span>
                  {row.label}
                </strong>
                <span>{row.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="echo-card__foot">
        <span>From the Aquacellum species guide</span>
        {members.filter((m) => m.specCode != null).slice(0, 3).map((m) => (
          <a key={m.specCode} href={speciesHref(m.specCode)}>{m.name}</a>
        ))}
      </div>
      {footer}
    </section>
  );
}

/**
 * What Echo saw in a photo.
 *
 * A photo can only suggest, so the card shows ranked candidates with their
 * real match numbers, says so in plain sight, and never writes the result
 * anywhere (see services/echoVision.js).
 *
 * @param {object} props
 * @param {object} props.result identifyFish() result
 * @param {string|null} [props.thumb] object URL of the photo, this session only
 * @param {(c: object) => void} [props.onAsk] ask Echo about a candidate
 * @param {(c: object) => void} [props.onCheck] check a candidate against the tank in context
 * @param {string|null} [props.tankName]
 */
export function PhotoCard({ result, thumb = null, onAsk, onCheck, tankName = null }) {
  if (!result) return null;
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  let message = null;
  if (!result.success) message = result.error || "I couldn't look at that photo.";
  else if (result.isFish === false) message = result.observation || "That doesn't look like a fish to me.";
  else if (candidates.length === 0) message = result.observation || "I can't place this one from the photo. A clear side-on shot usually helps.";

  return (
    <section className="echo-card echo-card--photo" aria-label="What Echo saw in your photo" aria-live="polite">
      <div className="echo-card__head">
        {thumb && <img className="echo-card__thumb" src={thumb} alt="Your photo" />}
        <div className="echo-card__heading">
          <p className="echo-card__verdict">{candidates.length ? "My best guesses" : "Photo check"}</p>
          {result.success && result.observation && candidates.length > 0 && (
            <p className="echo-card__note">{result.observation}</p>
          )}
        </div>
      </div>

      {message && <p className={`echo-card__message${result.success ? "" : " echo-card__message--error"}`}>{message}</p>}

      {candidates.length > 0 && (
        <ol className="echo-card__guesses">
          {candidates.map((c) => {
            const pct = Math.round(Number(c.confidence || 0) * 100);
            const name = c.catalogCommonName || c.commonName || c.scientificName;
            return (
              <li key={`${c.scientificName}-${c.commonName}`} className="echo-card__guess">
                <div className="echo-card__guessrow">
                  <strong>{name}</strong>
                  <span className="echo-card__pct">{pct}% match</span>
                </div>
                <div className="echo-card__bar" aria-hidden="true"><span style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} /></div>
                <em className="echo-card__sci">{c.scientificName}</em>
                <div className="echo-card__links">
                  {c.inCatalog && c.specCode != null
                    ? <a href={speciesHref(c.specCode)}>View in database</a>
                    : <span className="echo-card__muted">Not in our catalog yet</span>}
                  {onAsk && <button type="button" onClick={() => onAsk(c)}>Ask Echo about it</button>}
                  {onCheck && c.inCatalog && tankName && (
                    <button type="button" onClick={() => onCheck(c)}>Check with {tankName}</button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {candidates.length > 0 && (
        <p className="echo-card__foot echo-card__foot--plain">
          A photo can only suggest. Juveniles, females and colour morphs often can&apos;t be told apart from an image, so confirm before you record it.
        </p>
      )}
    </section>
  );
}
