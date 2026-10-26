import { NextResponse } from "next/server";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

// `app` lets launchers and monitors confirm they reached THIS application (not another process on
// the port). Nothing sensitive is reported.
const APP = "sdp-portal";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ app: APP, status: "ok", database: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ app: APP, status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
