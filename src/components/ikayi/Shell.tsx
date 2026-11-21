import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { BookUser, Cloud, HandCoins, Settings2, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { toast } from "sonner";
import { fullSync } from "@/lib/sync";
import { useI18n } from "@/lib/i18n";
import { isLoggedIn } from "@/lib/auth";
import { enterAppMode, isAppMode } from "@/lib/app-mode";
import { AuthCard } from "./AuthCard";
import { useConnectivity } from "@/hooks/use-connectivity";
import logo from "@/assets/ikayi-logo.png";

const AUTO_SYNC_KEY = "ikayi-sync-mode";

/**
 * App chrome: header + content + Stoke-style floating bottom pill nav.
 * Layout matches lovable-sync / Stoke Yange — do not rename bottom-nav class.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { lang, setLang, t } = useI18n();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const online = useConnectivity();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [syncSetupOpen, setSyncSetupOpen] = useState(false);
  const isLanding =
    path === "/welcome" ||
    path.startsWith("/welcome/") ||
    path === "/install-android" ||
    path.startsWith("/install-android/");

  useEffect(() => {
    if (isAppMode()) enterAppMode();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void isLoggedIn()
      .then((ok) => {
        if (!cancelled) {
          setAuthed(ok || sessionStorage.getItem("ikayi-device-mode") === "1");
          setChecking(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthed(sessionStorage.getItem("ikayi-device-mode") === "1");
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onAuthed = useCallback((isNewAccount = false) => {
    setAuthed(true);
    if (isNewAccount) setSyncSetupOpen(true);
  }, []);
  const finishSyncSetup = useCallback((enabled: boolean) => {
    let saved = false;
    try {
      localStorage.setItem(AUTO_SYNC_KEY, enabled ? "auto" : "manual");
      saved = true;
    } catch {
      toast.error(lang === "rw" ? "Ihitamo ntiryabitswe. Ongera ugerageze mu igenamiterere." : "Your choice could not be saved. Try again in Settings.");
    }
    setSyncSetupOpen(false);
    if (enabled && saved) {
      void fullSync().catch((error) => console.error("Initial automatic sync failed", error));
      toast.success(lang === "rw" ? "Guhuza amakuru byikora byemejwe" : "Automatic sync enabled");
    }
  }, [lang]);
  const onOffline = useCallback(() => {
    sessionStorage.setItem("ikayi-device-mode", "1");
    setAuthed(true);
  }, []);

  const tabs = [
    { to: "/" as const, label: t("owesMe"), icon: BookUser },
    { to: "/i-owe" as const, label: t("iOwe"), icon: HandCoins },
    { to: "/settings" as const, label: t("settings"), icon: Settings2 },
  ];

  if (isLanding) {
    return <>{children}</>;
  }

  if (checking) {
    return (
      <div className="ikayi-startup">
        <div className="ikayi-startup-content">
          <img src={logo} alt="" className="ikayi-startup-logo" />
          <h1 className="ikayi-startup-title">Ikayi Yange</h1>
          <p className="ikayi-startup-description">
            {lang === "rw" ? "Tegereza gato…" : "Getting things ready…"}
          </p>
          <div className="ikayi-startup-track" role="progressbar" aria-label={lang === "rw" ? "Gutegura porogaramu" : "Loading Ikayi"}>
            <span className="is-loading" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="flex min-w-0 items-center gap-3">
          <img src={logo} alt="" className="size-11 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold leading-tight">Ikayi Yange</h1>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {online ? (
                <Wifi className="size-3 shrink-0 text-emerald-600" />
              ) : (
                <WifiOff className="size-3 shrink-0" />
              )}
              <span className="truncate">
                {online
                  ? lang === "rw"
                    ? "Online"
                    : "Online"
                  : lang === "rw"
                    ? "Nta murandasi"
                    : "Offline"}
              </span>
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9 shrink-0 gap-0 rounded-full bg-card p-0.5"
          aria-label="Toggle language"
          onClick={() => setLang(lang === "rw" ? "en" : "rw")}
        >
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
              lang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            EN
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
              lang === "rw" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            RW
          </span>
        </Button>
      </header>

      <main className="px-4 pb-32 pt-3">{authed ? children : null}</main>

      <nav className="bottom-nav" aria-label={lang === "rw" ? "Paji" : "Main navigation"}>
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? path === "/" : path.startsWith(to);
          return (
            <Button
              asChild
              key={to}
              variant="ghost"
              className={`h-12 rounded-full ${
                active
                  ? "flex-[2] bg-primary px-4 text-primary-foreground hover:bg-primary/90"
                  : "flex-1 text-ink-foreground/70 hover:bg-ink hover:text-ink-foreground"
              }`}
            >
              <Link to={to} aria-label={label} aria-current={active ? "page" : undefined}>
                <Icon className="size-5 shrink-0" />
                {active && <span className="truncate text-sm font-semibold">{label}</span>}
              </Link>
            </Button>
          );
        })}
      </nav>

      {!authed && <AuthCard onAuthed={onAuthed} onOffline={onOffline} />}

      <Drawer
        open={syncSetupOpen}
        onOpenChange={(open) => {
          if (!open) finishSyncSetup(false);
        }}
      >
        <DrawerContent className="mx-auto max-w-md">
          <DrawerHeader className="text-left">
            <div className="mb-2 flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Cloud className="size-5" />
            </div>
            <DrawerTitle>{lang === "rw" ? "Wifuza ko amakuru abikwa kuri murandasi?" : "Back up your data automatically?"}</DrawerTitle>
            <DrawerDescription>
              {lang === "rw"
                ? "Iyo telefone ifite murandasi, Ikayi izajya ihuza amakuru yawe kugira ngo uzabashe kuyagarura igihe uhinduye telefone."
                : "When your phone has internet, Ikayi will sync your data so you can restore it if you change phones."}
            </DrawerDescription>
          </DrawerHeader>
          <div className="space-y-3 p-4 pb-8">
            <Button className="h-12 w-full rounded-full" onClick={() => finishSyncSetup(true)}>
              <Cloud className="size-4" />
              {lang === "rw" ? "Emera kubika amakuru byikora" : "Enable automatic backup"}
            </Button>
            <Button variant="outline" className="h-12 w-full rounded-full" onClick={() => finishSyncSetup(false)}>
              {lang === "rw" ? "Komeza utabishyizeho ubu" : "Continue without enabling it now"}
            </Button>
            <p className="px-2 text-center text-xs leading-relaxed text-muted-foreground">
              {lang === "rw"
                ? "Nuhitamo kutabikoresha, amakuru yawe azaguma kuri iyi telefone kugeza uyahuje n'andi ubwawe. Ushobora guhindura iri hitamo igihe icyo ari cyo cyose mu Igenamiterere."
                : "If you skip, your data stays on this phone until you sync it manually. You can change this choice at any time in Settings."}
            </p>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
