import { apiRoute, ok, parseJson } from "@/server/api";
import { instrumentDraftSchema } from "@/lib/validation";
import { createDraft } from "@/server/services/instruments";
import { searchInstruments } from "@/server/services/search";
import { clampPage } from "@/server/services/common";

export const GET = apiRoute(async (req, { actor }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const paging = clampPage(Number(sp.page), Number(sp.pageSize));
  const { rows, total, totalAmount } = await searchInstruments(actor, sp, paging);
  return ok({ rows, total, totalAmount, page: paging.page, pageSize: paging.pageSize });
});

export const POST = apiRoute(async (req, { actor }) => {
  const input = await parseJson(req, instrumentDraftSchema);
  return ok(await createDraft(actor, input), 201);
});
