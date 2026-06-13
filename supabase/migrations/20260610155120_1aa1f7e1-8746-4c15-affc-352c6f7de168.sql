ALTER TABLE public.symbol_config
  ADD COLUMN IF NOT EXISTS z_filter_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS z_lookback integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS z_interval text NOT NULL DEFAULT '1h',
  ADD COLUMN IF NOT EXISTS z_entry_threshold numeric NOT NULL DEFAULT 1.5;