CREATE TABLE public.cnet_tlds (tld text PRIMARY KEY, price_croins integer NOT NULL DEFAULT 100, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.cnet_tlds TO service_role;
ALTER TABLE public.cnet_tlds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cnet_tlds backend only" ON public.cnet_tlds FOR ALL USING (false) WITH CHECK (false);

CREATE TABLE public.cnet_domains (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), domain text NOT NULL UNIQUE, tld text NOT NULL REFERENCES public.cnet_tlds(tld) ON DELETE CASCADE, owner_id text NOT NULL, owner_email text, created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.cnet_domains TO service_role;
ALTER TABLE public.cnet_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cnet_domains backend only" ON public.cnet_domains FOR ALL USING (false) WITH CHECK (false);
CREATE INDEX cnet_domains_owner_idx ON public.cnet_domains(owner_id);

CREATE TABLE public.cnet_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), domain_id uuid NOT NULL REFERENCES public.cnet_domains(id) ON DELETE CASCADE, host text NOT NULL, path text NOT NULL, content text NOT NULL DEFAULT '', title text, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(host, path));
GRANT ALL ON public.cnet_files TO service_role;
ALTER TABLE public.cnet_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cnet_files backend only" ON public.cnet_files FOR ALL USING (false) WITH CHECK (false);

INSERT INTO public.cnet_tlds (tld, price_croins, created_by) VALUES ('cat', 100, 'system');
INSERT INTO public.cnet_domains (domain, tld, owner_id) VALUES ('domain.cat', 'cat', 'system');