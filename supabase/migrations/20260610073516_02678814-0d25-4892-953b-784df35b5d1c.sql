ALTER TABLE public.symbol_config
  ADD COLUMN IF NOT EXISTS backtest_pnl NUMERIC,
  ADD COLUMN IF NOT EXISTS backtest_max_drawdown NUMERIC,
  ADD COLUMN IF NOT EXISTS backtest_fills INTEGER,
  ADD COLUMN IF NOT EXISTS backtest_return_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS backtest_at TIMESTAMPTZ;