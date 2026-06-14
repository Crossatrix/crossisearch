## 1. File uploads (any type)

- `/submit` file form: add an optional **Custom filename** text input (defaults to original filename). Accept any file type — no client-side text-only restriction.
- Upload the raw bytes to the `submissions` bucket as today.
- Add `mime_type` and `file_kind` columns to `pages` (`file_kind` ∈ `image | text | other`).
- Server `submitUrl` (file branch):
  - Detect category from the file's MIME / extension.
  - **text** (txt, md, csv, json, html, xml): extract text as today.
  - **image** (png, jpg, jpeg, gif, webp, svg): no text extraction; store mime + custom name.
  - **other** (pdf, docx, zip, exe, …): no text extraction; store mime + custom name only. (No PDF parsing — keeps it simple and matches your "just name + download" requirement.)
- `searchPages` returns `mime_type` and `file_kind` for file results.
- `/search` Files tab:
  - **Images** render as a small grid of thumbnails (signed URL as `<img src>`) with filename caption.
  - **Text/other** render as a row: filename + type badge + Download button (signed URL).

## 2. URL validation (ping the site)

Replace the current "stub fallback" behavior for page submissions:

- Before indexing, do a `HEAD` request (fallback to `GET` if HEAD is rejected) to the submitted URL with `redirect: "follow"` and a 10s timeout.
- If the fetch throws (DNS failure, connection refused, timeout) → reject: `"This site doesn't seem to exist or isn't reachable."`
- If it responds with any status (even 403 from a bot block) → accept and proceed. If the page body can be fetched, index it normally; if blocked, fall back to a stub entry (hostname/title) so bot-protected sites like microsoft.com still work.
- Same check runs once per submitted URL only (not for every sitemap entry).

## 3. Admin role + delete

- Migration:
  - `CREATE TYPE public.app_role AS ENUM ('admin', 'user');`
  - `CREATE TABLE public.user_roles (id uuid pk, user_id text not null, role app_role not null, unique(user_id, role))` — `user_id` is text because Crossatrix IDs are external strings, not `auth.users` UUIDs.
  - GRANTs + RLS + `has_role(text, app_role)` security-definer function.
  - Seed the owner: insert an `admin` row for the Crossatrix user whose email is `cross.a.trix.owner@hotmail.com`. Since we don't store emails locally, the admin row is keyed by their Crossatrix `user_id` — on first sign-in of that email, a server fn auto-grants admin (lookup by email against the Crossatrix auth function, then upsert into `user_roles`).
- New server fns:
  - `isAdmin({ user_id })` → boolean.
  - `deletePage({ user_id, page_id })` — verifies admin, deletes from `pages` (and from storage if it's a file).
- UI: on `/search`, if `isAdmin` is true for the current session, each result card shows a small **Delete** button.

## 4. Admin-only submission API

- Migration: `api_keys` table — `id`, `key_hash` (sha256), `label`, `created_by` (admin user_id), `created_at`, `last_used_at`, `revoked_at`. GRANT only `service_role`; no RLS-exposed reads.
- Server fns (admin-gated):
  - `listApiKeys` — returns metadata only (label, created, last used, revoked) — **never the key**.
  - `createApiKey({ label })` — generates a random 32-byte key, stores its sha256, **returns the plaintext exactly once** in the response so the admin can copy it. Subsequent reads only show the hash metadata.
  - `revokeApiKey({ id })`.
- New route `/admin` (admin-only): UI to mint / list / revoke keys. Plaintext key is shown in a one-time modal with a copy button and a warning that it won't be shown again.
- New public HTTP endpoint `src/routes/api/public/submit.ts`:
  - Accepts `POST` with header `x-api-key: <key>` and JSON body:
    - `{ "kind": "page", "url": "..." }`, or
    - `{ "kind": "file", "filename": "...", "mime_type": "...", "content_base64": "..." }`
  - Validates the key (sha256 lookup, not revoked), updates `last_used_at`.
  - Reuses the same indexing logic as `submitUrl` (URL ping for pages; for files, decode base64 → upload to bucket → index).
  - No Croins awarded (system submission).
  - Returns `{ success, indexed }` or `{ error }`. CORS enabled.
- API keys never appear anywhere on the public site — only in the `/admin` route for admins.

## Technical notes

- Croin reward unchanged for human submissions (100 page / 50 file). API submissions: 0.
- File category detection uses `file.type` + extension fallback.
- Existing `pages` rows get `mime_type = null`, `file_kind = 'text'` by default (back-compat).
- Storage delete uses `supabaseAdmin.storage.from('submissions').remove([path])` when a file row is deleted.
- The owner auto-grant runs once on login via a new `ensureAdminOnLogin` server fn called from `/auth` after a successful Crossatrix login.
