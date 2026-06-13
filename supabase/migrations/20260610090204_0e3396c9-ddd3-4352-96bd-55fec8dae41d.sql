
-- 1) user_binance_creds
CREATE TABLE public.user_binance_creds (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key text,
  api_secret text,
  testnet_api_key text,
  testnet_api_secret text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_binance_creds TO authenticated;
GRANT ALL ON public.user_binance_creds TO service_role;
ALTER TABLE public.user_binance_creds ENABLE ROW LEVEL SECURITY;
-- Deny all client access; only server-side admin client reads/writes
CREATE POLICY "deny client select" ON public.user_binance_creds FOR SELECT USING (false);
CREATE POLICY "deny client modify" ON public.user_binance_creds FOR ALL USING (false) WITH CHECK (false);

-- 2) Add user_id columns
ALTER TABLE public.bot_config    ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.symbol_config ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.grid_orders   ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.trades        ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.bot_logs      ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3) Backfill to original owner
UPDATE public.bot_config    SET user_id = '766ced41-29ab-4304-9497-800a95bb7530' WHERE user_id IS NULL;
UPDATE public.symbol_config SET user_id = '766ced41-29ab-4304-9497-800a95bb7530' WHERE user_id IS NULL;
UPDATE public.grid_orders   SET user_id = '766ced41-29ab-4304-9497-800a95bb7530' WHERE user_id IS NULL;
UPDATE public.trades        SET user_id = '766ced41-29ab-4304-9497-800a95bb7530' WHERE user_id IS NULL;
UPDATE public.bot_logs      SET user_id = '766ced41-29ab-4304-9497-800a95bb7530' WHERE user_id IS NULL;

-- 4) NOT NULL + reshape PKs
ALTER TABLE public.bot_config    ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.symbol_config ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.grid_orders   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.trades        ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.bot_logs      ALTER COLUMN user_id SET NOT NULL;

-- bot_config: drop singleton id PK -> user_id PK
ALTER TABLE public.bot_config DROP CONSTRAINT IF EXISTS bot_config_pkey;
ALTER TABLE public.bot_config DROP COLUMN IF EXISTS id;
ALTER TABLE public.bot_config ADD PRIMARY KEY (user_id);

-- symbol_config: composite uniqueness (user_id, symbol)
ALTER TABLE public.symbol_config DROP CONSTRAINT IF EXISTS symbol_config_pkey;
ALTER TABLE public.symbol_config ADD PRIMARY KEY (user_id, symbol);

CREATE INDEX IF NOT EXISTS grid_orders_user_idx ON public.grid_orders(user_id);
CREATE INDEX IF NOT EXISTS trades_user_idx      ON public.trades(user_id);
CREATE INDEX IF NOT EXISTS bot_logs_user_idx    ON public.bot_logs(user_id);

-- 5) Replace permissive policies with user-scoped ones
DROP POLICY IF EXISTS "auth insert bot_config" ON public.bot_config;
DROP POLICY IF EXISTS "auth read bot_config"   ON public.bot_config;
DROP POLICY IF EXISTS "auth update bot_config" ON public.bot_config;
CREATE POLICY "own select" ON public.bot_config FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.bot_config FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update" ON public.bot_config FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "auth all symbol_config" ON public.symbol_config;
CREATE POLICY "own all symbol_config" ON public.symbol_config FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "auth read grid_orders" ON public.grid_orders;
CREATE POLICY "own read grid_orders" ON public.grid_orders FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "auth read trades" ON public.trades;
CREATE POLICY "own read trades" ON public.trades FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "auth read logs" ON public.bot_logs;
CREATE POLICY "own read logs" ON public.bot_logs FOR SELECT USING (auth.uid() = user_id);

-- 6) Auto-provision new users
CREATE OR REPLACE FUNCTION public.provision_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.bot_config (user_id, max_total_notional_usdt, testnet, is_running)
  VALUES (NEW.id, 500, true, false)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.symbol_config (user_id, symbol, enabled, grid_levels, grid_spacing_pct, order_size_usdt, leverage)
  VALUES
    (NEW.id, 'BTCUSDT',  false, 5, 0.5, 20, 5),
    (NEW.id, 'ETHUSDT',  false, 5, 0.5, 20, 5),
    (NEW.id, 'BNBUSDT',  false, 5, 0.5, 20, 5),
    (NEW.id, 'DOGEUSDT', false, 5, 0.5, 20, 5),
    (NEW.id, 'BCHUSDT',  false, 5, 0.5, 20, 5),
    (NEW.id, 'ETCUSDT',  false, 5, 0.5, 20, 5)
  ON CONFLICT (user_id, symbol) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_provision ON auth.users;
CREATE TRIGGER on_auth_user_created_provision
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.provision_new_user();

-- Ensure the already-existing second user has a bot_config + default symbols
INSERT INTO public.bot_config (user_id, max_total_notional_usdt, testnet, is_running)
SELECT u.id, 500, true, false FROM auth.users u
WHERE u.id <> '766ced41-29ab-4304-9497-800a95bb7530'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.symbol_config (user_id, symbol, enabled, grid_levels, grid_spacing_pct, order_size_usdt, leverage)
SELECT u.id, s.symbol, false, 5, 0.5, 20, 5
FROM auth.users u
CROSS JOIN (VALUES ('BTCUSDT'),('ETHUSDT'),('BNBUSDT'),('DOGEUSDT'),('BCHUSDT'),('ETCUSDT')) s(symbol)
WHERE u.id <> '766ced41-29ab-4304-9497-800a95bb7530'
ON CONFLICT (user_id, symbol) DO NOTHING;
