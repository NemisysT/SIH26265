import { apiRoute } from "@/server/api";
import { downloadDocument } from "@/server/services/documents";

/**
 * Authorised document download. Storage paths are never exposed; the response is served with
 * nosniff + a sandbox CSP so a stored file cannot execute in the portal's origin.
 */
export const GET = apiRoute<{ id: string }>(
  async (req, { actor, params }) => {
    const { doc, buffer } = await downloadDocument(actor, params.id);
    const inline = req.nextUrl.searchParams.get("inline") === "1";
    const asciiName = doc.originalName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": doc.mimeType,
        "content-length": String(buffer.length),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        "cache-control": "private, no-store",
        "x-document-sha256": doc.sha256,
      },
    });
  },
  { rateLimit: [60, 60_000] },
);
