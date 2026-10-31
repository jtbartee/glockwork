// Small inline icons. Every SVG carries explicit width/height so it never grows to fill its box.

const PATHS: Record<string, string> = {
  play: '<path d="M4 2.5v11l9-5.5z" fill="currentColor"/>',
  stop: '<rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/>',
  loop: '<path d="M3 8a5 5 0 0 1 8.6-3.5L13 6V2.5M13 8a5 5 0 0 1-8.6 3.5L3 10v3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  lock: '<rect x="3.5" y="7" width="9" height="7" rx="1.5" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  dice: '<rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5.5" cy="5.5" r="1.2" fill="currentColor"/><circle cx="10.5" cy="10.5" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/>',
  follow: '<path d="M2 8h9M8 4.5 11.5 8 8 11.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 3v10" stroke="currentColor" stroke-width="1.6"/>',
  regen: '<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  vary: '<path d="M2 10c2-6 4-6 6 0s4 6 6 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  edit: '<path d="M3 13l1-3.5L10.5 3a1.4 1.4 0 0 1 2 2L6 11.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  capture: '<circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2.3" fill="currentColor"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  start: '<path d="M3 2.5v11" stroke="currentColor" stroke-width="1.8"/><path d="M13 2.5v11L5 8z" fill="currentColor"/>',
};

export function icon(name: keyof typeof PATHS | string, size = 14): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = PATHS[name] ?? "";
  return svg;
}
