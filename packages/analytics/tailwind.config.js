/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/CookieBanner.tsx'],
  important: '.ww',
  theme: {
    extend: {
      colors: {
        'deep-works-300': 'var(--ww-analytics-accent, #0ea5e9)',
      },
      maxWidth: {
        '9xl': 'var(--ww-analytics-max-width, 96rem)',
      },
    },
  },
}
