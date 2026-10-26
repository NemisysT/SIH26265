// Server-side sessions: an opaque random token in an HttpOnly cookie; only its SHA-256 is stored.
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "../db";
import { env } from "../env";
import type { Actor } from "./actor";
import { UnauthenticatedError } from "../errors";
import type { RoleName } from "./permissions";

export const SESSION_COOKIE = "sdp_session";
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour of inactivity

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.sessionTtlHours * 3600_000);
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt,
      ipAddress: meta.ip?.slice(0, 64),
      userAgent: meta.userAgent?.slice(0, 256),
    },
  });
  return { token, expiresAt };
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}

/** Resolve a session token to an Actor, enforcing expiry, idle timeout and account status. */
export async function actorFromToken(token: string | undefined): Promise<Actor | null> {
  if (!token || token.length > 128) return null;
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { include: { officerRegions: true, institution: { select: { status: true } } } } },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  const u = session.user;
  if (u.status !== "ACTIVE") return null;
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return {
    kind: "user",
    id: u.id,
    role: u.role as RoleName,
    name: u.name,
    email: u.email,
    institutionId: u.institutionId,
    regionIds: u.officerRegions.map((r) => r.regionId),
  };
}

/** For server components and route handlers. */
export async function getCurrentActor(): Promise<Actor | null> {
  const store = await cookies();
  return actorFromToken(store.get(SESSION_COOKIE)?.value);
}

export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}
