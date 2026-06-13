ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS advisor_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_select_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_select_max_symbols integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS drawdown_pause_pct numeric NOT NULL DEFAULT 3.0;

ALTER TABLE public.symbol_config
  ADD COLUMN IF NOT EXISTS auto_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_advisor_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_advisor_note text;

CREATE TABLE IF NOT EXISTS public.bot_advisor_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  decision jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_advisor_calls TO authenticated;
GRANT ALL ON public.bot_advisor_calls TO service_role;
ALTER TABLE public.bot_advisor_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own advisor calls select" ON public.bot_advisor_calls
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own advisor calls insert" ON public.bot_advisor_calls
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own advisor calls update" ON public.bot_advisor_calls
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own advisor calls delete" ON public.bot_advisor_calls
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS bot_advisor_calls_user_symbol_created_idx
  ON public.bot_advisor_calls (user_id, symbol, created_at DESC);