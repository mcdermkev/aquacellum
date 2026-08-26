/**
 * species-videos.js — the set of Spec-Dex hover/hero videos that actually exist.
 *
 * Derived from frontend/public/videos/species/*.mp4 (52 files). Do not invent
 * extra slugs and do not inject a <video src> unless the slug is in this set:
 * a missing src is a 404 on every card (database.html previously requested
 * ~315 videos and 263 of them 404'd). videoSlugs in database.html used to omit
 * betta-splendens and astronotus-ocellatus even though those files exist.
 *
 * Gold-standard card: Betta splendens (spec_code 4768) — betta-splendens.mp4.
 */
(function (root) {
  "use strict";

  var SLUGS = [
    "ancistrus-cirrhosus",
    "astronotus-ocellatus",
    "betta-splendens",
    "biotodoma-cupido",
    "botia-striata",
    "carassius-auratus",
    "chromobotia-macracanthus",
    "corydoras-aeneus",
    "corydoras-paleatus",
    "corydoras-panda",
    "crossocheilus-oblongus",
    "danio-margaritatus",
    "danio-rerio",
    "epalzeorhynchos-bicolor",
    "fundulopanchax-gardneri",
    "gymnocorymbus-ternetzi",
    "hypancistrus-zebra",
    "hyphessobrycon-amandae",
    "hyphessobrycon-eques",
    "hyphessobrycon-erythrostigma",
    "hyphessobrycon-megalopterus",
    "inpaichthys-kerri",
    "iriatherina-werneri",
    "limia-melanogaster",
    "melanotaenia-boesemani",
    "mikrogeophagus-altispinosus",
    "mikrogeophagus-ramirezi",
    "osteoglossum-bicirrhosum",
    "otocinclus-vittatus",
    "pangio-kuhlii",
    "paracheirodon-axelrodi",
    "paracheirodon-innesi",
    "pethia-conchonius",
    "phenacogrammus-interruptus",
    "poecilia-reticulata",
    "poecilia-sphenops",
    "poecilia-velifera",
    "poecilia-wingei",
    "pterophyllum-scalare",
    "puntigrus-tetrazona",
    "puntius-titteya",
    "rasbora-trilineata",
    "symphysodon-aequifasciatus",
    "synodontis-nigriventris",
    "tanichthys-albonubes",
    "thorichthys-meeki",
    "trichogaster-chuna",
    "trichogaster-lalius",
    "trichopodus-leerii",
    "trigonostigma-heteromorpha",
    "xiphophorus-hellerii",
    "xiphophorus-maculatus"
  ];

  var set = {};
  for (var i = 0; i < SLUGS.length; i++) set[SLUGS[i]] = true;

  function slugify(name) {
    return String(name == null ? "" : name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  var api = {
    slugs: SLUGS,
    has: function (scientificName) {
      var slug = slugify(scientificName);
      return !!(slug && set[slug]);
    },
    src: function (scientificName) {
      var slug = slugify(scientificName);
      if (!slug || !set[slug]) return null;
      return "/videos/species/" + slug + ".mp4";
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.AquadexSpeciesVideos = api;
})(typeof window !== "undefined" ? window : globalThis);
