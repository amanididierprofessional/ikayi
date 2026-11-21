import { useEffect, useState } from "react";
import { supabaseAnonKey, supabaseConfigured, supabaseUrl } from "@/lib/supabase";

/**
 * Reports actual Supabase reachability, not just the browser's network flag.
 * navigator.onLine can remain true on captive portals or when internet access
 * exists but the cloud service cannot be reached.
 */
export function useConnectivity() {
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let active = true;
    let checking = false;
    const check = async () => {
      if (!active || checking) return;
      if (!navigator.onLine || !supabaseConfigured) {
        setOnline(false);
        return;
      }
      checking = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
          method: "GET",
          headers: { apikey: supabaseAnonKey },
          cache: "no-store",
          signal: controller.signal,
        });
        if (active) setOnline(response.ok);
      } catch {
        if (active) setOnline(false);
      } finally {
        window.clearTimeout(timeout);
        checking = false;
      }
    };

    const onOnline = () => void check();
    const onOffline = () => setOnline(false);
    void check();
    const interval = window.setInterval(() => void check(), 15000);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return online;
}
