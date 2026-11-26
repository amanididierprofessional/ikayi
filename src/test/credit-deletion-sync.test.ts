import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, deletePerson, readVisibleLedger } from "@/lib/credit-db";
import { deleteCreditPerson, fullSync } from "@/lib/sync";

type Row = { local_id: number; user_id: string; [key: string]: unknown };
const cloud = vi.hoisted(() => {
  const rows = new Map<string, Row[]>();
  const uploads: string[] = [];
  return {
    rows,
    uploads,
    afterPaymentRead: undefined as (() => Promise<void>) | undefined,
    auth: { getSession: async () => ({ data: { session: { user: { id: "owner" } } } }) },
  };
});
vi.mock("@/lib/supabase", () => ({
  supabaseConfigured: true,
  ensureSupabase: async () => ({
    auth: cloud.auth,
    from: (table: string) => ({
      select: () => {
        let owner = "";
        let cursor = 0;
        const query = {
          eq: (_field: string, value: string) => {
            owner = value;
            return query;
          },
          gt: (_field: string, value: number) => {
            cursor = value;
            return query;
          },
          order: () => query,
          limit: async (limit: number) => {
            const data = (cloud.rows.get(table) ?? [])
              .filter((row) => row.user_id === owner && row.local_id > cursor)
              .sort((a, b) => a.local_id - b.local_id)
              .slice(0, limit);
            if (table === "payments" && cloud.afterPaymentRead) {
              const afterRead = cloud.afterPaymentRead;
              cloud.afterPaymentRead = undefined;
              await afterRead();
            }
            return { data };
          },
        };
        return query;
      },
      upsert: async (incoming: Row[]) => {
        cloud.uploads.push(table);
        const merged = new Map((cloud.rows.get(table) ?? []).map((row) => [row.local_id, row]));
        for (const row of incoming) merged.set(row.local_id, row);
        cloud.rows.set(table, [...merged.values()]);
        // Keep stale remote rows in this mock. The client must suppress them even
        // if a read raced the server-side cascading delete.
        return {};
      },
    }),
  }),
}));

afterEach(async () => {
  vi.unstubAllGlobals();
  localStorage.removeItem("ikayi-account");
  cloud.rows.clear();
  cloud.uploads.length = 0;
  cloud.afterPaymentRead = undefined;
  await db.delete();
});

describe("credit deletion sync", () => {
  const party = { id: 1, name: "Customer", phone: "", kind: "customer" as const, createdAt: 10 };
  const debt = { id: 2, partyId: 1, amount: 500, createdAt: 20 };
  const payment = { id: 3, partyId: 1, amount: 100, createdAt: 30 };

  it("opens a version-two ledger, preserves its balances and records an explicit deletion", async () => {
    const previous = new Dexie(db.name);
    previous.version(2).stores({
      parties: "id,kind,name",
      debts: "id,partyId,createdAt",
      payments: "id,partyId,createdAt",
      settings: "key",
      usage: "[date+path],date",
    });
    await previous.table("parties").add(party);
    await previous.table("debts").add(debt);
    await previous.table("payments").add(payment);
    previous.close();
    await db.open();

    expect(await db.parties.toArray()).toEqual([party]);
    expect(await db.debts.toArray()).toEqual([debt]);
    expect(await db.payments.toArray()).toEqual([payment]);
    expect(await db.deletedParties.count()).toBe(0);
    await deletePerson(1, "owner");
    expect(await db.deletedParties.get(1)).toEqual({ id: 1, owner: "owner" });
    expect(await db.debts.toArray()).toEqual([debt]);
    expect(await db.payments.toArray()).toEqual([payment]);
  });

  it("keeps an offline deletion through restart and repeated syncs", async () => {
    await db.open();
    vi.stubGlobal("navigator", { onLine: false });
    localStorage.setItem("ikayi-account", JSON.stringify({ supabaseUserId: "owner" }));
    await db.parties.add(party);
    await db.debts.add(debt);
    await db.payments.add(payment);
    await deleteCreditPerson(party.id);
    expect(await db.parties.get(party.id)).toEqual(party);
    expect(await readVisibleLedger()).toEqual({ parties: [], debts: [], payments: [] });
    db.close();
    await db.open();
    expect(await db.deletedParties.get(party.id)).toEqual({ id: party.id, owner: "owner" });
    vi.stubGlobal("navigator", { onLine: true });
    await deletePerson(4, "other-owner");
    await deletePerson(5);
    await db.parties.add({ ...party, id: 7 });
    const user_id = "owner";
    const created_at = new Date(10).toISOString();
    cloud.rows.set("parties", [
      { user_id, local_id: 1, name: "Old", kind: "customer", phone: "", created_at },
    ]);
    cloud.rows.set("debts", [{ user_id, local_id: 2, party_local_id: 1, amount: 500, created_at }]);
    cloud.rows.set("payments", [
      { user_id, local_id: 3, party_local_id: 1, amount: 100, created_at },
    ]);
    cloud.afterPaymentRead = async () => {
      await db.parties.add({ ...party, id: 8 });
    };

    expect(await fullSync()).toEqual({ ok: true });
    expect(cloud.uploads.slice(0, 2)).toEqual(["credit_party_deletions", "parties"]);
    expect(cloud.rows.get("credit_party_deletions")).toEqual([{ user_id, local_id: 1 }]);
    expect(await fullSync()).toEqual({ ok: true });
    expect(cloud.uploads.filter((table) => table === "credit_party_deletions")).toHaveLength(1);
    expect((await readVisibleLedger()).parties.map((row) => row.id)).toEqual([7, 8]);
    expect(await db.parties.toCollection().primaryKeys()).toEqual([1, 7, 8]);
    expect(await db.debts.toArray()).toEqual([debt]);
    expect(await db.payments.toArray()).toEqual([payment]);
  });
  it("hides a deletion received from another device while retaining the local data", async () => {
    await db.open();
    await db.parties.add(party);
    await db.debts.add(debt);
    await db.payments.add(payment);
    cloud.rows.set("credit_party_deletions", [{ user_id: "owner", local_id: party.id }]);
    expect(await fullSync()).toEqual({ ok: true });
    expect(await readVisibleLedger()).toEqual({ parties: [], debts: [], payments: [] });
    expect(await db.parties.get(party.id)).toEqual(party);
    expect(await db.debts.get(debt.id)).toEqual(debt);
    expect(await db.payments.get(payment.id)).toEqual(payment);
    expect(cloud.uploads).toEqual([]);
  });
});
