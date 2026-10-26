// Helpers for server-rendered pages. Pages call the same scoped services as the API, so a page can
// never show more than the API would return.
import { notFound, redirect } from "next/navigation";
import { getCurrentActor } from "./auth/session";
import type { Actor } from "./auth/actor";
import { can } from "./auth/scope";
import type { Permission } from "./auth/permissions";
import { AppError } from "./errors";

export async function requirePageActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  return actor;
}

/** Missing permission renders as "not found" — hidden navigation is not the access control. */
export async function requirePagePermission(permission: Permission): Promise<Actor> {
  const actor = await requirePageActor();
  if (!can(actor, permission)) notFound();
  return actor;
}

/** Map service NotFound/Forbidden errors to the 404 page; rethrow everything else. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof AppError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function flatParams(sp: SearchParams): Promise<Record<string, string | undefined>> {
  const raw = await sp;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}
