import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
// Self-hosted fonts (UI-N-06): IBM Plex Sans for everything people
// read, IBM Plex Mono for what a machine reads (refs, key names, paths,
// times). Sans at 400, 500 and 600 and Mono at 400 and 500, the only
// weights the brand book uses. All unicode-range subsets are bundled
// into /assets/ by vite so the CSP can stay at font-src 'self';
// browsers fetch only the subsets a page renders. Fonts are SIL OFL-1.1
// (license ships in each package).
//
// Imported here rather than from index.css: @tailwindcss/postcss
// inlines CSS @imports without rebasing their relative url()s, which
// left the font files out of the build. Vite handles these imports
// itself and emits every face under /assets/.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
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
