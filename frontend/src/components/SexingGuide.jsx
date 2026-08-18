import React from "react";
import {
  SEXING_STATUS,
  SEXING_COPY,
  MALE_SYMBOL,
  FEMALE_SYMBOL,
  normalizeSexingGuide,
  sexingLabel,
  sexingBlurb,
} from "../services/sexingGuide";
import "./SexingGuide.css";

/**
 * SexingGuide — "how do I tell a male from a female?" for one species.
 *
 * The data behind this shipped a long time ago and only `species.html` rendered
 * it, so nobody using the actual app ever saw it. This is the shared React
 * presentation for it; classification lives in services/sexingGuide.js so the
 * public database page (which loads the /js/sexing-guide.js mirror) cannot
 * disagree with the app about whether a fish is sexable by eye.
 *
 * THE UNRELIABLE STATE IS NOT AN ERROR STATE. Seven of the twenty documented
 * species say `identifiable: false` and still carry real prose — an Oscar's entry
 * explains that you need the genital papilla in breeding condition. That renders
 * with a warning-coloured badge and the notes intact, because "you cannot do this
 * by eye, here is what you would actually have to do" is the most useful thing we
 * can tell that keeper. Hiding it would read as "no differences exist".
 *
 * Props:
 *   record                 — a fishbase_master.json-shaped species record
 *   casual                 — casual copy instead of pro vocabulary
 *   compact                — badge + one line only, for a card or a form hint
 *   hideWhenUndocumented   — render nothing rather than "not documented yet";
 *                            for surfaces where the honest gap is just noise
 *   heading                — override the section title
 */
export function SexingGuide({
  record,
  casual = false,
  compact = false,
  hideWhenUndocumented = false,
  heading,
}) {
  const guide = normalizeSexingGuide(record);

  if (hideWhenUndocumented && !guide.documented) return null;

  const label = sexingLabel(guide, { casual });
  const blurb = sexingBlurb(guide, { casual });
  const maleHeading = casual ? SEXING_COPY.maleHeading.casual : SEXING_COPY.maleHeading.pro;
  const femaleHeading = casual ? SEXING_COPY.femaleHeading.casual : SEXING_COPY.femaleHeading.pro;
  const maturityPrefix = casual ? SEXING_COPY.maturityPrefix.casual : SEXING_COPY.maturityPrefix.pro;

  // The badge carries its state in TEXT as well as colour, so it does not rely on
  // colour alone to distinguish "sexable" from "don't trust your eyes".
  const badge = (
    <span className={guide.badgeClass}>
      <span aria-hidden="true">{MALE_SYMBOL}{FEMALE_SYMBOL}</span> {label}
    </span>
  );

  if (compact) {
    return (
      <div className="sexing-compact">
        {badge}
        <span className="sexing-compact-blurb">{blurb}</span>
      </div>
    );
  }

  return (
    <section className="sexing-guide" aria-labelledby="sexing-guide-title">
      <div className="sexing-guide-head">
        <h3 className="sexing-guide-title" id="sexing-guide-title">
          <span aria-hidden="true">⚥</span> {heading || (casual ? "Male or female?" : "Sexual dimorphism")}
        </h3>
        {badge}
      </div>

      <p className="sexing-guide-blurb">{blurb}</p>

      {guide.maturityAge && (
        <p className="sexing-guide-maturity">
          <strong>{maturityPrefix}:</strong> {guide.maturityAge}
        </p>
      )}

      {(guide.male || guide.female) && (
        <div className="sexing-compare">
          {guide.male && (
            <div className="sexing-col">
              <div className="sexing-col-title">
                <span aria-hidden="true">{MALE_SYMBOL}</span> {maleHeading}
              </div>
              <p className="sexing-col-text">{guide.male}</p>
            </div>
          )}
          {guide.female && (
            <div className="sexing-col">
              <div className="sexing-col-title">
                <span aria-hidden="true">{FEMALE_SYMBOL}</span> {femaleHeading}
              </div>
              <p className="sexing-col-text">{guide.female}</p>
            </div>
          )}
        </div>
      )}

      {/* Structured per-trait cues. Empty for every record shipping today — this
          is the reader for the authoring work, so adding cues needs no second
          pass through the consumers. */}
      {guide.cues.length > 0 && (
        <table className="sexing-cues">
          <caption className="sexing-cues-caption">
            {casual ? "What to look at" : "Trait comparison"}
          </caption>
          <thead>
            <tr>
              <th scope="col">{casual ? "Look at" : "Trait"}</th>
              <th scope="col">{maleHeading}</th>
              <th scope="col">{femaleHeading}</th>
            </tr>
          </thead>
          <tbody>
            {guide.cues.map((cue) => (
              <tr key={cue.trait}>
                <th scope="row">{cue.trait}</th>
                <td>{cue.male || "—"}</td>
                <td>{cue.female || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {guide.status === SEXING_STATUS.UNDOCUMENTED && (
        <p className="sexing-guide-gap">
          {casual
            ? "If you keep this fish and know how to tell, that's exactly the kind of thing we want to add."
            : "Breeder input is how this gets filled in — sexing notes for this species are still open."}
        </p>
      )}
    </section>
  );
}

export default SexingGuide;
