/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,js,jsx}'],
  corePlugins: {
    container: false,
  },
  important: '.ww',
  theme: {
    extend: {
      colors: {
        'deep-works-300': '#bcc0c2',
      },
      maxWidth: {
        '9xl': '96rem',
      },
    },
  },
}
