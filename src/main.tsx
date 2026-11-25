import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

// Save the app on this device so the File Organizer opens without internet.
// Skipped inside the phone app (its files are already on the phone) and during development.
const inPhoneApp = typeof (window as unknown as { Capacitor?: unknown }).Capacitor !== 'undefined';
if (import.meta.env.PROD && !inPhoneApp && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not supported here (e.g. some preview frames): the app still works online
    });
  });
}
