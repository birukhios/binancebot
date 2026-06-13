ALTER TABLE public.symbol_config
  ADD COLUMN IF NOT EXISTS extreme_loss_threshold_usdt numeric NOT NULL DEFAULT -10,
  ADD COLUMN IF NOT EXISTS extreme_loss_cooldown_min integer NOT NULL DEFAULT 60;