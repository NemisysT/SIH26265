import { apiRoute, ok } from "@/server/api";
import { listInstitutions } from "@/server/services/institutions";
import { clampPage } from "@/server/services/common";

export const GET = apiRoute(async (req, { actor }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const paging = clampPage(Number(sp.page), Number(sp.pageSize));
  return ok(await listInstitutions(actor, sp, paging));
});
