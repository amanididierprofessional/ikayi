import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { addPerson, db, deletePerson } from "@/lib/credit-db";
import { GUEST_LIMIT, readGuestActions, saveCreditAction } from "@/lib/guest-ledger";

it("counts only saved changes across both books and locks on the tenth change", async () => {
  const add = (name: string, kind: "customer" | "supplier") =>
    saveCreditAction(false, () => addPerson(name, "", kind, 0, ""));
  await expect(add("", "customer")).rejects.toThrow();
  expect(await readGuestActions()).toBe(0);

  await add("Customer", "customer");
  const person = await db.parties.where("kind").equals("customer").first();
  if (!person) throw new Error("Missing customer");
  await saveCreditAction(false, () => db.parties.update(person.id, { name: "Edited" }));
  expect(await readGuestActions()).toBe(2);
  await saveCreditAction(false, () => deletePerson(person.id));
  for (let i = 0; i < 6; i++) await add("Supplier " + i, "supplier");

  const results = await Promise.allSettled([add("Tenth", "customer"), add("Blocked", "supplier")]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  db.close();
  await db.open();
  expect(await readGuestActions()).toBe(GUEST_LIMIT);
  expect(await db.parties.count()).toBe(7);
  await saveCreditAction(true, () => addPerson("Signed in", "", "customer", 0, ""));
  expect(await db.parties.count()).toBe(8);
  expect(await readGuestActions()).toBe(GUEST_LIMIT);
});
