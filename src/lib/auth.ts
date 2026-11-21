/**
 * Ikayi Yange auth — phone uses synthetic email for one password path.
 * Signup stores one display name (lowercase) for phone recovery.
 * Email recovery = Supabase reset link. Phone recovery = name + phone verify → new password.
 */
import { ensureSupabase, supabaseConfigured } from "@/lib/supabase";

export const MIN_PASSWORD = 6;
const ACCOUNT_KEY = "ikayi-account";
const LOGGED_KEY = "ikayi-logged-in";

export type LoginType = "phone" | "email";
export type Account = {
  loginType: LoginType;
  identifier: string;
  fullName?: string;
  supabaseUserId?: string;
  createdAt: number;
};

/** One name only — always stored lowercase for recovery matching. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^0/, "250");
}

export function syntheticEmail(phone: string): string {
  return `phone_${normalizePhoneDigits(phone)}@ikayi.app`;
}

function normalizeId(loginType: LoginType, identifier: string): string {
  const v = identifier.trim();
  if (loginType === "email") return v.toLowerCase();
  return normalizePhoneDigits(v);
}

export function getAccount(): Account | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

function saveAccount(a: Account) {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a));
}

export async function isLoggedIn(): Promise<boolean> {
  if (localStorage.getItem(LOGGED_KEY) === "1") return true;
  const client = await ensureSupabase();
  if (!client) return false;
  const { data } = await client.auth.getSession();
  if (data.session?.user) {
    localStorage.setItem(LOGGED_KEY, "1");
    return true;
  }
  return false;
}

export function setLoggedIn(v: boolean) {
  if (v) localStorage.setItem(LOGGED_KEY, "1");
  else localStorage.removeItem(LOGGED_KEY);
}

async function upsertOwnProfile(opts: {
  fullName: string;
  phone: string;
}) {
  const client = await ensureSupabase();
  if (!client) return;
  const { data } = await client.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) return;
  await client.from("profiles").upsert(
    {
      id: uid,
      full_name: opts.fullName,
      phone: opts.phone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
}

export async function signUp(opts: {
  loginType: LoginType;
  identifier: string;
  password: string;
  /** One name (first or last) — required, stored lowercase. */
  displayName: string;
}): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  const id = normalizeId(opts.loginType, opts.identifier);
  const fullName = normalizeName(opts.displayName);
  if (!id) return { ok: false, error: "bad_id" };
  if (!fullName) return { ok: false, error: "bad_name" };
  if (opts.password.length < MIN_PASSWORD) return { ok: false, error: "bad_password" };

  const client = await ensureSupabase();
  const email = opts.loginType === "email" ? id : syntheticEmail(id);
  const phoneStored = opts.loginType === "phone" ? id : "";

  // Offline or no cloud: local-only account
  if (!supabaseConfigured || !client || !navigator.onLine) {
    saveAccount({
      loginType: opts.loginType,
      identifier: id,
      fullName,
      createdAt: Date.now(),
    });
    setLoggedIn(true);
    return { ok: true };
  }

  const { data, error } = await client.auth.signUp({
    email,
    password: opts.password,
    options: {
      data: {
        login_type: opts.loginType,
        identifier: id,
        full_name: fullName,
        app: "ikayi",
      },
      ...(typeof window !== "undefined" ? { emailRedirectTo: window.location.origin } : {}),
    },
  });

  if (error) {
    if (/already registered|already been registered|user already/i.test(error.message)) {
      return { ok: false, error: "exists", detail: error.message };
    }
    return { ok: false, error: "signup_failed", detail: error.message };
  }

  const uid = data.user?.id ?? data.session?.user?.id;
  saveAccount({
    loginType: opts.loginType,
    identifier: id,
    fullName,
    ...(uid ? { supabaseUserId: uid } : {}),
    createdAt: Date.now(),
  });

  if (data.session || data.user) {
    setLoggedIn(true);
    await upsertOwnProfile({ fullName, phone: phoneStored || id });
    return { ok: true };
  }
  return { ok: false, error: "signup_failed" };
}

export async function signIn(opts: {
  loginType: LoginType;
  identifier: string;
  password: string;
}): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  const id = normalizeId(opts.loginType, opts.identifier);
  if (!id || opts.password.length < 1) return { ok: false, error: "bad_password" };

  const client = await ensureSupabase();
  const email = opts.loginType === "email" ? id : syntheticEmail(id);

  if (supabaseConfigured && client && navigator.onLine) {
    const { data, error } = await client.auth.signInWithPassword({ email, password: opts.password });
    if (error) {
      if (/invalid login credentials|invalid credentials|wrong password|user not found/i.test(error.message)) {
        return { ok: false, error: "wrong_credentials", detail: error.message };
      }
      if (/email not confirmed/i.test(error.message)) {
        return { ok: false, error: "confirmation_required", detail: error.message };
      }
      return { ok: false, error: "wrong_credentials", detail: error.message };
    }
    if (data.session?.user) {
      const meta = data.session.user.user_metadata as { full_name?: string } | undefined;
      saveAccount({
        loginType: opts.loginType,
        identifier: id,
        fullName: meta?.full_name ? normalizeName(meta.full_name) : getAccount()?.fullName,
        supabaseUserId: data.session.user.id,
        createdAt: Date.now(),
      });
      setLoggedIn(true);
      return { ok: true };
    }
  }

  const account = getAccount();
  if (!account) return { ok: false, error: "no_account" };
  if (account.loginType !== opts.loginType || account.identifier !== id) {
    return { ok: false, error: "mismatch" };
  }
  setLoggedIn(true);
  return { ok: true };
}

export async function signOutLocal() {
  setLoggedIn(false);
  const client = await ensureSupabase();
  if (client) await client.auth.signOut().catch(() => {});
}

/** Email accounts only — real inbox + Supabase SMTP (use Brevo port 587). */
export async function requestPasswordReset(emailOrPhone: string, loginType: LoginType) {
  const client = await ensureSupabase();
  if (!client || !supabaseConfigured) return { ok: false as const, error: "no_cloud" };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ok: false as const, error: "offline" };
  }
  // Phone synthetic emails never receive mail — refuse and guide to name recovery
  if (loginType === "phone") {
    return { ok: false as const, error: "use_phone_name" };
  }
  const email = emailOrPhone.trim().toLowerCase();
  if (!email.includes("@")) return { ok: false as const, error: "bad_id" };
  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}/` : undefined;
  const { error } = await client.auth.resetPasswordForEmail(email, {
    ...(redirectTo ? { redirectTo } : {}),
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

/**
 * Phone recovery: verify registered name + phone, then set new password.
 * Uses Edge Function `phone-recover` (service role) when available;
 * falls back to local account match on this device only.
 */
export async function recoverPhoneWithName(opts: {
  displayName: string;
  phone: string;
  newPassword: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const fullName = normalizeName(opts.displayName);
  const phone = normalizePhoneDigits(opts.phone);
  if (!fullName) return { ok: false, error: "bad_name" };
  if (!phone) return { ok: false, error: "bad_id" };
  if (opts.newPassword.length < MIN_PASSWORD) return { ok: false, error: "bad_password" };

  // Same-device offline / local account
  const local = getAccount();
  if (
    local &&
    local.loginType === "phone" &&
    local.identifier === phone &&
    local.fullName &&
    normalizeName(local.fullName) === fullName
  ) {
    // Local flag only — user still needs cloud password if they use another device
    saveAccount({ ...local, fullName });
    setLoggedIn(true);
    // Try cloud update via edge function when online
  }

  const client = await ensureSupabase();
  if (!client || !supabaseConfigured || !navigator.onLine) {
    if (local?.loginType === "phone" && local.identifier === phone && local.fullName === fullName) {
      setLoggedIn(true);
      return { ok: true };
    }
    return { ok: false, error: "no_cloud" };
  }

  try {
    const { data, error } = await client.functions.invoke("phone-recover", {
      body: {
        phone,
        name: fullName,
        new_password: opts.newPassword,
      },
    });
    if (error) {
      // Function missing or failed — try local only
      if (local?.loginType === "phone" && local.identifier === phone && local.fullName === fullName) {
        setLoggedIn(true);
        return { ok: true };
      }
      return { ok: false, error: error.message || "recover_failed" };
    }
    const body = data as { ok?: boolean; error?: string } | null;
    if (body && body.ok === false) {
      return { ok: false, error: body.error || "mismatch" };
    }
    // Sign in with new password
    const email = syntheticEmail(phone);
    const sign = await client.auth.signInWithPassword({
      email,
      password: opts.newPassword,
    });
    if (sign.error) {
      // Password may still be updated; try local session
      saveAccount({
        loginType: "phone",
        identifier: phone,
        fullName,
        createdAt: Date.now(),
      });
      setLoggedIn(true);
      return { ok: true };
    }
    saveAccount({
      loginType: "phone",
      identifier: phone,
      fullName,
      supabaseUserId: sign.data.session?.user?.id,
      createdAt: Date.now(),
    });
    setLoggedIn(true);
    return { ok: true };
  } catch (e) {
    if (local?.loginType === "phone" && local.identifier === phone && local.fullName === fullName) {
      setLoggedIn(true);
      return { ok: true };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "recover_failed",
    };
  }
}

export async function updatePassword(newPassword: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (newPassword.length < MIN_PASSWORD) return { ok: false, error: "bad_password" };
  const client = await ensureSupabase();
  if (!client || !supabaseConfigured) return { ok: false, error: "no_cloud" };
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
  setLoggedIn(true);
  return { ok: true };
}

export function isRecoveryUrl(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hash || "";
  const s = window.location.search || "";
  return (
    /type=recovery/i.test(h) ||
    /type=recovery/i.test(s) ||
    /type=recovery/i.test(window.location.href)
  );
}
