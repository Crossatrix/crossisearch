
CREATE INDEX IF NOT EXISTS pages_title_trgm_idx ON public.pages USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pages_url_trgm_idx ON public.pages USING gin (url gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pages_description_trgm_idx ON public.pages USING gin (description gin_trgm_ops);

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
  WITH params AS (SELECT lower(btrim(q)) AS qn),
  scored AS (
    SELECT
      p.id, p.url, p.title, p.description, p.content, p.kind,
      p.mime_type, p.file_kind, p.storage_path, p.created_at,
      GREATEST(
        similarity(lower(coalesce(p.title,'')), (SELECT qn FROM params)),
        similarity(lower(coalesce(p.url,'')), (SELECT qn FROM params)) * 0.9,
        similarity(lower(coalesce(p.description,'')), (SELECT qn FROM params)) * 0.6,
        word_similarity((SELECT qn FROM params), lower(coalesce(p.title,''))) * 0.95
      )::real AS score
    FROM public.pages p
    WHERE (kind_filter IS NULL OR p.kind = kind_filter)
      AND (
        lower(coalesce(p.title,'')) % (SELECT qn FROM params)
        OR lower(coalesce(p.url,'')) % (SELECT qn FROM params)
        OR lower(coalesce(p.description,'')) % (SELECT qn FROM params)
        OR (SELECT qn FROM params) <% lower(coalesce(p.title,''))
        OR lower(coalesce(p.title,'')) ILIKE '%' || (SELECT qn FROM params) || '%'
        OR lower(coalesce(p.url,'')) ILIKE '%' || (SELECT qn FROM params) || '%'
      )
  )
  SELECT * FROM scored
  WHERE score > 0.15
  ORDER BY score DESC, created_at DESC
  LIMIT max_results;
$$;

GRANT EXECUTE ON FUNCTION public.search_pages_fuzzy(text, text, int) TO anon, authenticated, service_role;
