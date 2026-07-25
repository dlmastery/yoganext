import plugin from 'tailwindcss/plugin';

/**
 * Tailwind is the delivery mechanism for the tokens in `src/styles/globals.css`.
 * Every colour resolves through a CSS variable holding a bare `R G B` triplet, so
 * the alpha utilities keep working (`bg-accent/20`, `border-line/60`) *and* a
 * theme switch is a single `[data-theme]` write with no class churn.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // `dark:` asks a palette question, not an OS one — sand is the only light
  // palette, so everything else is the dark branch.
  darkMode: ['variant', ':where(html:not([data-theme="sand"])) &'],
  theme: {
    extend: {
      colors: {
        // `bg-bg`, `bg-bg-elev`
        bg: {
          DEFAULT: 'rgb(var(--bg) / <alpha-value>)',
          elev: 'rgb(var(--bg-elev) / <alpha-value>)',
        },
        // `text-fg`, `text-fg-muted`
        fg: {
          DEFAULT: 'rgb(var(--fg) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
        },
        // `bg-accent`, `text-accent-2`
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          2: 'rgb(var(--accent-2) / <alpha-value>)',
        },
        ring: 'rgb(var(--ring) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
      },

      fontFamily: {
        display: ['Fraunces', 'ui-serif', 'Georgia', 'Cambria', 'serif'],
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        numeric: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },

      // Fluid steps from globals.css. `text-fluid-2xl` scales with the viewport;
      // the stock `text-2xl` still exists for anything that must not move.
      fontSize: {
        'fluid-xs': ['var(--step--1)', { lineHeight: '1.5' }],
        'fluid-sm': ['var(--step-0)', { lineHeight: '1.6' }],
        'fluid-base': ['var(--step-1)', { lineHeight: '1.55' }],
        'fluid-lg': ['var(--step-2)', { lineHeight: '1.4' }],
        'fluid-xl': ['var(--step-3)', { lineHeight: '1.25' }],
        'fluid-2xl': ['var(--step-4)', { lineHeight: '1.18' }],
        'fluid-3xl': ['var(--step-5)', { lineHeight: '1.12' }],
        'fluid-4xl': ['var(--step-6)', { lineHeight: '1.06' }],
        'fluid-5xl': ['var(--step-7)', { lineHeight: '1.02', letterSpacing: '-0.025em' }],
      },

      borderRadius: {
        card: 'var(--radius-card)',
        sheet: 'var(--radius-sheet)',
      },

      maxWidth: {
        shell: 'var(--shell-max)',
        prose: '62ch',
      },

      spacing: {
        'safe-b': 'var(--safe-b)',
        'safe-t': 'var(--safe-t)',
      },

      blur: {
        xs: '2px',
        '4xl': '72px',
        blob: '72px',
      },

      backgroundImage: {
        theme: 'var(--grad)',
      },

      boxShadow: {
        glow: '0 0 40px -8px rgb(var(--accent) / 0.45)',
        lift: '0 24px 48px -28px rgb(0 0 0 / 0.6)',
      },

      transitionTimingFunction: {
        'out-expo': 'var(--ease-out-expo)',
        'out-quart': 'var(--ease-out-quart)',
        soft: 'var(--ease-in-out-soft)',
        spring: 'var(--ease-spring)',
      },

      transitionDuration: {
        instant: 'var(--dur-instant)',
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
        slow: 'var(--dur-slow)',
        theme: 'var(--dur-theme)',
      },

      keyframes: {
        // The breath orb. One cycle = one full breath; drive the tempo by setting
        // `animationDuration` from the BreathPattern rather than swapping classes.
        breathe: {
          '0%, 100%': { transform: 'scale(0.82)', opacity: '0.72' },
          '50%': { transform: 'scale(1.12)', opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-160% 0' },
          '100%': { backgroundPosition: '260% 0' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.55' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },

      animation: {
        breathe: 'breathe 8s var(--ease-in-out-soft) infinite',
        float: 'float 7s var(--ease-in-out-soft) infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        'fade-up': 'fade-up var(--dur-slow) var(--ease-out-expo) both',
        'fade-in': 'fade-in var(--dur-base) var(--ease-out-quart) both',
        'pulse-ring': 'pulse-ring 2.8s var(--ease-out-expo) infinite',
      },
    },
  },

  plugins: [
    plugin(({ addVariant }) => {
      // Palette-scoped styling for the rare case a component needs to differ:
      // `sand:border-line` only applies under the light palette.
      for (const name of ['aurora', 'dusk', 'forest', 'sand']) {
        addVariant(name, `:where([data-theme="${name}"]) &`);
      }
      // `light:` is the mirror of the `dark:` strategy configured above.
      addVariant('light', ':where([data-theme="sand"]) &');

      // `still:hidden` — applies when the user has asked for less motion.
      addVariant('still', ':where([data-reduce-motion="true"]) &');
      addVariant('motion-ok', '@media (prefers-reduced-motion: no-preference)');
    }),
  ],
};
