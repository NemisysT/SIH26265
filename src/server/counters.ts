import type { Db } from "./db";

/** Atomically allocate the next number in a named sequence (safe under concurrency). */
export async function nextSequence(db: Db, key: string): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "counters" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "counters"."value" + 1
    RETURNING "value"`;
  return Number(rows[0].value);
}

/** Human-friendly reference numbers, e.g. SDP-2026-00042. */
export async function nextReference(db: Db, prefix: string, year: number): Promise<string> {
  const n = await nextSequence(db, `${prefix}-${year}`);
  return `${prefix}-${year}-${String(n).padStart(5, "0")}`;
}
