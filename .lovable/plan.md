## Problem
Results are returned in DB order (no ranking). Searching "Youtube" puts youtube.com 6th instead of 1st.

## Fix
In `searchPages` (`src/lib/crossi.functions.ts`), compute a relevance score for each row server-side, sort descending, then slice to top N.

### Scoring (per row, case-insensitive)
For each query term (split on whitespace):
- URL hostname exactly equals term (e.g. `youtube.com` for "youtube") → +1000
- URL hostname starts with `term.` or contains `/term` segment → +500
- URL contains term → +200
- Title equals term → +400; title starts with term → +250; title contains term as whole word → +150; contains substring → +60
- Description contains term → +30
- Content contains term → +10 (cap contribution)

Bonus: exact full-query match in title +300; all terms present in title +150.
Tiny tiebreaker: newer `created_at` wins (+ up to 5 based on recency).

### Implementation notes
- Fetch up to ~100 candidates from the `ilike` OR query (raise limit from 30 → 100), score in JS, sort, then return top 30.
- Add a small `scoreRow(query, row)` helper. Hostname parsed via `new URL(r.url).hostname` with a try/catch fallback.
- No DB changes. No UI changes.

### Files
- `src/lib/crossi.functions.ts` — update `searchPages` only.
