
CREATE POLICY "own delete bot_config" ON public.bot_config FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "own insert bot_logs" ON public.bot_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update bot_logs" ON public.bot_logs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own delete bot_logs" ON public.bot_logs FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "own insert grid_orders" ON public.grid_orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update grid_orders" ON public.grid_orders FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own delete grid_orders" ON public.grid_orders FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "own insert trades" ON public.trades FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update trades" ON public.trades FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own delete trades" ON public.trades FOR DELETE USING (auth.uid() = user_id);
