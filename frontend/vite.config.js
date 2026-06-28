// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Custom plugin to handle SPA-style rewrites during development
// (mirrors vercel.json rewrites for local dev)
function storefrontRewritePlugin() {
  return {
    name: 'storefront-rewrite',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Rewrite /store/* to /store.html (let Vite serve the HTML entry)
        if (req.url && req.url.startsWith('/store/')) {
          req.url = '/store.html';
        }
        // Rewrite /species/* to /species.html (species detail pages)
        if (req.url && req.url.startsWith('/species/')) {
          req.url = '/species.html';
        }
        // Rewrite /app and /app/* to /app.html (React Router SPA shell)
        if (req.url && (req.url === '/app' || req.url.startsWith('/app/') || req.url.startsWith('/app?'))) {
          req.url = '/app.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    storefrontRewritePlugin(),
    react(),
    VitePWA({
      // Custom SW (src/sw.js) so we can keep the existing Web Push handlers
      // alongside Workbox precaching/runtime caching.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // We register + surface the update prompt ourselves via the
      // virtual:pwa-register/react hook (see src/components/PwaManager.jsx).
      injectRegister: false,
      registerType: 'prompt',
      // Only inject the manifest <link> into the app shell, not every page.
      includeManifestIcons: false,
      manifest: {
        name: 'Aquadex — Hobbyist & Breeder Protocol',
        short_name: 'Aquadex',
        description: 'Digital aquarium management, breeding registry, and marketplace.',
        id: '/app',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a0e1a',
        theme_color: '#0a0e1a',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/aquacellum-favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      injectManifest: {
        // Precache ONLY the lightweight app shell: HTML entries, CSS, fonts,
        // icons, and the web manifest. JS chunks are runtime-cached on first
        // use (see the script/style route in src/sw.js), so the install-time
        // download stays small instead of pulling the whole ~9MB bundle set.
        globPatterns: ['**/*.{css,html,woff,woff2}', 'icons/*.png', 'aquacellum-*.svg'],
        globIgnores: ['**/node_modules/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      // Service worker is production-only; disabling in dev avoids HMR conflicts.
      devOptions: {
        enabled: false,
      },
    }),
  ],
  root: '.',
  resolve: {
    alias: {
      // Redirect all "ethers" imports to our shim that uses window.ethers (UMD global)
      'ethers': resolve(__dirname, 'src/utils/ethersCompat.js'),
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        // Split stable, eagerly-loaded vendor libraries out of the main app
        // entry chunk. These rarely change, so isolating them lets the browser
        // cache them across deploys (app code invalidates far more often) and
        // download them in parallel with the app chunk. Privy, supabase, and
        // the lazy tab chunks are already code-split elsewhere; ethers is a
        // UMD-global shim (see resolve.alias) so it isn't bundled at all.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // React core + the routing/data libs that depend on it. Grouped
            // together because they're interdependent and all load eagerly,
            // which avoids cross-chunk init-order surprises.
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/') ||
              id.includes('/react-router/') ||
              id.includes('/react-router-dom/') ||
              id.includes('/@tanstack/')
            ) {
              return 'react-vendor';
            }
            // Phosphor icon set — sizable and stable.
            if (id.includes('/@phosphor-icons/')) {
              return 'icons-vendor';
            }
          }
        },
      },
      input: {
        index: resolve(__dirname, 'index.html'),       // Main landing page (/)
        hobbyist: resolve(__dirname, 'hobbyist.html'), // Hobbyist landing
        breeder: resolve(__dirname, 'breeder.html'),   // Breeder landing
        database: resolve(__dirname, 'database.html'), // Species database page
        marketplace: resolve(__dirname, 'marketplace.html'), // Public marketplace browse
        reef: resolve(__dirname, 'reef.html'),         // The Reef social landing
        reefXr: resolve(__dirname, 'reef-xr.html'),   // Immersive 3D reef (WebXR)
        about: resolve(__dirname, 'about.html'),       // About page
        legal: resolve(__dirname, 'legal.html'),       // Legal & policies page
        app: resolve(__dirname, 'app.html'),           // React dashboard app
        store: resolve(__dirname, 'store.html'),        // Breeder Storefront (public)
        species: resolve(__dirname, 'species.html'),      // Species detail page
        compare: resolve(__dirname, 'compare.html'),      // Species comparison tool
        howItWorks: resolve(__dirname, 'how-it-works.html'), // How it works / pricing
        breeders: resolve(__dirname, 'breeders.html'),     // Local breeder map
        breeds: resolve(__dirname, 'breeds.html'),          // Breed gallery / lineage registry
        poseidon: resolve(__dirname, 'poseidon.html'),       // Poseidon AI assistant
        leaderboard: resolve(__dirname, 'leaderboard.html')  // Zone leaderboard
      }
    }
  },
  server: {
    port: 4200,
    proxy: {
      // Forward /api requests to the Vercel dev server (run `vercel dev --listen 3000`)
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  }
});
