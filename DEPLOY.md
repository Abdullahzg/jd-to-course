# Deploying Carpa

The challenge requires "a working link a judge can actually open." This is the
shortest safe path to one.

## The constraint that decides the host

Four routes need more than 60 seconds of server time:

| Route | maxDuration | Why |
|---|---|---|
| `app/api/inbox/scan` | 300s | reads a year of mail (runs as a background job) |
| `app/api/fit` | 180s | reads all 139 courses against the posting |
| `app/api/relevance` | 120s | second reading pass |
| `app/api/solve` | 90s | solver with escalation ladder |

**Vercel Hobby (free) kills any function at 60 seconds**, so this looked fatal.
Measured on the live deployment it is not: a full catalog read finishes in about
**30 seconds** there, because Vercel's network to the model provider is far
faster than a laptop's. The headroom is real but it is not enormous, and a
slower posting could still approach the cap. Options, in order of safety:

- **Vercel Pro** ($20/month) — raises the cap to 300s, everything works, or
- **A container host with no per-request cap** — Railway, Render, Fly.io.
  Free/cheap tiers are fine because the app is one Next.js process.

Recommended: **Railway** (no cap, no cold-start config, deploys from GitHub in
minutes).

## Runbook

1. **Make the repo pushable to the host.** Railway/Render read from GitHub;
   the repo may stay private (you authorize the host), but if you submit the
   GitHub link as your judge link it must be **public**.

2. **Create the service.** Railway → New Project → Deploy from GitHub repo →
   pick `jd-to-course`. Build command `npm run build`, start command
   `npm start`. Node 20+.

3. **Set environment variables** (all of them; the app fails loudly without
   `DATABASE_URL`):

   ```
   DATABASE_URL       postgres connection string (Supabase pooler, port 6543)
   AUTH_SECRET        openssl rand -base64 32   (a fresh one for production)
   AUTH_GOOGLE_ID     from Google Cloud console
   AUTH_GOOGLE_SECRET from Google Cloud console
   ADMIN_EMAILS       comma separated, controls /admin and API-key changes
   OPENROUTER_API_KEY so visitors do not need their own key
   AUTH_URL           https://your-domain  (only needed off Vercel)
   ```

   Do **not** set `NEXT_PUBLIC_ALLOW_DEMO`. The demo sign-in door accepts any
   typed email; leaving it off in production is what stops a stranger signing
   in as an admin address.

4. **Google OAuth redirect URI.** Google Cloud → Credentials → your OAuth
   client → Authorized redirect URIs → add:

   ```
   https://your-domain/api/auth/callback/google
   ```

   Sign-in returns a 400 until this exact URL is registered. Also confirm the
   consent screen is published ("In production"), or only test users can enter.

5. **Enable the Gmail API** in the same Google Cloud project, or the
   "Connect Gmail" OAuth path errors. The app-password path does not need it.

6. **Region.** The database is in Supabase `ap-northeast-2` (Seoul). Every
   request pays the round trip. Deploy the app to an Asia-Pacific region if
   the host offers one; otherwise expect a few hundred milliseconds of extra
   latency per page.

7. **Smoke test the deployed URL, in this order:**
   - landing loads, favicon shows
   - Google sign-in completes and lands on `/setup`
   - "Use the owner's inbox" fills the tracker within ~10s
   - a job posting builds a plan end to end (this is the slow one; watch it finish)
   - `/admin` is reachable for an `ADMIN_EMAILS` address and refused for others

## What breaks first, in order

1. **The OAuth redirect URI** — nothing works until it matches exactly.
2. **A slow posting near the 60-second cap** on Vercel Hobby. Typical runs
   measure ~30s in production, so there is roughly 2x headroom; a heavier
   posting eats into it. Vercel Pro (300s) removes the question entirely.
3. **A missing `OPENROUTER_API_KEY`** — the solver still runs, but every
   reading step reports "no API key connected" and the demo looks empty.
