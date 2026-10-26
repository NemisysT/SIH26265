// Maturity / escalation monitor entry point for cron jobs and local development.
//   npm run monitor          # single pass (use from cron / Render cron job)
//   npm run monitor:watch    # loop every MONITOR_INTERVAL_MINUTES (default 60) for local dev
import { prisma } from "@/server/db";
import { runMonitor } from "@/server/jobs/monitor";

const watch = process.argv.includes("--watch");
const intervalMs = Math.max(1, Number(process.env.MONITOR_INTERVAL_MINUTES ?? 60)) * 60_000;

async function once() {
  const started = Date.now();
  const { runId, summary } = await runMonitor({ trigger: watch ? "SCHEDULE" : "CLI" });
  console.log(`[monitor] run ${runId} finished in ${Date.now() - started} ms`, JSON.stringify(summary));
}

async function main() {
  if (!watch) return once();
  for (;;) {
    try {
      await once();
    } catch (err) {
      console.error("[monitor] run failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main()
  .catch((err) => {
    console.error("[monitor] fatal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!watch) void prisma.$disconnect();
  });
