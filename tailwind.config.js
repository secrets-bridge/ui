/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand neutral — adjust once design lands. Subdued slate-on-slate
        // dashboard. Status colors deliberately limited to red/yellow/green
        // so they read at a glance.
        bg: '#0b1220',
        surface: '#111a2e',
        border: '#1f2a44',
        muted: '#94a3b8',
        text: '#e2e8f0',
        accent: '#38bdf8',
      },
    },
  },
  plugins: [],
};
