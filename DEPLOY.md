# Ikayi Yange deploy

Repo: **amanididierprofessional/ikayi** (full app)  
Domain: https://ikayi-yange.vercel.app

## Vercel env (your Supabase project)

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Use the **Ikayi** project (not an old Stoke project). Code fallback in `src/lib/supabase.ts` should match the same project.

## Supabase setup

1. SQL Editor → run `supabase/schema.sql`
2. Auth → Email → **Confirm email = OFF** (faster signup like phone)
3. Site URL = `https://ikayi-yange.vercel.app`
4. Redirect URLs: `https://ikayi-yange.vercel.app/**`
5. Email templates: see `EMAIL_TEMPLATES.md`

## Android APK

Primary download (website + Actions release):

`https://github.com/amanididierprofessional/ikayi/releases/download/android-latest/ikayi-yange.apk`

Welcome page (`/welcome`) uses that URL for **Shyiramo app**.

### Protect existing Android ledgers

Keep the package name, signing certificate and Capacitor storage origin compatible for an in-place update. Test an APK using the production app ID and a compatible signing key on a phone seeded with sample local-only customers, suppliers, debts and payments. Compare the records before and after the update with the phone offline.

Builds from main produce artifacts. Updating the public download requires a manual workflow run with publish_apk enabled and an APK whose certificate matches IKAYI_EXPECTED_APK_CERT_SHA256, the verified fingerprint of the installed APK for the users you intend to update. A GitHub-hosted debug build may have a new key on each run. Do not change the expected fingerprint to match an unrelated new key.

If an installed APK has a different certificate and its signing key cannot be recovered, keep it installed. Verify a backup and restore path for each affected ledger before recommending any uninstall. A separate test app cannot read the production app’s on-device records.

### Capacitor / system splash (saved playbook)

If the APK shows a **Capacitor** logo for a second on cold start, see:

**→ [`docs/ANDROID_LAUNCH_FIX.md`](docs/ANDROID_LAUNCH_FIX.md)**

Summary: after `cap sync` + Ikayi icons, run `npm run android:fix-startup` (already in CI on `main`), rebuild APK, and verify an in-place update before testing a phone with saved records.

## Usage analytics (owner only)

1. Run `supabase/schema.sql` (creates `usage_daily` + `app_admins`).
2. In Supabase → Authentication → Users, copy your user id, then:
   `insert into public.app_admins (user_id) values ('YOUR-USER-UUID');`
3. Open `/admin` while signed in to see users and page usage.

Each device records page views locally and uploads at most once per day when online. No credit / debtor data is tracked.
