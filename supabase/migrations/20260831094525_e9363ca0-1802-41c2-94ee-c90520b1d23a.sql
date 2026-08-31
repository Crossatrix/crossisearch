CREATE TABLE public.api_key_usage (
  key_id UUID NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day)
);
GRANT ALL ON public.api_key_usage TO service_role;
ALTER TABLE public.api_key_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.track_api_key_usage(_key_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.api_key_usage (key_id, day, requests)
  VALUES (_key_id, CURRENT_DATE, 1)
  ON CONFLICT (key_id, day)
  DO UPDATE SET requests = api_key_usage.requests + 1;
END;
$$;