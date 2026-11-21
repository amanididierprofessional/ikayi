import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, Mail, Phone, ArrowRight, ShieldCheck, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import {
  MIN_PASSWORD,
  finishEmailRecoveryPassword,
  isRecoveryUrl,
  recoverPhoneWithName,
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
  verifyEmailRecoveryCode,
  verifyPhoneName,
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
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  /** Email: code matched → show password card only */
  const [emailCodeOk, setEmailCodeOk] = useState(false);

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
      // —— Email recovery step 2: password only (code already OK) ——
      if (mode === "forgot" && tab === "email" && emailCodeOk) {
        if (password !== password2) {
          toast.error(rw ? "Amajambo y'ibanga ntabwo ahura" : "Passwords do not match");
          return;
        }
        const res = await finishEmailRecoveryPassword(password);
        if (res.ok) {
          toast.success(rw ? "Ijambo ry'ibanga rihindutse — winjiye" : "Password updated — signed in");
          onAuthed();
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
        toast.error(res.error || (rw ? "Byanze" : "Failed"));
        return;
      }

      // —— Email recovery step 1: code only ——
      if (mode === "forgot" && tab === "email" && sent && !emailCodeOk) {
        const res = await verifyEmailRecoveryCode({ email: identifier, token: otp });
        if (res.ok) {
          setEmailCodeOk(true);
          setPassword("");
          setPassword2("");
          toast.success(
            rw ? "Code ni yo — shyiraho ijambo ry'ibanga rishya" : "Code correct — set a new password",
          );
          return;
        }
        if (res.error === "bad_token" || /token|otp|invalid|expired/i.test(res.error)) {
          toast.error(
            rw
              ? "Code ntabwo ari yo cyangwa yarangiye"
              : "Code is wrong or expired",
          );
          return;
        }
        toast.error(res.error || (rw ? "Byanze" : "Failed"));
        return;
      }

      if (mode === "forgot") {
        if (tab === "email") {
          const res = await requestPasswordReset(identifier, "email");
          if (res.ok) {
            setSent(true);
            setEmailCodeOk(false);
            setOtp("");
            toast.success(
              rw ? "Reba imeyili — shyiramo code gusa" : "Check your email — enter the code only",
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

        if (!phoneVerified) {
          const res = await verifyPhoneName({ displayName, phone: identifier });
          if (res.ok) {
            setPhoneVerified(true);
            toast.success(
              rw ? "Byemejwe — shyiraho ijambo ry'ibanga rishya" : "Verified — set your new password",
            );
            return;
          }
          if (res.error === "mismatch") {
            toast.error(
              rw
                ? "Izina cyangwa telefone ntabwo bihura n'ibyo byanditswe"
                : "Name or phone does not match our records",
            );
            return;
          }
          if (res.error === "rpc_missing") {
            toast.error(
              rw
                ? "Koresha SQL phone_recovery_all mu Supabase"
                : "Run phone_recovery_all SQL in Supabase",
            );
            return;
          }
          toast.error(rw ? "Kugerageza byanze" : "Could not verify");
          return;
        }

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
          toast.success(rw ? "Winjiye" : "Signed in");
          onAuthed();
          return;
        }
        if (res.error === "rpc_missing") {
          toast.error(
            rw ? "Koresha SQL phone_recovery_all mu Supabase" : "Run phone_recovery_all SQL in Supabase",
          );
          return;
        }
        toast.error(rw ? "Guhindura byanze" : "Could not update password");
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
        if (res.error === "no_account" || res.error === "mismatch") {
          if (!navigator.onLine) {
            setAsk(true);
            return;
          }
          toast.error(rw ? "Ntabwo winjiye" : "Could not sign in");
          return;
        }
        toast.error(
          rw
            ? "Telefone/email cyangwa ijambo ry'ibanga ntabwo ari byo"
            : "Wrong phone/email or password",
        );
        return;
      }

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
        toast.error(rw ? "Shyiramo izina rimwe" : "Enter one name");
        return;
      }
      toast.error(res.detail || (rw ? "Kwiyandikisha byanze" : "Sign up failed"));
    } finally {
      setBusy(false);
    }
  }

  const phoneStep1 = mode === "forgot" && tab === "phone" && !phoneVerified;
  const phoneStep2 = mode === "forgot" && tab === "phone" && phoneVerified;
  const emailCodeStep = mode === "forgot" && tab === "email" && sent && !emailCodeOk;
  const emailPassStep = mode === "forgot" && tab === "email" && emailCodeOk;

  const title = emailPassStep || phoneStep2 || mode === "newpassword"
    ? rw
      ? "Shyiraho ijambo ry'ibanga rishya"
      : "Set a new password"
    : emailCodeStep
      ? rw
        ? "Shyiramo code yo muri email"
        : "Enter the code from email"
      : mode === "forgot"
        ? rw
          ? "Wibagiwe ijambo ry'ibanga?"
          : "Forgot your password?"
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
          {emailCodeStep
            ? rw
              ? "Shyiramo code gusa — niba ihuye tuzaguha form y'ijambo rishya"
              : "Enter the code only — if it matches, we show the new password form"
            : emailPassStep
              ? rw
                ? "Code yemejwe. Hitamo ijambo ry'ibanga rishya"
                : "Code verified. Choose a new password"
              : phoneStep1
                ? rw
                  ? "Shyiramo izina n'telefone byanditswe gusa"
                  : "Enter only your registered name and phone"
                : phoneStep2
                  ? rw
                    ? "Byemejwe. Hitamo ijambo ry'ibanga rishya"
                    : "Verified. Choose a new password"
                  : mode === "forgot" && tab === "email"
                    ? rw
                      ? "Twakohereza code kuri imeyili yawe"
                      : "We send a code to your email"
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
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            {mode !== "newpassword" && !phoneStep2 && !emailCodeStep && !emailPassStep && (
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
                    onClick={() => {
                      setTab(k);
                      setPhoneVerified(false);
                      setSent(false);
                      setEmailCodeOk(false);
                    }}
                  >
                    {k === "phone" ? <Phone className="size-4" /> : <Mail className="size-4" />}
                    {t(k)}
                  </Button>
                ))}
              </div>
            )}

            {(mode === "signup" || phoneStep1) && (
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

            {mode !== "newpassword" && !phoneStep2 && !emailCodeStep && !emailPassStep && (
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

            {emailCodeStep && (
              <>
                <p className="text-center text-xs text-muted-foreground">{identifier}</p>
                <label className="block space-y-1.5 text-sm font-medium">
                  {rw ? "Code yo muri email (6)" : "Code from email (6 digits)"}
                  <Input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    maxLength={8}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
                    className="h-14 rounded-xl text-center text-2xl font-bold tracking-[0.35em]"
                    placeholder="••••••"
                  />
                </label>
              </>
            )}

            {(mode === "login" ||
              mode === "signup" ||
              mode === "newpassword" ||
              phoneStep2 ||
              emailPassStep) && (
              <label className="block space-y-1.5 text-sm font-medium">
                {mode === "newpassword" || phoneStep2 || emailPassStep
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

            {(mode === "newpassword" || phoneStep2 || emailPassStep) && (
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
              ) : emailCodeStep ? (
                <>
                  <KeyRound className="size-4" />
                  {rw ? "Emeza code" : "Verify code"}
                </>
              ) : emailPassStep || phoneStep2 || mode === "newpassword" ? (
                <>
                  {rw ? "Bika ijambo ry'ibanga" : "Save new password"}
                  <ArrowRight className="size-4" />
                </>
              ) : phoneStep1 ? (
                <>
                  <KeyRound className="size-4" />
                  {rw ? "Emeza izina n'telefone" : "Verify name & phone"}
                </>
              ) : mode === "forgot" && tab === "email" ? (
                <>
                  <KeyRound className="size-4" />
                  {rw ? "Kohereza code" : "Send code"}
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
                  setEmailCodeOk(false);
                  setPhoneVerified(false);
                  setOtp("");
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
                  setEmailCodeOk(false);
                  setPhoneVerified(false);
                  setOtp("");
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
