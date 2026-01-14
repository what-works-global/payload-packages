const path = require('path')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(__dirname, '..', 'src', '**/*.{ts,tsx,js,jsx}'),
    path.join(__dirname, 'app', '**/*.{ts,tsx,js,jsx}'),
  ],
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
