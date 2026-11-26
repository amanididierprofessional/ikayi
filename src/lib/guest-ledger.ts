import { createContext, useContext } from "react";
import { db } from "@/lib/credit-db";

export const GUEST_LIMIT = 10;
const ACTIONS_KEY = "guest-credit-actions";
const PROMPT_KEY = "ikayi-guest-signin-requested";
export class GuestLimitError extends Error {}
export const LedgerSession = createContext({
  authenticated: false,
  requestChange: (_force?: boolean): boolean => true,
});

export function guestSignInRequested() {
  return localStorage.getItem(PROMPT_KEY) === "1";
}

export function setGuestSignInRequested(value: boolean) {
  if (value) localStorage.setItem(PROMPT_KEY, "1");
  else localStorage.removeItem(PROMPT_KEY);
}

export function canRequestCreditChange(authenticated: boolean, completed: number) {
  return authenticated || completed < GUEST_LIMIT;
}
export const useLedgerSession = () => useContext(LedgerSession);

export async function readGuestActions() {
  const saved = await db.settings.get(ACTIONS_KEY);
  return Number(saved?.value ?? 0);
}

export async function saveCreditAction(authenticated: boolean, change: () => Promise<unknown>) {
  if (authenticated) return change();
  return db.transaction("rw", db.settings, db.parties, db.debts, db.payments, async () => {
    const completed = await readGuestActions();
    if (completed >= GUEST_LIMIT) {
      throw new GuestLimitError("Fungura konti cyangwa winjire kugira ngo ukomeze.");
    }
    await change();
    await db.settings.put({ key: ACTIONS_KEY, value: String(completed + 1) });
  });
}
