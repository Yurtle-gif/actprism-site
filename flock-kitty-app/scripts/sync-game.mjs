// Copies the standalone Flock Kitty build into the app and adds the native bridge.
// Usage: node scripts/sync-game.mjs [path/to/flock-kitty.html]
// Default source is the repo copy on the flock-kitty branch layout (../glock-kitty/index.html).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(process.argv[2] || resolve(root, '../glock-kitty/index.html'));
const out = resolve(root, 'assets/game/index.html');

let html = readFileSync(src, 'utf8');

// The game runs inside one IIFE, so SFX is only reachable from inside it.
// Insert the bridge just before the last `})();` of the game script.
const bridge = `
/* native app bridge, added by flock-kitty-app/scripts/sync-game.mjs */
if (window.ReactNativeWebView) {
  const HAPTIC = { shot: 'light', dash: 'light', hit: 'medium', thud: 'medium', crunch: 'medium', oof: 'heavy', boom: 'heavy', boss: 'warning', pickup: 'success', fanfare: 'success', over: 'error' };
  for (const k in HAPTIC) {
    const f = SFX[k];
    if (typeof f === 'function') SFX[k] = function () { try { window.ReactNativeWebView.postMessage(JSON.stringify({ t: 'haptic', k: HAPTIC[k] })); } catch (e) {} return f.apply(this, arguments); };
  }
}
`;
const end = html.lastIndexOf('})();');
if (end < 0 || !html.includes('const SFX = {')) throw new Error('Unexpected game file: no SFX object or closing IIFE');
html = html.slice(0, end) + bridge + html.slice(end);

// Store builds cannot sell digital items through Stripe, so the shop is hidden in the app.
html = html.replace('</head>', '<style>#shopBtn,#shopTitle{display:none!important}</style>\n</head>');

writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1048576).toFixed(1)} MB) from ${src}`);
