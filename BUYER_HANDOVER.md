# Elite Quote Flow handover

## If you only have one Supabase project

You do not need a second hosted Supabase project to test the app. Use the same Elite Quote Flow Supabase project with a **dedicated staging Supabase Auth account**, and use Stripe test mode for staging payments. The staging Worker serves its browser Supabase URL/key from its own Worker secrets and has scheduled production mutations disabled.

1. Deploy staging with `npm.cmd run check:staging` and `npm.cmd run deploy:staging`.
2. In Cloudflare, set the `quoteflow-staging` Worker secrets to the **same Elite Quote Flow Supabase project URL**, its publishable key, and its service-role/secret key. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to Stripe **test-mode** values only on the staging Worker. Do not change production Stripe secrets.
3. Create a dedicated Supabase test user. Use only that user for staging; avoid production customer records. The same database tables are shared, so test quotes are in the same project. Label staging test data clearly and remove it when done.
4. Run SQL migrations against the Elite Quote Flow project only if the columns/RPCs have not already been verified there. Don’t rerun schema setup in the Naija Meet & Connect project.
5. Test auth, quote create/edit, public quote and signature, test deposit, webhook, and duplicate webhook delivery. Staging scheduled expiry/reminders are intentionally disabled to avoid mutating shared customer data.
6. Use production only for the live Stripe account and real customer data. Never put Stripe test keys on the production Worker.

## 1. Prepare Supabase

1. Confirm the project URL is `https://rcdbfgwslbwywdsxtisd.supabase.co` before running SQL.
2. Create a database backup before changing production schema.
3. If migrations are still needed, run `supabase-sale-ready-migration.sql` (columns) first. It is safe to rerun after timeouts because it uses `IF NOT EXISTS` and has no transaction wrapper.
4. Run `supabase-sale-ready-constraints.sql`, then `supabase-sale-ready-rpcs.sql`, then `supabase-sale-ready-index.sql` separately. The index uses `CREATE INDEX CONCURRENTLY`; execute it by itself, not inside an explicit transaction.
5. Verify columns and RPCs using the new-configured Worker before deploying the upgraded app.

## 2. Configure production Supabase secrets

The production `quoteflow` Worker needs the Elite Quote Flow project URL, publishable key, and service-role/secret key. Set with PowerShell from the project folder; Wrangler prompts for sensitive values:

```powershell
$url = 'https://rcdbfgwslbwywdsxtisd.supabase.co'
$url | npx wrangler secret put SUPABASE_URL --name quoteflow --env=""
npx wrangler secret put SUPABASE_ANON_KEY --name quoteflow --env=""
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --name quoteflow --env=""
```

Paste the Elite Quote Flow publishable key at the `SUPABASE_ANON_KEY` prompt, and its private service-role/secret key at the final prompt. Never put the private key in browser config, chat, source files, or Git.

## 3. Stripe modes

- Production: retain the existing matching **live-mode** Stripe secret, payment configuration, and webhook signing secret. Do not replace these with test values.
- Staging: set **test-mode** Stripe credentials on `quoteflow-staging` only. Configure a test-mode Stripe webhook pointing to `https://staging.elitequoteflow.com/api/stripe-webhook` and use its signing secret on staging.
- Test a deposit and duplicate webhook delivery on staging. Check that the payment is applied to the intended staging quote.

## 4. Resend reminders

1. Configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` on production after verifying the sender domain.
2. Production scheduled processing runs daily at 09:00 UTC, expires past-due quotes, and sends at most three reminders spaced at least 24 hours apart.
3. Staging scheduled processing is disabled because staging shares the production database. Manually test email with a designated test quote/account and a safe recipient.

## 5. Cloudflare and deployment

1. `.dev.vars.example` documents local variables; copy it to `.dev.vars` for local development and never commit `.dev.vars`.
2. Set staging secrets only after the staging Worker exists. Use `npx wrangler secret put <SECRET_NAME> --name quoteflow-staging` and supply staging-appropriate values at each prompt.
3. Verify only secret names, never values, with `npx wrangler secret list --name quoteflow --env=""` and `npx wrangler secret list --name quoteflow-staging`.
4. Deploy staging with `npm.cmd run check:staging` and `npm.cmd run deploy:staging`.
5. After staging checks and database verification, deploy production with `npm.cmd run check -- --env=""` and `npm.cmd run deploy -- --env=""`.

## 6. GitHub Actions

Add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Pull requests run tests and a Wrangler dry run; pushes to `main` deploy production.

## Important notes

- The public quote Worker uses restricted RPC functions with service-role access. Browser keys must not be granted direct execution on these functions.
- Signature capture stores a data URL in `accepted_signature`; review privacy, retention, and e-signature requirements before commercial use.
- The quote form currently supports one optional line item, not multiple editable rows.
- A second hosted Supabase project is not required for a first staging pass, but same-project staging data is not isolated. For stronger staging isolation, use a separate Supabase project later or a local Supabase stack.
