import { publicRoute, ok, parseJson } from "@/server/api";
import { registrationSchema } from "@/lib/validation";
import { registerInstitution } from "@/server/services/institutions";

export const POST = publicRoute(
  async (req) => {
    const input = await parseJson(req, registrationSchema);
    await registerInstitution(input);
    // Identical response whether or not the email already existed.
    return ok({ message: "Registration received. You can sign in once the Regulation Bureau approves your institution." }, 202);
  },
  { rateLimit: [5, 10 * 60_000] },
);
