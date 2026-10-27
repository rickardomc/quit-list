/** Inline stroke icons; they inherit `currentColor` and size from CSS. */
const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  check: svg(`<path d="M5 12.5l4.5 4.5L19 7.5"/>`),
  x: svg(`<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`),
  trash: svg(`<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10.2 11v5.5M13.8 11v5.5"/>`),
  external: svg(`<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>`),
};
