
CREATE TABLE public.symbol_locks (
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, symbol)
);
GRANT ALL ON public.symbol_locks TO service_role;
ALTER TABLE public.symbol_locks ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (which bypasses RLS) may access.
