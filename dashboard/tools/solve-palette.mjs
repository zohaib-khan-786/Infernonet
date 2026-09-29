/**
 * Solve the three tokens the guide's palette fails, keeping its hues.
 *
 * The guide's muted text, border and diagnostic purple are under-contrast on
 * the dark surfaces. Rather than discard the guide's palette or quietly ship
 * inaccessible colour, each is nudged along its own hue in HSL until it clears
 * WCAG on the WORST surface it is allowed to sit on. Same hue, minimum change,
 * verified result.
 */

const srgb = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * srgb((n >> 16) & 255) +
    0.7152 * srgb((n >> 8) & 255) +
    0.0722 * srgb(n & 255)
  );
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const toHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return toHex(v, v, v);
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return toHex(hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255);
}

/** Walk lightness up (or down) until `test` passes, holding hue and saturation. */
function solve(startHex, direction, test) {
  const [h, s, l0] = hexToHsl(startHex);
  for (let step = 0; step <= 100; step += 0.002) {
    const l = l0 + direction * step;
    if (l < 0 || l > 1) break;
    const candidate = hslToHex(h, s, l);
    if (test(candidate)) return candidate;
  }
  return null;
}

const guide = {
  muted: '#60758A',
  border: '#1C3854',
  purple: '#8B5CF6',
};

const WORST_TEXT_SURFACE = '#10243A'; // the lightest surface text may sit on
const failures = [];

console.log('=== SOLVING (worst-case surface #10243A) ===\n');

// Muted text: 4.5:1. Needs to go lighter on a dark ground.
const muted = solve(guide.muted, +1, (c) => ratio(c, WORST_TEXT_SURFACE) >= 4.5);
console.log(`muted text   ${guide.muted} -> ${muted}   ${ratio(muted, WORST_TEXT_SURFACE).toFixed(2)}:1  (need 4.5)`);
for (const s of ['#06111F', '#081525', '#0B1B2D', '#10243A']) {
  console.log(`              on ${s}  ${ratio(muted, s).toFixed(2)}:1`);
}

// Border: 3:1 non-text. Also needs to go lighter on a dark ground.
const border = solve(guide.border, +1, (c) => ratio(c, WORST_TEXT_SURFACE) >= 3);
console.log(`\nborder       ${guide.border} -> ${border}   ${ratio(border, WORST_TEXT_SURFACE).toFixed(2)}:1  (need 3)`);
for (const s of ['#06111F', '#081525', '#0B1B2D', '#10243A']) {
  console.log(`              on ${s}  ${ratio(border, s).toFixed(2)}:1`);
}

// Diagnostic purple: 4.5:1 as text.
const purple = solve(guide.purple, +1, (c) => ratio(c, WORST_TEXT_SURFACE) >= 4.5);
console.log(`\npurple       ${guide.purple} -> ${purple}   ${ratio(purple, WORST_TEXT_SURFACE).toFixed(2)}:1  (need 4.5)`);
for (const s of ['#06111F', '#081525', '#0B1B2D', '#10243A']) {
  console.log(`              on ${s}  ${ratio(purple, s).toFixed(2)}:1`);
}

console.log('\n=== VERIFY UNCHANGED GUIDE TOKENS ON THE LIGHTEST SURFACE ===');
const g = {
  primary: '#F3F7FB',
  secondary: '#91A4B8',
  success: '#20C997',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
  cyan: '#22D3EE',
};
for (const [name, val] of Object.entries(g)) {
  const r = ratio(val, WORST_TEXT_SURFACE);
  const ok = r >= 4.5;
  if (!ok) {
    // Same-hue solve rather than shipping a sub-4.5:1 status colour.
    const solved = solve(val, +1, (c) => ratio(c, WORST_TEXT_SURFACE) >= 4.5);
    console.log(`  FAIL  ${name.padEnd(9)} ${r.toFixed(2)}:1  ->  ${solved}  ${ratio(solved, WORST_TEXT_SURFACE).toFixed(2)}:1`);
  } else {
    console.log(`  PASS  ${name.padEnd(9)} ${r.toFixed(2)}:1`);
  }
}

console.log('\n=== FINAL DARK INK SET ON ALL FOUR SURFACES ===');
const final = {
  primary: '#F3F7FB',
  secondary: '#91A4B8',
  muted: '#778CA1',
  success: '#20C997',
  warning: '#F59E0B',
  danger: solve('#EF4444', +1, (c) => ratio(c, WORST_TEXT_SURFACE) >= 4.5),
  info: solve('#3B82F6', +1, (c) => ratio(c, WORST_TEXT_SURFACE) >= 4.5),
  purple: '#9970F7',
  cyan: '#22D3EE',
};
const surfaces = { void: '#06111F', sidebar: '#081525', card: '#0B1B2D', elevated: '#10243A' };
for (const [name, val] of Object.entries(final)) {
  const cells = Object.values(surfaces).map((s) => ratio(val, s).toFixed(2).padStart(6));
  const worst = Math.min(...Object.values(surfaces).map((s) => ratio(val, s)));
  console.log(
    `  ${worst >= 4.5 ? 'PASS' : 'FAIL'}  ${name.padEnd(9)} ${val}   ` +
      `void ${cells[0]}  sidebar ${cells[1]}  card ${cells[2]}  elevated ${cells[3]}`,
  );
}

console.log('\n=== BORDERS (3:1 non-text) ===');
console.log(`  hairline (decorative, exempt)  #1C3854`);
console.log(`  control  (must clear 3:1)     #3870A7`);

