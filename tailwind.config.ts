import type { Config } from "tailwindcss";

// Design tokens for an institutional, information-dense administration UI.
// Colours are CSS variables (see globals.css) so contrast can be tuned in one place.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: "rgb(var(--surface) / <alpha-value>)", raised: "rgb(var(--surface-raised) / <alpha-value>)", sunken: "rgb(var(--surface-sunken) / <alpha-value>)" },
        line: { DEFAULT: "rgb(var(--line) / <alpha-value>)", strong: "rgb(var(--line-strong) / <alpha-value>)" },
        ink: { DEFAULT: "rgb(var(--ink) / <alpha-value>)", muted: "rgb(var(--ink-muted) / <alpha-value>)", subtle: "rgb(var(--ink-subtle) / <alpha-value>)", inverse: "rgb(var(--ink-inverse) / <alpha-value>)" },
        brand: { DEFAULT: "rgb(var(--brand) / <alpha-value>)", hover: "rgb(var(--brand-hover) / <alpha-value>)", soft: "rgb(var(--brand-soft) / <alpha-value>)", ink: "rgb(var(--brand-ink) / <alpha-value>)" },
        chart: { DEFAULT: "rgb(var(--chart-1) / <alpha-value>)" },
        tone: {
          info: "rgb(var(--tone-info) / <alpha-value>)", "info-bg": "rgb(var(--tone-info-bg) / <alpha-value>)",
          success: "rgb(var(--tone-success) / <alpha-value>)", "success-bg": "rgb(var(--tone-success-bg) / <alpha-value>)",
          warning: "rgb(var(--tone-warning) / <alpha-value>)", "warning-bg": "rgb(var(--tone-warning-bg) / <alpha-value>)",
          danger: "rgb(var(--tone-danger) / <alpha-value>)", "danger-bg": "rgb(var(--tone-danger-bg) / <alpha-value>)",
          accent: "rgb(var(--tone-accent) / <alpha-value>)", "accent-bg": "rgb(var(--tone-accent-bg) / <alpha-value>)",
          neutral: "rgb(var(--tone-neutral) / <alpha-value>)", "neutral-bg": "rgb(var(--tone-neutral-bg) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "Noto Sans", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: { "2xs": ["0.6875rem", "1rem"] },
      boxShadow: { card: "0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 1px rgba(16, 24, 40, 0.03)" },
    },
  },
  plugins: [],
};
export default config;
