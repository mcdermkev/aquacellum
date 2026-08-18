/**
 * sexing-guide.js — browser mirror of the canonical sexing contract.
 *
 * The Vite app imports the real module at src/services/sexingGuide.js. The
 * static pages (database.html, species.html, compare.html) are plain <script>
 * pages that cannot import ESM from src/, so they load this small mirror as a
 * global (`window.SexingGuide`). Same arrangement as /js/species-catalog.js.
 *
 * Kept in lockstep with the canonical module by a parity test
 * (src/services/sexingGuide.test.js), which evaluates THIS file and asserts the
 * two agree on every state for a matrix of records — so the public database page
 * and the in-app panels can never disagree about whether a fish can be sexed by
 * eye.
 *
 * Mirror only what the static pages need: state classification, labels, and the
 * filter predicate. Do not add app-only presentation here.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // Node / vitest parity test
  }
  root.SexingGuide = api; // browser global
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var SEXING_STATUS = {
    RELIABLE: "reliable",
    UNRELIABLE: "unreliable",
    UNDOCUMENTED: "undocumented",
  };

  var MALE_SYMBOL = "\u2642";
  var FEMALE_SYMBOL = "\u2640";

  var SEXING_COPY = {
    reliable: {
      label: { pro: "Visually sexable", casual: "You can tell males from females" },
      short: "Sexable",
      blurb: {
        pro: "Males and females differ visibly once mature.",
        casual: "Once they grow up, males and females look different.",
      },
    },
    unreliable: {
      label: { pro: "Not reliably visual", casual: "Hard to tell apart" },
      short: "Hard to sex",
      blurb: {
        pro: "External differences are subtle or absent \u2014 treat visual sexing as a guess.",
        casual: "The differences are very subtle, so guessing by eye is unreliable.",
      },
    },
    undocumented: {
      label: { pro: "Sexing not documented", casual: "Not documented yet" },
      short: "Not documented",
      blurb: {
        pro: "We have not documented how to sex this species yet.",
        casual: "We haven't written up how to tell males from females yet.",
      },
    },
    maturityPrefix: { pro: "Sexual maturity", casual: "Grown up at" },
    maleHeading: { pro: "Male", casual: "Male" },
    femaleHeading: { pro: "Female", casual: "Female" },
  };

  var STATUS_META = {
    reliable: { key: "reliable", documented: true, reliable: true, badgeClass: "sexing-badge sexing-badge--reliable", order: 0 },
    unreliable: { key: "unreliable", documented: true, reliable: false, badgeClass: "sexing-badge sexing-badge--unreliable", order: 1 },
    undocumented: { key: "undocumented", documented: false, reliable: false, badgeClass: "sexing-badge sexing-badge--undocumented", order: 2 },
  };

  var PLACEHOLDERS = {
    "information arriving soon": 1,
    "generic biotope details": 1,
    "n/a": 1,
    unknown: 1,
    "-": 1,
  };

  function cleanText(value) {
    if (value === null || value === undefined) return null;
    var text = String(value).trim();
    if (!text) return null;
    if (PLACEHOLDERS[text.toLowerCase()]) return null;
    return text;
  }

  function readCues(raw) {
    if (!Array.isArray(raw)) return [];
    var cues = [];
    for (var i = 0; i < raw.length; i++) {
      var entry = raw[i];
      if (!entry) continue;
      var trait = cleanText(entry.trait);
      var male = cleanText(entry.male);
      var female = cleanText(entry.female);
      if (!trait || (!male && !female)) continue;
      cues.push({ trait: trait, male: male, female: female });
    }
    return cues;
  }

  function withMeta(status, fields) {
    var meta = STATUS_META[status];
    return {
      status: status,
      documented: meta.documented,
      reliable: meta.reliable,
      badgeClass: meta.badgeClass,
      order: meta.order,
      key: meta.key,
      male: fields.male,
      female: fields.female,
      maturityAge: fields.maturityAge,
      cues: fields.cues,
      hasNotes: fields.hasNotes,
    };
  }

  function normalizeSexingGuide(record) {
    var block = record && typeof record === "object" ? record.sexualDimorphism : null;

    if (!block || typeof block !== "object") {
      return withMeta(SEXING_STATUS.UNDOCUMENTED, {
        male: null, female: null, maturityAge: null, cues: [], hasNotes: false,
      });
    }

    var male = cleanText(block.male);
    var female = cleanText(block.female);
    var maturityAge = cleanText(block.maturityAge);
    var cues = readCues(block.cues);
    var hasNotes = Boolean(male || female || cues.length > 0);

    if (!hasNotes) {
      return withMeta(SEXING_STATUS.UNDOCUMENTED, {
        male: male, female: female, maturityAge: maturityAge, cues: cues, hasNotes: false,
      });
    }

    var status = block.identifiable === true ? SEXING_STATUS.RELIABLE : SEXING_STATUS.UNRELIABLE;
    return withMeta(status, {
      male: male, female: female, maturityAge: maturityAge, cues: cues, hasNotes: true,
    });
  }

  function copyFor(guide) {
    return SEXING_COPY[guide && guide.status] || SEXING_COPY[SEXING_STATUS.UNDOCUMENTED];
  }

  function sexingLabel(guide, options) {
    var casual = !!(options && options.casual);
    var entry = copyFor(guide);
    return casual ? entry.label.casual : entry.label.pro;
  }

  function sexingBlurb(guide, options) {
    var casual = !!(options && options.casual);
    var entry = copyFor(guide);
    return casual ? entry.blurb.casual : entry.blurb.pro;
  }

  function sexingShortLabel(guide) {
    return copyFor(guide).short;
  }

  function hasSexingNotes(guide) {
    return Boolean(guide && guide.hasNotes);
  }

  function matchesSexingFilter(record, mode) {
    if (!mode || mode === "any") return true;
    var guide = normalizeSexingGuide(record);
    if (mode === "reliable") return guide.reliable;
    if (mode === "documented") return guide.documented;
    if (mode === "undocumented") return !guide.documented;
    return true;
  }

  var SEXING_FILTER_OPTIONS = [
    { value: "any", label: "Any sexing info" },
    { value: "reliable", label: "Visually sexable" },
    { value: "documented", label: "Sexing documented" },
    { value: "undocumented", label: "Sexing missing" },
  ];

  return {
    SEXING_STATUS: SEXING_STATUS,
    SEXING_COPY: SEXING_COPY,
    MALE_SYMBOL: MALE_SYMBOL,
    FEMALE_SYMBOL: FEMALE_SYMBOL,
    SEXING_FILTER_OPTIONS: SEXING_FILTER_OPTIONS,
    normalizeSexingGuide: normalizeSexingGuide,
    sexingLabel: sexingLabel,
    sexingBlurb: sexingBlurb,
    sexingShortLabel: sexingShortLabel,
    hasSexingNotes: hasSexingNotes,
    matchesSexingFilter: matchesSexingFilter,
  };
});
