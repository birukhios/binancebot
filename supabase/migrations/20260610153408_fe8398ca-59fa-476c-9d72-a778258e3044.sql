DO $$
BEGIN
  PERFORM cron.unschedule('bot-tick-every-minute');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'bot-tick-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--514efe6b-44ed-4f38-9544-193e7028fd24-dev.lovable.app/api/public/bot-tick',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_sJwCoqnDOZXvGkyO2R4nuA_dQanxTnq"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);