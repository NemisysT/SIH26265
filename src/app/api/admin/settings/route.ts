import { z } from "zod";
import { apiRoute, ok, parseJson } from "@/server/api";
import { getSettings, updateSettings } from "@/server/settings";
import { requirePermission } from "@/server/auth/scope";

export const GET = apiRoute(async (_req, { actor }) => {
  requirePermission(actor, "admin:settings");
  return ok(await getSettings());
});

export const PUT = apiRoute(async (req, { actor }) => {
  requirePermission(actor, "admin:settings");
  const body = await parseJson(req, z.record(z.string(), z.unknown()));
  return ok(await updateSettings(actor, body));
});
