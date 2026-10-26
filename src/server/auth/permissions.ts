// Role-based permission matrix. This is the single source of truth for "who may do what";
// data scoping (which records) lives in scope.ts. UI navigation reads the same matrix, but the
// server re-checks every request — hidden UI is never the control.

export type RoleName = "INSTITUTION_USER" | "OFFICER" | "APPROVING_AUTHORITY" | "ADMIN" | "AUDITOR";

export const PERMISSIONS = [
  "dashboard:operational",
  "institution:read",
  "institution:manage-registration",
  "instrument:read",
  "instrument:create",
  "instrument:edit-own",
  "instrument:review",
  "instrument:decide",
  "document:upload-institution",
  "document:upload-officer",
  "document:download",
  "document:review",
  "discrepancy:manage",
  "verification:record",
  "renewal:submit",
  "release:read",
  "release:create",
  "release:scrutinize",
  "release:decide",
  "release:complete",
  "comment:internal",
  "report:export",
  "audit:read",
  "audit:export",
  "admin:users",
  "admin:settings",
  "admin:reference-data",
  "admin:jobs",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<RoleName, readonly Permission[]> = {
  INSTITUTION_USER: [
    "institution:read",
    "instrument:read",
    "instrument:create",
    "instrument:edit-own",
    "document:upload-institution",
    "document:download",
    "renewal:submit",
    "release:read",
    "release:create",
    "report:export",
  ],
  OFFICER: [
    "dashboard:operational",
    "institution:read",
    "institution:manage-registration",
    "instrument:read",
    "instrument:review",
    "instrument:decide",
    "document:upload-officer",
    "document:download",
    "document:review",
    "discrepancy:manage",
    "verification:record",
    "release:read",
    "release:scrutinize",
    "release:complete",
    "comment:internal",
    "report:export",
  ],
  APPROVING_AUTHORITY: [
    "dashboard:operational",
    "institution:read",
    "instrument:read",
    "document:download",
    "release:read",
    "release:decide",
    "comment:internal",
    "report:export",
  ],
  // Administrators run the system but do not handle financial records or documents.
  ADMIN: [
    "institution:read",
    "institution:manage-registration",
    "audit:read",
    "admin:users",
    "admin:settings",
    "admin:reference-data",
    "admin:jobs",
  ],
  // Auditors are read-only: records, decisions, document metadata (not binaries) and audit trails.
  AUDITOR: [
    "dashboard:operational",
    "institution:read",
    "instrument:read",
    "release:read",
    "comment:internal",
    "report:export",
    "audit:read",
    "audit:export",
  ],
};

export function roleHas(role: RoleName, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

export function permissionsFor(role: RoleName): Permission[] {
  return [...(MATRIX[role] ?? [])];
}
