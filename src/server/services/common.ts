import { NotFoundError } from "../errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Malformed identifiers are reported exactly like out-of-scope ones. */
export function assertUuid(id: string, what = "Record"): void {
  if (!UUID.test(id)) throw new NotFoundError(what);
}

export function clampPage(page?: number, pageSize?: number) {
  const size = Math.min(Math.max(Number(pageSize) || 20, 5), 100);
  const p = Math.max(Number(page) || 1, 1);
  return { skip: (p - 1) * size, take: size, page: p, pageSize: size };
}
