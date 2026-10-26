// Launcher helper: verify that DATABASE_URL accepts connections and report a specific, actionable
// reason when it does not. Never prints the connection password.
//   exit 0 ok · 2 unreachable · 3 authentication failed · 4 database missing · 1 other/misconfigured
import "./load-env";
import { PrismaClient } from "@prisma/client";

function describe(url: string | undefined): string {
  if (!url) return "(DATABASE_URL is not set)";
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "")} as ${decodeURIComponent(u.username)}`;
  } catch {
    return "(DATABASE_URL is not a valid URL)";
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  const target = describe(url);
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    console.error(`DATABASE_URL must be a postgresql:// URL ${target}`);
    return 1;
  }
  const withTimeout = url + (url.includes("?") ? "&" : "?") + "connect_timeout=5";
  const prisma = new PrismaClient({ datasources: { db: { url: withTimeout } }, log: [] });
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(`Database reachable: ${target}`);
    return 0;
  } catch (err) {
    // Prisma 6 does not populate `errorCode` on these initialization errors; classify by its
    // stable messages (P1001 / P1000 / P1003).
    const msg = (err as Error).message;
    const code = (err as { errorCode?: string }).errorCode ??
      (/Can't reach database server|database server is running|Timed out/i.test(msg) ? "P1001"
        : /Authentication failed|valid database credentials/i.test(msg) ? "P1000"
        : /Database `[^`]*` does not exist/i.test(msg) ? "P1003" : "");
    if (code === "P1001" || code === "P1002") {
      console.error(`Cannot reach PostgreSQL at ${target}.`);
      return 2;
    }
    if (code === "P1000") {
      console.error(`PostgreSQL rejected the credentials for ${target}.`);
      return 3;
    }
    if (code === "P1003") {
      console.log(`Server reachable; database does not exist yet (${target}). Migrations will create it.`);
      return 4;
    }
    console.error(`Database check failed for ${target}: ${(err as Error).message.split("\n").filter(Boolean).pop()}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => process.exit(code));
