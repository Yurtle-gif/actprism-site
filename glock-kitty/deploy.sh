#!/usr/bin/env bash
# Puts the current Flock Kitty build live on glockkitty.pages.dev from E's computer.
# Run it from a terminal there with:
#   bash <(curl -fsSL https://raw.githubusercontent.com/Yurtle-gif/actprism-site/<commit>/glock-kitty/deploy.sh)
# FK pins the Flock Kitty build, GK the Glock Kitty 7 page; both are bumped with each new version.
set -e
FK=f21f44ee6f19d8e2982848c32b18cc508dac794d
GK=fe1b777b36aa404bbbab172dc9f0ee07d467a4c0
R=https://raw.githubusercontent.com/Yurtle-gif/actprism-site/$FK
G=https://raw.githubusercontent.com/Yurtle-gif/actprism-site/$GK
cd ~/glockkitty-phaser

echo "Downloading Flock Kitty..."
curl -fsSL $R/glock-kitty/index.html -o /tmp/fk.html
for f in index.html dist/index.html arcade/index.html dist/arcade/index.html; do mkdir -p "$(dirname $f)"; cp /tmp/fk.html $f; done
mkdir -p functions/api dist/glock-kitty-7 rooms
for f in checkout verify events; do curl -fsSL $R/glock-kitty/functions/api/$f.js -o functions/api/$f.js; done
curl -fsSL $G/glock-kitty-7/index.html -o dist/glock-kitty-7/index.html
for f in worker.js wrangler.toml; do curl -fsSL $R/glock-kitty/rooms/$f -o rooms/$f; done

npx wrangler whoami >/dev/null 2>&1 || npx wrangler login

echo "Starting the online room server..."
rm -f /tmp/rooms.json
if WRANGLER_OUTPUT_FILE_PATH=/tmp/rooms.json npx wrangler deploy --config rooms/wrangler.toml; then
  ROOMS=$(grep -o 'https://[a-z0-9.-]*workers\.dev' /tmp/rooms.json | head -1)
  [ -n "$ROOMS" ] && echo "{\"rooms\":\"wss://${ROOMS#https://}\"}" > dist/net.json
else
  echo "Room server skipped; the game still works, online play waits for it."
fi

echo "Deploying the game..."
npx wrangler pages deploy dist --project-name glockkitty --branch main --commit-dirty=true
echo "Done: https://glockkitty.pages.dev"
