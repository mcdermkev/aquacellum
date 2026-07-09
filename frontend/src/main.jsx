import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrivyProvider } from '@privy-io/react-auth'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PwaManager } from './components/PwaManager'
import { initAnalytics } from './services/analytics'
import App from './App.jsx'

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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
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
              default: { http: ['https://base-sepolia-rpc.publicnode.com'] },
            },
            blockExplorers: {
              default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
            },
          },
        }}
      >
        <AuthProvider>
          <ErrorBoundary>
            <BrowserRouter>
              <App />
              <PwaManager />
            </BrowserRouter>
          </ErrorBoundary>
        </AuthProvider>
      </PrivyProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
