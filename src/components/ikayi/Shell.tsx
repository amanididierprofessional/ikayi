import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { BookUser, Cloud, HandCoins, Settings2, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { toast } from "sonner";
import { fullSync } from "@/lib/sync";
import { useI18n } from "@/lib/i18n";
import { getAccount, isRecoveryUrl } from "@/lib/auth";
import { ensureSupabase } from "@/lib/supabase";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/credit-db";
import {
  canRequestCreditChange,
  guestSignInRequested,
  GUEST_LIMIT,
  LedgerSession,
  readGuestActions,
  setGuestSignInRequested,
} from "@/lib/guest-ledger";
import { tour } from "@/lib/first-run";
import { enterAppMode, isAppMode } from "@/lib/app-mode";
import { AuthCard } from "./AuthCard";
import { useConnectivity } from "@/hooks/use-connectivity";
import logo from "@/assets/ikayi-logo.png";

const ledgerRoutes: string[] = ["/", "/i-owe", "/settings"];
let introComplete = false;
const GUIDE_DONE = "ikayi-guide-seen";
type Spotlight = { left: number; top: number; width: number; height: number };
const GUIDE_STEP = "ikayi-guide-step";
async function hasAccountSession() {
  const client = await ensureSupabase();
  const result = await client?.auth.getSession().catch(() => null);
  return Boolean(result?.data.session?.user);
}
const AUTO_SYNC_KEY = "ikayi-sync-mode";

/**
 * App chrome: header + content + Stoke-style floating bottom pill nav.
 * Layout matches lovable-sync / Stoke Yange — do not rename bottom-nav class.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { lang, setLang, t } = useI18n();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const online = useConnectivity();
  const navigate = useNavigate();
  const count = useLiveQuery(readGuestActions, []);
  const [intro, setIntro] = useState(!introComplete);
  const [introLeaving, setIntroLeaving] = useState(false);
  const [signinRequested, setSigninRequested] = useState(false);
  const tabIndex = ledgerRoutes.indexOf(path);
  const previousTab = useRef(tabIndex);
  const slideDirection = useMemo(() => {
    if (tabIndex === previousTab.current) return undefined;
    return tabIndex > previousTab.current ? "forward" : "backward";
  }, [tabIndex]);
  useEffect(() => {
    previousTab.current = tabIndex;
  }, [tabIndex]);
  const [motionReady, setMotionReady] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null);
  const guidePanel = useRef<HTMLElement>(null);
  const activeGuide = step === null ? undefined : tour[step];
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
    if (!intro) return;
    setMotionReady(true);
    const timer = window.setTimeout(
      () => {
        setIntroLeaving(true);
      },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1900,
    );
    return () => window.clearTimeout(timer);
  }, [intro]);

  const ready = !checking && count !== undefined;
  useEffect(() => {
    if (!intro || !introLeaving || !ready) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 430;
    const timer = window.setTimeout(() => {
      introComplete = true;
      setIntro(false);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [intro, introLeaving, ready]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [signedIn, records] = await Promise.all([hasAccountSession(), db.parties.count()]);
      if (cancelled) return;
      setAuthed(signedIn && !isRecoveryUrl());
      setSigninRequested(guestSignInRequested());
      if (!signedIn && !isRecoveryUrl() && !localStorage.getItem(GUIDE_DONE)) {
        const savedStep = sessionStorage.getItem(GUIDE_STEP);
        if (savedStep !== null || (!records && !getAccount())) setStep(Number(savedStep ?? 0));
        else localStorage.setItem(GUIDE_DONE, "1");
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (intro || !ready || signinRequested || !activeGuide || path !== activeGuide.target) return;
    const selector = step === 3 ? '[data-guide-target="add-person"]' : ".ikayi-guide-target";
    const target = document.querySelector(selector);
    if (!target) return;
    const panel = target.closest(".ikayi-tab-content");
    const measure = () => {
      if (panel?.getAnimations().some((animation) => animation.playState === "running")) return;
      const { left, top, width, height } = target.getBoundingClientRect();
      setSpotlight({ left: left - 4, top: top - 4, width: width + 8, height: height + 8 });
    };
    const motion = panel?.getAnimations() ?? [];
    if (motion.length)
      void Promise.allSettled(motion.map((animation) => animation.finished)).then(() => {
        if (target.isConnected) measure();
      });
    else measure();
    guidePanel.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [activeGuide, intro, path, ready, signinRequested, step]);

  const onAuthed = useCallback(async (isNewAccount = false) => {
    if (!(await hasAccountSession())) {
      toast.error("Huza telefone na murandasi maze wongere winjire cyangwa ufungure konti.");
      return;
    }
    setGuestSignInRequested(false);
    setSigninRequested(false);
    setAuthed(true);
    if (isNewAccount) setSyncSetupOpen(true);
  }, []);

  function requestChange(force = false) {
    if (!force && canRequestCreditChange(authed, count ?? 0)) return true;
    setGuestSignInRequested(true);
    setSigninRequested(true);
    return false;
  }

  function finishGuide() {
    localStorage.setItem(GUIDE_DONE, "1");
    sessionStorage.removeItem(GUIDE_STEP);
    setStep(null);
    setSpotlight(null);
  }

  function advanceGuide() {
    if (step === null) return;
    const next = tour[step + 1];
    if (!next) return finishGuide();
    sessionStorage.setItem(GUIDE_STEP, String(step + 1));
    setStep(step + 1);
    if (path !== next.target) void navigate({ to: next.target });
  }
  const finishSyncSetup = useCallback(
    (enabled: boolean) => {
      let saved = false;
      try {
        localStorage.setItem(AUTO_SYNC_KEY, enabled ? "auto" : "manual");
        saved = true;
      } catch {
        toast.error(
          lang === "rw"
            ? "Ihitamo ntiryabitswe. Ongera ugerageze mu igenamiterere."
            : "Your choice could not be saved. Try again in Settings.",
        );
      }
      setSyncSetupOpen(false);
      if (enabled && saved) {
        void fullSync().catch((error) => console.error("Initial automatic sync failed", error));
        toast.success(lang === "rw" ? "Guhuza amakuru byikora byemejwe" : "Automatic sync enabled");
      }
    },
    [lang],
  );
  const tabs = [
    { to: "/" as const, label: t("owesMe"), icon: BookUser },
    { to: "/i-owe" as const, label: t("iOwe"), icon: HandCoins },
    { to: "/settings" as const, label: t("settings"), icon: Settings2 },
  ];

  if (isLanding) {
    return <>{children}</>;
  }

  const startup = intro && (
    <div
      className="ikayi-startup"
      aria-hidden="true"
      data-animate={motionReady || undefined}
      data-leaving={(introLeaving && ready) || undefined}
    >
      <div className="ikayi-startup-content">
        <img src={logo} alt="" className="ikayi-startup-logo" />
        <h1 className="ikayi-startup-title">Ikayi Yange</h1>
        <p className="ikayi-startup-description">Bika amadeni n’inguzanyo bitakugoye</p>
      </div>
    </div>
  );
  const blocked =
    ready && !authed && ((signinRequested && count >= GUEST_LIMIT) || isRecoveryUrl());
  return (
    <>
      {startup}
      {!ready ? (
        !intro && <div className="min-h-dvh bg-background" />
      ) : blocked ? (
        <AuthCard onAuthed={onAuthed} guestLimit={signinRequested} />
      ) : (
        <div className="app-shell">
          <div inert={intro || Boolean(activeGuide)}>
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

            <main className="px-4 pb-32 pt-3">
              <div key={path} className="ikayi-tab-content" data-slide={slideDirection}>
                <LedgerSession.Provider value={{ authenticated: authed, requestChange }}>
                  {children}
                </LedgerSession.Provider>
              </div>
            </main>

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
                    <Link
                      to={to}
                      className={
                        step !== 3 && activeGuide?.target === to ? "ikayi-guide-target" : undefined
                      }
                      aria-label={label}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon className="size-5 shrink-0" />
                      {active && <span className="truncate text-sm font-semibold">{label}</span>}
                    </Link>
                  </Button>
                );
              })}
            </nav>
          </div>

          {!intro && activeGuide && (
            <>
              <div className="ikayi-tour-scrim" aria-hidden="true">
                {spotlight && <div className="ikayi-tour-spotlight" style={spotlight} />}
              </div>
              <aside
                ref={guidePanel}
                tabIndex={-1}
                className="ikayi-guide-panel"
                role="dialog"
                aria-modal="true"
                aria-label="Uko ukoresha Ikayi"
              >
                <h2 className="font-semibold">{activeGuide.title}</h2>
                <p className="mt-1 text-sm">{activeGuide.text}</p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={finishGuide}>
                    Simbuka
                  </Button>
                  <Button type="button" onClick={advanceGuide}>
                    {step === 3 ? "Tangira" : "Komeza"}
                  </Button>
                </div>
              </aside>
            </>
          )}

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
                <DrawerTitle>
                  {lang === "rw"
                    ? "Wifuza ko amakuru abikwa kuri murandasi?"
                    : "Back up your data automatically?"}
                </DrawerTitle>
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
                <Button
                  variant="outline"
                  className="h-12 w-full rounded-full"
                  onClick={() => finishSyncSetup(false)}
                >
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
      )}
    </>
  );
}
