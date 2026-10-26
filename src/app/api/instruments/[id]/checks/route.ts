import { apiRoute, ok } from "@/server/api";
import { rerunChecks } from "@/server/services/verification";
import { loadScopedInstrument } from "@/server/services/instruments";
import { computeInstrumentFindings } from "@/server/services/checks";
import { prisma } from "@/server/db";

/** Preview findings without recording them (e.g. for a draft before submission). */
export const GET = apiRoute<{ id: string }>(async (_req, { actor, params }) => {
  await loadScopedInstrument(prisma, actor, params.id);
  return ok(await prisma.$transaction((tx) => computeInstrumentFindings(tx, params.id)));
});

/** Officer re-check: reconciles automated discrepancies and records the run. */
export const POST = apiRoute<{ id: string }>(async (_req, { actor, params }) => ok(await rerunChecks(actor, params.id)));
