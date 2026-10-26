"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public fieldErrors?: Record<string, string[] | undefined>,
    public correlationId?: string,
  ) {
    super(message);
  }
}

/**
 * Call the portal API. Success is reported ONLY when the server returns a 2xx response; network
 * failures and server errors surface as ApiError so the UI never shows a false success.
 */
export async function apiCall<T = unknown>(url: string, opts: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.json !== undefined || opts.form ? "POST" : "GET"),
      headers: opts.json !== undefined ? { "content-type": "application/json" } : undefined,
      body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Network error — the request did not reach the server. Nothing was saved.", 0);
  }
  let payload: { data?: T; error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> }; correlationId?: string } = {};
  try {
    payload = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    throw new ApiError(
      payload.error?.message ?? `Request failed (${res.status}).`,
      res.status,
      payload.error?.code,
      payload.error?.fieldErrors,
      payload.correlationId,
    );
  }
  return payload.data as T;
}
