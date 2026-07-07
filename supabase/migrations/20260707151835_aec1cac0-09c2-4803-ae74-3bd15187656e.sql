
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'read'
  CHECK (scope IN ('read','write'));

DROP FUNCTION IF EXISTS public.consume_api_key(text);

CREATE OR REPLACE FUNCTION public.consume_api_key(_hash text)
 RETURNS TABLE(id uuid, created_by text, plan text, daily_limit integer, requests_today integer, remaining integer, scope text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k record;
  effective_limit integer;
  effective_plan text;
BEGIN
  SELECT * INTO k FROM public.api_keys WHERE key_hash = _hash;
  IF NOT FOUND OR k.revoked_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF k.scope = 'write' THEN
    UPDATE public.api_keys SET last_used_at = now() WHERE api_keys.id = k.id;
    id := k.id;
    created_by := k.created_by;
    plan := k.plan;
    daily_limit := -1;
    requests_today := 0;
    remaining := -1;
    scope := 'write';
    RETURN NEXT;
    RETURN;
  END IF;

  IF k.plan <> 'free' AND k.plan_expires_at IS NOT NULL AND k.plan_expires_at < now() THEN
    effective_plan := 'free';
    effective_limit := 50;
  ELSE
    effective_plan := k.plan;
    effective_limit := k.daily_limit;
  END IF;

  IF k.usage_day <> current_date THEN
    k.requests_today := 0;
  END IF;

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
  scope := 'read';
  RETURN NEXT;
END;
$function$;
