-- Publishers can disable the visitor developer console for their whole domain.
ALTER TABLE public.cnet_domains
  ADD COLUMN IF NOT EXISTS console_disabled boolean NOT NULL DEFAULT false;
