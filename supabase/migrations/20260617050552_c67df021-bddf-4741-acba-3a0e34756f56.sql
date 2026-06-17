CREATE POLICY "admin_logs backend only"
ON public.admin_logs
FOR ALL
TO public
USING (false)
WITH CHECK (false);

CREATE POLICY "api_keys backend only"
ON public.api_keys
FOR ALL
TO public
USING (false)
WITH CHECK (false);

CREATE POLICY "submissions backend only"
ON public.submissions
FOR ALL
TO public
USING (false)
WITH CHECK (false);