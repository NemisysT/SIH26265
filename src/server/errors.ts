// Typed application errors. Route handlers map these to HTTP responses; anything else becomes a
// generic 500 without internal details.

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string[] | undefined>) {
    super(400, "VALIDATION_FAILED", message, fieldErrors ? { fieldErrors } : undefined);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super(401, "UNAUTHENTICATED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(403, "FORBIDDEN", message);
  }
}

/** Also used for resources outside the caller's scope, so existence is not disclosed. */
export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(404, "NOT_FOUND", `${what} not found.`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "CONFLICT") {
    super(409, code, message);
  }
}

export class InvalidTransitionError extends AppError {
  constructor(message: string) {
    super(409, "INVALID_TRANSITION", message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many attempts. Please wait and try again.") {
    super(429, "RATE_LIMITED", message);
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}
