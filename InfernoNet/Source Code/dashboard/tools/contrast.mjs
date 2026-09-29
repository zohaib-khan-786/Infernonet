/* Contrast audit for the FreshGuard palette. Run: node tools/contrast.mjs */
const hex = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};
const lum = (h) => {
  const [r, g, b] = hex(h).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const PAIRS = [
  ['ink on field', '#12171A', '#F6F7F7', 4.5],
  ['ink on plate', '#12171A', '#FFFFFF', 4.5],
  ['ink on panel', '#12171A', '#E7EAEB', 4.5],
  ['ink-2 on field', '#414B4F', '#F6F7F7', 4.5],
  ['ink-2 on plate', '#414B4F', '#FFFFFF', 4.5],
  ['ink-2 on panel', '#414B4F', '#E7EAEB', 4.5],
  ['ink-3 on field', '#5E6A6E', '#F6F7F7', 4.5],
  ['ink-3 on plate', '#5E6A6E', '#FFFFFF', 4.5],
  ['ink-3 on panel', '#5E6A6E', '#E7EAEB', 4.5],
  ['field on bezel', '#F6F7F7', '#12171A', 4.5],
  ['ink-2 on bezel', '#A9B6BB', '#12171A', 4.5],
  ['ok ink on ok tint', '#0B5734', '#DCEDE2', 4.5],
  ['ok ink on field', '#0B5734', '#F6F7F7', 4.5],
  ['warn ink on warn tint', '#7A4408', '#FAEBD6', 4.5],
  ['warn ink on field', '#7A4408', '#F6F7F7', 4.5],
  ['crit ink on crit tint', '#8E1111', '#F8E0E0', 4.5],
  ['crit ink on field', '#8E1111', '#F6F7F7', 4.5],
  ['unknown ink on unknown tint', '#2F3B44', '#E2E7EA', 4.5],
  ['unknown ink on field', '#2F3B44', '#F6F7F7', 4.5],
  ['admin ink on admin tint', '#1B4A7A', '#E0E9F3', 4.5],
  ['admin ink on field', '#1B4A7A', '#F6F7F7', 4.5],
  ['series on plate', '#14496E', '#FFFFFF', 3],
  ['threshold edge on plate', '#6E7A7F', '#FFFFFF', 3],
  ['rule-strong on field', '#79858A', '#F6F7F7', 3],
  ['link on field', '#0B4F8A', '#F6F7F7', 4.5],
  ['link on plate', '#0B4F8A', '#FFFFFF', 4.5],
  ['focus ring on field', '#0B57D0', '#F6F7F7', 3],
  ['focus ring on bezel', '#8FC7F2', '#12171A', 3],
  ['plate on ok edge (chip)', '#FFFFFF', '#0B5734', 4.5],
  ['plate on crit edge (chip)', '#FFFFFF', '#8E1111', 4.5],
  ['plate on warn edge (chip)', '#FFFFFF', '#7A4408', 4.5],
  ['plate on unknown edge (chip)', '#FFFFFF', '#2F3B44', 4.5],
  ['plate on admin edge (chip)', '#FFFFFF', '#1B4A7A', 4.5],
  ['disabled ink on field', '#79858A', '#F6F7F7', 3],
];

let fail = 0;
for (const [name, fg, bg, min] of PAIRS) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(6)}:1  (min ${min})  ${name}`);
}
console.log(fail === 0 ? '\nall pairs pass' : `\n${fail} pair(s) fail`);
