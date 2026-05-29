/** @type {import('tailwindcss').Config} */
//
// Brand tokens synced from the Figma file "Secrets Bridge — Brand"
// (version 2358961245452574711, 2026-05-29). Mapping notes in
// `secrets-bridge/skills/ui/design/tokens/mapping.md`.
//
// Re-run the sync via `secrets-bridge/skills/ui/design/tokens/sync.sh`
// after every design rev; then update the values here to match.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic surfaces.
        bg: '#0b1220',       // Navy 900 — app canvas (deepest)
        surface: '#0f172a',  // Dark Navy — cards / drawers / modals (raised)
        text: '#cbd5e1',     // Slate 300 — primary readable text
        muted: '#64748b',    // Slate 500 — secondary text
        accent: '#06b6d4',   // Cyan — primary CTA, selected chips
        border: '#1e293b',   // derived (Tailwind slate-800) — not yet in Figma

        // Extended brand accents (use sparingly, intent-driven).
        'accent-bright': '#22d3ee', // Cyan Bright — hover, brand emphasis
        teal: '#14b8a6',
        blue: '#2563eb',
        purple: '#8b5cf6',
        success: '#22c55e',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Brand type ramp from Figma's 6 text styles. Numeric tracking
        // preserved verbatim from the source; line-heights rounded to
        // sensible Tailwind values.
        display: ['64px', { lineHeight: '78px', letterSpacing: '-1.5px', fontWeight: '800' }],
        h1:      ['40px', { lineHeight: '48px', letterSpacing: '-0.5px', fontWeight: '700' }],
        h2:      ['26px', { lineHeight: '32px', letterSpacing: '-0.3px', fontWeight: '700' }],
        eyebrow: ['14px', { lineHeight: '17px', letterSpacing: '3px',    fontWeight: '700' }],
        body:    ['18px', { lineHeight: '22px',                            fontWeight: '400' }],
        caption: ['13px', { lineHeight: '16px', letterSpacing: '0.3px',  fontWeight: '500' }],
      },
      backgroundImage: {
        // Gradient (Cyan→Blue) from the Foundations page.
        'brand-gradient': 'linear-gradient(90deg, #22d3ee 0%, #2563eb 100%)',
      },
    },
  },
  plugins: [],
};
