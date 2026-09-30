CREATE TABLE public.cnet_browser_state (
  user_id text PRIMARY KEY,
  tabs jsonb NOT NULL DEFAULT '[]'::jsonb,
  favorites jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_index integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.cnet_browser_state TO service_role;
ALTER TABLE public.cnet_browser_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cnet_browser_state backend only" ON public.cnet_browser_state FOR ALL USING (false) WITH CHECK (false);