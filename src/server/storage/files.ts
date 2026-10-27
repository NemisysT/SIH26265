// Protected document storage on the local filesystem (STORAGE_DIR, outside `public/`).
// Keys are server-generated (`YYYY/MM/<uuid>`); client-supplied names never become paths.
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { env } from "../env";
import { NotFoundError, ValidationError } from "../errors";

export type AllowedMimeType = "application/pdf" | "image/png" | "image/jpeg";

const EXTENSIONS: Record<string, AllowedMimeType> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export interface ValidatedFile {
  originalName: string;
  buffer: Buffer;
  sizeBytes: number;
  mimeType: AllowedMimeType;
  sha256: string;
}

/** Detect the type from magic bytes only; the file name and browser-supplied MIME are not trusted. */
export function sniffMimeType(buf: Buffer): AllowedMimeType | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}

/** Keep only the final path segment, without control or reserved characters. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\x00-\x1F\x7F<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!cleaned) return "document";
  if (cleaned.length <= 200) return cleaned;
  const ext = path.extname(cleaned).slice(0, 10);
  return cleaned.slice(0, 200 - ext.length) + ext;
}

// PDF names may hex-escape characters (/J#61vaScript), so names are decoded before matching.
const PDF_ACTIVE_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|SubmitForm|ImportData|GoToE)(?![A-Za-z0-9])/;
const MARKUP = /<\s*(script|html|body|iframe|svg|object|embed)\b|javascript:/i;

function decodePdfNames(text: string) {
  return text.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Text of the PDF to scan: the raw file plus the decompressed contents of object streams, where
 * action dictionaries can otherwise hide. Returns null if an object stream cannot be read.
 */
function pdfInspectableText(buf: Buffer): string | null {
  const raw = buf.toString("latin1");
  const parts = [raw];
  const streamStart = /(?<!end)stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamStart.exec(raw))) {
    const dictStart = raw.lastIndexOf("obj", m.index);
    const dict = dictStart >= 0 ? raw.slice(dictStart, m.index) : "";
    if (!/\/Type\s*\/ObjStm/.test(dict)) continue;
    const bodyStart = m.index + m[0].length;
    const bodyEnd = raw.indexOf("endstream", bodyStart);
    if (bodyEnd < 0 || !/\/FlateDecode/.test(dict)) return null;
    try {
      parts.push(inflateSync(buf.subarray(bodyStart, bodyEnd), { maxOutputLength: 16 * 1024 * 1024 }).toString("latin1"));
    } catch {
      return null;
    }
    streamStart.lastIndex = bodyEnd + "endstream".length;
  }
  return parts.join("\n");
}

export function validateUpload(file: { name: string; buffer: Buffer }, maxBytes: number): ValidatedFile {
  const originalName = sanitizeFilename(file.name);
  const { buffer } = file;
  if (buffer.length === 0) throw new ValidationError("The file is empty.");
  if (buffer.length > maxBytes) {
    throw new ValidationError(`The file exceeds the ${Math.round((maxBytes / (1024 * 1024)) * 10) / 10} MB size limit.`);
  }
  const ext = path.extname(originalName).toLowerCase();
  const expected = EXTENSIONS[ext];
  if (!expected) throw new ValidationError("Unsupported file type. Upload a PDF, PNG or JPEG file.");
  const mimeType = sniffMimeType(buffer);
  if (!mimeType) throw new ValidationError("Unsupported file type: the content is not a valid PDF, PNG or JPEG.");
  if (mimeType !== expected) throw new ValidationError(`The file content does not match its ${ext} extension.`);
  if (mimeType === "application/pdf") {
    const text = pdfInspectableText(buffer);
    if (text === null) throw new ValidationError("The PDF could not be inspected safely; save it as a standard PDF and try again.");
    if (PDF_ACTIVE_CONTENT.test(decodePdfNames(text))) {
      throw new ValidationError("PDFs containing scripts, launch actions or embedded files are not accepted.");
    }
  }
  if (MARKUP.test(buffer.toString("latin1"))) throw new ValidationError("The file contains embedded web markup and was rejected.");
  return {
    originalName,
    buffer,
    sizeBytes: buffer.length,
    mimeType,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

const KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Map a storage key to an absolute path inside STORAGE_DIR, refusing anything else. */
export function resolveKey(key: string): string {
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key.");
  const root = env.storageDir;
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key.");
  return full;
}

/** Write atomically (temp file + rename) and return the new opaque storage key. */
export async function storeFile(buffer: Buffer, at: Date): Promise<string> {
  const key = `${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, buffer, { flag: "wx", mode: 0o600 });
    await fs.rename(tmp, full);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  try {
    return await fs.readFile(resolveKey(key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundError("Document file");
    throw err;
  }
}

export async function deleteStoredFile(key: string): Promise<void> {
  await fs.rm(resolveKey(key), { force: true });
}
