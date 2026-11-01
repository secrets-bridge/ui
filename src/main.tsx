import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
// Self-hosted fonts (UI-N-06): Geist for everything people read, Geist
// Mono for what a machine reads (refs, key names, paths, times) and
// Bricolage Grotesque for titles and counts. Only the weights the design
// uses are imported. All unicode-range subsets are bundled
// into /assets/ by vite so the CSP can stay at font-src 'self';
// browsers fetch only the subsets a page renders. Fonts are SIL OFL-1.1
// (license ships in each package).
//
// Imported here rather than from index.css: @tailwindcss/postcss
// inlines CSS @imports without rebasing their relative url()s, which
// left the font files out of the build. Vite handles these imports
// itself and emits every face under /assets/.
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist/700.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import '@fontsource/bricolage-grotesque/700.css';
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
