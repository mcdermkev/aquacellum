# Aquadex Brand Kit

> Living identity system for Aquadex (public brand: **Aquacellum**)
> Last updated: June 2026

---

## Brand Architecture

| Layer | Name | Role |
|-------|------|------|
| Platform | **Aquadex** | Internal/protocol name, app header |
| Public Brand | **Aquacellum** | Marketing, landing page, social |
| AI Companion | **Poseidon** | Knowledge engine, chat assistant |
| AI Entity | **Echo** | Companion fish, gamification mascot |

---

## Logomark

The Aquacellum logomark represents a **living aquatic cell** — a globe with organic meridian lines suggesting both a biological cell and a planetary body of water. It conveys: life, knowledge, interconnection.

### Usage

| Context | Format | Min Size |
|---------|--------|----------|
| Navigation | SVG inline, 38x38px mark | 32px |
| Favicon | SVG, purple bolt (current) or teal cell | 16px |
| Social avatar | PNG export, 400x400px | 200px |
| Print / merch | SVG vector, padding = 25% mark width | 24mm |

### Clear Space
Minimum clear space around the logomark = 50% of mark width on all sides.

### Don'ts
- Don't rotate the mark
- Don't apply drop shadows outside the glow system
- Don't place on busy backgrounds without the glass backing
- Don't stretch or distort proportions

---

## Color Palette

### Primary Colors

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--teal-400` | `#2dd4bf` | 45, 212, 191 | Primary actions, highlights, CTAs |
| `--teal-500` | `#14b8a6` | 20, 184, 166 | Buttons, active states |
| `--teal-300` | `#5eead4` | 94, 234, 212 | Text accents, glows |
| `--cyan-400` | `#22d3ee` | 34, 211, 238 | Secondary accent, gradients |

### Accent Colors

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--violet-500` | `#8b5cf6` | 139, 92, 246 | Premium features, Poseidon brand |
| `--violet-400` | `#a78bfa` | 167, 139, 250 | Subtle violet accents |
| `--amber-400` | `#fbbf24` | 251, 191, 36 | Warnings, achievements, gold tier |
| `--emerald-400` | `#34d399` | 52, 211, 153 | Success, compatibility, health |

### Backgrounds

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-void` | `#060814` | Page background, deepest layer |
| `--bg-deep` | `#080c1a` | App background |
| `--bg-surface` | `#0d1229` | Cards, elevated surfaces |

### Text

| Token | Hex | Usage |
|-------|-----|-------|
| `--text-primary` | `#f0f4ff` | Headlines, body text |
| `--text-secondary` | `#94a3b8` | Descriptions, supporting text |
| `--text-muted` | `#475569` | Captions, metadata, timestamps |

### Glass System

| Token | Value | Usage |
|-------|-------|-------|
| `--glass-bg` | `rgba(13, 18, 41, 0.6)` | Card backgrounds |
| `--glass-border` | `rgba(255,255,255,0.07)` | Card borders |
| `--glass-hover` | `rgba(255,255,255,0.04)` | Hover state overlay |
| Backdrop blur | `blur(24px)` | Nav, modals, elevated glass |

### Gradients

```css
/* Primary gradient — CTAs, hero elements */
background: linear-gradient(135deg, var(--teal-400), var(--violet-500));

/* Text gradient — headlines */
background: linear-gradient(135deg, var(--teal-300) 0%, var(--cyan-300) 50%, var(--teal-400) 100%);

/* Warm gradient — achievements, special */
background: linear-gradient(135deg, var(--amber-300) 0%, var(--teal-300) 100%);

/* Violet gradient — premium features */
background: linear-gradient(135deg, var(--violet-400) 0%, var(--cyan-400) 100%);
```

---

## Typography

### Font Stack

| Role | Family | Weights | Usage |
|------|--------|---------|-------|
| Display | **Outfit** | 400–900 | Headlines, nav logo, section titles |
| Body (Landing) | **Inter** | 300–800 | Landing page body, descriptions |
| Body (App) | **Plus Jakarta Sans** | 300–700 | In-app body text, UI labels |
| Code | **JetBrains Mono** | 400, 500 | Spec codes, technical data, metadata |

### Type Scale

| Element | Size | Weight | Family | Letter Spacing |
|---------|------|--------|--------|---------------|
| Hero headline | 3.2rem | 900 | Outfit | -0.03em |
| Section title | 2.2rem | 900 | Outfit | -0.02em |
| Card title | 1.1rem | 700 | Outfit | — |
| Body | 0.92rem | 400 | Inter / Plus Jakarta Sans | — |
| Caption | 0.78rem | 400 | Inter | — |
| Nav link | 0.85rem | 500 | Inter | — |
| Logo text | 1.1rem | 800 | Outfit | 0.12em |
| Tagline | 9px | 600 | Outfit | 0.18em |
| Code/metadata | 0.68rem | 400 | JetBrains Mono | — |

---

## Iconography

### Icon System: Phosphor Icons

**Package:** `@phosphor-icons/react`
**License:** ISC (fully permissive)

### Weight Strategy (Two-Tier System)

| Context | Weight | Rationale |
|---------|--------|-----------|
| Site chrome (nav, cards, CTAs) | **Duotone** | Premium, polished, high visual fidelity |
| Feature highlights | **Bold** | Attention-grabbing, marketing emphasis |
| App utility (buttons, inputs) | **Regular** | Clean, functional, unobtrusive |
| Subtle/decorative | **Light** | Elegant, minimal footprint |
| Gamification layer | Keep existing emoji/custom SVGs | Maintains playful collector vibe |
| Active/selected states | **Fill** | Clear toggle indication |

### Icon Sizing

| Context | Size | Stroke |
|---------|------|--------|
| Navigation | 20px | — |
| Feature cards | 24px | — |
| Inline buttons | 16–18px | — |
| Hero/empty states | 48px | — |
| Small badges | 12px | — |

### Icon Color Rules
- Icons inherit `currentColor` by default
- Duotone secondary color: use brand teal or violet at 20% opacity
- Never colorize icons with more than 2 colors
- Social icons retain their own brand SVGs (custom sprite)

### Migration Map (Current → Phosphor)

| Current Usage | Phosphor Replacement |
|--------------|---------------------|
| Globe (nav logo) | `GlobeHemisphereWest` duotone |
| Checkmark circle | `CheckCircle` duotone |
| Arrow right | `ArrowRight` bold |
| Chevron down | `CaretDown` regular |
| Clock circle | `Clock` duotone |
| Plus sign | `Plus` bold |
| Fish bowl | `FishSimple` duotone |
| Flask/beaker | `Flask` duotone |
| Water drop | `Drop` duotone |
| Alert triangle | `Warning` duotone |
| Search | `MagnifyingGlass` regular |

---

## Imagery & Brand Assets

### Poseidon (AI Companion)
- Avatar: Illustrated portrait, deep ocean tones with violet highlights
- Used in: chat interface, loading states, help prompts
- Always paired with a soft violet glow ring

### Echo (Companion Fish)
- Evolution stages: Fry → Mid → Silver → Evolved (God-Tier)
- Used in: gamification, achievements, onboarding
- Animated SVG with brand teal/violet palette
- Playful, organic shapes — intentionally "gamey" (this is correct for gamification)

### Photography Style
- Dark, moody aquarium photography
- High contrast with selective color pops (teal, cyan)
- Shallow depth of field preferred
- Avoid stock photography feel — real tanks, real fish

---

## Motion & Effects

### Ambient System
- Floating orbs with `blur(120px)`, brand colors at 8–12% opacity
- Drift animation: `18s ease-in-out infinite`
- Creates depth without distraction

### Transitions
- Default: `all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- Hover states: scale 1.02–1.05, increased glow
- Page transitions: fade-up with 0.4s ease

### Glow System
- Text glow: `0 0 30px rgba(color, 0.35), 0 0 60px rgba(color, 0.15)`
- Element glow: `0 0 20px rgba(color, 0.3)` idle, `0 0 30px rgba(color, 0.5)` hover
- Use sparingly — max 2–3 glowing elements per viewport

---

## Social Media & Marketing

### Voice & Tone
- Knowledgeable but approachable
- "Fellow enthusiast" energy, never corporate
- Technical when relevant, never jargon-heavy
- Celebrate the community, showcase real setups

### Avatar & Banner
- Social avatar: Logomark on `--bg-void` background with subtle teal glow
- Banner: Ambient orb background with tagline "The Living Aquatic Registry"

### Hashtags
- Primary: `#Aquacellum` `#LivingRegistry`
- Secondary: `#AquaDex` `#FishKeeping` `#ReefLife` `#Aquarist`
- Feature-specific: `#PoseidonAI` `#EchoCompanion` `#SpecDex`

---

## File Naming Conventions

| Asset Type | Pattern | Example |
|-----------|---------|---------|
| Logo files | `aquacellum-{variant}-{size}.{ext}` | `aquacellum-mark-400.png` |
| Icons | Phosphor component names (PascalCase) | `<FishSimple weight="duotone" />` |
| Brand images | `{subject}-{variant}.{ext}` | `poseidon-avatar.jpg` |
| Social assets | `social-{platform}-{type}.{ext}` | `social-x-banner.png` |

---

## Quick Reference: Do's and Don'ts

### Do
- Use the glass system for elevated content
- Let the dark background breathe (generous spacing)
- Use gradients sparingly for emphasis
- Match icon weight to context (premium vs utility)
- Keep the ambient orbs subtle

### Don't
- Use flat white backgrounds anywhere
- Mix more than 2 accent colors in one component
- Use emoji in premium/marketing contexts (reserve for gamification)
- Apply glow effects to body text
- Use thin font weights below 14px
