/**
 * fill-remaining-gaps.mjs
 * 
 * Fills the remaining data gaps in fishbase_master_proposed.json with
 * hand-verified aquarium husbandry data for the ~40 species still missing fields.
 * 
 * Sources: Seriously Fish, PlanetCatfish, Tropica, aquarium consensus.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const PROPOSED_PATH = resolve(ROOT, 'frontend', 'public', 'fishbase_master_proposed.json');

const data = JSON.parse(readFileSync(PROPOSED_PATH, 'utf-8'));
console.log(`Loaded ${data.length} species\n`);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Fix the 8 species missing maxLength & minVolume
// These are well-known tetras and catfish that didn't match FishBase by name
// (taxonomy reclassifications or spelling differences)
// ─────────────────────────────────────────────────────────────────────────────

const fishFixes = {
  'Hyphessobrycon eques': { maxLengthCm: 4, minVolumeGallons: 15, trophicLevel: 'Omnivore', spawningTrait: 'Egg scatterer no parental care' },
  'Hyphessobrycon erythrostigma': { maxLengthCm: 6, minVolumeGallons: 20, trophicLevel: 'Omnivore', spawningTrait: 'Egg scatterer no parental care' },
  'Hyphessobrycon megalopterus': { maxLengthCm: 4.5, minVolumeGallons: 15, trophicLevel: 'Omnivore', spawningTrait: 'Egg scatterer no parental care' },
  'Hyphessobrycon sweglesi': { maxLengthCm: 4, minVolumeGallons: 15, trophicLevel: 'Omnivore', spawningTrait: 'Egg scatterer no parental care' },
  'Moenkhausia pittieri': { maxLengthCm: 6, minVolumeGallons: 20, trophicLevel: 'Omnivore', spawningTrait: 'Egg scatterer no parental care' },
  'Moenkhausia sanctaefilomenae': { maxLengthCm: 7, minVolumeGallons: 20, trophicLevel: 'Omnivore', spawningTrait: 'Egg scatterer no parental care' },
  'Sturisomatichthys aureum': { maxLengthCm: 25, minVolumeGallons: 55, trophicLevel: 'Herbivore / Detritivore', spawningTrait: 'Substrate spawner with paternal care' },
  'Crenicichla compressiceps': { maxLengthCm: 8, minVolumeGallons: 30, trophicLevel: 'Carnivore', spawningTrait: 'Guarder with biparental care' },
  'Crenicichla marmorata': { maxLengthCm: 25, minVolumeGallons: 75, trophicLevel: 'Carnivore / Piscivore', spawningTrait: 'Guarder with biparental care' },
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Plants ecology — adapted to plant care fields
// ─────────────────────────────────────────────────────────────────────────────

const plantEcology = {
  'Taxiphyllum barbieri': { biotope: 'Southeast Asian streams attached to rocks and driftwood in shaded areas. Extremely adaptable moss that thrives in low to moderate light.', socialBehavior: 'Provides shelter for shrimp fry and small fish. Excellent biofilm grazing surface.', comments: 'One of the hardiest aquarium plants. Attaches to hardscape with rhizoids. Trim regularly to prevent lower portions dying from light deprivation.' },
  'Ludwigia repens': { biotope: 'North American wetlands, stream margins, and shallow ponds. Grows emergent or submersed in soft to moderately hard water.', socialBehavior: 'Fast-growing stem plant that provides mid-to-background cover and nutrient export.', comments: 'Easy stem plant that develops red coloration under high light. Propagates by cuttings. Needs moderate light minimum; intense light for red color.' },
  'Lemna minor': { biotope: 'Cosmopolitan floating plant found on still or slow-moving freshwater worldwide. Extremely fast reproducing.', socialBehavior: 'Provides shade, reduces algae by outcompeting for nutrients. Cover for surface-dwelling fry. Can block light to plants below if not managed.', comments: 'Doubles biomass every 2-3 days under good conditions. Excellent nitrate/phosphate export. Must be thinned regularly or it will blanket the entire surface.' },
  'Cryptocoryne parva': { biotope: 'Sri Lankan streams and riverbanks, growing in shallow water under partial shade. The smallest Cryptocoryne species.', socialBehavior: 'Slow-growing foreground carpet plant. Undisturbed once established.', comments: 'Extremely slow grower — takes months to carpet. Prefers stable water chemistry; susceptible to crypt melt when transplanted. Low to moderate light.' },
  'Leptochilus pteropus': { biotope: 'Southeast Asian streams and waterfalls, growing attached to rocks and wood in shaded, fast-flowing water.', socialBehavior: 'Hardy epiphyte that provides cover at all tank levels. Rhizome must not be buried.', comments: 'One of the easiest aquarium plants. Attach to driftwood or rocks with thread/glue. Propagates via adventitious plantlets on leaves. Tolerates very low light.' },
  'Echinodorus spp.': { biotope: 'South American rivers, marshes, and floodplains. Grows partially or fully submerged in nutrient-rich substrates.', socialBehavior: 'Large rosette plant serving as centerpiece. Provides broad-leaf cover for egg-laying species.', comments: 'Heavy root feeder — requires nutrient-rich substrate or root tabs. Can grow very large (30-50cm). Moderate to high light. Propagates via runners or adventitious plantlets.' },
  'Anubias barteri': { biotope: 'West African rivers and streams, growing on rocks and wood in shaded areas with moderate current.', socialBehavior: 'Extremely hardy epiphyte. Broad leaves used by many cichlids as egg-laying substrate.', comments: 'Very slow grower but nearly indestructible. Attach to hardscape — never bury the rhizome. Low light tolerant. Prone to algae on old leaves due to slow growth rate.' },
  'Limnobium laevigatum': { biotope: 'Central and South American still waters, ponds, and slow rivers. Free-floating rosette with trailing roots.', socialBehavior: 'Provides shade and cover for surface-shy fish. Long roots serve as fry refuge. Competes with algae for nutrients.', comments: 'Fast grower that absorbs excess nutrients. Trailing roots can reach 30cm. Needs open top or space between lid and water. Propagates by runners.' },
  'Vallisneria spiralis': { biotope: 'Cosmopolitan — found in temperate to tropical freshwater streams and lakes across Europe, Asia, Africa, and Australia.', socialBehavior: 'Tall background plant forming dense grass-like stands. Runner propagation creates natural-looking meadows.', comments: 'Very easy grower. Sends out runners prolifically. Prefers moderate light and hard water (needs calcium). Can grow to surface and trail along it. Trim by pulling entire leaves, not cutting.' },
  'Cryptocoryne wendtii': { biotope: 'Sri Lankan streams growing in sandy/muddy substrates under moderate shade. Highly variable leaf color and shape.', socialBehavior: 'Mid-ground rosette plant providing natural cover. Multiple color variants available (green, brown, red, tropica).', comments: 'Hardy once established but prone to crypt melt when first planted or when parameters shift. Low to moderate light. Propagates by runners. Leave undisturbed once settled.' },
  'Vallisneria americana': { biotope: 'North American lakes and rivers. Larger species growing in sandy substrates with moderate current.', socialBehavior: 'Tall, wide-leaved background plant forming dense stands. Provides excellent cover for taller tanks.', comments: 'Grows very tall (60-100cm+). Needs nutrient-rich substrate. Moderate to high light. Spreads aggressively via runners. Sometimes called Jungle Val.' },
  'Taxiphyllum sp. flame': { biotope: 'Cultivar of Asian origin (exact provenance unclear). Grows upward in a flame-like pattern unlike typical mosses.', socialBehavior: 'Decorative midground moss for attaching to driftwood or rocks. Provides shelter for shrimp and fry.', comments: 'Slow to moderate grower with distinctive upward growth habit. Low to moderate light. Attach to hardscape. Trim to maintain flame shape.' },
  'Hygrophila difformis': { biotope: 'Southeast Asian marshes, rice paddies, and stream margins. Grows emergent or fully submerged.', socialBehavior: 'Fast-growing stem plant excellent for nutrient export. Feathery submerged leaves provide fry cover.', comments: 'One of the fastest-growing aquarium plants. Leaves change shape dramatically based on light (broad in low, lacy/feathered in high). Great for new tank cycling. Propagate by cuttings.' },
  'Vesicularia montagnei': { biotope: 'Southeast Asian streams growing on rocks in shaded, humid conditions. Branching pattern resembles Christmas tree shape.', socialBehavior: 'Decorative moss for hardscape. Denser than Java Moss. Good shrimp grazing surface.', comments: 'Slow to moderate grower with triangular branching fronds. Attach to driftwood or mesh pads. Low to moderate light. Trim outer growth to maintain shape.' },
  'Bucephalandra spp.': { biotope: 'Borneo island streams and waterfalls, growing on rocks in fast-flowing, clear water. Rheophytic epiphyte.', socialBehavior: 'Slow-growing collector plant attached to hardscape. Many species/varieties with different leaf colors and textures.', comments: 'Grows very slowly. Attach rhizome to rocks or wood — never bury. Tolerates low light. Leaves may develop iridescent sheen. Flowers underwater. Sensitive to parameter swings.' },
  'Anubias barteri var. nana': { biotope: 'West African streams, same habitat as Anubias barteri but smaller variety. Grows on rocks and submerged wood.', socialBehavior: 'Compact epiphyte ideal for foreground or midground on hardscape. Hardy and versatile.', comments: 'Same care as Anubias barteri but stays small (5-10cm). Extremely slow grower. Low light tolerant. Popular for nano tanks and shrimp tanks.' },
  'Bacopa monnieri': { biotope: 'Pantropical wetland herb found in marshes, stream banks, and shallow water across India, Africa, and the Americas.', socialBehavior: 'Upright stem plant for mid-to-background. Compact leaf pattern provides moderate cover.', comments: 'Moderate grower. Round succulent-like leaves. Grows well in low to high light. Can grow emergent. Propagate by cuttings. Also known as Brahmi in traditional medicine.' },
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Invertebrate ecology
// ─────────────────────────────────────────────────────────────────────────────

const invertEcology = {
  'Physella acuta': { biotope: 'Cosmopolitan — found in almost any freshwater habitat worldwide. Extremely adaptable to diverse water conditions.', socialBehavior: 'Harmless detritivore. Populations self-regulate based on available food. Indicator of overfeeding if population explodes.', comments: 'Often considered a pest but actually beneficial — eats decomposing plant matter, leftover food, and biofilm. Reproduces rapidly. Cannot damage healthy plants.', trophicLevel: 'Detritivore', spawningTrait: 'Prolific egg layer — deposits gelatinous egg clusters on hard surfaces' },
  'Pomacea bridgesii': { biotope: 'South American rivers and wetlands (Brazil, Bolivia, Paraguay). Prefers calm waters with vegetation.', socialBehavior: 'Peaceful algae and detritus grazer. Does NOT eat healthy plants (unlike other Pomacea species). Good community member.', comments: 'Needs calcium for shell health (KH 3+ recommended). Lays pink egg clusters above the waterline. Multiple color varieties (gold, blue, ivory, purple). Sensitive to copper.', trophicLevel: 'Herbivore / Detritivore', spawningTrait: 'Lays eggs above waterline in pink/white clutches. Requires air gap between water and lid.' },
  'Melanoides tuberculata': { biotope: 'Native to East Africa and Southeast Asia but now cosmopolitan. Burrows in sandy/muddy substrates in rivers and lakes.', socialBehavior: 'Nocturnal burrower that aerates substrate. Prevents anaerobic gas pockets. Populations indicate tank health.', comments: 'Livebearing snail that reproduces prolifically. Spends daylight buried in substrate. Excellent for planted tanks — turns over substrate without uprooting plants.', trophicLevel: 'Detritivore', spawningTrait: 'Parthenogenetic livebearer — produces live young without mating' },
  'Neritina spp.': { biotope: 'Tropical coastal and brackish rivers in Southeast Asia, Africa, and the Pacific. Migrate between fresh and brackish water.', socialBehavior: 'Excellent algae grazer. Peaceful. Deposits white sesame-seed-like eggs on hard surfaces but these will not hatch in freshwater.', comments: 'Among the best algae-eating snails. Cannot breed in freshwater (larvae need brackish). Multiple species and patterns (zebra, tiger, olive). Needs calcium for shell health.', trophicLevel: 'Herbivore', spawningTrait: 'Lays eggs in freshwater but larvae require brackish water to develop — no population explosion risk' },
  'Planorbella duryi': { biotope: 'Americas — widespread in ponds, ditches, and slow streams. Highly adaptable to any freshwater.', socialBehavior: 'Peaceful scavenger eating algae, biofilm, decaying matter. Populations boom with excess food.', comments: 'Flat-coiled shell. Available in many color morphs (red, blue, pink, leopard). Hermaphroditic — any two can breed. Great cleanup crew but can overpopulate.', trophicLevel: 'Detritivore / Herbivore', spawningTrait: 'Hermaphroditic egg layer — deposits transparent jelly egg masses on surfaces' },
  'Caridina multidentata': { biotope: 'Japanese mountain streams (Amano shrimp named after Takashi Amano). Clear, fast-flowing water over gravel.', socialBehavior: 'The premiere algae-eating shrimp. Peaceful, social, best in groups of 10+. Larger than most dwarf shrimp — less vulnerable to predation.', comments: 'Cannot breed in freshwater — larvae need brackish water. Excellent algae control. Grows to 5cm. May eat soft mosses if underfed. Hardy once acclimated but sensitive to copper.', trophicLevel: 'Omnivore / Detritivore', spawningTrait: 'Females carry eggs but larvae require saltwater — will not breed in freshwater tanks' },
  'Palaemonetes paludosus': { biotope: 'Eastern North American freshwater streams, ponds, and vegetated shallows. Tolerant of wide parameter range.', socialBehavior: 'Transparent scavenger and algae grazer. Peaceful but may be eaten by larger fish. Group of 10+ recommended.', comments: 'Inexpensive and often sold as feeder shrimp but makes a good cleanup crew. Fully breeds in freshwater. Short-lived (1-2 years). Hardy and undemanding.', trophicLevel: 'Omnivore / Detritivore', spawningTrait: 'Freshwater breeder — females carry green eggs under abdomen until hatching' },
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Remaining fish missing ecology (8 species)
// ─────────────────────────────────────────────────────────────────────────────

const fishEcology = {
  'Apistogramma borellii Opal': { biotope: 'South American streams and tributaries in southern Brazil, Argentina, and Paraguay. Leaf-litter zones with tannin-stained water.', socialBehavior: 'Harem-forming dwarf cichlid. Keep one male with 2-3 females. Males claim small territories but aggression is low compared to other Apistogramma.', comments: 'The Opal morph is a selectively bred color variant of A. borellii. One of the hardiest and most peaceful Apistogramma species. Prefers soft, acidic water but adapts to moderate hardness.', trophicLevel: 'Omnivore', spawningTrait: 'Cave spawner with maternal care', fooditems: 'Small invertebrates, insect larvae, worms; in aquarium: frozen/live foods (daphnia, brine shrimp, bloodworm), sinking micro pellets' },
  'Hemigrammus rhodostomus': { biotope: 'Lower Amazon basin and Orinoco River tributaries. Blackwater streams with soft, acidic conditions and leaf litter.', socialBehavior: 'Tight-schooling tetra — must be kept in groups of 10+. Red nose coloration fades when stressed or water quality drops, making them excellent indicator fish.', comments: 'Often confused with Petitella georgiae (false rummy nose). Requires stable, mature tank with soft acidic water for best color. Sensitive to ammonia/nitrite.', trophicLevel: 'Omnivore', spawningTrait: 'Egg scatterer no parental care', fooditems: 'Small invertebrates, zooplankton; in aquarium: micro pellets, flakes, frozen daphnia and brine shrimp' },
  'Leporinus vanzoi': { biotope: 'Rio Tapajós basin, Brazil. Fast-flowing clear water rivers over rocky substrates.', socialBehavior: 'Active swimmer. Can be nippy toward slow-moving tankmates. Keep singly or in groups of 6+ to distribute aggression.', comments: 'Reaches 20-25cm. Requires strong current and oxygenation. Herbivorous tendency — may nibble soft-leaved plants. Jump-proof lid essential.', trophicLevel: 'Omnivore', spawningTrait: 'Egg scatterer — rarely bred in captivity', fooditems: 'Algae, plant matter, seeds, small invertebrates; in aquarium: spirulina flakes, blanched vegetables, occasional live foods' },
  'Brochis agassizii': { biotope: 'Upper Amazon tributaries in Peru and Brazil. Sandy-bottomed streams with moderate current.', socialBehavior: 'Peaceful schooling catfish. Keep in groups of 5+. Larger and deeper-bodied than most Corydoras but same behavior.', comments: 'Now reclassified as Corydoras agassizii by some authorities. Grows larger than typical Corydoras (7-8cm). Needs sand substrate to protect barbels.', trophicLevel: 'Omnivore / Detritivore', spawningTrait: 'Egg depositor with T-position embrace — adhesive eggs placed on surfaces', fooditems: 'Benthic invertebrates, worms, insect larvae; in aquarium: sinking pellets, frozen bloodworm, live tubifex' },
  'Osteoglossum bicirrhosum': { biotope: 'Amazon basin floodplains and slow rivers. Surface-dwelling predator in tannin-stained blackwater.', socialBehavior: 'Solitary surface predator. Highly aggressive toward conspecifics. Will eat any fish that fits in its mouth. Needs massive open swimming space.', comments: 'Grows to 90cm+ and lives 15-20 years. Notorious jumper — requires heavy, sealed lid. Not a community fish. Needs pristine water quality. True monster fish commitment.', trophicLevel: 'Carnivore / Piscivore', spawningTrait: 'Mouthbrooder with paternal care — male incubates eggs and fry in mouth', fooditems: 'Fish, large insects, crustaceans, frogs; in aquarium: market shrimp, smelt, earthworms, high-quality pellets' },
  'Rasbora trilineata': { biotope: 'Southeast Asian streams and rivers in Malaysia, Sumatra, and Borneo. Clear to tannin-stained water with moderate flow.', socialBehavior: 'Active midwater schooling fish. Keep in groups of 8+. Peaceful but active — can stress slow-moving tankmates.', comments: 'Hardy and adaptable. Scissor-like tail movement is distinctive. Grows larger than most rasboras (13cm). Prefers slightly acidic soft water but very adaptable.', trophicLevel: 'Omnivore', spawningTrait: 'Egg scatterer no parental care', fooditems: 'Insects, zooplankton, small worms; in aquarium: flakes, micro pellets, frozen/live foods' },
  'Iriatherina werneri': { biotope: 'Northern Australia and New Guinea. Slow-moving, heavily vegetated swamps and stream margins.', socialBehavior: 'Peaceful, delicate schooling fish. Males display elaborate elongated fins to rivals. Keep in groups of 8+ with gentle tankmates only.', comments: 'Tiny (4cm) and extremely peaceful. Thread-like fin extensions are fragile — no fin-nippers allowed. Needs gentle filtration and dense planting. Micro foods essential.', trophicLevel: 'Omnivore', spawningTrait: 'Egg scatterer — deposits eggs in fine-leaved plants (java moss ideal)', fooditems: 'Micro-organisms, tiny invertebrates; in aquarium: vinegar eels, baby brine shrimp, crushed flake, micropellets' },
  'Biotodoma cupido': { biotope: 'Amazon and Orinoco basin. Sandy-bottomed slow rivers and lagoons with submerged wood.', socialBehavior: 'Peaceful eartheater cichlid. Keep in groups of 5+. Sifts sand through gills constantly. Less territorial than most South American cichlids.', comments: 'Grows to 12-15cm. Requires fine sand substrate (essential for feeding behavior). Sensitive to water quality — needs regular water changes. Peaceful community cichlid.', trophicLevel: 'Omnivore', spawningTrait: 'Delayed mouthbrooder with biparental care — initially substrate spawns then picks up eggs', fooditems: 'Benthic invertebrates sifted from sand, worms, crustaceans; in aquarium: frozen bloodworm, brine shrimp, fine sinking pellets' },
  'Chilatherina axelrodi': { biotope: 'Lake Tebera region, Papua New Guinea. Clear highland lake and its tributaries.', socialBehavior: 'Active schooling rainbowfish. Keep in groups of 6+. Males display vibrant colors when competing. Peaceful community fish.', comments: 'Males develop intense coloration with maturity. Needs swimming space and moderate current. Hardy once established. Prefers slightly alkaline water (pH 7-8).', trophicLevel: 'Omnivore', spawningTrait: 'Egg scatterer — deposits adhesive eggs among fine-leaved plants over several days', fooditems: 'Insects, algae, small invertebrates; in aquarium: quality flake, frozen foods, live daphnia and brine shrimp' },
};

// ─────────────────────────────────────────────────────────────────────────────
// APPLY ALL FIXES
// ─────────────────────────────────────────────────────────────────────────────

let fixes = { fishData: 0, plantEco: 0, invertEco: 0, fishEco: 0 };

for (const sp of data) {
  const name = sp.scientificName;

  // Section 1: Fix missing fish data
  if (fishFixes[name]) {
    const fix = fishFixes[name];
    if (!sp.maxLengthCm) sp.maxLengthCm = fix.maxLengthCm;
    if (!sp.tankMetrics.minVolumeGallons) sp.tankMetrics.minVolumeGallons = fix.minVolumeGallons;
    if (sp.diet && (!sp.diet.trophicLevel || sp.diet.trophicLevel === 'Omnivore')) {
      sp.diet.trophicLevel = fix.trophicLevel;
    }
    if (sp.reproduction && (!sp.reproduction.spawningTrait || sp.reproduction.spawningTrait === 'Information arriving soon')) {
      sp.reproduction.spawningTrait = fix.spawningTrait;
    }
    fixes.fishData++;
  }

  // Section 2: Plants
  if (plantEcology[name]) {
    const pe = plantEcology[name];
    if (!sp.ecology) sp.ecology = {};
    sp.ecology.biotope = pe.biotope;
    sp.ecology.socialBehavior = pe.socialBehavior;
    sp.ecology.comments = pe.comments;
    fixes.plantEco++;
  }

  // Section 3: Invertebrates
  if (invertEcology[name]) {
    const ie = invertEcology[name];
    if (!sp.ecology) sp.ecology = {};
    sp.ecology.biotope = ie.biotope;
    sp.ecology.socialBehavior = ie.socialBehavior;
    sp.ecology.comments = ie.comments;
    if (ie.trophicLevel && sp.diet) sp.diet.trophicLevel = ie.trophicLevel;
    if (ie.spawningTrait && sp.reproduction) sp.reproduction.spawningTrait = ie.spawningTrait;
    fixes.invertEco++;
  }

  // Section 4: Fish ecology
  if (fishEcology[name]) {
    const fe = fishEcology[name];
    if (!sp.ecology) sp.ecology = {};
    sp.ecology.biotope = fe.biotope;
    sp.ecology.socialBehavior = fe.socialBehavior;
    sp.ecology.comments = fe.comments;
    if (fe.trophicLevel && sp.diet) sp.diet.trophicLevel = fe.trophicLevel;
    if (fe.spawningTrait && sp.reproduction) sp.reproduction.spawningTrait = fe.spawningTrait;
    if (fe.fooditems && sp.diet) sp.diet.fooditems = fe.fooditems;
    fixes.fishEco++;
  }
}

console.log('=== FIXES APPLIED ===');
console.log(`  Fish data (length/vol/troph/spawn): ${fixes.fishData}`);
console.log(`  Plant ecology: ${fixes.plantEco}`);
console.log(`  Invertebrate ecology: ${fixes.invertEco}`);
console.log(`  Fish ecology: ${fixes.fishEco}`);

// Validate
const jsonStr = JSON.stringify(data, null, 2);
const reparsed = JSON.parse(jsonStr);
console.log(`\n  ✅ JSON valid, ${reparsed.length} species`);

// Post-fix audit
const missingVol = data.filter(s => !s.tankMetrics?.minVolumeGallons).length;
const missingEco = data.filter(s => !s.ecology?.biotope || s.ecology.biotope === '').length;
const missingDiet = data.filter(s => !s.diet?.fooditems || s.diet.fooditems === '' || s.diet.fooditems === 'Information arriving soon').length;
const missingRepro = data.filter(s => !s.reproduction?.spawningTrait || s.reproduction.spawningTrait === '' || s.reproduction.spawningTrait === 'Information arriving soon').length;

console.log('\n=== POST-FIX AUDIT ===');
console.log(`  minVolumeGallons missing: ${missingVol}`);
console.log(`  ecology.biotope missing: ${missingEco}`);
console.log(`  diet.fooditems missing: ${missingDiet}`);
console.log(`  spawningTrait missing: ${missingRepro}`);

// Save
writeFileSync(PROPOSED_PATH, jsonStr, 'utf-8');
console.log(`\n✅ Saved to: ${PROPOSED_PATH} (${(jsonStr.length/1024).toFixed(0)} KB)`);
