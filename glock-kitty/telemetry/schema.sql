-- Flock Kitty telemetry · Cloudflare D1 schema
-- Apply once:  npx wrangler d1 execute flockkitty-telemetry --remote --file=telemetry/schema.sql
--
-- One append-only table. Every event is one row; event-specific fields live in `props` (JSON text)
-- and are read with json_extract(). Keeping one table means a new event needs no migration.

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,            -- "<sid>:<seq>" from the client, or "stripe:<session>" for server-stamped purchases
  received_at INTEGER NOT NULL,            -- server clock, ms since epoch (trusted)
  ts          INTEGER NOT NULL,            -- client clock, ms since epoch, clamped to within a day of received_at
  did         TEXT NOT NULL,               -- anonymous device id (random uuid in localStorage; no account, no IP)
  sid         TEXT NOT NULL,               -- session id (random uuid per page load)
  run_id      TEXT,                        -- run id (random uuid per run), NULL outside a run
  event       TEXT NOT NULL,               -- allow-listed event name, see TELEMETRY.md
  seq         INTEGER NOT NULL,            -- client sequence number within the session (gaps = dropped events)
  country     TEXT,                        -- ISO country from Cloudflare's edge (request.cf.country)
  device      TEXT,                        -- phone | tablet | desktop
  platform    TEXT,                        -- ios | android | windows | mac | chromeos | linux | unknown
  version     INTEGER,                     -- game build number (34 = first build that sends telemetry)
  ctx         TEXT,                        -- JSON: viewport w/h, dpr, language
  props       TEXT NOT NULL DEFAULT '{}'   -- JSON: the event's own fields
);

CREATE INDEX IF NOT EXISTS events_event_ts  ON events (event, ts);
CREATE INDEX IF NOT EXISTS events_did_ts    ON events (did, ts);
CREATE INDEX IF NOT EXISTS events_run       ON events (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_received  ON events (received_at);

-- Convenience views -----------------------------------------------------------------------------

-- one row per device: first day seen (its cohort) and the furthest FTUE milestone it ever reached
CREATE VIEW IF NOT EXISTS players AS
SELECT did,
       MIN(date(ts / 1000, 'unixepoch')) AS cohort_day,
       MIN(ts)                            AS first_ts,
       MAX(CASE WHEN event = 'ftue_step' THEN json_extract(props, '$.index') END) AS ftue_max_index,
       COUNT(DISTINCT sid)                AS sessions,
       COUNT(DISTINCT run_id)             AS runs
FROM events
GROUP BY did;

-- one row per finished run, with the fields the economy and balance queries need
CREATE VIEW IF NOT EXISTS runs AS
SELECT run_id, did, sid, ts AS ended_ts, date(ts / 1000, 'unixepoch') AS day,
       json_extract(props, '$.score')       AS score,
       json_extract(props, '$.wave')        AS wave,
       json_extract(props, '$.kills')       AS kills,
       json_extract(props, '$.secs')        AS secs,
       json_extract(props, '$.daily')       AS daily,
       json_extract(props, '$.diff')        AS diff,
       json_extract(props, '$.gun')         AS gun,
       json_extract(props, '$.picks')       AS picks,
       json_extract(props, '$.cash_earned') AS cash_earned,
       json_extract(props, '$.cash_spent')  AS cash_spent,
       json_extract(props, '$.cash_left')   AS cash_left,
       json_extract(props, '$.hits')        AS hits,
       json_extract(props, '$.city')        AS city,
       json_extract(props, '$.in_ride')     AS in_ride
FROM events
WHERE event = 'run_end' AND run_id IS NOT NULL;

-- active days per device, the unit of retention
CREATE VIEW IF NOT EXISTS active_days AS
SELECT DISTINCT did, date(ts / 1000, 'unixepoch') AS day FROM events;
