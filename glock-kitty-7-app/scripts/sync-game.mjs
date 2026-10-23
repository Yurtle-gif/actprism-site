// Copies the standalone Glock Kitty 7 build into the app.
// Usage: node scripts/sync-game.mjs [path/to/glock-kitty-7.html]
// Default source is the repo build at ../glock-kitty-7/index.html.
// The game already talks to the app itself (haptics via window.ReactNativeWebView,
// touch controls on any touch screen), so this is a straight copy.
import { copyFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(process.argv[2] || resolve(root, '../glock-kitty-7/index.html'));
const out = resolve(root, 'assets/game/index.html');
copyFileSync(src, out);
console.log(`Wrote ${out} (${(statSync(out).size / 1048576).toFixed(1)} MB) from ${src}`);
