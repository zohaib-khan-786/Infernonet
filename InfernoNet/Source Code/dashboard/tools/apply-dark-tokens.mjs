/**
 * Apply the dark enterprise palette to tokens.css, scoped to the :root block.
 *
 * Token-name aware, NOT a blind hex replace: #0F1618 is both --ink-primary
 * (-> #F3F7FB) and --chart-series-1 (-> #22D3EE), and #FFFFFF is both
 * --surface-plate (-> #10243A) and --focus-halo (-> #06111F). A global hex
 * substitution would silently apply one token's value to another.
 *
 * The @media print block is left untouched: paper is white, and a dark theme
 * printed onto it would be unreadable and wasteful. The legacy name map at the
 * end is entirely var() references, so it follows the new values for free.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/styles/tokens.css';
const src = readFileSync(FILE, 'utf8');

// token name -> new value
const DARK = {
  // Surfaces. Elevation now inverts: the page is darkest and a raised readout
  // plate is the lightest thing on screen, which is the inverse of the old
  // light theme where the plate was white.
  'surface-void': '#06111F',
  'surface-sunken': '#081525',
  'surface-field': '#0B1B2D',
  'surface-plate': '#10243A',
  'surface-bezel': '#030A14',
  'surface-bezel-well': '#071523',
  'surface-bezel-raised': '#0A1B2D',

  // Ink
  'ink-primary': '#F3F7FB',
  'ink-secondary': '#91A4B8',
  'ink-tertiary': '#778CA1',
  'ink-disabled': '#5E7086',
  'ink-on-dark': '#F3F7FB',
  'ink-on-dark-2': '#91A4B8',
  'ink-on-dark-3': '#778CA1',

  // Rules. Hairline stays decorative (WCAG 1.4.11 exempts separators that do
  // not identify a control); rule-strong is the border that does identify one
  // and is held at 3:1.
  'rule-hairline': '#1C3854',
  'rule-strong': '#3870A7',
  'rule-bezel': '#1C3854',
  'rule-bezel-strong': '#3870A7',
  'rule-bezel-control': '#5C86B5',

  // Status: ink is now the BRIGHT colour and tint is a dark wash, the inverse
  // of the light theme's dark-ink-on-pale-wash relationship.
  'status-fresh-ink': '#20C997',
  'status-fresh-tint': '#0A2A22',
  'status-fresh-edge': '#20C997',
  'status-use-soon-ink': '#F59E0B',
  'status-use-soon-tint': '#2E2109',
  'status-use-soon-edge': '#F59E0B',
  'status-check-food-ink': '#F05252',
  'status-check-food-tint': '#2F1113',
  'status-check-food-edge': '#F05252',
  'status-sensor-fault-ink': '#C7D1DA',
  'status-sensor-fault-tint': '#1A2229',
  'status-sensor-fault-edge': '#8A99A6',
  'status-administrative-ink': '#4387F6',
  'status-administrative-tint': '#0D1E38',
  'status-administrative-edge': '#4387F6',
  'status-informational-ink': '#91A4B8',
  'status-informational-tint': '#14202E',
  'status-informational-edge': '#3870A7',

  // Accent
  'accent-link': '#7FC4F5',
  'accent-series': '#22D3EE',
  'accent-focus': '#7FC4F5',
  'accent-on-dark': '#7FC4F5',
  // The focus halo was white to separate a ring from a light plate. On a dark
  // ground the separation is the page colour, so the halo inverts with it.
  'focus-halo': '#06111F',

  // Chart
  'chart-series-1': '#22D3EE',
  'chart-series-2': '#20C997',
  'chart-series-3': '#F59E0B',
  'chart-series-4': '#9970F7',
  'chart-series-soft': '#3A6E8F',
  'chart-grid': '#16293F',
  'chart-axis': '#778CA1',
  'chart-band': '#0A2135',
  'chart-band-edge': '#3870A7',
  'chart-label': '#91A4B8',
  'chart-label-quiet': '#778CA1',

  // Transport + caution
  'transport-live': '#22D3EE',
  'transport-waiting': '#F59E0B',
  'transport-down': '#778CA1',
  'caution-on-dark': '#F59E0B',
};

// Only the :root block. Everything after the print query is left alone.
const printStart = src.indexOf('@media print');
if (printStart === -1) throw new Error('could not find the @media print boundary');
const head = src.slice(0, printStart);
const tail = src.slice(printStart);

let changed = 0;
const missed = [];
const out = head.replace(
  /^(\s*)(--[a-z0-9-]+)(\s*:\s*)(#[0-9A-Fa-f]{3,8})(.*)$/gm,
  (match, indent, name, sep, value, rest) => {
    // The map is keyed without the leading dashes; the regex captures them.
    const key = name.replace(/^--/, '');
    if (!(key in DARK)) {
      if (/^#[0-9A-Fa-f]{3,8}$/.test(value)) missed.push(name);
      return match;
    }
    changed++;
    return `${indent}${name}${sep}${DARK[key]}${rest}`;
  },
);

writeFileSync(FILE, out + tail, 'utf8');
console.log(`recoloured ${changed} token declarations inside :root`);
if (missed.length) {
  console.log(`\nNOT in the map (left as-is, check each): ${[...new Set(missed)].join(', ')}`);
}
