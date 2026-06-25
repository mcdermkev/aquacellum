// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

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
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [storefrontRewritePlugin(), react()],
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
        compare: resolve(__dirname, 'compare.html')       // Species comparison tool
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
