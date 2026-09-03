/** @type {import('tailwindcss').Config} */
//
// Tailwind tokens are aliased to Helga RGB channel variables defined in
// `src/app.css`. Using the `rgb(var(--…-rgb) / <alpha-value>)` form keeps
// opacity utilities (e.g. `bg-brand/10`) working while letting
// `data-theme="light"` flip the whole palette.
//
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Space Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      colors: {
        brand: {
          DEFAULT: rgb('--accent-electric-rgb'),
          50:  rgb('--accent-electric-rgb'),
          100: rgb('--accent-electric-rgb'),
          200: rgb('--accent-electric-rgb'),
          300: rgb('--accent-electric-rgb'),
          400: rgb('--accent-electric-rgb'),
          500: rgb('--accent-electric-rgb'),
          600: rgb('--accent-electric-hover-rgb'),
          700: rgb('--accent-electric-hover-rgb'),
          800: rgb('--accent-electric-hover-rgb'),
          900: rgb('--accent-electric-hover-rgb')
        },
        ink: {
          900: rgb('--text-primary-rgb'),
          700: rgb('--text-primary-rgb'),
          500: rgb('--text-secondary-rgb'),
          400: rgb('--text-tertiary-rgb'),
          300: rgb('--text-tertiary-rgb'),
          200: rgb('--border-strong-rgb')
        },
        surface: {
          page:    rgb('--bg-primary-rgb'),
          card:    rgb('--bg-secondary-rgb'),
          hover:   rgb('--bg-tertiary-rgb'),
          border:  rgb('--border-subtle-rgb'),
          divider: rgb('--border-subtle-rgb')
        },
        tag: {
          sales:         rgb('--bg-tertiary-rgb'),
          salesText:     rgb('--state-danger-rgb'),
          nutrition:     rgb('--bg-tertiary-rgb'),
          nutritionText: rgb('--state-success-rgb'),
          garden:        rgb('--bg-tertiary-rgb'),
          gardenText:    rgb('--accent-electric-rgb'),
          chat:          rgb('--bg-tertiary-rgb'),
          chatText:      rgb('--state-warning-rgb'),
          health:        rgb('--bg-tertiary-rgb'),
          healthText:    rgb('--state-danger-rgb'),
          online:        rgb('--accent-electric-rgb'),
          onlineText:    rgb('--accent-electric-rgb')
        }
      },
      borderRadius: {
        card: 'var(--radius-lg)'
      },
      boxShadow: {
        // No drop shadows in Helga — borders carry the structure.
        card: '0 0 0 0 transparent',
        pop:  '0 0 0 1px var(--border-subtle)'
      },
      letterSpacing: {
        tightish: '-0.01em',
        tighter2: '-0.02em'
      }
    }
  },
  plugins: [require('@tailwindcss/forms')]
};
