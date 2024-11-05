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
      keyframes: {
        stripe: {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '100% 0' },
        },
      },
      animation: {
        stripe: 'stripe 6s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config

