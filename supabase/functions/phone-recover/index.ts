/**
 * Phone account recovery: verify profiles.full_name + profiles.phone, then set new password.
 *
 * Edge Function secrets (Dashboard → Edge Functions → Secrets):
 *   Name:  SERVICE_ROLE_KEY   (do NOT prefix with SUPABASE_ — reserved)
 *   Value: Project Settings → API Keys → Secret key (sb_secret_…) OR legacy service_role (eyJ…)
 *
 * Auto-provided by Supabase (no need to add):
 *   SUPABASE_URL
 *
 * Deploy: supabase functions deploy phone-recover --project-ref tngyfjxkpwayctrprftq
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
function normPhone(s: string) {
  return s.replace(/\D/g, "").replace(/^0/, "250");
}

/** Prefer custom secret name; fall back to platform / legacy names. */
function serviceRoleKey(): string {
  return (
    Deno.env.get("SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_SECRET_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    ""
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = (await req.json()) as {
      phone?: string;
      name?: string;
      new_password?: string;
    };
    const phone = normPhone(body.phone ?? "");
    const name = normName(body.name ?? "");
    const newPassword = body.new_password ?? "";

    if (!phone || !name) {
      return new Response(JSON.stringify({ ok: false, error: "bad_input" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (newPassword.length < 6) {
      return new Response(JSON.stringify({ ok: false, error: "bad_password" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = serviceRoleKey();
    if (!url || !serviceKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "server_misconfigured",
          hint: "Add secret SERVICE_ROLE_KEY = your project Secret / service_role key",
        }),
        {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profiles, error: qErr } = await admin
      .from("profiles")
      .select("id, full_name, phone")
      .not("phone", "eq", "");

    if (qErr) {
      return new Response(JSON.stringify({ ok: false, error: qErr.message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const match = (profiles ?? []).find((p) => {
      const pPhone = normPhone(String(p.phone ?? ""));
      const pName = normName(String(p.full_name ?? ""));
      return pPhone === phone && pName === name && pName.length > 0;
    });

    if (!match) {
      return new Response(JSON.stringify({ ok: false, error: "mismatch" }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { error: upErr } = await admin.auth.admin.updateUserById(match.id, {
      password: newPassword,
    });

    if (upErr) {
      return new Response(JSON.stringify({ ok: false, error: upErr.message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
