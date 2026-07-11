-- ============================================================================
-- Official Master Schools — Pre-seeded species-focused schools
-- Adds is_official flag to schools table and inserts 20 curated schools.
-- ============================================================================

-- 1. Add is_official column to distinguish platform-curated schools
ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_official BOOLEAN DEFAULT FALSE;

-- Index for quick filtering of official schools
CREATE INDEX IF NOT EXISTS idx_schools_is_official ON schools(is_official) WHERE is_official = TRUE;

-- 2. Insert 20 Official Master Schools
-- These use a deterministic UUID (v5-style) based on slug for idempotency.
-- founder_wallet is NULL (system-created), open to all, no member cap.

INSERT INTO schools (id, name, slug, description, banner_url, school_type, founder_wallet, member_cap, is_invite_only, tracked_species, is_official, member_count)
VALUES
  (
    'a0000000-0000-4000-8000-000000000001',
    'Betta Keepers',
    'betta-keepers',
    'The definitive community for Betta splendens enthusiasts. Share care tips, breeding projects, tail types, and everything Betta.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 4768, "scientificName": "Betta splendens", "commonName": "Betta / Siamese Fighting Fish"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'Neon Tetra Nation',
    'neon-tetra-nation',
    'Everything about the iconic Neon Tetra — schooling setups, planted tank companions, and breeding the classic jewel of freshwater.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 10691, "scientificName": "Paracheirodon innesi", "commonName": "Neon Tetra"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    'Guppy Guild',
    'guppy-guild',
    'For guppy breeders and keepers. Discuss genetics, strain development, livebearer care, and colorful colonies.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 3228, "scientificName": "Poecilia reticulata", "commonName": "Guppy"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000004',
    'Bristlenose Brigade',
    'bristlenose-brigade',
    'Dedicated to Ancistrus cirrhosus and the broader bristlenose world. Algae management, cave breeding, and driftwood setups.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 23347, "scientificName": "Ancistrus cirrhosus", "commonName": "Bristlenose Pleco"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000005',
    'Corydoras Corner',
    'corydoras-corner',
    'For fans of the armored catfish. Shoaling behavior, substrate choices, and breeding Bronze Corys and beyond.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 7777, "scientificName": "Corydoras aeneus", "commonName": "Bronze Corydoras"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000006',
    'Angelfish Academy',
    'angelfish-academy',
    'Graceful, tall, and full of personality. Discuss Pterophyllum scalare care, pairing, and community tank strategies.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 4717, "scientificName": "Pterophyllum scalare", "commonName": "Freshwater Angelfish"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000007',
    'Goldfish Society',
    'goldfish-society',
    'The OG aquarium fish. From commons to fancies — pond setups, filtration, and debunking the bowl myth.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 271, "scientificName": "Carassius auratus", "commonName": "Common Goldfish"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000008',
    'Discus Circle',
    'discus-circle',
    'The king of the aquarium. Water chemistry, feeding regimens, and the art of keeping Symphysodon.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 11185, "scientificName": "Symphysodon aequifasciatus", "commonName": "Discus"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000009',
    'Dwarf Gourami Den',
    'dwarf-gourami-den',
    'Care, color morphs, and health management for Trichogaster lalius — the jewel-toned labyrinth fish.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 4774, "scientificName": "Trichogaster lalius", "commonName": "Dwarf Gourami"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000010',
    'Tiger Barb Tank',
    'tiger-barb-tank',
    'Fast, feisty, and striped. Discuss proper shoal sizes, aggression management, and barb-compatible communities.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 4766, "scientificName": "Puntigrus tetrazona", "commonName": "Tiger Barb"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000011',
    'Harlequin Rasbora Hub',
    'harlequin-rasbora-hub',
    'The peaceful schooler that looks stunning in planted tanks. Care tips, breeding triggers, and nano setups.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 10881, "scientificName": "Trigonostigma heteromorpha", "commonName": "Harlequin Rasbora"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000012',
    'Cherry Barb Collective',
    'cherry-barb-collective',
    'The gentle barb with stunning red coloration. Planted tank setups, breeding, and conservation awareness.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 6147, "scientificName": "Puntius titteya", "commonName": "Cherry Barb"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000013',
    'Ram Cichlid Society',
    'ram-cichlid-society',
    'German Blue Rams — the jewel of dwarf cichlids. Water parameters, pair bonding, and color enhancement.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 12305, "scientificName": "Mikrogeophagus ramirezi", "commonName": "German Blue Ram"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000014',
    'Oscar Owners Club',
    'oscar-owners-club',
    'Big personality, big fish. Tank size requirements, feeding, and living with the aquatic dog.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 3612, "scientificName": "Astronotus ocellatus", "commonName": "Oscar"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000015',
    'Clown Loach Crew',
    'clown-loach-crew',
    'The social giant of the loach world. Group dynamics, long-term growth, and community tank planning.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 10897, "scientificName": "Chromobotia macracanthus", "commonName": "Clown Loach"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000016',
    'Kuhli Loach Lodge',
    'kuhli-loach-lodge',
    'Noodle fish enthusiasts unite. Substrate choices, hiding spots, and nocturnal behavior appreciation.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 12276, "scientificName": "Pangio kuhlii", "commonName": "Kuhli Loach"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000017',
    'Cardinal Tetra Collective',
    'cardinal-tetra-collective',
    'The deeper-red cousin of the Neon. Blackwater setups, wild-caught vs captive-bred, and biotope aquascaping.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 8195, "scientificName": "Paracheirodon axelrodi", "commonName": "Cardinal Tetra"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000018',
    'Zebra Danio Zone',
    'zebra-danio-zone',
    'Hardy, active, and endlessly entertaining. The perfect beginner fish and a genetic research icon.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 4653, "scientificName": "Danio rerio", "commonName": "Zebra Danio"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000019',
    'Convict Cichlid Corps',
    'convict-cichlid-corps',
    'Prolific breeders with attitude. Pair dynamics, fry raising, and managing aggression in community tanks.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 3615, "scientificName": "Amatitlania nigrofasciata", "commonName": "Convict Cichlid"}]',
    TRUE,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000020',
    'Molly Mania',
    'molly-mania',
    'Versatile livebearers for fresh and brackish setups. Color varieties, breeding, and beginner-friendly communities.',
    NULL,
    'species',
    NULL,
    NULL,
    FALSE,
    '[{"specCode": 4680, "scientificName": "Poecilia sphenops", "commonName": "Molly"}]',
    TRUE,
    0
  )
ON CONFLICT (slug) DO NOTHING;
