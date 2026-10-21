-- Flock Kitty telemetry · analysis queries for Cloudflare D1 (SQLite dialect)
-- Run one with:  npx wrangler d1 execute flockkitty-telemetry --remote --command "<paste a query>"
-- All of them read the `events` table and the views in schema.sql.

-- =====================================================================================================
-- 1. D1 / D7 retention by furthest FTUE milestone reached
--    "Did players who got past X come back the next day and a week later?"
--    A device is retained on D1 if it has any event on cohort_day + 1, on D7 if any event on cohort_day + 7.
--    Only cohorts old enough to have had their D7 are counted, so the D7 column is never artificially low.
-- =====================================================================================================
WITH p AS (
  SELECT did, cohort_day, COALESCE(ftue_max_index, -1) AS ftue_idx FROM players
  WHERE cohort_day <= date('now', '-8 days')
),
ret AS (
  SELECT p.did, p.ftue_idx,
         MAX(CASE WHEN a.day = date(p.cohort_day, '+1 day') THEN 1 ELSE 0 END) AS d1,
         MAX(CASE WHEN a.day = date(p.cohort_day, '+7 day') THEN 1 ELSE 0 END) AS d7
  FROM p LEFT JOIN active_days a ON a.did = p.did
  GROUP BY p.did
)
SELECT CASE ftue_idx
         WHEN -1 THEN 'never started a run'
         WHEN 0 THEN '0 first_run' WHEN 1 THEN '1 first_wave_clear' WHEN 2 THEN '2 first_shop_buy'
         WHEN 3 THEN '3 first_boss_kill' WHEN 4 THEN '4 first_ride' WHEN 5 THEN '5 first_death'
         WHEN 6 THEN '6 first_share' WHEN 7 THEN '7 first_daily' WHEN 8 THEN '8 first_purchase' END AS furthest_milestone,
       COUNT(*)                                   AS players,
       ROUND(100.0 * SUM(d1) / COUNT(*), 1)       AS d1_retention_pct,
       ROUND(100.0 * SUM(d7) / COUNT(*), 1)       AS d7_retention_pct
FROM ret
GROUP BY ftue_idx
ORDER BY ftue_idx;

-- =====================================================================================================
-- 2a. Average ride result by ride kind  (the "stunt score vs chassis type" question for this game)
--     bonus = the stealth/clean bonus paid at the end of a ride, pay = cash banked, boosts = dashes used.
-- =====================================================================================================
SELECT json_extract(props, '$.kind')                                  AS ride_kind,
       json_extract(props, '$.road')                                  AS road,
       COUNT(*)                                                       AS rides,
       ROUND(AVG(json_extract(props, '$.bonus')), 1)                  AS avg_bonus,
       ROUND(AVG(json_extract(props, '$.pay')), 1)                    AS avg_pay,
       ROUND(AVG(json_extract(props, '$.kills')), 2)                  AS avg_kills,
       ROUND(100.0 * AVG(json_extract(props, '$.unseen')), 1)         AS clean_run_pct,
       ROUND(AVG(json_extract(props, '$.boosts')), 2)                 AS avg_boosts,
       ROUND(AVG(json_extract(props, '$.lives')), 2)                  AS avg_lives_left
FROM events
WHERE event = 'ride_end'
GROUP BY ride_kind, road
ORDER BY rides DESC;

-- =====================================================================================================
-- 2b. Average run by gun loadout  (which gun carries players furthest, picks = the upgrade list)
-- =====================================================================================================
SELECT gun,
       COUNT(*)                         AS runs,
       ROUND(AVG(wave), 2)              AS avg_wave,
       ROUND(AVG(score), 0)             AS avg_score,
       ROUND(AVG(secs) / 60.0, 1)       AS avg_minutes,
       ROUND(AVG(hits), 1)              AS avg_hits_taken,
       SUM(CASE WHEN wave >= 5 THEN 1 ELSE 0 END) * 100 / COUNT(*) AS reached_boss_pct
FROM runs
WHERE daily = 0 OR daily IS NULL
GROUP BY gun
ORDER BY avg_wave DESC;

-- =====================================================================================================
-- 3. Currency inflation per cohort
--    For each weekly cohort of new players: cash earned vs spent per run, and how much is left unspent
--    at death. A rising earned/spent ratio across cohorts (or rising cash_left) means the economy is
--    inflating: players earn faster than the shop can soak it up. Compare across game versions too.
-- =====================================================================================================
SELECT strftime('%Y-W%W', p.cohort_day)                               AS cohort_week,
       COUNT(DISTINCT r.did)                                          AS players,
       COUNT(*)                                                       AS runs,
       ROUND(AVG(r.cash_earned), 1)                                   AS avg_earned_per_run,
       ROUND(AVG(r.cash_spent), 1)                                    AS avg_spent_per_run,
       ROUND(AVG(r.cash_left), 1)                                     AS avg_unspent_at_death,
       ROUND(1.0 * SUM(r.cash_earned) / MAX(1, SUM(r.cash_spent)), 3) AS earned_over_spent,
       ROUND(1.0 * SUM(r.cash_earned) / MAX(1, SUM(r.wave)), 2)       AS earned_per_wave
FROM runs r JOIN players p ON p.did = r.did
GROUP BY cohort_week
ORDER BY cohort_week;

-- =====================================================================================================
-- 4. Shop funnel (real-money store): opened -> clicked buy -> verified by Stripe
-- =====================================================================================================
SELECT COUNT(DISTINCT CASE WHEN event = 'store_open'        THEN did END) AS opened_store,
       COUNT(DISTINCT CASE WHEN event = 'store_buy_click'   THEN did END) AS clicked_buy,
       COUNT(DISTINCT CASE WHEN event = 'purchase_verified' THEN did END) AS paid,
       SUM(CASE WHEN event = 'purchase_verified' THEN json_extract(props, '$.cents') ELSE 0 END) / 100.0 AS revenue
FROM events
WHERE ts >= (strftime('%s', 'now', '-30 days') * 1000);

-- =====================================================================================================
-- 5. Where players get hit (50 px grid), per city: the hotspot map
-- =====================================================================================================
SELECT json_extract(props, '$.city') AS city,
       json_extract(props, '$.x')    AS x,
       json_extract(props, '$.y')    AS y,
       COUNT(*)                      AS hits
FROM events
WHERE event = 'player_hit'
GROUP BY city, x, y
ORDER BY hits DESC
LIMIT 50;

-- =====================================================================================================
-- 6. Share rate: of the runs that ended, how many opened the share card and actually shared
-- =====================================================================================================
SELECT COUNT(DISTINCT CASE WHEN event = 'run_end'    THEN run_id END) AS runs_ended,
       COUNT(DISTINCT CASE WHEN event = 'share_open' THEN sid END)    AS sessions_opened_share,
       SUM(CASE WHEN event = 'share' AND json_extract(props, '$.method') = 'image' THEN 1 ELSE 0 END) AS image_shares,
       SUM(CASE WHEN event = 'share' AND json_extract(props, '$.method') = 'link'  THEN 1 ELSE 0 END) AS link_shares,
       SUM(CASE WHEN event = 'share' AND json_extract(props, '$.method') = 'copy'  THEN 1 ELSE 0 END) AS copies
FROM events;

-- =====================================================================================================
-- 7. Daily active devices and runs per day, last 30 days
-- =====================================================================================================
SELECT day, COUNT(DISTINCT did) AS dau,
       (SELECT COUNT(*) FROM runs r WHERE r.day = a.day) AS runs
FROM active_days a
WHERE day >= date('now', '-30 days')
GROUP BY day ORDER BY day;
