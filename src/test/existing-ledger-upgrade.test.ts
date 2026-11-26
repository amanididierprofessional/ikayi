import "fake-indexeddb/auto";
import Dexie from "dexie";
import { expect, it } from "vitest";
import { db, summarize } from "@/lib/credit-db";
import { readGuestActions } from "@/lib/guest-ledger";

it("opens an existing offline Android ledger without clearing it or counting old records as actions", async () => {
  const previous = new Dexie(db.name);
  previous.version(2).stores({
    parties: "id,kind,name",
    debts: "id,partyId,createdAt",
    payments: "id,partyId,createdAt",
    settings: "key",
    usage: "[date+path],date",
  });

  const parties = [
    { id: 100, name: "Sample customer", kind: "customer", phone: "", createdAt: 1 },
    { id: 200, name: "Sample supplier", kind: "supplier", phone: "", createdAt: 2 },
  ];
  const debts = [
    { id: 101, partyId: 100, amount: 1500, createdAt: 3, description: "Sample credit" },
    { id: 201, partyId: 200, amount: 2400, createdAt: 4, dueDays: 7 },
  ];
  const payments = [
    { id: 102, partyId: 100, amount: 500, createdAt: 5 },
    { id: 202, partyId: 200, amount: 200, createdAt: 6 },
  ];
  await previous.table("parties").bulkAdd(parties);
  await previous.table("debts").bulkAdd(debts);
  await previous.table("payments").bulkAdd(payments);
  await previous.table("settings").put({ key: "existing-setting", value: "preserved" });
  previous.close();

  await db.open();
  try {
    const saved = await Promise.all([
      db.parties.toArray(),
      db.debts.toArray(),
      db.payments.toArray(),
    ]);
    expect(saved).toEqual([parties, debts, payments]);
    expect(summarize(...saved).map(({ p, balance }) => [p.id, balance])).toEqual([
      [100, 1000],
      [200, 2200],
    ]);
    expect(await readGuestActions()).toBe(0);
    expect(await db.settings.get("existing-setting")).toEqual({
      key: "existing-setting",
      value: "preserved",
    });
  } finally {
    await db.delete();
  }
});
