import type { SystemActor } from "./actor";

/** Actor used for unauthenticated self-registration audit events. */
export const SYSTEM_REGISTRATION: SystemActor = { kind: "system", label: "self-registration" };
export const SYSTEM_AUTH: SystemActor = { kind: "system", label: "authentication" };
