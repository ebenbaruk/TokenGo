import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/800.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/global.css';
import { App } from './App.tsx';

const DevGallery = lazy(() => import('./screens/DevGallery.tsx'));

const isDev = location.pathname.startsWith('/dev/ui');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDev ? <Suspense fallback={null}><DevGallery /></Suspense> : <App />}
  </StrictMode>,
);
