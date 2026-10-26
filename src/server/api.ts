// Route-handler wrapper: authentication, CSRF origin checks, request context, input parsing and
// centralised error mapping. Every API route goes through `apiRoute`.
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";
import { Prisma } from "@prisma/client";
import { AppError, ForbiddenError, UnauthenticatedError, ValidationError } from "./errors";
import { actorFromToken, SESSION_COOKIE } from "./auth/session";
import type { Actor } from "./auth/actor";
import { env } from "./env";
import { newCorrelationId, runWithContext } from "./context";
import { checkRateLimit } from "./rate-limit";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_JSON_BYTES = 256 * 1024;

export interface RouteCtx<P> {
  actor: Actor;
  params: P;
  correlationId: string;
  ip: string;
}

interface Options {
  /** Per-IP limit for this route: [requests, windowMs]. */
  rateLimit?: [number, number];
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests must carry an Origin
 * (or Referer) matching this application. Combined with SameSite=Lax session cookies.
 */
export function isTrustedOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin") ?? (req.headers.get("referer") ? safeOrigin(req.headers.get("referer")!) : null);
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const selfOrigin = host ? `${proto}://${host}` : null;
  return origin === selfOrigin || env.allowedOrigins.includes(origin);
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function errorResponse(err: unknown, correlationId: string): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.details ?? {}) }, correlationId },
      { status: err.status },
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: { code: "VALIDATION_FAILED", message: "Some fields are invalid.", fieldErrors: z.flattenError(err).fieldErrors },
        correlationId,
      },
      { status: 400 },
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return NextResponse.json(
      { error: { code: "DUPLICATE", message: "This action conflicts with an existing record (it may already have been processed)." }, correlationId },
      { status: 409 },
    );
  }
  // Unknown failure: log server-side with the correlation id; never leak internals to the client.
  console.error(`[api] unhandled error correlationId=${correlationId}`, err instanceof Error ? err.stack ?? err.message : err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "The request could not be completed. No changes were confirmed." }, correlationId },
    { status: 500 },
  );
}

type Handler<P> = (req: NextRequest, ctx: RouteCtx<P>) => Promise<Response>;
type PublicHandler<P> = (req: NextRequest, ctx: Omit<RouteCtx<P>, "actor"> & { actor: Actor | null }) => Promise<Response>;
type Segment<P> = { params: Promise<P> };

/** Authenticated API route. */
export function apiRoute<P = Record<string, never>>(handler: Handler<P>, opts: Omit<Options, "public"> = {}) {
  return wrap<P>((req, ctx) => {
    if (!ctx.actor) throw new UnauthenticatedError();
    return handler(req, ctx as RouteCtx<P>);
  }, opts);
}

/** Unauthenticated API route (sign-in, registration). CSRF origin checks still apply. */
export function publicRoute<P = Record<string, never>>(handler: PublicHandler<P>, opts: Omit<Options, "public"> = {}) {
  return wrap<P>(handler, opts);
}

function wrap<P>(handler: PublicHandler<P>, opts: Options) {
  return async (req: NextRequest, segment: Segment<P>) => {
    const correlationId = newCorrelationId();
    const ip = clientIp(req);
    return runWithContext({ correlationId, ip, userAgent: req.headers.get("user-agent") ?? undefined }, async () => {
      try {
        if (!SAFE_METHODS.has(req.method) && !isTrustedOrigin(req)) {
          throw new ForbiddenError("Request origin could not be verified.");
        }
        if (opts.rateLimit) {
          checkRateLimit(`${req.nextUrl.pathname}:${ip}`, opts.rateLimit[0], opts.rateLimit[1]);
        }
        const actor = await actorFromToken(req.cookies.get(SESSION_COOKIE)?.value);
        const params = ((await segment?.params) ?? {}) as P;
        const res = await handler(req, { actor, params, correlationId, ip });
        res.headers.set("x-correlation-id", correlationId);
        if (!res.headers.has("cache-control")) res.headers.set("cache-control", "no-store");
        return res;
      } catch (err) {
        return errorResponse(err, correlationId);
      }
    });
  };
}

export async function parseJson<T extends ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_JSON_BYTES) throw new ValidationError("Request body is too large.");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Some fields are invalid.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  }
  return parsed.data;
}

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}
