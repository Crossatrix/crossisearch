## Crossi Search — Build Plan

A Google-style web search where the index is built only from user-submitted sitemaps and files. Crossatrix login, croin rewards per submission (with a daily cap), AI overview via Crossi 5.1 Lite.

### Stack
- TanStack Start (existing template)
- Lovable Cloud (Supabase) for the search index + submission tracking
- Server functions for all external API calls (Crossatrix, Crossi AI, croin rewards, sitemap fetch/scrape)
- Tailwind theme: bg `hsl(220 80% 12%)`, accent `hsl(45 100% 55%)`, text `hsl(0 0% 100%)`

### Data model (Lovable Cloud)
- `pages` — id, url (unique), title, description, content (text), source_sitemap, submitted_by (crossatrix user_id), kind ('page'|'file'), created_at
- `submissions` — id, user_id, url, kind, croins_awarded, created_at (drives the daily cap)
- Postgres `tsvector` GIN index on title + content for full-text search
- RLS: public read on `pages`; `submissions` writes only via server function (service role)

### Secrets (Lovable Cloud)
- `CROSSI_AI_KEY` — Crossi 5.1 Lite public-api
- `CROSSATRIX_API_KEY` — `x-api-key` for the croin credit endpoint

### Server functions (`src/lib/*.functions.ts`)
1. `login(email, password)` → proxies Crossatrix auth, returns `{ user, access_token }`
2. `submitUrl({ user_id, url, kind })`
   - Enforce daily cap (default 20/user/day) using `submissions`
   - Sitemap: fetch URL, parse `<loc>` entries (cap ~100), fetch each, HTML→text, upsert into `pages`
   - Page/file: fetch, extract text, upsert
   - Reject duplicate URLs (no reward)
   - Call Crossatrix credit endpoint with `x-api-key` (100 for page/sitemap, 50 for file)
   - Insert `submissions` row with `croins_awarded`
3. `search(query)` → Postgres FTS over `pages`, top 20 hits (title, url, snippet)
4. `aiOverview(query, resultUrls)` → calls Crossi public-api with the documented prompt template

### Routes
- `/` — landing: Crossi Search wordmark + big search bar, login state top-right
- `/search?q=…` — AI overview card on top, then result list
- `/submit` — auth-required form: URL + type (page / sitemap / file), shows daily-cap remaining + reward
- `/auth` — Crossatrix email/password login

Auth state stored in localStorage (Crossatrix `user` + `access_token`). `/submit` redirects to `/auth` if not signed in.

### UI
- Deep navy bg, bold golden accent CTAs, white text, Google-like minimal layout
- Header shows croin balance + email when signed in, otherwise Sign in button

### Implementation order
1. Enable Lovable Cloud; create tables, RLS, FTS index
2. Add `CROSSI_AI_KEY` + `CROSSATRIX_API_KEY` secrets
3. Theme tokens in `src/styles.css`
4. Auth context + `/auth` route
5. `/submit` route + `submitUrl` server function (sitemap parse, scrape, croin reward, daily cap)
6. `/` landing + `/search` + `search` & `aiOverview` server functions
7. Header with croin/user display + sign-out

### Notes / limits
- Sitemap crawl bounded (≤100 URLs/submission, simple HTML→text, no JS rendering) to stay within Worker runtime
- "File" submissions accept a fetchable text/HTML resource; if extraction fails the URL+title are still indexed
- Daily cap default = 20 submissions/user, easy to tune
