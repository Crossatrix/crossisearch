
CREATE TABLE public.pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  description TEXT,
  content TEXT,
  source_sitemap TEXT,
  submitted_by TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('page','file')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pages_fts_idx ON public.pages USING GIN (
  to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(content,''))
);

GRANT SELECT ON public.pages TO anon, authenticated;
GRANT ALL ON public.pages TO service_role;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pages public read" ON public.pages FOR SELECT USING (true);

CREATE TABLE public.submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL,
  croins_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX submissions_user_day_idx ON public.submissions (user_id, created_at);

GRANT ALL ON public.submissions TO service_role;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
-- no policies; only service_role (server functions) writes/reads
