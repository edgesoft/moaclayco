import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        rosa: '#f0d5c8',
      },
      fontFamily: {
        note: ['Noteworthy'],
      },
    },
  },
  plugins: [],
} satisfies Config

