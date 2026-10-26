import { prisma } from "../db";
import { dummyPasswordHash, verifyPassword } from "../auth/password";
import { createSession } from "../auth/session";
import { recordAudit } from "../audit";
import { SYSTEM_AUTH } from "../auth/system";
import { AppError } from "../errors";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const GENERIC = "The email or password is incorrect.";

/**
 * Password login with per-account lockout. Responses do not reveal whether an account exists,
 * and failed attempts never log the supplied password.
 */
export async function login(email: string, password: string, meta: { ip?: string; userAgent?: string }) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    await verifyPassword(password, await dummyPasswordHash());
    throw new AppError(401, "INVALID_CREDENTIALS", GENERIC);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(429, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.");
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      await recordAudit(tx, SYSTEM_AUTH, {
        action: lock ? "LOGIN_LOCKED" : "LOGIN_FAILED",
        resourceType: "User",
        resourceId: user.id,
        institutionId: user.institutionId,
      });
    });
    throw new AppError(401, "INVALID_CREDENTIALS", GENERIC);
  }
  if (user.status === "PENDING") {
    throw new AppError(403, "ACCOUNT_PENDING", "Your registration is awaiting approval by the Regulation Bureau.");
  }
  if (user.status !== "ACTIVE") throw new AppError(403, "ACCOUNT_DISABLED", "This account is disabled. Contact the administrator.");

  const session = await createSession(user.id, meta);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await recordAudit(tx, SYSTEM_AUTH, { action: "LOGIN_SUCCEEDED", resourceType: "User", resourceId: user.id, institutionId: user.institutionId });
  });
  return { session, user: { id: user.id, role: user.role, name: user.name } };
}
