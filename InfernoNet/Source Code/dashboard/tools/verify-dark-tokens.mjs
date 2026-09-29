/**
 * Verify the complete proposed dark token set, then emit the exact
 * find-and-replace list for tokens.css.
 *
 * Scope discipline: the @media print block must stay light (paper is white), so
 * substitutions are only ever applied inside the :root block. The legacy name
 * map at the end of the file is entirely var() references and needs no change.
 */

const srgb = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// The four surfaces, darkest (page) to lightest (elevated readout).
const S = { void: '#06111F', sunken: '#081525', card: '#0B1B2D', plate: '#10243A' };
const ALL = Object.values(S);

// [token, value, minimum] - 4.5 for text, 3 for non-text.
const SET = [
  ['ink-primary', '#F3F7FB', 4.5],
  ['ink-secondary', '#91A4B8', 4.5],
  ['ink-tertiary', '#778CA1', 4.5],
  ['ink-disabled', '#5E7086', 3],
  ['accent-link', '#7FC4F5', 4.5],
  ['accent-focus', '#7FC4F5', 3],
  ['accent-on-dark', '#7FC4F5', 3],
  ['accent-series', '#22D3EE', 3],

  ['fresh', '#20C997', 4.5],
  ['use-soon', '#F59E0B', 4.5],
  ['check-food', '#F05252', 4.5],
  ['sensor-fault', '#C7D1DA', 4.5],
  ['administrative', '#4387F6', 4.5],
  ['informational', '#91A4B8', 4.5],

  ['transport-live', '#22D3EE', 3],
  ['transport-waiting', '#F59E0B', 3],
  ['transport-down', '#778CA1', 3],

  ['chart-series-1', '#22D3EE', 3],
  ['chart-series-2', '#20C997', 3],
  ['chart-series-3', '#F59E0B', 3],
  ['chart-series-4', '#9970F7', 3],
  ['chart-axis', '#778CA1', 3],
  ['chart-label', '#91A4B8', 4.5],
  ['chart-label-quiet', '#778CA1', 4.5],

  // Borders: hairline is decorative (exempt), control must clear 3:1.
  ['rule-hairline', '#1C3854', 0],
  ['rule-strong / control', '#3870A7', 3],
  ['bezel-hairline', '#1C3854', 0],
  ['bezel-control', '#5C86B5', 3],
];

let failed = 0;
console.log('=== TEXT & GRAPHICAL TOKENS ACROSS ALL FOUR SURFACES ===\n');
for (const [name, val, min] of SET) {
  if (min === 0) {
    const r = Math.min(...ALL.map((s) => ratio(val, s)));
    console.log(`  n/a  ${name.padEnd(22)} ${val}   worst ${r.toFixed(2)}:1  (decorative, exempt)`);
    continue;
  }
  const cells = ALL.map((s) => ratio(val, s));
  const worst = Math.min(...cells);
  const ok = worst >= min;
  if (!ok) failed++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ${val}   ` +
      `void ${cells[0].toFixed(2)}  sunken ${cells[1].toFixed(2)}  card ${cells[2].toFixed(2)}  ` +
      `plate ${cells[3].toFixed(2)}   worst ${worst.toFixed(2)}:1 (need ${min})`,
  );
}

console.log('\n=== TINT WASHES (background behind status text) ===\n');
const TINTS = [
  ['fresh-tint', '#0A2A22', '#20C997'],
  ['use-soon-tint', '#2E2109', '#F59E0B'],
  ['check-food-tint', '#2F1113', '#F05252'],
  ['sensor-fault-tint', '#1A2229', '#C7D1DA'],
  ['administrative-tint', '#0D1E38', '#4387F6'],
  ['informational-tint', '#14202E', '#91A4B8'],
];
for (const [name, tint, ink] of TINTS) {
  const r = ratio(ink, tint);
  const ok = r >= 4.5;
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ink ${ink} on ${tint}   ${r.toFixed(2)}:1`);
}

console.log(`\n${failed === 0 ? 'ALL CHECKS PASS' : `${failed} FAILURES`}`);
process.exitCode = failed === 0 ? 0 : 1;
