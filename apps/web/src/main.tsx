import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/ui';
import { App } from './App';
import './styles.css';
import './styles/marketing.css';

/**
 * Query defaults are tuned for a compliance tool: scan data changes only when
 * something actually happens, so we retry less aggressively than a social feed
 * but keep a short stale window so polling scans stay live.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500) return false; // never retry auth/validation errors
        return failureCount < 2;
      },
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      gcTime: 5 * 60_000,
    },
    mutations: { retry: 0 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
