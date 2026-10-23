# Glock Kitty 7 phone app

An Expo (SDK 58) app for iPhone (and Android) that runs the Glock Kitty 7 web build full screen in a WebView. The game file ships inside the app, so it plays offline (the Google fonts fall back to system fonts without a connection). Same setup as `flock-kitty-app/`.

What the app adds:
- Landscape only, full screen, no status bar, screen stays awake.
- Haptics: shots tap lightly (shotgun and sniper harder), hits and taking damage thump, eliminations buzz "success". The game sends these itself through `window.ReactNativeWebView`, and they do nothing on the website.
- The touch controls are part of the game, so they also work in Safari on a phone: left thumb moves (push all the way to sprint), right thumb looks, FIRE shoots and aims while you drag it, plus JUMP, AIM, SLIDE, skateboard, OPEN at chests, and tappable hotbar and build pieces. Firing on a phone gets light aim assist.

## Updating the game

```bash
cd ../glock-kitty-7-src && npx vite build && cp dist/index.html ../glock-kitty-7/index.html
cd ../glock-kitty-7-app && npm run sync-game
```

## Running it

```bash
npm install
npx expo start          # scan the QR code with Expo Go on the iPhone
npx expo run:ios        # or a full build; needs a Mac with Xcode
```

## Shipping to the App Store (not done yet)

1. Accounts: Expo (free) and Apple Developer ($99/yr).
2. Pick the real bundle id; `app.json` has the placeholder `com.glockkitty7.app`.
3. Replace the default Expo icon and splash in `assets/`.
4. `npx eas-cli@latest build --platform ios`, then `npx eas-cli@latest submit --platform ios`. No Mac needed with EAS.
5. Before review: the Hello Kitty character and brand logos are likely to get the app rejected for IP, and Apple requires a privacy policy URL.
