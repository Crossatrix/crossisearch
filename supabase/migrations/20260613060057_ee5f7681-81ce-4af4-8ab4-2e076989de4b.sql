
ALTER TABLE public.pages ADD CONSTRAINT pages_url_unique UNIQUE (url);

CREATE POLICY "auth uploads to submissions" ON storage.objects
  FOR INSERT TO authenticated, anon
  WITH CHECK (bucket_id = 'submissions');

CREATE POLICY "read submissions" ON storage.objects
  FOR SELECT TO authenticated, anon
  USING (bucket_id = 'submissions');
