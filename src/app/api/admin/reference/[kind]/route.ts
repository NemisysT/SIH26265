import { z } from "zod";
import { apiRoute, ok, parseJson } from "@/server/api";
import { createReference } from "@/server/services/admin";
import { NotFoundError } from "@/server/errors";

export const POST = apiRoute<{ kind: string }>(async (req, { actor, params }) => {
  if (params.kind !== "region" && params.kind !== "bank") throw new NotFoundError();
  const body = await parseJson(req, z.record(z.string(), z.unknown()));
  return ok(await createReference(actor, params.kind, body), 201);
});
