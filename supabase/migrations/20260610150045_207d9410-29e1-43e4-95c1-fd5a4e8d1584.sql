ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS news_pause_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS news_pause_window_min integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS news_currencies text NOT NULL DEFAULT 'USD';