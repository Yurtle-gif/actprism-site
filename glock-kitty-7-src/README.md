# Glock Kitty 7 — source

Three.js third-person battle royale on Neo-Tokyo 85 Island. Adapted from the
`glock-kitty-6/royale` build (same gameplay, renamed, bundled to one file).

```sh
npm install
npm run build          # -> dist/index.html, one self-contained file
VITE_GK_TEST=1 npx vite build --outDir dist-test   # adds window.__gk for headless tests
```

Copy `dist/index.html` to `../glock-kitty-7/index.html` to update the deployable build.

## Art

`src/models.js` loads the shared Flock Kitty art at startup: the rigged player
(`hero`, the Hello Kitty boy) and Snow, the cam robots, cars, street props and
money bags in `src/assets/models/*.glb.gz`, plus storefront, skyline and
billboard textures in `src/assets/tex/`. The GLBs are gzip'd and meshopt-free
so the single-file build decodes them with `DecompressionStream` (no fetch,
no WebAssembly). If a model fails to load, the game falls back to the old
primitive meshes.
