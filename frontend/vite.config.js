// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
        reef: resolve(__dirname, 'reef.html'),         // The Reef social landing
        about: resolve(__dirname, 'about.html'),       // About page
        legal: resolve(__dirname, 'legal.html'),       // Legal & policies page
        app: resolve(__dirname, 'app.html')            // React dashboard app
      }
    }
  },
  server: {
    port: 4200
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  }
});
