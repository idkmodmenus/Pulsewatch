/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0B0F13',
        surface: '#121820',
        raised: '#17202A',
        line: '#1F2A35',
        ink: '#DCE6EC',
        muted: '#7C8C99',
        signal: '#58C2C6',
        up: '#57B894',
        degraded: '#D9A441',
        down: '#E05C58'
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      boxShadow: { panel: '0 1px 0 0 rgba(255,255,255,0.03) inset' }
    }
  },
  plugins: []
};
