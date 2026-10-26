import { apiRoute, ok } from "@/server/api";
import { listNotifications } from "@/server/services/activity";
import { clampPage } from "@/server/services/common";

export const GET = apiRoute(async (req, { actor }) => {
  const sp = req.nextUrl.searchParams;
  const paging = clampPage(Number(sp.get("page")), Number(sp.get("pageSize")));
  return ok(await listNotifications(actor, { unreadOnly: sp.get("unread") === "1" }, paging));
});
