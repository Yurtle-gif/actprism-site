# Flock Kitty phone app

An Expo (SDK 58) app for iOS and Android that runs the Flock Kitty web game, unchanged, inside a full-screen WebView. The game file ships inside the app, so it plays offline (the Google font falls back to a system font without a connection).

What the app adds on top of the web game:
- Full screen, no status bar, screen stays awake while playing, portrait or landscape.
- Haptics: shots and dashes tap lightly, hits and explosions hit harder, pickups and wave fanfares buzz "success", game over buzzes "error" (throttled to one every 70 ms).
- The cash shop is hidden. Apple and Google don't allow Stripe for digital items in store apps; selling skins in the app would need their in-app purchase systems.
- Telemetry stays off, because the game only sends it from the live website.

## Updating the game

`assets/game/index.html` is a patched copy of the standalone build. After changing the game, re-copy it:

```bash
npm run sync-game -- /path/to/flock-kitty/index.html
```

With no path it reads `../glock-kitty/index.html` (the layout of the `flock-kitty` branch). The script inserts the small haptics bridge and the shop-hiding style; the web game itself is never edited.

## Running it

```bash
npm install
npx expo run:ios       # or run:android; needs Xcode / Android Studio
```

The app uses `react-native-webview`, `expo-haptics` and `expo-keep-awake`, which are all in Expo Go, so `npx expo start` and scanning the QR code with Expo Go also works for a quick look.

## Shipping to the stores (not done yet)

1. Accounts: Expo (free), Apple Developer ($99/yr), Google Play ($25 once).
2. Pick the real bundle id; `app.json` has the placeholder `com.flockkitty.app`.
3. Replace the default Expo icon and splash in `assets/`.
4. `npx eas-cli@latest build --platform all`, then `eas submit`. The `eas-app-stores` skill in the Expo plugin walks through it.
5. Before review: the Hello Kitty character and brand logos in the art are likely to get the app rejected for IP, and the privacy page placeholders need filling in.

Claude Code picks up the official Expo skills here automatically (`.claude/settings.json` enables the `expo` plugin).
