
CREATE OR REPLACE FUNCTION public.search_pages_fuzzy(
  q text,
  kind_filter text DEFAULT NULL,
  max_results integer DEFAULT 30
)
RETURNS TABLE (
  id uuid, url text, title text, description text, content text,
  kind text, mime_type text, file_kind text, storage_path text,
  created_at timestamptz, score real
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
  WITH params AS (SELECT public.crossi_normalize_search_text(q) AS qn)
  SELECT
    p.id, p.url, p.title, p.description, p.content,
    p.kind, p.mime_type, p.file_kind, p.storage_path, p.created_at,
    GREATEST(
      word_similarity(
        params.qn,
        public.crossi_normalize_search_text(
          coalesce(p.title, '') || ' ' || coalesce(p.url, '') || ' ' || coalesce(p.description, '')
        )
      ),
      CASE WHEN public.crossi_normalize_search_text(
        coalesce(p.title, '') || ' ' || coalesce(p.url, '') || ' ' || coalesce(p.description, '')
      ) ILIKE '%' || params.qn || '%' THEN 0.9 ELSE 0 END
    )::real AS score
  FROM public.pages p, params
  WHERE params.qn <> ''
    AND (kind_filter IS NULL OR p.kind = kind_filter)
    AND (
      public.crossi_normalize_search_text(
        coalesce(p.title, '') || ' ' || coalesce(p.url, '') || ' ' || coalesce(p.description, '')
      ) ILIKE '%' || params.qn || '%'
      OR params.qn <% public.crossi_normalize_search_text(
        coalesce(p.title, '') || ' ' || coalesce(p.url, '') || ' ' || coalesce(p.description, '')
      )
    )
  ORDER BY score DESC, p.created_at DESC
  LIMIT max_results;
$$;
