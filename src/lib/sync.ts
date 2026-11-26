import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccount } from "@/lib/auth";
import { db, deletePerson, readVisibleLedger, type Entry, type Party } from "@/lib/credit-db";
import { ensureSupabase, supabaseConfigured } from "@/lib/supabase";

export type SyncResult = { ok: true } | { ok: false; reason: string };
type CreditTable = "credit_party_deletions" | "parties" | "debts" | "payments";
type CloudRow = { local_id: number };
type CloudParty = CloudRow & {
  name: string;
  phone: string;
  kind: Party["kind"];
  created_at: string;
};
type CloudEntry = CloudRow & {
  party_local_id: number;
  amount: number;
  created_at: string;
  description?: string;
  due_days?: number | null;
};

const PAGE_SIZE = 500;

async function sessionUserId(client: SupabaseClient) {
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function deleteCreditPerson(partyId: number) {
  const savedOwner = getAccount()?.supabaseUserId;
  const client = await ensureSupabase();
  const owner =
    client && navigator.onLine
      ? ((await sessionUserId(client).catch(() => null)) ?? savedOwner)
      : savedOwner;
  // A device-only deletion still suppresses stale local pulls. Only an identified
  // account can send a deletion to a cloud ledger.
  await deletePerson(partyId, owner);
}

async function readRows<T extends CloudRow>(
  client: SupabaseClient,
  table: CreditTable,
  owner: string,
) {
  const rows: T[] = [];
  let cursor = 0;
  while (true) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .eq("user_id", owner)
      .gt("local_id", cursor)
      .order("local_id")
      .limit(PAGE_SIZE);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    const last = page.at(-1);
    if (!last) return rows;
    rows.push(...page);
    cursor = last.local_id;
  }
}

async function upload(client: SupabaseClient, table: CreditTable, rows: object[]) {
  for (let offset = 0; offset < rows.length; offset += PAGE_SIZE) {
    const { error } = await client.from(table).upsert(rows.slice(offset, offset + PAGE_SIZE), {
      onConflict: "user_id,local_id",
      ignoreDuplicates: table === "credit_party_deletions",
    });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function rememberDeletions(owner: string, ids: number[]) {
  if (!ids.length) return;
  await db.transaction("rw", db.deletedParties, async () => {
    // Keep local markers intact, including device-only deletions.
    const existing = await db.deletedParties.bulkGet(ids);
    await db.deletedParties.bulkAdd(
      ids.filter((_, index) => !existing[index]).map((id) => ({ id, owner })),
    );
  });
}

async function pushAccount(client: SupabaseClient, owner: string) {
  const deleted = await readRows(client, "credit_party_deletions", owner);
  await rememberDeletions(
    owner,
    deleted.map((row) => row.local_id),
  );
  const knownDeleted = new Set(deleted.map((row) => row.local_id));
  const [{ parties, debts, payments }, pending] = await db.transaction(
    "r",
    db.parties,
    db.debts,
    db.payments,
    db.deletedParties,
    () =>
      Promise.all([readVisibleLedger(), db.deletedParties.where("owner").equals(owner).toArray()]),
  );
  await upload(
    client,
    "credit_party_deletions",
    pending
      .filter(({ id }) => !knownDeleted.has(id))
      .map(({ id }) => ({ user_id: owner, local_id: id })),
  );
  const cloudEntry = (row: Entry) => ({
    user_id: owner,
    local_id: row.id,
    party_local_id: row.partyId,
    amount: row.amount,
    created_at: new Date(row.createdAt).toISOString(),
  });
  await upload(
    client,
    "parties",
    parties.map((row) => ({
      user_id: owner,
      local_id: row.id,
      name: row.name,
      phone: row.phone,
      kind: row.kind,
      created_at: new Date(row.createdAt).toISOString(),
    })),
  );
  await upload(
    client,
    "debts",
    debts.map((row) => ({
      ...cloudEntry(row),
      description: row.description ?? "",
      due_days: row.dueDays ?? null,
    })),
  );
  await upload(client, "payments", payments.map(cloudEntry));
}

function decodeEntry(row: CloudEntry): Entry {
  return {
    id: row.local_id,
    partyId: row.party_local_id,
    amount: Number(row.amount),
    createdAt: Date.parse(row.created_at),
    ...(row.description != null ? { description: row.description } : {}),
    ...(row.due_days != null ? { dueDays: row.due_days } : {}),
  };
}

async function pullAccount(client: SupabaseClient, owner: string) {
  const [parties, debts, payments] = await Promise.all([
    readRows<CloudParty>(client, "parties", owner),
    readRows<CloudEntry>(client, "debts", owner),
    readRows<CloudEntry>(client, "payments", owner),
  ]);
  const deleted = await readRows(client, "credit_party_deletions", owner);
  await rememberDeletions(
    owner,
    deleted.map((row) => row.local_id),
  );

  await db.transaction("rw", db.parties, db.debts, db.payments, db.deletedParties, async () => {
    const blocked = new Set(await db.deletedParties.toCollection().primaryKeys());
    const incomingParties = parties
      .filter((row) => !blocked.has(row.local_id))
      .map((row) => ({
        id: row.local_id,
        name: row.name,
        phone: row.phone,
        kind: row.kind,
        createdAt: Date.parse(row.created_at),
      }));
    const incomingDebts = debts.filter((row) => !blocked.has(row.party_local_id)).map(decodeEntry);
    const incomingPayments = payments
      .filter((row) => !blocked.has(row.party_local_id))
      .map(decodeEntry);

    // Merge without clearing IndexedDB. A phone can have rows that were added
    // while a sync was in flight and have never reached the cloud.
    const [existingParties, existingDebts, existingPayments] = await Promise.all([
      db.parties.bulkGet(incomingParties.map((row) => row.id)),
      db.debts.bulkGet(incomingDebts.map((row) => row.id)),
      db.payments.bulkGet(incomingPayments.map((row) => row.id)),
    ]);
    await db.parties.bulkAdd(incomingParties.filter((_, index) => !existingParties[index]));
    await db.debts.bulkAdd(incomingDebts.filter((_, index) => !existingDebts[index]));
    await db.payments.bulkAdd(incomingPayments.filter((_, index) => !existingPayments[index]));
  });
}

async function sync(
  action: (client: SupabaseClient, owner: string) => Promise<void>,
  requestedOwner?: string,
): Promise<SyncResult> {
  if (!supabaseConfigured) return { ok: false, reason: "no_cloud" };
  if (!navigator.onLine) return { ok: false, reason: "offline" };
  const client = await ensureSupabase();
  if (!client) return { ok: false, reason: "no_cloud" };
  const owner = await sessionUserId(client);
  if (!owner || (requestedOwner && requestedOwner !== owner))
    return { ok: false, reason: "no_session" };
  try {
    await action(client, owner);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "sync_failed" };
  }
}

export function fullSync() {
  return sync(async (client, owner) => {
    await pushAccount(client, owner);
    await pullAccount(client, owner);
  });
}

export function pushCredit(userId?: string) {
  return sync(pushAccount, userId);
}

export function pullCredit(userId?: string) {
  return sync(pullAccount, userId);
}

export async function checkRemoteAhead(): Promise<{ ahead: boolean }> {
  if (!supabaseConfigured || !navigator.onLine) return { ahead: false };
  const client = await ensureSupabase();
  if (!client) return { ahead: false };
  const uid = await sessionUserId(client);
  if (!uid) return { ahead: false };

  const { parties, debts, payments } = await readVisibleLedger();
  const localMax = Math.max(
    0,
    ...debts.map((d) => d.createdAt),
    ...payments.map((p) => p.createdAt),
    ...parties.map((p) => p.createdAt),
  );

  const { data } = await client
    .from("debts")
    .select("created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!data?.length) return { ahead: false };
  const remoteTs = new Date(data[0]?.created_at ?? 0).getTime();
  return { ahead: remoteTs > localMax + 2000 };
}
