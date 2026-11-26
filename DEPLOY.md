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

## Credit deletion sync

Run supabase/credit_deletions.sql in the Ikayi Supabase SQL Editor before releasing the client update. It adds account-scoped deletion markers. Sync hides marked records on the phone and in Supabase while retaining the underlying credit rows. The client syncs deletions made after the update when it knows which cloud account owns them. Earlier deletions made without a recorded marker cannot be inferred from missing rows.

The updated app adds a table to the existing on-device ledger. Test an in-place update on an Android device with local-only records before publishing. Keep the old app installed if the signing key does not match, and verify a backup and restore path before any uninstall.


## Android APK

Primary download (website + Actions release):

`https://github.com/amanididierprofessional/ikayi/releases/download/android-latest/ikayi-yange.apk`

Welcome page (`/welcome`) uses that URL for **Shyiramo app**.

### Capacitor / system splash (saved playbook)

If the APK shows a **Capacitor** logo for a second on cold start, see:

**→ [`docs/ANDROID_LAUNCH_FIX.md`](docs/ANDROID_LAUNCH_FIX.md)**

Summary: after `cap sync` + Ikayi icons, run `npm run android:fix-startup` (already in CI on `main`), rebuild APK, **uninstall** old app, install new one.

## Usage analytics (owner only)

1. Run `supabase/schema.sql` (creates `usage_daily` + `app_admins`).
2. In Supabase → Authentication → Users, copy your user id, then:
   `insert into public.app_admins (user_id) values ('YOUR-USER-UUID');`
3. Open `/admin` while signed in to see users and page usage.

Each device records page views locally and uploads at most once per day when online. No credit / debtor data is tracked.
