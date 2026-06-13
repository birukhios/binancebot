ALTER TABLE public.symbol_config
  ADD COLUMN IF NOT EXISTS stop_loss_roi_pct numeric NOT NULL DEFAULT -50,
  ADD COLUMN IF NOT EXISTS max_position_age_minutes integer NOT NULL DEFAULT 0;