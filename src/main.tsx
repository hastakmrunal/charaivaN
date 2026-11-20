import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  const triggerGmpQuota = () => {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  };

  (window as any).gm_authFailure = () => {
    triggerGmpQuota();
  };

  const origConsoleError = console.error.bind(console);
  console.error = (...args: any[]) => {
    try {
      const joined = args
        .map((a) => (typeof a === 'string' ? a : a?.message || ''))
        .join(' ');
      if (
        joined.includes('OverQuotaMapError') ||
        joined.includes('QuotaExceededError') ||
        joined.includes('RESOURCE_EXHAUSTED')
      ) {
        triggerGmpQuota();
      }
    } catch {
      // ignore inspection error
    }
    origConsoleError(...args);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
