
ALTER TABLE public.symbol_config
  ADD COLUMN IF NOT EXISTS trend_filter_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS trend_ema_period integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trend_interval text NOT NULL DEFAULT '1h';
