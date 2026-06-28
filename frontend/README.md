# Aquacellum — Static Frontend

Premium multi-page marketing site for the Aquacellum aquarium registry, breeding platform, and marketplace.

## Quick Start

This is a static site — no build step required. Serve the `frontend/` directory with any static file server.

### Option 1: Python (built-in)

```bash
cd frontend
python -m http.server 8080
```

### Option 2: Node.js (npx)

```bash
npx serve frontend
```

### Option 3: VS Code Live Server

Install the "Live Server" extension, right-click `index.html`, and select **Open with Live Server**.

Then open [http://localhost:8080](http://localhost:8080) (or whatever port your server uses).

## Site Structure

```
frontend/
├── css/
│   └── shared.css          # Unified design system (tokens, layout, components)
├── js/
│   ├── nav.js              # Shared navigation (injected into #site-nav)
│   ├── footer.js           # Shared footer (injected into #site-footer)
│   └── reveal.js           # Scroll-reveal animations (IntersectionObserver)
├── index.html              # Landing page with waitlist
├── database.html           # Species database (326+ species)
├── species.html            # Individual species profile (dynamic via JS)
├── breeds.html             # Breed gallery / lineage registry
├── breeders.html           # Interactive breeder map (Leaflet)
├── marketplace.html        # Live livestock marketplace
├── store.html              # Individual breeder storefront
├── how-it-works.html       # Escrow guide, pricing, FAQ
├── reef.html               # The Reef — social layer
├── hobbyist.html           # For Hobbyists landing page
├── poseidon.html           # Poseidon AI chat assistant
└── about.html              # Team, mission, roadmap
```

## Design System

All pages share `css/shared.css` which provides:

- **Tokens** — colors (violet, emerald, teal, cyan, amber), typography, spacing, radii
- **Base** — reset, body, scrollbar, selection
- **Layout** — container, sections, grid utilities
- **Ambient** — floating orb background with blur
- **Glassmorphism** — glass cards with backdrop-filter
- **Navigation** — sticky nav with mobile toggle
- **Components** — buttons, badges, chips, cards, inputs, breadcrumbs, toasts
- **Footer** — 4-column responsive footer
- **Animations** — fade-in-up, reveal on scroll, pulse dot
- **Responsive** — mobile-first breakpoints at 480px, 768px, 1024px

Pages override tokens via `:root` when using alternate palettes (e.g., reef.html uses coral/ocean, hobbyist.html uses sky-blue).

## Adding a New Page

1. Create your `.html` file in `frontend/`
2. Include in `<head>`:
   ```html
   <link rel="stylesheet" href="/css/shared.css">
   ```
3. Add navigation and footer targets in `<body>`:
   ```html
   <header id="site-nav"></header>
   <!-- your content -->
   <footer id="site-footer"></footer>
   ```
4. Include shared scripts before `</body>`:
   ```html
   <script src="/js/nav.js"></script>
   <script src="/js/footer.js"></script>
   <script src="/js/reveal.js"></script>
   ```

## Fonts

The site uses Google Fonts loaded via CDN:
- **Inter** — body text
- **Outfit** — headings and display
- **JetBrains Mono** — code and data values

## Browser Support

Modern browsers (Chrome, Firefox, Safari, Edge). Requires CSS `backdrop-filter` support for glassmorphism effects.
