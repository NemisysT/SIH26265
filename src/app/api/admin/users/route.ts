import { apiRoute, ok, parseJson } from "@/server/api";
import { createUser, createUserSchema, listUsers } from "@/server/services/admin";

export const GET = apiRoute(async (_req, { actor }) => ok(await listUsers(actor)));

export const POST = apiRoute(async (req, { actor }) => {
  const input = await parseJson(req, createUserSchema);
  const { passwordHash: _hidden, ...user } = await createUser(actor, input);
  return ok(user, 201);
});
