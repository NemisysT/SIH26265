import { apiRoute, ok } from "@/server/api";
import { readMultipart } from "@/server/multipart";
import { createReleaseRequest, createReleaseSchema, listReleaseRequests } from "@/server/services/releases";
import { clampPage } from "@/server/services/common";
import { ValidationError } from "@/server/errors";
import { z } from "zod";

export const GET = apiRoute(async (req, { actor }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const paging = clampPage(Number(sp.page), Number(sp.pageSize));
  return ok(await listReleaseRequests(actor, { q: sp.q, status: sp.status, view: sp.view as "open" }, paging));
});

/** Multipart: request fields + at least one supporting document, created atomically. */
export const POST = apiRoute(
  async (req, { actor }) => {
    const { fields, files } = await readMultipart(req, 5);
    const parsed = createReleaseSchema.safeParse({ ...fields, clientRequestId: fields.clientRequestId || undefined });
    if (!parsed.success) throw new ValidationError("Some fields are invalid.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
    return ok(await createReleaseRequest(actor, parsed.data, files), 201);
  },
  { rateLimit: [20, 60_000] },
);
