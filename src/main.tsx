import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { PortfolioProvider } from './context/PortfolioContext.tsx';
import { TradingIntelligenceProvider } from './context/TradingIntelligenceContext.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { CapitalAllocationProvider } from './context/CapitalAllocationContext.tsx';
import { registerSW } from 'virtual:pwa-register';
import './index.css';

// Initialize PWA service worker for Android offline caching and background synchronization
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onNeedRefresh() {
      console.log('[DeltaAI PWA] New update available.');
    },
    onOfflineReady() {
      console.log('[DeltaAI PWA] DeltaAI ready for offline trading operations.');
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AuthProvider>
      <PortfolioProvider>
        <TradingIntelligenceProvider>
          <CapitalAllocationProvider>
            <App />
          </CapitalAllocationProvider>
        </TradingIntelligenceProvider>
      </PortfolioProvider>
    </AuthProvider>
  </ErrorBoundary>
);

