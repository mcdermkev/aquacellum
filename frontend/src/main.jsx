import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrivyProvider } from '@privy-io/react-auth'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { CartProvider } from './contexts/CartContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PwaManager } from './components/PwaManager'
import { initAnalytics } from './services/analytics'
import { installChunkErrorRecovery } from './utils/chunkErrorRecovery'
import App from './App.jsx'

// Auto-recover from stale-shell chunk 404s (old cached app.html referencing
// JS/CSS filenames from a previous deploy). Installed as early as possible
// so it also catches failures during the very first module load. See
// chunkErrorRecovery.js for the full explanation.
installChunkErrorRecovery()

// Initialize product analytics once at boot. No-ops if VITE_POSTHOG_KEY isn't set.
initAnalytics()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID;

// The provider tree below <PrivyProvider>. Extracted so we can mount it with or
// without Privy: PrivyProvider requires a valid appId, so when none is
// configured (E2E harness / CI, or a misconfigured env) we render the tree
// without it and AuthProvider falls back to its no-Privy path (see
// AuthContext.jsx) instead of white-screening the whole app.
const appTree = (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <CartProvider>
        <ErrorBoundary>
          <BrowserRouter>
            <App />
            <PwaManager />
          </BrowserRouter>
        </ErrorBoundary>
      </CartProvider>
    </AuthProvider>
  </QueryClientProvider>
);

// Remove the HTML boot splash (see app.html) once the app signals it's ready.
// App.jsx dispatches 'app:booted' when auth is ready; the timeout is a safety
// fallback so the splash can never get stuck if that event never fires.
function hideBootSplash() {
  const el = document.getElementById('boot-splash')
  if (!el) return
  el.classList.add('boot-hidden')
  setTimeout(() => el.remove(), 700)
}
window.addEventListener('app:booted', hideBootSplash, { once: true })
setTimeout(hideBootSplash, 8000)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {privyAppId ? (
      <PrivyProvider
        appId={privyAppId}
        config={{
          appearance: {
            theme: 'dark',
            accentColor: '#38bdf8',
          },
          embeddedWallets: {
            createOnLogin: 'users-without-wallets',
          },
          loginMethods: ['email', 'google'],
          defaultChain: {
            id: 84532,
            name: 'Base Sepolia',
            network: 'base-sepolia',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: {
              // Base's own endpoint. Was publicnode.com, which now rate-limits
              // (HTTP 429) and floods the console; Privy has no fallback here, so
              // the primary must be the reliable one.
              default: { http: ['https://sepolia.base.org'] },
            },
            blockExplorers: {
              default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
            },
          },
        }}
      >
        {appTree}
      </PrivyProvider>
    ) : appTree}
  </React.StrictMode>,
)
