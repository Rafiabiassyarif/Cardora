import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import { installFx } from './lib/fx';
import './styles.css';
import './app-theme.css';
import './table-theme.css';
import './landing.css';
import './home.css';
import './catalog.css';
import './fx.css';

installFx();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// PWA offline: hanya di build production web. Aplikasi native (Capacitor) sudah membawa file lokal.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* tidak kritis */ });
  });
}
