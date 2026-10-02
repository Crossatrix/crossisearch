DROP POLICY IF EXISTS "pages public read" ON public.pages;
DROP POLICY IF EXISTS "user_roles readable" ON public.user_roles;
DROP POLICY IF EXISTS "admin_emails readable" ON public.admin_emails;
DROP POLICY IF EXISTS "auth uploads to submissions" ON storage.objects;
DROP POLICY IF EXISTS "read submissions" ON storage.objects;