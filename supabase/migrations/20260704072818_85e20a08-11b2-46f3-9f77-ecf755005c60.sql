
-- Columns for rate limiting and plan
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS daily_limit integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS requests_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_day date NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;

-- Fast lookup by hash (validateApiKey hot path)
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_uidx ON public.api_keys (key_hash);

-- Atomic validate + consume: single roundtrip.
-- Returns one row on success; empty result set on invalid/revoked/over-limit.
CREATE OR REPLACE FUNCTION public.consume_api_key(_hash text)
RETURNS TABLE (
  id uuid,
  created_by text,
  plan text,
  daily_limit integer,
  requests_today integer,
  remaining integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k record;
  effective_limit integer;
  effective_plan text;
BEGIN
  SELECT * INTO k FROM public.api_keys WHERE key_hash = _hash;
  IF NOT FOUND OR k.revoked_at IS NOT NULL THEN
    RETURN;
  END IF;

  -- Expire paid plan back to free after 30 days
  IF k.plan <> 'free' AND k.plan_expires_at IS NOT NULL AND k.plan_expires_at < now() THEN
    effective_plan := 'free';
    effective_limit := 50;
  ELSE
    effective_plan := k.plan;
    effective_limit := k.daily_limit;
  END IF;

  -- Reset counter on new day
  IF k.usage_day <> current_date THEN
    k.requests_today := 0;
  END IF;

  -- Enforce daily limit (-1 = infinite / enterprise)
  IF effective_limit >= 0 AND k.requests_today >= effective_limit THEN
    RETURN;
  END IF;

  UPDATE public.api_keys
     SET requests_today = k.requests_today + 1,
         usage_day = current_date,
         last_used_at = now(),
         plan = effective_plan,
         daily_limit = effective_limit
   WHERE api_keys.id = k.id;

  id := k.id;
  created_by := k.created_by;
  plan := effective_plan;
  daily_limit := effective_limit;
  requests_today := k.requests_today + 1;
  remaining := CASE WHEN effective_limit < 0 THEN -1 ELSE effective_limit - (k.requests_today + 1) END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_api_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_key(text) TO service_role;
