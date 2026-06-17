CREATE OR REPLACE FUNCTION public.crossi_normalize_search_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        lower(coalesce(input, '')),
        '[^[:alnum:][:space:]]+',
        '',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.crossi_normalize_search_text(text) TO anon, authenticated, service_role;

DROP INDEX IF EXISTS public.pages_fts_idx;
DROP INDEX IF EXISTS public.pages_title_trgm_idx;
DROP INDEX IF EXISTS public.pages_url_trgm_idx;
DROP INDEX IF EXISTS public.pages_description_trgm_idx;

CREATE INDEX IF NOT EXISTS pages_search_norm_trgm_idx
ON public.pages
USING gin (
  public.crossi_normalize_search_text(
    coalesce(title, '') || ' ' || coalesce(url, '') || ' ' || coalesce(description, '')
  ) gin_trgm_ops
);

CREATE OR REPLACE FUNCTION public.search_pages_fuzzy(
  q text,
  kind_filter text DEFAULT NULL,
  max_results int DEFAULT 60
)
RETURNS TABLE (
  id uuid,
  url text,
  title text,
  description text,
  content text,
  kind text,
  mime_type text,
  file_kind text,
  storage_path text,
  created_at timestamptz,
  score real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT public.crossi_normalize_search_text(q) AS qn
  ),
  candidates AS (
    SELECT
      p.*,
      public.crossi_normalize_search_text(coalesce(p.title, '')) AS nt,
      public.crossi_normalize_search_text(coalesce(p.url, '')) AS nu,
      public.crossi_normalize_search_text(coalesce(p.description, '')) AS nd,
      public.crossi_normalize_search_text(
        coalesce(p.title, '') || ' ' || coalesce(p.url, '') || ' ' || coalesce(p.description, '')
      ) AS ns
    FROM public.pages p, params
    WHERE params.qn <> ''
      AND (kind_filter IS NULL OR p.kind = kind_filter)
      AND (
        public.crossi_normalize_search_text(
          coalesce(p.title, '') || ' ' || coalesce(p.url, '') || ' ' || coalesce(p.description, '')
        ) % params.qn
        OR public.crossi_normalize_search_text(
          coalesce(p.title, '') || ' ' || coalesce(p.url, '') || ' ' || coalesce(p.description, '')
        ) ILIKE '%' || params.qn || '%'
      )
    ORDER BY similarity(
      public.crossi_normalize_search_text(
        coalesce(p.title, '') || ' ' || coalesce(p.url, '') || ' ' || coalesce(p.description, '')
      ),
      params.qn
    ) DESC, p.created_at DESC
    LIMIT greatest(max_results * 4, max_results)
  ),
  scored AS (
    SELECT
      c.id, c.url, c.title, c.description, c.content, c.kind,
      c.mime_type, c.file_kind, c.storage_path, c.created_at,
      GREATEST(
        similarity(c.nt, (SELECT qn FROM params)),
        similarity(c.nu, (SELECT qn FROM params)) * 0.9,
        similarity(c.nd, (SELECT qn FROM params)) * 0.6,
        word_similarity((SELECT qn FROM params), c.nt) * 0.95,
        CASE WHEN c.nt ILIKE '%' || (SELECT qn FROM params) || '%' THEN 0.85 ELSE 0 END,
        CASE WHEN c.nu ILIKE '%' || (SELECT qn FROM params) || '%' THEN 0.8 ELSE 0 END
      )::real AS score
    FROM candidates c
  )
  SELECT * FROM scored
  WHERE score > 0.15
  ORDER BY score DESC, created_at DESC
  LIMIT max_results;
$$;

GRANT EXECUTE ON FUNCTION public.search_pages_fuzzy(text, text, int) TO anon, authenticated, service_role;