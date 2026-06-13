## Changes

### 1. File uploads (no URL required)
- Create a public Storage bucket `submissions` for user-uploaded files.
- On `/submit`, when type = **File**: replace the URL input with a file picker. Upload directly from the browser to the bucket using the authenticated Supabase client, then call `submitUrl` with the resulting public URL + original filename.
- Server `submitUrl` (file branch): fetch the uploaded file, extract text (plain text / readable formats), and index with `kind = "file"`, storing the filename as the title.
- Pages keep the current URL flow unchanged.

### 2. Separate file search
- Add tabs on `/search`: **Web** (kind = page) and **Files** (kind = file). AI overview stays on the Web tab only.
- `searchPages` accepts an optional `kind` filter; the Files tab renders results as a file list (filename, type, download link) instead of web snippets.

### 3. Remove daily submission cap
- Drop the 20/day check in `submitUrl`.
- Remove `getDailyCap` usage and the "Today: x/20" UI from `/submit`.

### 4. Prevent duplicate submissions
- Add a unique index on `pages.url` (already effectively unique via upsert; enforce with a real unique constraint).
- Before indexing, check if the URL already exists in `pages`. If yes → return `{ error: "Already submitted" }` and award no Croins. Applies to both pages and files (file dedupe keyed on uploaded file URL, so the same file uploaded twice = duplicate).
- For page submissions that pull in a sitemap: only count/award if at least one *new* page was indexed; skip already-indexed locs silently.

### Technical notes
- Bucket: `submissions`, public read, authenticated insert (RLS on `storage.objects`).
- Migration: `ALTER TABLE pages ADD CONSTRAINT pages_url_unique UNIQUE (url);` (safe — upsert already dedupes by url).
- No schema change to `submissions` table; we just stop writing a row when duplicate.
- Croin reward unchanged: 100 page / 50 file, only on first successful index.
