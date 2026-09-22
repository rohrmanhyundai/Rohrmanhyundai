# rohrman-api — the dashboard's backend

A Cloudflare Worker that keeps the secrets the browser must never see (the
GitHub token that writes data files, the AWS keys for uploads) and verifies
logins against passwords stored in Cloudflare KV instead of the public repo.
The dashboard talks to it at the URL in `src/utils/api.js`.

## One-time setup

1. Create a free account at <https://dash.cloudflare.com/sign-up> (Workers &
   Pages → free plan is plenty).
2. In a terminal:

   ```bash
   cd worker && npm install && npx wrangler login
   ```

3. Make the credential store and put its id into `wrangler.toml`:

   ```bash
   npx wrangler kv namespace create CREDS
   ```

4. Add the five secrets — each command prompts for the value, nothing is
   stored in the repo:

   ```bash
   npx wrangler secret put GITHUB_TOKEN          # fine-grained PAT, this repo only, Contents: read & write
   npx wrangler secret put AWS_ACCESS_KEY_ID     # IAM user limited to the rohrman-hyundai-files bucket
   npx wrangler secret put AWS_SECRET_ACCESS_KEY
   npx wrangler secret put PUSHER_SECRET          # Pusher dashboard → App Keys → secret
   openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
   ```

5. Deploy, then set your own password so you can sign in:

   ```bash
   npx wrangler deploy
   npm run set-password -- SHAWN
   ```

   The deploy prints the worker URL (`https://rohrman-api.<account>.workers.dev`);
   that goes in `src/utils/api.js` as `API_URL`.

Everyone else's password is set from Admin → Users (or they use **Forgot?**
on the login screen to email themselves a reset link).

## Rotating a secret

`npx wrangler secret put NAME` again with the new value — takes effect on the
next request, no redeploy needed.

## Endpoints

See the comment at the top of `src/index.js`.
