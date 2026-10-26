// Append-only audit trail. Always written inside the same transaction as the change it records,
// so a change can never commit without its audit event (and vice versa).
import type { Prisma } from "@prisma/client";
import type { Db } from "./db";
import { actorLabel, type AnyActor } from "./auth/actor";
import { currentContext } from "./context";
import { now } from "./clock";

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId: string;
  institutionId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Convert Decimals/Dates/BigInts to JSON-safe primitives for storage. */
export function toAuditJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v && typeof v === "object" && typeof (v as { toFixed?: unknown }).toFixed === "function" && "d" in v) {
        return (v as { toString(): string }).toString(); // Prisma.Decimal
      }
      return v;
    }),
  );
}

export async function recordAudit(db: Db, actor: AnyActor, input: AuditInput) {
  const ctx = currentContext();
  await db.auditEvent.create({
    data: {
      actorId: actor.kind === "user" ? actor.id : null,
      actorRole: actor.kind === "user" ? actor.role : "SYSTEM",
      actorLabel: actorLabel(actor),
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      institutionId: input.institutionId ?? null,
      before: toAuditJson(input.before),
      after: toAuditJson(input.after),
      reason: input.reason ?? null,
      correlationId: ctx?.correlationId ?? null,
      ipAddress: ctx?.ip ?? null,
      createdAt: now(),
    },
  });
}

/** Pick only the keys whose values changed, for compact before/after records. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const prev = before[key];
    const next = after[key];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v?.toString?.() ?? v);
    if (norm(prev) !== norm(next)) {
      b[key] = prev;
      a[key] = next;
    }
  }
  return { before: b, after: a, changed: Object.keys(a) };
}
