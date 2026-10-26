import type { RoleName } from "./permissions";

/** The authenticated principal on whose behalf a service call runs. */
export interface Actor {
  kind: "user";
  id: string;
  role: RoleName;
  name: string;
  email: string;
  institutionId: string | null;
  regionIds: string[];
}

/** Background processes (scheduler, automated checks). Never granted user permissions. */
export interface SystemActor {
  kind: "system";
  label: string;
}

export type AnyActor = Actor | SystemActor;

export function actorLabel(a: AnyActor): string {
  return a.kind === "system" ? `system:${a.label}` : `${a.name} <${a.email}>`;
}
