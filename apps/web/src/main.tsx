import { StrictMode, lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/800.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/global.css';
import { App } from './App.tsx';

// Routes publiques (pas de compte) chargées à la demande.
const ROUTES: Record<string, LazyExoticComponent<ComponentType>> = {
  '/lab': lazy(() => import('./screens/LabPage.tsx')),
  '/pulse': lazy(() => import('./screens/PulsePage.tsx')),
  '/about': lazy(() => import('./screens/AboutPage.tsx')),
  '/dev/ui': lazy(() => import('./screens/DevGallery.tsx')),
};

const path = location.pathname.replace(/\/+$/, '') || '/';
const Page = ROUTES[path];
// le jeu (pas les pages) : cadre de téléphone + panneau d'explication sur grand écran (global.css)
if (!Page) document.body.classList.add('game');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {Page ? <Suspense fallback={<div className="route-loading pixel">Loading…</div>}><Page /></Suspense> : <App />}
  </StrictMode>,
);
