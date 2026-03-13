/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          light: '#e8f0fe',
          DEFAULT: '#1a73e8',
          dark: '#185abc',
        },
        secondary: {
          light: '#e6f4ea',
          DEFAULT: '#34a853',
          dark: '#2c9c47',
        },
        danger: {
          light: '#fce8e6',
          DEFAULT: '#ea4335',
          dark: '#d13528',
        },
        warning: {
          light: '#fef7e0',
          DEFAULT: '#fbbc05',
          dark: '#e3a800',
        },
      }
    },
  },
  plugins: [],
}
