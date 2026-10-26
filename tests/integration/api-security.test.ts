// HTTP-boundary security: route handlers invoked directly with real NextRequest objects.
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { buildWorld, submitted, type World } from "../helpers";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { errorResponse } from "@/server/api";
import { notify, processDeliveries } from "@/server/notifications/notify";
import { setEmailProvider } from "@/server/notifications/email-provider";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as getInstrument } from "@/app/api/instruments/[id]/route";
import { POST as transition } from "@/app/api/instruments/[id]/transitions/route";
import { GET as download } from "@/app/api/documents/[id]/route";
import { POST as upload } from "@/app/api/instruments/[id]/documents/route";

const ORIGIN = "http://localhost:3000";
let w: World;

async function cookieFor(userId: string) {
  const { token } = await createSession(userId, {});
  return `${SESSION_COOKIE}=${token}`;
}

function req(url: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null; form?: FormData } = {}) {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  headers.set("host", "localhost:3000");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`${ORIGIN}${url}`, {
    method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
    headers,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
}
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(async () => {
  w = await buildWorld();
});

describe("authentication", () => {
  it("logs in with a correct password, never reveals which part was wrong, and locks after repeated failures", async () => {
    await prisma.user.update({ where: { id: w.instA.id }, data: { passwordHash: await hashPassword("Right-pass-123") } });
    const ok = await login(req("/api/auth/login", { body: { email: "a@t.example", password: "Right-pass-123" } }), params({}));
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/sdp_session=/);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");

    const unknown = await login(req("/api/auth/login", { body: { email: "nobody@t.example", password: "x" } }), params({}));
    const wrong = await login(req("/api/auth/login", { body: { email: "a@t.example", password: "nope" } }), params({}));
    expect(unknown.status).toBe(401);
    expect((await unknown.json()).error.message).toBe((await wrong.json()).error.message);

    for (let i = 0; i < 4; i++) await login(req("/api/auth/login", { body: { email: "a@t.example", password: "nope" } }), params({}));
    const locked = await login(req("/api/auth/login", { body: { email: "a@t.example", password: "Right-pass-123" } }), params({}));
    expect(locked.status).toBe(429);
  });

  it("rejects unauthenticated API calls", async () => {
    const s = await submitted(w.instA);
    const res = await getInstrument(req(`/api/instruments/${s.id}`), params({ id: s.id }));
    expect(res.status).toBe(401);
  });
});

describe("direct API calls bypassing the UI", () => {
  it("enforces CSRF origin checks on state-changing requests", async () => {
    const s = await submitted(w.instA);
    const cookie = await cookieFor(w.officerNorth.id);
    const noOrigin = await transition(req(`/api/instruments/${s.id}/transitions`, { body: { action: "START_REVIEW" }, cookie, origin: null }), params({ id: s.id }));
    expect(noOrigin.status).toBe(403);
    const evil = await transition(req(`/api/instruments/${s.id}/transitions`, { body: { action: "START_REVIEW" }, cookie, origin: "https://evil.example" }), params({ id: s.id }));
    expect(evil.status).toBe(403);
    const good = await transition(req(`/api/instruments/${s.id}/transitions`, { body: { action: "START_REVIEW" }, cookie }), params({ id: s.id }));
    expect(good.status).toBe(200);
  });

  it("blocks role escalation and cross-institution access at the API", async () => {
    const s = await submitted(w.instA);
    const instCookie = await cookieFor(w.instA.id);
    const selfReview = await transition(req(`/api/instruments/${s.id}/transitions`, { body: { action: "START_REVIEW" }, cookie: instCookie }), params({ id: s.id }));
    expect(selfReview.status).toBe(403);
    const otherCookie = await cookieFor(w.instB.id);
    const peek = await getInstrument(req(`/api/instruments/${s.id}`, { cookie: otherCookie }), params({ id: s.id }));
    expect(peek.status).toBe(404);
    const doc = await prisma.document.findFirstOrThrow({ where: { instrumentId: s.id } });
    const dl = await download(req(`/api/documents/${doc.id}`, { cookie: otherCookie }), params({ id: doc.id }));
    expect(dl.status).toBe(404);
    const auditorDl = await download(req(`/api/documents/${doc.id}`, { cookie: await cookieFor(w.auditor.id) }), params({ id: doc.id }));
    expect(auditorDl.status).toBe(403);
  });

  it("serves authorised downloads with safe headers and no storage path", async () => {
    const s = await submitted(w.instA);
    const doc = await prisma.document.findFirstOrThrow({ where: { instrumentId: s.id } });
    const res = await download(req(`/api/documents/${doc.id}`, { cookie: await cookieFor(w.instA.id) }), params({ id: doc.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    const json = await (await getInstrument(req(`/api/instruments/${s.id}`, { cookie: await cookieFor(w.instA.id) }), params({ id: s.id }))).text();
    expect(json).not.toContain(doc.storageKey);
  });

  it("rejects invalid upload types at the API with a 400", async () => {
    const draft = await prisma.instrument.create({ data: { referenceNo: "SDP-X-1", institutionId: w.institutionA, type: "FDR", createdById: w.instA.id } });
    const form = new FormData();
    form.set("docType", "FDR_RECEIPT");
    form.set("file", new File([Buffer.from("<html><script>alert(1)</script>")], "receipt.pdf", { type: "application/pdf" }));
    const res = await upload(req(`/api/instruments/${draft.id}/documents`, { form, cookie: await cookieFor(w.instA.id) }), params({ id: draft.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/Unsupported file type/);
  });
});

describe("error handling", () => {
  it("18. unknown failures return a generic 500 without stack traces or internals", async () => {
    const res = errorResponse(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"), "corr-1");
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toMatch(/ECONNREFUSED|hunter2|at \w+ \(/);
    expect(JSON.parse(body).error.message).toMatch(/No changes were confirmed/);
  });

  it("invalid JSON and invalid enum values are rejected with 400, not 500", async () => {
    const s = await submitted(w.instA);
    const cookie = await cookieFor(w.officerNorth.id);
    const res = await transition(req(`/api/instruments/${s.id}/transitions`, { body: { action: "APPROVE_EVERYTHING" }, cookie }), params({ id: s.id }));
    expect(res.status).toBe(400);
  });
});

describe("notification delivery", () => {
  it("records simulated email as SIMULATED (never 'delivered') and retries failures with a cap", async () => {
    await notify(prisma, { recipientIds: [w.instA.id], type: "GENERAL", title: "t", message: "m" });
    const r1 = await processDeliveries();
    expect(r1.simulated).toBe(1);
    expect((await prisma.notificationDelivery.findFirstOrThrow({ where: { channel: "EMAIL" } })).status).toBe("SIMULATED");

    setEmailProvider({ name: "failing", isSimulated: false, send: async () => { throw new Error("SMTP timeout"); } });
    try {
      await notify(prisma, { recipientIds: [w.instB.id], type: "GENERAL", title: "t2", message: "m2" });
      const far = (n: number) => new Date(Date.now() + n * 3600_000);
      await processDeliveries();
      await processDeliveries(far(1));
      await processDeliveries(far(2));
      await processDeliveries(far(3));
      const d = await prisma.notificationDelivery.findFirstOrThrow({ where: { channel: "EMAIL", notification: { recipientId: w.instB.id } } });
      expect(d.status).toBe("FAILED");
      expect(d.attempts).toBe(3);
      expect(d.lastError).toBe("SMTP timeout");
      expect(d.deliveredAt).toBeNull();
    } finally {
      setEmailProvider(null);
    }
  });

  it("deduplicates notifications by key", async () => {
    const a = await notify(prisma, { recipientIds: [w.instA.id], type: "GENERAL", title: "x", message: "y", dedupeKey: "k1" });
    const b = await notify(prisma, { recipientIds: [w.instA.id], type: "GENERAL", title: "x", message: "y", dedupeKey: "k1" });
    expect([a, b]).toEqual([1, 0]);
  });
});
