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
        'cyan-works': '#95f1f3',
        'deep-works-300': '#bcc0c2',
        'deep-works-700': '#3d4043',
        'deep-works-900': '#020f18',
      },
      maxWidth: {
        '9xl': '96rem',
      },
    },
  },
}
