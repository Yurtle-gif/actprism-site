# Glock Kitty 7 — source

Three.js third-person battle royale on Neo-Tokyo 85 Island. Adapted from the
`glock-kitty-6/royale` build (same gameplay, renamed, bundled to one file).

```sh
npm install
npm run build          # -> dist/index.html, one self-contained file
VITE_GK_TEST=1 npx vite build --outDir dist-test   # adds window.__gk for headless tests
```

Copy `dist/index.html` to `../glock-kitty-7/index.html` to update the deployable build.
