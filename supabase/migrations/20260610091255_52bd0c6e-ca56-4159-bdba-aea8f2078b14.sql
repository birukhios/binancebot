ALTER TABLE public.symbol_config
  ADD COLUMN IF NOT EXISTS auto_tune boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_order_size_usdt numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_order_size_usdt numeric NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS min_spacing_pct numeric NOT NULL DEFAULT 0.2,
  ADD COLUMN IF NOT EXISTS max_spacing_pct numeric NOT NULL DEFAULT 3.0,
  ADD COLUMN IF NOT EXISTS last_learned_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS learning_notes text;