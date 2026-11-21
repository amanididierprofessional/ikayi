import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, Mail, Phone, ArrowRight, ShieldCheck, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import {
  MIN_PASSWORD,
  isRecoveryUrl,
  recoverPhoneWithName,
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
  type LoginType,
} from "@/lib/auth";
import { ensureSupabase } from "@/lib/supabase";
import logo from "@/assets/ikayi-logo.png";

type Mode = "login" | "signup" | "forgot" | "newpassword";

export function AuthCard({
  onAuthed,
}: {
  onAuthed: () => void;
  onOffline?: () => void;
}) {
  const { lang, t } = useI18n();
  const rw = lang === "rw";
  const [tab, setTab] = useState<LoginType>("phone");
  const [mode, setMode] = useState<Mode>(() => (isRecoveryUrl() ? "newpassword" : "login"));
  const [show, setShow] = useState(false);
  const [ask, setAsk] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (isRecoveryUrl()) setMode("newpassword");
    let unsub: (() => void) | undefined;
    void (async () => {
      const client = await ensureSupabase();
      if (!client) return;
      const { data } = client.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") setMode("newpassword");
      });
      unsub = () => data.subscription.unsubscribe();
    })();
    return () => unsub?.();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // —— Forgot: email → reset link; phone → name + phone + new password ——
      if (mode === "forgot") {
        if (tab === "email") {
          const res = await requestPasswordReset(identifier, "email");
          if (res.ok) {
            setSent(true);
            toast.success(
              rw
                ? "Reba imeyili yawe (inbox + spam) — twohereje link"
                : "Check your email (inbox + spam) — we sent a reset link",
            );
            return;
          }
          if (res.error === "no_cloud" || res.error === "offline") {
            toast.error(rw ? "Ukeneye murandasi" : "You need internet");
            return;
          }
          toast.error(res.error || (rw ? "Kohereza byanze" : "Could not send email"));
          return;
        }

        // Phone recovery
        if (password !== password2) {
          toast.error(rw ? "Amajambo y'ibanga ntabwo ahura" : "Passwords do not match");
          return;
        }
        const res = await recoverPhoneWithName({
          displayName,
          phone: identifier,
          newPassword: password,
        });
        if (res.ok) {
          toast.success(rw ? "Ijambo ry'ibanga rihindutse — winjiye" : "Password updated — signed in");
          onAuthed();
          return;
        }
        if (res.error === "mismatch") {
          toast.error(
            rw
              ? "Izina cyangwa telefone ntabwo bihura n'ibyo wanditse"
              : "Name or phone does not match our records",
          );
          return;
        }
        if (res.error === "bad_name") {
          toast.error(rw ? "Shyiramo izina ryawe" : "Enter your name");
          return;
        }
        if (res.error === "bad_password") {
          toast.error(
            rw
              ? `Ijambo ry'ibanga byibuze ${MIN_PASSWORD}`
              : `Password at least ${MIN_PASSWORD} characters`,
          );
          return;
        }
        toast.error(
          rw
            ? "Kugarura byanze. Gerageza nanone cyangwa koresha email."
            : "Recovery failed. Try again or use email reset.",
        );
        return;
      }

      if (mode === "newpassword") {
        if (password !== password2) {
          toast.error(rw ? "Amajambo y'ibanga ntabwo ahura" : "Passwords do not match");
          return;
        }
        const res = await updatePassword(password);
        if (res.ok) {
          toast.success(rw ? "Ijambo ry'ibanga rihindutse" : "Password updated");
          if (typeof window !== "undefined" && window.history.replaceState) {
            window.history.replaceState(null, "", window.location.pathname || "/");
          }
          onAuthed();
          return;
        }
        toast.error(res.error || (rw ? "Guhindura byanze" : "Could not update password"));
        return;
      }

      if (mode === "login") {
        const res = await signIn({ loginType: tab, identifier, password });
        if (res.ok) {
          toast.success(rw ? "Winjiye neza" : "Signed in");
          onAuthed();
          return;
        }
        if (res.error === "wrong_credentials" || res.error === "bad_password") {
          toast.error(
            rw
              ? "Telefone/email cyangwa ijambo ry'ibanga ntabwo ari byo"
              : "Wrong phone/email or password",
          );
          return;
        }
        if (res.error === "confirmation_required") {
          toast.error(rw ? "Emeza email yawe mbere" : "Confirm your email first");
          return;
        }
        if (res.error === "no_account" || res.error === "mismatch") {
          if (!navigator.onLine) {
            setAsk(true);
            return;
          }
          toast.error(
            rw
              ? "Ntabwo winjiye. Gerageza cyangwa fungura konti"
              : "Could not sign in. Check details or create an account",
          );
          return;
        }
        toast.error(
          rw
            ? "Telefone/email cyangwa ijambo ry'ibanga ntabwo ari byo"
            : "Wrong phone/email or password",
        );
        return;
      }

      // Signup
      const res = await signUp({
        loginType: tab,
        identifier,
        password,
        displayName,
      });
      if (res.ok) {
        toast.success(rw ? "Konti yafunguwe" : "Account created");
        onAuthed();
        return;
      }
      if (res.error === "exists") {
        toast.message(rw ? "Konti isanzwe ihari — injira" : "Account already exists — sign in");
        setMode("login");
        return;
      }
      if (res.error === "bad_name") {
        toast.error(rw ? "Shyiramo izina rimwe (ryawe)" : "Enter one name (yours)");
        return;
      }
      if (res.error === "bad_password") {
        toast.error(
          rw
            ? `Ijambo ry'ibanga byibuze ${MIN_PASSWORD}`
            : `Password at least ${MIN_PASSWORD} characters`,
        );
        return;
      }
      toast.error(res.detail || (rw ? "Kwiyandikisha byanze" : "Sign up failed"));
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "forgot"
      ? rw
        ? "Wibagiwe ijambo ry'ibanga?"
        : "Forgot your password?"
      : mode === "newpassword"
        ? rw
          ? "Shyiraho ijambo ry'ibanga rishya"
          : "Set a new password"
        : mode === "login"
          ? rw
            ? "Murakaza neza kuri Ikayi Yange"
            : "Welcome to Ikayi Yange"
          : rw
            ? "Fungura konti ya Ikayi Yange"
            : "Create your Ikayi Yange account";

  return (
    <div className="auth-overlay">
      <section
        className="auth-card no-scrollbar"
        role="dialog"
        aria-modal="true"
        aria-label={rw ? "Injira muri Ikayi Yange" : "Sign in to Ikayi Yange"}
      >
        <img src={logo} alt="Ikayi Yange" className="mx-auto size-20 rounded-2xl" />
        <h2 className="mt-4 text-center text-xl font-bold sm:mt-5 sm:text-2xl">{title}</h2>
        <p className="mb-5 mt-2 text-center text-sm text-muted-foreground">
          {mode === "forgot"
            ? tab === "email"
              ? rw
                ? "Twakohereza link kuri imeyili yawe"
                : "We email a reset link to your address"
              : rw
                ? "Shyiramo izina n'telefone byanditswe, n'ijambo rishya"
                : "Enter your registered name, phone, and a new password"
            : mode === "newpassword"
              ? rw
                ? "Hitamo ijambo ry'ibanga woroshye kwibuka"
                : "Choose a password you can remember"
              : mode === "signup"
                ? rw
                  ? "Izina rimwe + telefone/email + ijambo ry'ibanga"
                  : "One name + phone/email + password"
                : rw
                  ? "Ikayi Yange · amadeni yawe"
                  : "Ikayi Yange · your credit book"}
        </p>

        {ask ? (
          <div className="space-y-4">
            <p className="text-center font-semibold">
              {rw ? "Uri mushya kuri Ikayi Yange?" : "New to Ikayi Yange?"}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="h-12 rounded-full" onClick={() => setAsk(false)}>
                {rw ? "Oya" : "No"}
              </Button>
              <Button
                className="h-12 rounded-full"
                onClick={() => {
                  setAsk(false);
                  setMode("signup");
                }}
              >
                {rw ? "Yego" : "Yes"}
              </Button>
            </div>
          </div>
        ) : mode === "forgot" && sent ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Mail className="size-7" />
            </div>
            <p className="text-sm font-medium">{rw ? "Reba imeyili yawe" : "Check your email"}</p>
            <p className="text-xs text-muted-foreground">
              {rw
                ? "Kanda link (cyangwa code). Reba n'isubiza (spam)."
                : "Open the link (or code). Check spam too."}
            </p>
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-full"
              onClick={() => {
                setSent(false);
                setMode("login");
              }}
            >
              {rw ? "Subira ku kwinjira" : "Back to sign in"}
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            {mode !== "newpassword" && (
              <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1" role="tablist">
                {(["phone", "email"] as const).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    variant="ghost"
                    className={`h-11 rounded-full ${
                      tab === k ? "bg-card text-primary shadow-card" : "text-muted-foreground"
                    }`}
                    onClick={() => setTab(k)}
                  >
                    {k === "phone" ? <Phone className="size-4" /> : <Mail className="size-4" />}
                    {t(k)}
                  </Button>
                ))}
              </div>
            )}

            {/* Name first on phone recovery & on signup */}
            {(mode === "signup" || (mode === "forgot" && tab === "phone")) && (
              <label className="block space-y-1.5 text-sm font-medium">
                {rw ? "Izina ryawe (rimwe)" : "Your name (one name)"}
                <Input
                  type="text"
                  autoComplete="given-name"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="h-12 rounded-xl text-base"
                  placeholder={rw ? "Urugero: Didier" : "e.g. Didier"}
                />
              </label>
            )}

            {mode !== "newpassword" && (
              <label className="block space-y-1.5 text-sm font-medium">
                {t(tab)}
                <Input
                  type={tab === "phone" ? "tel" : "email"}
                  autoComplete="username"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="h-12 rounded-xl text-base"
                  placeholder={tab === "phone" ? "07•• ••• •••" : "izina@example.com"}
                />
              </label>
            )}

            {(mode === "login" ||
              mode === "signup" ||
              mode === "newpassword" ||
              (mode === "forgot" && tab === "phone")) && (
              <label className="block space-y-1.5 text-sm font-medium">
                {mode === "newpassword" || (mode === "forgot" && tab === "phone")
                  ? rw
                    ? "Ijambo ry'ibanga rishya"
                    : "New password"
                  : t("password")}
                <div className="relative">
                  <Input
                    type={show ? "text" : "password"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                    minLength={MIN_PASSWORD}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 rounded-xl pr-12 text-base"
                    placeholder={rw ? `Byibuze ${MIN_PASSWORD}` : `At least ${MIN_PASSWORD}`}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Hide" : "Show"}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </label>
            )}

            {(mode === "newpassword" || (mode === "forgot" && tab === "phone")) && (
              <label className="block space-y-1.5 text-sm font-medium">
                {rw ? "Ongera wandike ijambo ry'ibanga" : "Confirm new password"}
                <Input
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD}
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  className="h-12 rounded-xl text-base"
                  placeholder={rw ? "Ongera wandike" : "Type again"}
                />
              </label>
            )}

            <Button type="submit" disabled={busy} className="h-12 w-full rounded-full text-base">
              {busy ? (
                t("pleaseWait")
              ) : mode === "forgot" ? (
                <>
                  <KeyRound className="size-4" />
                  {tab === "email"
                    ? rw
                      ? "Kohereza link"
                      : "Send reset link"
                    : rw
                      ? "Bika ijambo rishya"
                      : "Save new password"}
                </>
              ) : mode === "newpassword" ? (
                <>
                  {rw ? "Bika ijambo ry'ibanga" : "Save new password"}
                  <ArrowRight className="size-4" />
                </>
              ) : (
                <>
                  {mode === "login" ? t("signIn") : t("signUp")}
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>

            {mode === "login" && (
              <button
                type="button"
                className="w-full py-2 text-center text-xs font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => {
                  setSent(false);
                  setDisplayName("");
                  setPassword("");
                  setPassword2("");
                  setMode("forgot");
                }}
              >
                {rw ? "Wibagiwe ijambo ry'ibanga?" : "Forgot your password?"}
              </button>
            )}

            {(mode === "login" || mode === "signup") && (
              <button
                type="button"
                className="w-full py-1 text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setMode(mode === "login" ? "signup" : "login")}
              >
                {mode === "login"
                  ? rw
                    ? "Uri mushya? Fungura konti"
                    : "New here? Create an account"
                  : rw
                    ? "Usanzwe ufite konti? Injira"
                    : "Already have an account? Sign in"}
              </button>
            )}

            {(mode === "forgot" || mode === "newpassword") && (
              <button
                type="button"
                className="w-full py-2 text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setSent(false);
                  setPassword("");
                  setPassword2("");
                  setDisplayName("");
                  setMode("login");
                }}
              >
                {rw ? "Subira ku kwinjira" : "Back to sign in"}
              </button>
            )}
          </form>
        )}

        <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Ikayi Yange · {rw ? "Amadeni yawe" : "Your credit book"}
        </p>
      </section>
    </div>
  );
}
