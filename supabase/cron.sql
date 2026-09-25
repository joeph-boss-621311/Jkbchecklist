-- Schedules the daily briefing. Run once in the SQL Editor after deploying
-- the daily-briefing function and setting its secrets (CRON_SECRET especially
-- must match what you put in Edge Functions -> Secrets).
--
-- Replace <CRON_SECRET> below with the real value before running.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'atlas-morning-briefing',
  '0 7 * * *', -- 7am UTC = 8am WAT
  $$
  select net.http_post(
    url := 'https://nbgmegpqxzvgvtqqlvko.supabase.co/functions/v1/daily-briefing',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := jsonb_build_object('kind', 'morning')
  );
  $$
);

select cron.schedule(
  'atlas-evening-review',
  '0 19 * * *', -- 7pm UTC = 8pm WAT
  $$
  select net.http_post(
    url := 'https://nbgmegpqxzvgvtqqlvko.supabase.co/functions/v1/daily-briefing',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := jsonb_build_object('kind', 'evening')
  );
  $$
);

-- To check what's scheduled: select * from cron.job;
-- To unschedule: select cron.unschedule('atlas-morning-briefing');
