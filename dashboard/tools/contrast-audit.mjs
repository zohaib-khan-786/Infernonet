/**
 * WCAG contrast audit for the dark enterprise palette.
 *
 * The existing tokens.css earns trust by publishing computed contrast ratios
 * rather than estimated ones. A theme inversion that skips that step silently
 * breaks accessibility while still looking right, so this computes every pair
 * the stylesheet actually relies on and reports the failures.
 */

const srgb = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const r = srgb((n >> 16) & 255);
  const g = srgb((n >> 8) & 255);
  const b = srgb(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Guide palette, section 2. */
const guide = {
  void: '#06111F',
  sidebar: '#081525',
  card: '#0B1B2D',
  elevated: '#10243A',
  border: '#1C3854',
  inkPrimary: '#F3F7FB',
  inkSecondary: '#91A4B8',
  inkMuted: '#60758A',
  success: '#20C997',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
  purple: '#8B5CF6',
  cyan: '#22D3EE',
};

const surfaces = {
  void: guide.void,
  sidebar: guide.sidebar,
  card: guide.card,
  elevated: guide.elevated,
};

console.log('=== TEXT: 4.5:1 required ===');
for (const [sn, sv] of Object.entries(surfaces)) {
  for (const [inkName, inkVal, min] of [
    ['primary', guide.inkPrimary, 4.5],
    ['secondary', guide.inkSecondary, 4.5],
    ['muted', guide.inkMuted, 4.5],
  ]) {
    const r = ratio(inkVal, sv);
    const verdict = r >= min ? 'PASS' : 'FAIL';
    console.log(
      `  ${verdict}  ${inkName.padEnd(9)} on ${sv.padEnd(9)} (${sn.padEnd(8)})  ${r.toFixed(2).padStart(6)}:1`,
    );
  }
}

console.log('\n=== NON-TEXT: 3:1 required ===');
for (const [sn, sv] of Object.entries(surfaces)) {
  const r = ratio(guide.border, sv);
  console.log(
    `  ${r >= 3 ? 'PASS' : 'FAIL'}  border    on ${sv.padEnd(9)} (${sn.padEnd(8)})  ${r.toFixed(2).padStart(6)}:1`,
  );
}

console.log('\n=== STATUS INKS on the card surface (#0B1B2D): 4.5:1 ===');
for (const [name, val] of Object.entries({
  success: guide.success,
  warning: guide.warning,
  danger: guide.danger,
  info: guide.info,
  purple: guide.purple,
  cyan: guide.cyan,
})) {
  const r = ratio(val, guide.card);
  console.log(`  ${r >= 4.5 ? 'PASS' : 'FAIL'}  ${name.padEnd(8)}  ${r.toFixed(2).padStart(6)}:1`);
}

console.log('\n=== STATUS INKS on the void surface (#06111F): 4.5:1 ===');
for (const [name, val] of Object.entries({
  success: guide.success,
  warning: guide.warning,
  danger: guide.danger,
  info: guide.info,
  purple: guide.purple,
  cyan: guide.cyan,
})) {
  const r = ratio(val, guide.void);
  console.log(`  ${r >= 4.5 ? 'PASS' : 'FAIL'}  ${name.padEnd(8)}  ${r.toFixed(2).padStart(6)}:1`);
}
