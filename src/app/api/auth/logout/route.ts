import { NextResponse } from "next/server";
import { publicRoute } from "@/server/api";
import { destroySession, SESSION_COOKIE } from "@/server/auth/session";

export const POST = publicRoute(
  async (req) => {
    await destroySession(req.cookies.get(SESSION_COOKIE)?.value);
    const res = NextResponse.json({ data: { ok: true } });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  },
);
