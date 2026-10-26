import type { NextRequest } from "next/server";
import { ValidationError } from "./errors";
import { getSettings } from "./settings";

export interface ParsedMultipart {
  fields: Record<string, string>;
  files: { field: string; name: string; buffer: Buffer }[];
}

/** Parse multipart/form-data with an upfront size ceiling (checked again per file during validation). */
export async function readMultipart(req: NextRequest, maxFiles = 5): Promise<ParsedMultipart> {
  const settings = await getSettings();
  const ceiling = settings.maxUploadMb * 1024 * 1024 * maxFiles + 64 * 1024;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > ceiling) throw new ValidationError(`Upload exceeds the ${settings.maxUploadMb} MB per-file limit.`);
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data")) {
    throw new ValidationError("Expected a multipart/form-data upload.");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ValidationError("The upload was interrupted or malformed. Please try again.");
  }
  const fields: Record<string, string> = {};
  const files: ParsedMultipart["files"] = [];
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    } else if (value.size > 0) {
      if (files.length >= maxFiles) throw new ValidationError(`At most ${maxFiles} files per upload.`);
      files.push({ field: key, name: value.name, buffer: Buffer.from(await value.arrayBuffer()) });
    }
  }
  return { fields, files };
}
