/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      borderWidth: {
        '3': '3px',
      },
      colors: {
        'marble-blue': '#586D78',
      }
    },
  },
  plugins: [],
};