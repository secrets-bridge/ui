import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
// Self-hosted fonts (UI-N-06). Same families + weights the old Google
// Fonts link loaded (Inter 400-800, JetBrains Mono 400/500/700), all
// unicode-range subsets, bundled into /assets/ by vite so the CSP can
// stay at font-src 'self'. Browsers fetch only the faces + subsets a
// page actually renders. Fonts are SIL OFL-1.1 (license ships in each
// @fontsource package).
//
// Imported here rather than from index.css: @tailwindcss/postcss
// inlines CSS @imports without rebasing their relative url()s, which
// left the font files out of the build. Vite handles these imports
// itself and emits every face under /assets/.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing — index.html shape changed?');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
