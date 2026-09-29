import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'D:/03-Development/Tech Wiz/dashboard/src/styles/tokens.css';
let t = readFileSync(FILE, 'utf8');

// The values were swapped for the dark theme, so the contrast figures cited in
// the trailing comments became false. In a file whose whole premise is
// "computed, not estimated", a stale number is worse than no number: it reads
// as a verification that never happened.
const pairs = [
  ['/* headings, readings, anything load-bearing      */', '/* headings, readings, anything load-bearing   16.14:1 */'],
  ['/* body copy, labels, axis text                   */', '/* body copy, labels, axis text                6.79:1 */'],
  ['/* units, legends, cell labels, metadata          */', '/* units, legends, cell labels, metadata       5.00:1 */'],
  ['/* disabled controls only; 3.57:1, exempt 1.4.3   */', '/* disabled controls only; 3.42:1, exempt 1.4.3   */'],
  ['/* bezel headings, the wordmark          15.28:1 */', '/* bezel headings, the wordmark           18.45:1 */'],
  ['/* bezel metadata, the device id          7.92:1 */', '/* bezel metadata, the device id            7.76:1 */'],
  ['/* bezel tertiary, "no device has reported" 4.83:1 */', '/* bezel tertiary, "no device has reported"  5.72:1 */'],
  ['/* seams between panels and rows; 2.22:1        */', '/* seams between panels and rows; 1.31:1        */'],
];

let ok = 0;
const missed = [];
for (const [from, to] of pairs) {
  if (t.includes(from)) {
    t = t.replace(from, to);
    ok++;
  } else {
    missed.push(from.slice(0, 40));
  }
}
writeFileSync(FILE, t, 'utf8');
console.log(`updated ${ok}/${pairs.length} inline citations`);
if (missed.length) console.log(`missed: ${missed.join(' | ')}`);
