# Cutover checklist (delete this file when done)

## You

1. **Rotate keys** — do this first, the old ones are public.
   - AWS → IAM → the S3 user → *Create access key*, then *Delete* the old one.
     Keep the new pair somewhere safe for a minute.
   - GitHub → Settings → Developer settings → *Fine-grained tokens* → Generate:
     repository access = only `Rohrmanhyundai`; permissions = **Contents: Read and write**.
     Then revoke the old token (Tokens (classic) / fine-grained list).
   - Pusher → dashboard → the app → *App Keys* → **Reset secret**.
2. **Cloudflare** — <https://dash.cloudflare.com/sign-up> (free). Then in a terminal:
   ```bash
   cd ~/Work/Rohrmanhyundai/worker && npx wrangler login
   ```
   Tell Claude when that's done — it deploys the worker and creates the KV store.
3. **Secrets** — after the deploy, each prompts for a value (paste, Enter; nothing is stored in the repo):
   ```bash
   cd ~/Work/Rohrmanhyundai/worker
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put AWS_ACCESS_KEY_ID
   npx wrangler secret put AWS_SECRET_ACCESS_KEY
   npx wrangler secret put PUSHER_SECRET
   openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
   npm run set-password -- SHAWN
   ```
4. **Everyone's new password** — after the site deploys: Admin → Users → pick each
   person → type a password → Save (or *Send reset email* for anyone with an email on file).
   Every device, TVs included, has to sign in once with the new password.
5. **GitHub Support** — the scrubbed commits still resolve by URL until GitHub purges them.
   <https://support.github.com/request> → "Sensitive data removal" (text in `worker/GITHUB-SUPPORT.md`).

## Claude (after step 2)

- `npx wrangler kv namespace create CREDS` → id into `wrangler.toml`; `npx wrangler deploy`
- worker URL → `API_URL` in `src/utils/api.js`
- `node scripts/strip-users-secrets.mjs` → commit
- merge `backend-worker` → `main`, push (Pages deploys)
- final history scrub (`sc1:` strings, old hashes) + force-push
