
-- Extensions for scheduling and HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Single-row global bot config (shared across signed-in users)
CREATE TABLE public.bot_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_running BOOLEAN NOT NULL DEFAULT FALSE,
  testnet BOOLEAN NOT NULL DEFAULT TRUE,
  max_total_notional_usdt NUMERIC NOT NULL DEFAULT 500,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.bot_config TO authenticated;
GRANT ALL ON public.bot_config TO service_role;
ALTER TABLE public.bot_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read bot_config" ON public.bot_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth update bot_config" ON public.bot_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth insert bot_config" ON public.bot_config FOR INSERT TO authenticated WITH CHECK (true);

INSERT INTO public.bot_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Per-symbol configuration
CREATE TABLE public.symbol_config (
  symbol TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  grid_levels INT NOT NULL DEFAULT 5 CHECK (grid_levels BETWEEN 1 AND 20),
  grid_spacing_pct NUMERIC NOT NULL DEFAULT 0.5 CHECK (grid_spacing_pct > 0),
  order_size_usdt NUMERIC NOT NULL DEFAULT 20 CHECK (order_size_usdt > 0),
  leverage INT NOT NULL DEFAULT 5 CHECK (leverage BETWEEN 1 AND 20),
  upper_bound NUMERIC,
  lower_bound NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.symbol_config TO authenticated;
GRANT ALL ON public.symbol_config TO service_role;
ALTER TABLE public.symbol_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all symbol_config" ON public.symbol_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.symbol_config (symbol, leverage) VALUES
  ('BTCUSDT', 5),
  ('ETHUSDT', 5),
  ('BNBUSDT', 5),
  ('BCHUSDT', 5),
  ('DOGEUSDT', 3),
  ('ETCUSDT', 3)
ON CONFLICT DO NOTHING;

-- Open grid orders the bot is tracking
CREATE TABLE public.grid_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  price NUMERIC NOT NULL,
  qty NUMERIC NOT NULL,
  binance_order_id BIGINT,
  client_order_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'NEW',
  level_index INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX grid_orders_symbol_status_idx ON public.grid_orders(symbol, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grid_orders TO authenticated;
GRANT ALL ON public.grid_orders TO service_role;
ALTER TABLE public.grid_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read grid_orders" ON public.grid_orders FOR SELECT TO authenticated USING (true);

-- Executed trades / fills
CREATE TABLE public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  price NUMERIC NOT NULL,
  qty NUMERIC NOT NULL,
  realized_pnl NUMERIC NOT NULL DEFAULT 0,
  commission NUMERIC NOT NULL DEFAULT 0,
  binance_order_id BIGINT,
  binance_trade_id BIGINT UNIQUE,
  filled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trades_filled_at_idx ON public.trades(filled_at DESC);
GRANT SELECT ON public.trades TO authenticated;
GRANT ALL ON public.trades TO service_role;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read trades" ON public.trades FOR SELECT TO authenticated USING (true);

-- Bot activity logs
CREATE TABLE public.bot_logs (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  symbol TEXT,
  message TEXT NOT NULL,
  context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bot_logs_created_at_idx ON public.bot_logs(created_at DESC);
GRANT SELECT ON public.bot_logs TO authenticated;
GRANT ALL ON public.bot_logs TO service_role;
ALTER TABLE public.bot_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read logs" ON public.bot_logs FOR SELECT TO authenticated USING (true);
