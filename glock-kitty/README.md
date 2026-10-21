# Flock Kitty

The browser game, one file: `index.html`. Deployed to https://glockkitty.pages.dev/ from the
`glockkitty-phaser` folder with `npx wrangler pages deploy dist --project-name glockkitty --branch main`.

`functions/api/checkout.js` and `functions/api/verify.js` are Cloudflare Pages Functions for the
in-game shop (Stripe Checkout). They read the secret key from the `STRIPE_SECRET_KEY` environment
variable, set with `npx wrangler pages secret put STRIPE_SECRET_KEY --project-name glockkitty`.
The key is never in the page.

To sync the game folder on the computer with this copy:

    cd ~/glockkitty-phaser
    for f in index.html dist/index.html arcade/index.html dist/arcade/index.html; do
      curl -fsSL https://raw.githubusercontent.com/Yurtle-gif/actprism-site/flock-kitty/glock-kitty/index.html -o "$f"; done
    mkdir -p functions/api
    for f in checkout verify; do
      curl -fsSL https://raw.githubusercontent.com/Yurtle-gif/actprism-site/flock-kitty/glock-kitty/functions/api/$f.js -o functions/api/$f.js; done
