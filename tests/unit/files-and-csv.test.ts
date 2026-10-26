import { describe, expect, it } from "vitest";
import { resolveKey, sanitizeFilename, sniffMimeType, validateUpload } from "@/server/storage/files";
import { syntheticPdf } from "@/server/storage/synthetic-pdf";
import { csvCell, toCsv } from "@/server/services/reports";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { ValidationError } from "@/server/errors";

const MB = 1024 * 1024;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

describe("upload validation", () => {
  it("detects type from content, not from the name or browser MIME", () => {
    expect(sniffMimeType(syntheticPdf("t", []))).toBe("application/pdf");
    expect(sniffMimeType(png)).toBe("image/png");
    expect(sniffMimeType(Buffer.from("MZ\x90\x00 executable"))).toBeNull();
  });
  it("accepts a valid PDF and records a SHA-256", () => {
    const v = validateUpload({ name: "receipt.pdf", buffer: syntheticPdf("t", ["x"]) }, 10 * MB);
    expect(v.mimeType).toBe("application/pdf");
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("rejects unsupported, mismatched, empty, oversized and active-content files", () => {
    expect(() => validateUpload({ name: "x.exe", buffer: Buffer.from("MZ....") }, MB)).toThrow(ValidationError);
    expect(() => validateUpload({ name: "receipt.pdf", buffer: png }, MB)).toThrow(/does not match/);
    expect(() => validateUpload({ name: "a.pdf", buffer: Buffer.alloc(0) }, MB)).toThrow(/empty/);
    expect(() => validateUpload({ name: "a.pdf", buffer: Buffer.concat([syntheticPdf("t", []), Buffer.alloc(2 * MB)]) }, MB)).toThrow(/exceeds/);
    const js = Buffer.from("%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj");
    expect(() => validateUpload({ name: "a.pdf", buffer: js }, MB)).toThrow(/scripts/);
    const polyglot = Buffer.concat([png, Buffer.from("<script>alert(1)</script>")]);
    expect(() => validateUpload({ name: "a.png", buffer: polyglot }, MB)).toThrow(/markup/);
  });
  it("sanitises filenames and refuses path traversal in storage keys", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\x\\FDR (1).pdf")).toBe("FDR (1).pdf");
    expect(() => resolveKey("../../etc/passwd")).toThrow();
    expect(() => resolveKey("2026/10/../../x")).toThrow();
    expect(resolveKey("2026/10/123e4567-e89b-12d3-a456-426614174000")).toContain("2026");
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formula injection and escapes quotes", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+91 9000")).toBe("'+91 9000");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(toCsv(["h"], [["v"]]).startsWith("\uFEFFh\r\nv")).toBe(true);
  });
});

describe("password hashing", () => {
  it("hashes with scrypt and verifies", async () => {
    const h = await hashPassword("Correct horse 123");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h).not.toContain("Correct horse");
    expect(await verifyPassword("Correct horse 123", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});
