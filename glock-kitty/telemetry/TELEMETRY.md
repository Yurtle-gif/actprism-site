# Flock Kitty telemetry

How the game reports what players do, where it lands, and the questions it answers.

**Pipeline:** game (`index.html`, the `TEL` module) → `POST /api/events` (Cloudflare Pages Function, `functions/api/events.js`) → Cloudflare D1 (`telemetry/schema.sql`) → SQL (`telemetry/queries.sql`).

Nothing identifies a person. The device id is a random id in the browser's local storage, the session id is random per page load, and no IP address, name, email or tag is stored. Country comes from Cloudflare's edge, not from the player.

## Switching it on (one-time, on your computer)

The game already sends events on glockkitty.pages.dev. Until the database exists the endpoint answers 204 and drops them, so nothing breaks. To keep them:

```bash
cd ~/glockkitty-phaser
npx wrangler d1 create flockkitty-telemetry
npx wrangler d1 execute flockkitty-telemetry --remote --file=telemetry/schema.sql
```

Then in the Cloudflare dashboard: Workers & Pages → glockkitty → Settings → Bindings → add a **D1 database** binding with variable name `DB` pointing at `flockkitty-telemetry`. Redeploy once. From then on the queries below run with:

```bash
npx wrangler d1 execute flockkitty-telemetry --remote --command "SELECT event, COUNT(*) FROM events GROUP BY event"
```

## How the client works

- **Batching.** Events queue in memory and flush every **30 s** or as soon as **25** are waiting, up to 100 per request. The queue is capped at 500 (oldest dropped), and a failed batch is retried up to 3 times. A 400 or 413 answer is treated as the game's own fault and not retried.
- **Shutdown.** On `pagehide` the client records `session_end` and hands the whole queue to `navigator.sendBeacon`, which outlives the tab. Going to the background (`visibilitychange`) also beacons. Game over and a verified purchase flush immediately.
- **Heartbeat.** Every 180 s while the tab is open: average fps, mode, wave, minutes played, queue depth.
- **Sanitising.** Props are cleaned before they are queued: keys must be `[a-z0-9_]{1,40}`, strings are stripped of control characters and cut at 96 characters, numbers must be finite, objects are dropped, and an event carries at most 24 props.
- **Off-site.** The tracker only turns on when the page is served over http(s) from a host other than claude.ai, so the shared game link and local files send nothing.
- **Ids.** `did` (device) lives in `localStorage` as `gk.did`; `sid` is new per page load; `run` is new per run; `seq` counts up per session so gaps show dropped events.

## How the server validates

`functions/api/events.js` trusts nothing in the body:

| Check | Result |
|---|---|
| body over 64 KB, or more than 100 events | 413, not retried |
| malformed JSON, wrong `v`, ids not `[A-Za-z0-9-]{8,48}` | 400, not retried |
| more than 30 batches from one device in a minute | 429, retried later |
| event name not in the allow-list | row dropped silently |
| prop not in that event's allow-list, or a number past its cap (score > 5 M, wave > 500, lives > 20…) | prop dropped |
| client timestamp more than a day from the server clock | server time used instead |
| same `sid:seq` seen twice (a retried batch) | ignored by the primary key |
| database error | 500, so the game retries |
| no `DB` binding | 204, events dropped |

Money is never taken from the client. `purchase_complete` is what the browser *says* happened; the trusted row is `purchase_verified`, written by `/api/verify` only after Stripe confirms the Checkout Session is paid, with the Stripe session id as the row id so it can never double count.

## Event dictionary

Common fields on every event: `e` (name), `t` (client ms), `seq`, `run` (run id, when in a run), `p` (props). Every batch carries `did`, `sid`, `sent` and `ctx` (device class, platform, viewport, dpr, language, game version). The server adds `received_at` and `country`.

### Session

| Event | When | Props |
|---|---|---|
| `session_start` | page booted | `returning` (had a best score), `best`, `streak` (days), `owned` (paid items), `challenge` (arrived on a beat-my-score link), `ref` (referrer host), `reduced_motion`, `cat`, `skin` |
| `session_end` | tab hidden for good / closed | `duration_s`, `runs`, `mode`, `wave` |
| `heartbeat` | every 180 s | `fps`, `mode`, `wave`, `minutes`, `ride`, `lives`, `queue` |

### Progression and FTUE

| Event | When | Props |
|---|---|---|
| `ftue_step` | the first time a device reaches a milestone (sent once per device, ever) | `step`, `index` (0–8), `minutes_since_first` |
| `run_start` | Start or Daily pressed | `daily`, `diff`, `cat`, `skin`, `lives`, `picks` (drip carried in), `pass`, `streak`, `mod` (daily modifier) |
| `run_retry` | boss checkpoint retry | `wave`, `score`, `daily` |
| `run_end` | all lives gone | `score`, `wave`, `kills`, `secs`, `daily`, `diff`, `city`, `in_ride`, `cash_left`, `cash_earned`, `cash_spent`, `hits`, `gun`, `picks`, `kills_by` (JSON by enemy type), `new_best`, `beat_challenge`, `checkpoint` |
| `wave_start` | each wave begins | `wave`, `city`, `boss` (kind or empty), `lives`, `cash`, `gun`, `picks` (count), `budget` (enemy budget) |
| `wave_clear` | last enemy of a normal wave down | `wave`, `secs`, `lives`, `cash`, `kills`, `score`, `city` |
| `boss_kill` | boss down | `kind`, `wave`, `secs`, `lives`, `hits`, `score` |
| `unlock` | a streak reward granted | `streak`, `items` |

FTUE milestones, in order: `first_run`, `first_wave_clear`, `first_shop_buy`, `first_boss_kill`, `first_ride`, `first_death`, `first_share`, `first_daily`, `first_purchase`.

### Combat and rides

| Event | When | Props |
|---|---|---|
| `player_hit` | the cat loses a life | `wave`, `lives`, `x`, `y` (snapped to a 50 px grid, for the hotspot map), `city`, `boss` |
| `pickup` | cash or heart collected | `kind`, `wave`, `lives` |
| `ride_start` | bridge/freeway ride begins | `kind` (bike/car/…), `road`, `wave`, `lives`, `cash` |
| `ride_hit` | a life lost on a ride | `kind`, `road`, `why`, `lives`, `secs` |
| `ride_end` | ride clock runs out | `kind`, `road`, `wave`, `spotted`, `kills`, `unseen` (clean run), `bonus`, `pay`, `lives`, `boosts` (dashes used) |

### Economy (in-game cash)

| Event | When | Props |
|---|---|---|
| `shop_open` | the between-wave upgrade shop opens | `wave`, `cash`, `offer` (ids), `prices` |
| `upgrade_buy` | an upgrade bought | `id`, `cost`, `cash_after`, `wave`, `level`, `drip` (cosmetic piece) |
| `shop_leave` | shop closed | `wave`, `bought`, `cash`, `secs` (time in shop) |

Per-run totals (`cash_earned`, `cash_spent`, `cash_left`) ride on `run_end`, so the inflation query needs no per-pickup rows.

### Real-money store (Stripe)

| Event | When | Props |
|---|---|---|
| `store_open` | Shop panel opened | `owned`, `from` (mode) |
| `store_buy_click` | Buy pressed, before Stripe | `item` |
| `purchase_complete` | returned from Stripe and verified (client view) | `item`, `cents` |
| `purchase_failed` | returned but not paid | `item`, `reason` |
| `purchase_verified` | **server-written** by `/api/verify` after Stripe says paid | `item`, `cents`, `currency`, `mode` (test/live) |

### Choices and sharing

| Event | When | Props |
|---|---|---|
| `cat_select` / `skin_select` / `diff_select` | title-screen pickers | `cat` / `skin` / `diff` |
| `share_open` | share card opened after a run | `score`, `wave`, `daily` |
| `share` | a share succeeded | `method` (image/link/copy), `score` |
| `link_copy` | beat-my-score link copied | `score` |
| `challenge_beat` | the linked score was beaten | `target`, `wave` |
| `board_entry` | tag entered on the leaderboard | `rank`, `score`, `daily` |

## Ingestion payload

`telemetry/sample-batch.json` is one real-shaped request body: one session that starts a run, clears wave 1, buys an upgrade, rides the Bay Bridge clean and dies on wave 7.

## Dashboards (what to watch)

| Panel | Query in `queries.sql` | Reads |
|---|---|---|
| D1 / D7 retention by furthest FTUE milestone | 1 | which first-session moment makes people come back |
| Ride results by ride kind and road | 2a | the "stunt score vs chassis" view: bonus, pay, clean-run rate, boosts |
| Runs by gun loadout | 2b | which gun carries players furthest, and the boss-reach rate |
| Currency inflation per weekly cohort | 3 | cash earned vs spent per run; a rising ratio or rising unspent cash means prices need to climb |
| Store funnel | 4 | opened → clicked buy → paid (from `purchase_verified`), revenue last 30 days |
| Hit hotspots | 5 | the 50 px cells where players lose lives, per city |
| Share rate | 6 | runs ended vs share card opened vs shares by method |
| DAU and runs per day | 7 | the top-line line chart |

KPI definitions used above: **D1 retention** = share of a cohort day's new devices with any event on cohort_day + 1 (D7 likewise). **Cohort** = the device's first day seen. **Run** = `run_start` → `run_end` under one run id. **Clean run** = ride with `spotted = 0`.

## Adding an event

1. Call `TEL.track('name', { ...props })` in the game.
2. Add `name: [allowed prop keys]` to `EVENTS` in `functions/api/events.js` (and a cap in `LIMITS` for any number that should have one).
3. Add a row to this dictionary. No schema change is needed; props are JSON.
