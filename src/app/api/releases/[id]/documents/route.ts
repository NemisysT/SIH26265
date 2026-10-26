import { z } from "zod";
import { apiRoute, ok } from "@/server/api";
import { readMultipart } from "@/server/multipart";
import { uploadDocument } from "@/server/services/documents";
import { ValidationError } from "@/server/errors";

const docType = z.enum(["RELEASE_SUPPORTING", "RELEASE_COMPLETION_EVIDENCE", "OTHER"]);

export const POST = apiRoute<{ id: string }>(
  async (req, { actor, params }) => {
    const { fields, files } = await readMultipart(req, 1);
    const type = docType.safeParse(fields.docType);
    if (!type.success) throw new ValidationError("Choose a valid document type.", { docType: ["Invalid"] });
    if (files.length !== 1) throw new ValidationError("Choose one file to upload.", { file: ["Required"] });
    const { storageKey: _hidden, ...safe } = await uploadDocument(actor, { releaseRequestId: params.id, docType: type.data }, files[0]);
    return ok(safe, 201);
  },
  { rateLimit: [30, 60_000] },
);
