import { apiRoute } from "@/server/api";
import { generateReport } from "@/server/services/reports";

export const GET = apiRoute<{ kind: string }>(
  async (req, { actor, params }) => {
    const { csv, filename } = await generateReport(actor, params.kind, Object.fromEntries(req.nextUrl.searchParams));
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  },
  { rateLimit: [30, 60_000] },
);
