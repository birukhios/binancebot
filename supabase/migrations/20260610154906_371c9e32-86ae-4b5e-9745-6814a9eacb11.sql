ALTER TABLE public.symbol_config
  ADD COLUMN IF NOT EXISTS funding_filter_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS funding_max_abs_bps numeric NOT NULL DEFAULT 10;