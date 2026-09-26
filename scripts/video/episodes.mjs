// =============================================================================
// Episode slate — single source of truth for the YouTube feature series.
// Derived from docs/APP_FEATURE_MAP.md. Tier A (design) — owned by Opus.
//
// Each episode maps to one or more feature-map sections. The generator
// (generate-scripts.mjs) slices those sections out of the feature map and feeds
// them to the script-gen prompt.
//
// Fields:
//   id            kebab id, also the output filename stem
//   title         working title (the model may refine the public title)
//   sections      heading text(s) from APP_FEATURE_MAP.md to include as source
//   mode          'casual' | 'pro' | 'both'  — framing + which UI mode to record
//   echoCameo     true => include Echo intro/outro + a mascot cameo beat
//   reviewGate    true => Opus must review the generated script before recording
//                 (money / ownership / certificate / auth claims)
//   targetMinutes rough runtime budget; steers script length
// =============================================================================

/** @typedef {'casual'|'pro'|'both'} Mode */

export const EPISODES = [
  {
    id: 'aquariums',
    title: 'Your Tank Logbook, Done Right',
    sections: ['1. My Aquariums / Aquariums  (`tanks`)'],
    mode: 'both',
    echoCameo: true,
    reviewGate: false,
    targetMinutes: 5,
  },
  {
    id: 'fish-finder',
    title: 'Find the Right Fish for Your Tank',
    sections: ['2. Fish Finder / Breed Gallery  (`gallery`)'],
    mode: 'both',
    echoCameo: true,
    reviewGate: false,
    targetMinutes: 5,
  },
  {
    id: 'breeder-tools',
    title: 'Pedigree, Spawning & Genetics',
    sections: ['3. Breeder Tools  (`breeder`)  — pro only'],
    mode: 'pro',
    echoCameo: false,
    reviewGate: true, // birth certificates / lineage / ownership claims
    targetMinutes: 6,
  },
  {
    id: 'marketplace',
    title: 'Browse & Buy on the Marketplace',
    sections: ['4. Breeder Store / Marketplace  (`directory`)'],
    mode: 'both',
    echoCameo: false,
    reviewGate: false,
    targetMinutes: 4,
  },
  {
    id: 'orders-escrow',
    title: 'Orders, Escrow & Safe Handoffs',
    sections: ['5. My Orders  (`orders`)  — buyer side', '6. Incoming / In Transit  (`incoming`)  — appears only when items are shipping'],
    mode: 'both',
    echoCameo: false,
    reviewGate: true, // real-money Stripe escrow, DOA claims, payouts
    targetMinutes: 6,
  },
  {
    id: 'the-reef',
    title: 'The Reef — Community, Events & Live',
    sections: ['7. The Reef / Social  (`reef`)'],
    mode: 'both',
    echoCameo: true,
    reviewGate: false,
    targetMinutes: 5,
  },
  {
    id: 'settings-privacy',
    title: 'Settings, Backup & Privacy',
    sections: ['8. Settings  (`settings`)'],
    mode: 'both',
    echoCameo: false,
    reviewGate: false,
    targetMinutes: 3,
  },
  {
    id: 'seller-hub',
    title: 'Seller Hub — Listings, Shipping & Payouts',
    sections: ['10. Seller Hub / Breeder Terminal  (`breeder-terminal`)  — beta allowlist'],
    mode: 'pro',
    echoCameo: false,
    reviewGate: true, // Stripe Connect payouts, balances
    targetMinutes: 6,
  },
  {
    id: 'poseidon-echo',
    title: 'Meet Poseidon & Echo',
    sections: ['Always-on (not a tab)'],
    mode: 'both',
    echoCameo: true,
    reviewGate: false,
    targetMinutes: 4,
  },
  {
    id: 'casual-vs-pro',
    title: 'Casual Hobbyist vs Pro Breeder Mode',
    sections: ['Navigation overview'],
    mode: 'both',
    echoCameo: true,
    reviewGate: false,
    targetMinutes: 4,
  },
  {
    id: 'trailer',
    title: 'Aquacellum — Channel Trailer',
    sections: ['Navigation overview', 'Always-on (not a tab)'],
    mode: 'both',
    echoCameo: true,
    reviewGate: false,
    targetMinutes: 2,
  },
];

export const REVIEW_GATE_IDS = EPISODES.filter((e) => e.reviewGate).map((e) => e.id);
