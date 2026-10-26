import { apiRoute, ok } from "@/server/api";
import { listAudit } from "@/server/services/activity";
import { clampPage } from "@/server/services/common";

export const GET = apiRoute(async (req, { actor }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const paging = clampPage(Number(sp.page), Number(sp.pageSize));
  const { rows, total } = await listAudit(actor, sp, paging);
  return ok({ rows: rows.map((r) => ({ ...r, id: r.id.toString() })), total });
});
