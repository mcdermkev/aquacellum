# Aquadex Sponsorship Architecture

> Zero-cost sponsorship infrastructure. Renders nothing until activated. Lights up everywhere when a deal is signed.

## Quick Start

### 1. Wrap your app with the provider

```jsx
// In App.jsx or main.jsx
import { SponsorProvider } from "./sponsorship";

function App() {
  return (
    <SponsorProvider>
      {/* ... existing app ... */}
    </SponsorProvider>
  );
}
```

### 2. Use `useSponsorSlot` at any surface

```jsx
import { useSponsorSlot, SponsorBadge } from "../sponsorship";

function FeedButton({ species }) {
  const slot = useSponsorSlot("husbandry_feed", { speciesGroup: species.family });

  return (
    <>
      <button onClick={logFeed}>🥣 Feed</button>
      {slot && (
        <SponsorBadge
          sponsor={slot.sponsor}
          product={slot.product}
          productLink={slot.productLink}
          tagline={slot.tagline}
          surface="husbandry_feed"
        />
      )}
    </>
  );
}
```

### 3. Add XP campaigns

```jsx
import { SponsorCampaignBanner } from "../sponsorship";

// In the tank detail view
<SponsorCampaignBanner surface="husbandry_feed" />
```

## Surfaces

| Surface ID | App Location | Sponsor Type |
|---|---|---|
| `husbandry_feed` | TankList → Feed action | Fish food brands |
| `husbandry_treatment` | TankList → Treatment action | Medication brands |
| `husbandry_water_change` | TankList → Water change | Water conditioner brands |
| `alert_high_nitrate` | Chemistry alerts | Test kits / filters |
| `alert_high_ammonia` | Chemistry alerts | Test kits / filters |
| `species_detail_temperature` | Species card / Database | Heater brands |
| `species_detail_diet` | Species card / Database | Food brands |
| `species_detail_habitat` | Species card / Database | Equipment brands |
| `marketplace_featured` | MarketplaceBoard | Hatcheries / LFS chains |
| `checkout_shipping` | CheckoutSummary | Shipping supply brands |
| `checkout_insurance` | CheckoutSummary | Livestock guarantee partners |
| `onboarding_equipment` | OnboardingWizard | Starter kit brands |
| `reef_biome` | ImmersiveReef biome zones | Premium brands |
| `reef_narration` | NarrationLayer | Educational sponsors |
| `xp_campaign` | XP system / loyalty | Any engagement-seeking brand |

## Configuration

### Adding a sponsor

Edit `config/sponsors.json`:

```json
{
  "sponsors": [
    {
      "id": "hikari",
      "brand": "Hikari",
      "logo": "/sponsors/hikari.svg",
      "tier": "species",
      "surfaces": ["husbandry_feed", "species_detail_diet"],
      "active": true
    }
  ]
}
```

### Mapping products to surfaces

Edit `config/productMap.json`:

```json
{
  "husbandry_feed": {
    "characidae": {
      "sponsorId": "hikari",
      "product": "Micro Pellets",
      "productLink": "https://hikari.com/micro-pellets",
      "tagline": "Recommended for small tetras"
    },
    "*": {
      "sponsorId": "hikari",
      "product": "Tropical Granules",
      "productLink": "https://hikari.com/tropical",
      "tagline": "Premium daily nutrition"
    }
  }
}
```

### Creating a campaign

Edit `config/campaigns.json`:

```json
{
  "campaigns": [
    {
      "id": "hikari-feeding-challenge-q3",
      "sponsorId": "hikari",
      "title": "Hikari 7-Day Feeding Challenge",
      "description": "Log 7 consecutive days of feeding to earn exclusive rewards",
      "surface": "husbandry_feed",
      "xpMultiplier": 2,
      "bonusXp": 100,
      "requirements": {
        "actionType": "feed",
        "count": 7,
        "windowDays": 10
      },
      "reward": {
        "type": "badge",
        "value": "Hikari Nutrition Expert"
      },
      "startDate": "2026-07-01T00:00:00Z",
      "endDate": "2026-09-30T23:59:59Z",
      "active": true
    }
  ]
}
```

## Analytics

```js
import { generateReport, exportForUpload } from "./sponsorship";

// Get engagement summary
const report = generateReport({ sponsorId: "hikari" });
console.log(report.views, report.clicks, report.ctr);

// Export for Supabase/BigQuery upload
const payload = exportForUpload();
await supabase.from("sponsor_events").insert(payload.events);
```

## Design Principles

1. **Data layer, not a feature** — Every component checks for sponsors and gracefully handles null.
2. **Non-blocking** — Sponsorship UI never interrupts the user's workflow. It appears after actions complete.
3. **Transparent** — All sponsored content is clearly labeled. On-chain attribution events planned for contract integration.
4. **Conservation-first** — Sponsors are positioned as funding the protocol's marine conservation mission, not as advertisers.
5. **Zero cost today** — With empty config files, nothing renders. No performance impact, no visual noise.

## File Structure

```
src/sponsorship/
├── index.js                     ← Unified exports
├── README.md                    ← This file
├── SponsorProvider.jsx          ← React context (loads config, provides hooks)
├── SponsorBadge.jsx             ← Small "Recommended by X" chip
├── SponsorCard.jsx              ← Larger featured placement card
├── SponsorOverlay.jsx           ← WebXR/Reef biome overlay
├── SponsorCampaignBanner.jsx    ← XP challenge progress UI
├── useSponsorSlot.js            ← Primary hook: surface → sponsor | null
├── useSponsorImpression.js      ← Impression & click tracking hooks
├── useSponsorCampaign.js        ← Campaign progress & reward hook
├── config/
│   ├── sponsors.json            ← Master sponsor registry
│   ├── productMap.json          ← Species/action → product mapping
│   └── campaigns.json           ← Time-bound XP challenges
└── analytics/
    └── impressionLogger.js      ← Local persistence & reporting
```
