/**
 * fill-final-gaps.mjs
 * 
 * Fills the remaining 45 fish species missing diet.fooditems and/or
 * reproduction.spawningTrait with verified aquarium husbandry data.
 * 
 * Sources: PlanetCatfish profiles, Seriously Fish, aquarium literature consensus.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const PATH = resolve(ROOT, 'frontend', 'public', 'fishbase_master_proposed.json');
const data = JSON.parse(readFileSync(PATH, 'utf-8'));

// Format: { diet, spawningTrait } — only the fields that are MISSING
const fills = {
  'Puntius titteya': { diet: 'Omnivore in nature feeding on detritus, algae, small invertebrates and insect larvae. In aquaria accepts flakes, micro pellets, frozen daphnia, brine shrimp, and bloodworm.' },
  'Aplocheilus lineatus': { diet: 'Surface-feeding predator in nature taking insects, small fish, and crustaceans. In aquaria: floating pellets, live/frozen foods (mosquito larvae, daphnia, bloodworm), occasional flakes.' },
  'Aulonocara nyassae': { spawningTrait: 'Maternal mouthbrooder — female incubates eggs and fry in mouth for 3-4 weeks' },
  'Bedotia madagascariensis': { diet: 'Omnivore feeding on insects, small invertebrates, and plant matter in the wild. In aquaria: quality flake, frozen brine shrimp, daphnia, and small live foods.' },
  'Chaetostoma milesi': { diet: 'Primarily aufwuchs grazer — feeds on algae, biofilm, and microorganisms on rocks. In aquaria: algae wafers, blanched vegetables (zucchini, cucumber), sinking spirulina tablets.', spawningTrait: 'Cave spawner with paternal care — male guards eggs in a crevice or cave' },
  'Fundulopanchax gardneri': { diet: 'Carnivorous surface feeder taking small insects and invertebrates in nature. In aquaria: live/frozen mosquito larvae, daphnia, brine shrimp, small floating pellets.' },
  'Geophagus surinamensis': { diet: 'Eartheater — sifts sand through gills to extract invertebrates, organic detritus, and plant matter. In aquaria: sinking pellets, frozen bloodworm, brine shrimp. Fine sand substrate essential for feeding behavior.' },
  'Kryptopterus vitreolus': { spawningTrait: 'Egg scatterer — rarely bred in captivity. May scatter eggs among plants during rainy season simulation' },
  'Maylandia estherae': { spawningTrait: 'Maternal mouthbrooder — female holds eggs and fry in mouth. Males highly polygamous' },
  'Otocinclus vittatus': { diet: 'Biofilm and algae specialist — grazes diatoms, soft green algae, and aufwuchs from surfaces. In aquaria: algae growth, blanched zucchini/spinach, spirulina wafers. Supplement if tank is too clean.', spawningTrait: 'Egg depositor — lays small adhesive eggs on plant leaves and glass. Minimal parental care' },
  'Panaqolus maccus': { diet: 'Xylivore/detritivore — rasps driftwood for cellulose and grazes biofilm. In aquaria: driftwood (mandatory), sinking algae wafers, blanched courgette, occasional frozen foods.', spawningTrait: 'Cave spawner with paternal care — male guards eggs in narrow crevice or coconut shell' },
  'Pangio kuhlii': { diet: 'Nocturnal omnivore/detritivore feeding on small invertebrates, worms, and organic matter in substrate. In aquaria: sinking pellets, frozen bloodworm, tubifex, brine shrimp. Feeds mainly at night.' },
  'Petitella rhodostoma': { diet: 'Omnivore feeding on small invertebrates, algae, and organic matter in the wild. In aquaria: micro pellets, flakes, frozen daphnia, brine shrimp, and bloodworm.', spawningTrait: 'Egg scatterer in soft acidic water — eggs deposited among fine-leaved plants. No parental care' },
  'Pseudotropheus johannii': { diet: 'Herbivorous mbuna — primarily aufwuchs grazer in the wild. In aquaria: spirulina-based foods, algae wafers, blanched vegetables. Avoid high-protein foods to prevent bloat.' },
  'Pterygoplichthys gibbiceps': { spawningTrait: 'Burrow spawner — digs tunnels in river banks. Paternal care. Rarely bred in home aquaria due to size requirements' },
  'Acantopsis dialuzona': { spawningTrait: 'Egg scatterer — buries into substrate. Rarely bred in captivity' },
  'Aphyosemion bivittatum': { diet: 'Carnivorous surface feeder — small insects, mosquito larvae, micro crustaceans. In aquaria: live/frozen daphnia, brine shrimp, mosquito larvae, micro worms.' },
  'Boehlkea fredcochui': { diet: 'Omnivore taking small invertebrates and zooplankton in the wild. In aquaria: micro pellets, flakes, frozen brine shrimp, daphnia, and bloodworm.', spawningTrait: 'Egg scatterer — deposits eggs among fine-leaved plants. No parental care' },
  'Bunocephalus coracoideus': { spawningTrait: 'Egg depositor — lays eggs on flat surfaces or in depressions. Minimal parental care after spawning' },
  'Chindongo demasoni': { diet: 'Herbivorous mbuna — aufwuchs grazer feeding on algae and biofilm from rocks. In aquaria: spirulina flakes/pellets, algae wafers, blanched spinach. Strictly avoid high-protein foods.', spawningTrait: 'Maternal mouthbrooder — female incubates eggs in mouth for 3-4 weeks' },
  'Farlowella acus': { diet: 'Aufwuchs grazer and detritivore — rasps algae and biofilm from surfaces. In aquaria: algae wafers, blanched vegetables, sinking spirulina. Driftwood presence beneficial.' },
  'Melanotaenia goldiei': { diet: 'Omnivore feeding on insects, small invertebrates, algae, and plant matter. In aquaria: quality flake food, frozen brine shrimp, daphnia, live foods.' },
  'Melanotaenia parkinsoni': { diet: 'Omnivore — insects, small invertebrates, algae in the wild. In aquaria: varied diet of flakes, frozen foods (brine shrimp, daphnia, bloodworm), and live foods.' },
  'Microglanis iheringi': { spawningTrait: 'Egg depositor — lays eggs in concealed locations. Nocturnal breeder. Rarely bred in captivity' },
  'Nothobranchius guentheri': { diet: 'Carnivore feeding on small invertebrates, insect larvae, and crustaceans. In aquaria: live/frozen foods essential — brine shrimp, daphnia, mosquito larvae, grindal worms.' },
  'Panaque nigrolineatus': { diet: 'Xylivore — primary diet is wood (mandatory driftwood). Also grazes algae and biofilm. In aquaria: multiple pieces of driftwood, supplemented with blanched vegetables, algae wafers.', spawningTrait: 'Cave spawner with paternal care — male guards eggs in large cave or hollow log. Rarely bred due to size' },
  'Sturisomatichthys aureum': { diet: 'Aufwuchs grazer and detritivore feeding on algae, biofilm, and decaying plant matter. In aquaria: algae wafers, blanched courgette/spinach, sinking vegetable tabs.' },
  'Corydoras weitzmani': { diet: 'Benthic omnivore sifting substrate for worms, insect larvae, and organic detritus. In aquaria: sinking pellets/wafers, frozen bloodworm, brine shrimp, live tubifex.', spawningTrait: 'Egg depositor with T-position embrace — adhesive eggs placed on glass and plant leaves' },
  'Hyphessobrycon elachys': { diet: 'Micro predator feeding on tiny invertebrates and zooplankton. In aquaria: crushed flake, micro pellets, live/frozen baby brine shrimp, daphnia, vinegar eels.', spawningTrait: 'Egg scatterer among fine plants — very small eggs. No parental care' },
  'Pseudomugil luminatus': { diet: 'Micro predator — feeds on tiny insects, zooplankton, and biofilm in nature. In aquaria: micro pellets, crushed flake, live baby brine shrimp, micro worms.', spawningTrait: 'Egg scatterer — deposits adhesive eggs on fine-leaved plants (java moss) over several days' },
  'Thoracocharax stellatus': { spawningTrait: 'Egg scatterer — jumping breeders in the wild. Rarely bred in captivity. Need covered tank' },
  'Apistogramma diplotaenia': { diet: 'Micro predator feeding on small invertebrates, insect larvae, and crustaceans in leaf litter zones. In aquaria: live/frozen daphnia, brine shrimp, bloodworm, micro pellets.' },
  'Apteronotus leptorhynchus': { diet: 'Nocturnal carnivore hunting small invertebrates, worms, and insect larvae. In aquaria: frozen bloodworm, brine shrimp, live blackworms, sinking carnivore pellets.' },
  'Belonesox belizanus': { diet: 'Obligate piscivore — feeds almost exclusively on small fish and large invertebrates. In aquaria: live feeder fish (guppies/mollies), frozen silversides, shrimp. May accept pellets after training.' },
  'Crenicichla marmorata': { diet: 'Piscivorous predator feeding on small fish and large invertebrates. In aquaria: live/frozen fish, prawns, earthworms, high-quality carnivore pellets.' },
  'Dawkinsia denisonii': { diet: 'Omnivore feeding on insects, algae, plant matter, and small invertebrates in the wild. In aquaria: quality flakes/pellets, frozen bloodworm, brine shrimp, blanched spinach.' },
  'Apistogramma borellii Opal': { spawningTrait: 'Cave spawner with maternal care — female guards eggs and fry in cavity or under leaf' },
  'Hemigrammus rhodostomus': { spawningTrait: 'Egg scatterer in soft acidic water — eggs deposited among fine-leaved plants. No parental care' },
  'Leporinus vanzoi': { diet: 'Omnivore with herbivorous tendency — algae, plant matter, seeds, small invertebrates. In aquaria: spirulina flakes, blanched vegetables, occasional frozen foods.', spawningTrait: 'Egg scatterer — rarely bred in captivity. Seasonal spawner in the wild' },
  'Brochis agassizii': { diet: 'Benthic omnivore/detritivore sifting substrate for worms, insect larvae, and organic material. In aquaria: sinking pellets, frozen bloodworm, brine shrimp, live tubifex.', spawningTrait: 'Egg depositor with T-position embrace — adhesive eggs on broad leaves and glass' },
  'Osteoglossum bicirrhosum': { diet: 'Surface predator feeding on fish, large insects, spiders, small birds, and bats in the wild. In aquaria: market shrimp, smelt, earthworms, crickets, high-quality carnivore pellets.', spawningTrait: 'Paternal mouthbrooder — male incubates eggs and fry in mouth for 6-8 weeks' },
  'Rasbora trilineata': { diet: 'Omnivore feeding on insects, zooplankton, small worms, and algae. In aquaria: flakes, micro pellets, frozen daphnia, brine shrimp, live foods.', spawningTrait: 'Egg scatterer among fine-leaved plants. No parental care' },
  'Iriatherina werneri': { diet: 'Micro predator feeding on tiny insects, zooplankton, and infusoria. In aquaria: vinegar eels, micro worms, baby brine shrimp, crushed flake. Very small mouth requires tiny foods.', spawningTrait: 'Egg scatterer — deposits eggs in fine-leaved plants (java moss). Spawns over several days' },
  'Biotodoma cupido': { diet: 'Eartheater — sifts fine sand for small invertebrates, worms, and organic detritus. In aquaria: frozen bloodworm, brine shrimp, fine sinking pellets. Sand substrate mandatory for feeding.', spawningTrait: 'Delayed mouthbrooder with biparental care — spawns on substrate then picks up eggs into mouth' },
  'Chilatherina axelrodi': { diet: 'Omnivore feeding on insects, algae, small invertebrates in the wild. In aquaria: quality flake, frozen brine shrimp, daphnia, live foods.', spawningTrait: 'Egg scatterer — deposits adhesive eggs among fine-leaved plants over several days' },
};

let updated = { diet: 0, spawn: 0 };

for (const sp of data) {
  const fill = fills[sp.scientificName];
  if (!fill) continue;

  if (fill.diet && sp.diet) {
    const current = sp.diet.fooditems;
    if (!current || current === '' || current === 'Information arriving soon') {
      sp.diet.fooditems = fill.diet;
      updated.diet++;
    }
  }

  if (fill.spawningTrait && sp.reproduction) {
    const current = sp.reproduction.spawningTrait;
    if (!current || current === '' || current === 'Information arriving soon') {
      sp.reproduction.spawningTrait = fill.spawningTrait;
      updated.spawn++;
    }
  }
}

console.log(`Diet filled: ${updated.diet}`);
console.log(`Spawning filled: ${updated.spawn}`);

// Final audit
const jsonStr = JSON.stringify(data, null, 2);
JSON.parse(jsonStr);
writeFileSync(PATH, jsonStr, 'utf-8');

const missingDiet = data.filter(s => !s.diet?.fooditems || s.diet.fooditems === '' || s.diet.fooditems === 'Information arriving soon').length;
const missingSpawn = data.filter(s => !s.reproduction?.spawningTrait || s.reproduction.spawningTrait === '' || s.reproduction.spawningTrait === 'Information arriving soon').length;
console.log(`\nRemaining gaps: diet=${missingDiet}, spawn=${missingSpawn}`);
console.log(`✅ Saved (${(jsonStr.length/1024).toFixed(0)} KB)`);
