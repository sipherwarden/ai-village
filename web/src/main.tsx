import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';
import './hud.css';
import './glass.css';
import { App } from './App.tsx';

// ?lab=characters and ?lab=world open the design labs (simulated cast, no data, no API calls).
const Lab = lazy(() => import('./engine/Lab.tsx').then((m) => ({ default: m.Lab })));
const WorldLab = lazy(() => import('./engine/WorldLab.tsx').then((m) => ({ default: m.WorldLab })));
const lab = new URLSearchParams(location.search).get('lab');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {lab ? (
      <Suspense fallback={null}>
        {lab === 'world' ? <WorldLab /> : <Lab />}
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
