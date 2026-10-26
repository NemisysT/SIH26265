import { NextResponse } from "next/server";
import { publicRoute, parseJson } from "@/server/api";
import { loginSchema } from "@/lib/validation";
import { login } from "@/server/services/auth";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";

export const POST = publicRoute(
  async (req, { ip }) => {
    const { email, password } = await parseJson(req, loginSchema);
    const { session, user } = await login(email, password, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
    const res = NextResponse.json({ data: { role: user.role, name: user.name } });
    res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return res;
  },
  { rateLimit: [10, 60_000] },
);
