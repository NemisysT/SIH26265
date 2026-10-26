-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('INSTITUTION_USER', 'OFFICER', 'APPROVING_AUTHORITY', 'ADMIN', 'AUDITOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "InstitutionStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InstrumentType" AS ENUM ('FDR', 'SECURITY_DEPOSIT');

-- CreateEnum
CREATE TYPE "InstrumentOrigin" AS ENUM ('PORTAL', 'LEGACY_IMPORT');

-- CreateEnum
CREATE TYPE "InstrumentStatus" AS ENUM ('DRAFT', 'PENDING_SCRUTINY', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'VERIFICATION_PENDING', 'VERIFIED', 'ACCEPTED', 'REJECTED', 'REPLACED', 'RELEASED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_REVIEWED', 'PENDING', 'CONFIRMED', 'DISCREPANCY', 'UNABLE_TO_VERIFY', 'CORRECTION_REQUESTED');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('AUTOMATED_CONSISTENCY_CHECK', 'MANUAL_DOCUMENT_REVIEW', 'BANK_CONFIRMATION_LETTER', 'EXTERNAL_PROVIDER');

-- CreateEnum
CREATE TYPE "VerificationSource" AS ENUM ('SYSTEM', 'OFFICER_REVIEW', 'BANK_CORRESPONDENCE', 'EXTERNAL_PROVIDER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('FDR_RECEIPT', 'DEPOSIT_CONFIRMATION', 'RENEWAL_DOCUMENT', 'RELEASE_SUPPORTING', 'BANK_VERIFICATION_LETTER', 'RELEASE_COMPLETION_EVIDENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentReviewStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DiscrepancySeverity" AS ENUM ('BLOCKING', 'WARNING');

-- CreateEnum
CREATE TYPE "DiscrepancySource" AS ENUM ('AUTOMATED', 'OFFICER');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('OPEN', 'RESOLVED', 'WAIVED');

-- CreateEnum
CREATE TYPE "RenewalKind" AS ENUM ('RENEWAL', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('IN_PROGRESS', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ReleaseType" AS ENUM ('RELEASE', 'REFUND');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('SUBMITTED', 'UNDER_SCRUTINY', 'INFO_REQUESTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'COMPLETED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CommentVisibility" AS ENUM ('SHARED', 'INTERNAL');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SUBMISSION_RECEIVED', 'VERIFICATION_PENDING', 'CORRECTION_REQUESTED', 'CORRECTION_SUBMITTED', 'VERIFICATION_RESULT', 'MATURITY_UPCOMING', 'MATURITY_REACHED', 'RENEWAL_SUBMITTED', 'RELEASE_SUBMITTED', 'RELEASE_DECISION', 'OVERDUE_ACTION', 'ESCALATION', 'INSTITUTION_REGISTRATION', 'GENERAL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'SIMULATED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "regions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_references" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFictional" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "institutionId" UUID,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "officer_regions" (
    "userId" UUID NOT NULL,
    "regionId" UUID NOT NULL,

    CONSTRAINT "officer_regions_pkey" PRIMARY KEY ("userId","regionId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institutions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "approvalReference" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "regionId" UUID NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "status" "InstitutionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "statusReason" TEXT,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "id" UUID NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "institutionId" UUID NOT NULL,
    "type" "InstrumentType" NOT NULL,
    "origin" "InstrumentOrigin" NOT NULL DEFAULT 'PORTAL',
    "instrumentNumber" TEXT,
    "bankName" TEXT,
    "branchName" TEXT,
    "ifscCode" TEXT,
    "amount" DECIMAL(15,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "issueDate" DATE,
    "maturityDate" DATE,
    "validUntil" DATE,
    "purpose" TEXT,
    "notes" TEXT,
    "status" "InstrumentStatus" NOT NULL DEFAULT 'DRAFT',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
    "submittedAt" TIMESTAMP(3),
    "firstSubmittedAt" TIMESTAMP(3),
    "reviewerId" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "replacesInstrumentId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientRequestId" TEXT,
    "createdById" UUID NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "instrumentId" UUID,
    "releaseRequestId" UUID,
    "docType" "DocumentType" NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "supersedesId" UUID,
    "uploadedById" UUID NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStatus" "DocumentReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_records" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "method" "VerificationMethod" NOT NULL,
    "source" "VerificationSource" NOT NULL,
    "providerName" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "independentlyConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "initiatedById" UUID,
    "initiatedBy" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" "VerificationStatus" NOT NULL,
    "evidenceReference" TEXT,
    "evidenceDocumentId" UUID,
    "discrepancyDetails" TEXT,
    "observations" TEXT,

    CONSTRAINT "verification_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discrepancies" (
    "id" UUID NOT NULL,
    "instrumentId" UUID,
    "releaseRequestId" UUID,
    "code" TEXT NOT NULL,
    "field" TEXT,
    "severity" "DiscrepancySeverity" NOT NULL,
    "source" "DiscrepancySource" NOT NULL,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "raisedById" UUID,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,

    CONSTRAINT "discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "instrumentId" UUID,
    "releaseRequestId" UUID,
    "authorId" UUID NOT NULL,
    "authorLabel" TEXT NOT NULL,
    "visibility" "CommentVisibility" NOT NULL DEFAULT 'SHARED',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewal_cases" (
    "id" UUID NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "kind" "RenewalKind" NOT NULL,
    "originalInstrumentId" UUID NOT NULL,
    "newInstrumentId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "previousMaturityDate" DATE,
    "proposedMaturityDate" DATE,
    "status" "RenewalStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "submittedById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renewal_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_requests" (
    "id" UUID NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "institutionId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "type" "ReleaseType" NOT NULL,
    "requestedAmount" DECIMAL(15,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'SUBMITTED',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedOfficerId" UUID,
    "scrutinyNote" TEXT,
    "scrutinizedById" UUID,
    "scrutinizedAt" TIMESTAMP(3),
    "infoRequestNote" TEXT,
    "decision" TEXT,
    "decisionReason" TEXT,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "completionReference" TEXT,
    "completionNote" TEXT,
    "completedById" UUID,
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientRequestId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "institutionId" UUID,
    "instrumentId" UUID,
    "releaseRequestId" UUID,
    "dueDate" DATE,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" BIGSERIAL NOT NULL,
    "actorId" UUID,
    "actorRole" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "institutionId" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "correlationId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggeredById" UUID,
    "status" "JobStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regions_code_key" ON "regions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "bank_references_name_key" ON "bank_references"("name");

-- CreateIndex
CREATE UNIQUE INDEX "bank_references_shortCode_key" ON "bank_references"("shortCode");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_institutionId_idx" ON "users"("institutionId");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "institutions_code_key" ON "institutions"("code");

-- CreateIndex
CREATE INDEX "institutions_regionId_idx" ON "institutions"("regionId");

-- CreateIndex
CREATE INDEX "institutions_status_idx" ON "institutions"("status");

-- CreateIndex
CREATE INDEX "institutions_name_idx" ON "institutions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_referenceNo_key" ON "instruments"("referenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_clientRequestId_key" ON "instruments"("clientRequestId");

-- CreateIndex
CREATE INDEX "instruments_institutionId_idx" ON "instruments"("institutionId");

-- CreateIndex
CREATE INDEX "instruments_status_idx" ON "instruments"("status");

-- CreateIndex
CREATE INDEX "instruments_maturityDate_idx" ON "instruments"("maturityDate");

-- CreateIndex
CREATE INDEX "instruments_bankName_instrumentNumber_idx" ON "instruments"("bankName", "instrumentNumber");

-- CreateIndex
CREATE INDEX "instruments_replacesInstrumentId_idx" ON "instruments"("replacesInstrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storageKey_key" ON "documents"("storageKey");

-- CreateIndex
CREATE INDEX "documents_instrumentId_idx" ON "documents"("instrumentId");

-- CreateIndex
CREATE INDEX "documents_releaseRequestId_idx" ON "documents"("releaseRequestId");

-- CreateIndex
CREATE INDEX "documents_institutionId_idx" ON "documents"("institutionId");

-- CreateIndex
CREATE INDEX "verification_records_instrumentId_idx" ON "verification_records"("instrumentId");

-- CreateIndex
CREATE INDEX "discrepancies_instrumentId_status_idx" ON "discrepancies"("instrumentId", "status");

-- CreateIndex
CREATE INDEX "discrepancies_releaseRequestId_status_idx" ON "discrepancies"("releaseRequestId", "status");

-- CreateIndex
CREATE INDEX "comments_instrumentId_idx" ON "comments"("instrumentId");

-- CreateIndex
CREATE INDEX "comments_releaseRequestId_idx" ON "comments"("releaseRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "renewal_cases_referenceNo_key" ON "renewal_cases"("referenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "renewal_cases_newInstrumentId_key" ON "renewal_cases"("newInstrumentId");

-- CreateIndex
CREATE INDEX "renewal_cases_originalInstrumentId_idx" ON "renewal_cases"("originalInstrumentId");

-- CreateIndex
CREATE INDEX "renewal_cases_status_idx" ON "renewal_cases"("status");

-- CreateIndex
CREATE UNIQUE INDEX "release_requests_referenceNo_key" ON "release_requests"("referenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "release_requests_clientRequestId_key" ON "release_requests"("clientRequestId");

-- CreateIndex
CREATE INDEX "release_requests_institutionId_idx" ON "release_requests"("institutionId");

-- CreateIndex
CREATE INDEX "release_requests_instrumentId_idx" ON "release_requests"("instrumentId");

-- CreateIndex
CREATE INDEX "release_requests_status_idx" ON "release_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_recipientId_readAt_idx" ON "notifications"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_nextAttemptAt_idx" ON "notification_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notificationId_channel_key" ON "notification_deliveries"("notificationId", "channel");

-- CreateIndex
CREATE INDEX "audit_events_resourceType_resourceId_idx" ON "audit_events"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");

-- CreateIndex
CREATE INDEX "audit_events_institutionId_idx" ON "audit_events"("institutionId");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

-- CreateIndex
CREATE INDEX "job_runs_job_startedAt_idx" ON "job_runs"("job", "startedAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officer_regions" ADD CONSTRAINT "officer_regions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officer_regions" ADD CONSTRAINT "officer_regions_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_replacesInstrumentId_fkey" FOREIGN KEY ("replacesInstrumentId") REFERENCES "instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_releaseRequestId_fkey" FOREIGN KEY ("releaseRequestId") REFERENCES "release_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_releaseRequestId_fkey" FOREIGN KEY ("releaseRequestId") REFERENCES "release_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_releaseRequestId_fkey" FOREIGN KEY ("releaseRequestId") REFERENCES "release_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_cases" ADD CONSTRAINT "renewal_cases_originalInstrumentId_fkey" FOREIGN KEY ("originalInstrumentId") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_cases" ADD CONSTRAINT "renewal_cases_newInstrumentId_fkey" FOREIGN KEY ("newInstrumentId") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written integrity rules (not expressible in schema.prisma)
-- ---------------------------------------------------------------------------

-- Audit events are append-only: UPDATE and DELETE are rejected at the database level,
-- so no application path (including administrators) can rewrite history.
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

-- At most one open release/refund request per instrument (prevents duplicate processing,
-- including concurrent double-submits).
CREATE UNIQUE INDEX "release_requests_one_open_per_instrument"
  ON "release_requests" ("instrumentId")
  WHERE "status" NOT IN ('REJECTED', 'COMPLETED', 'WITHDRAWN');

-- At most one in-progress renewal/replacement case per original instrument.
CREATE UNIQUE INDEX "renewal_cases_one_open_per_original"
  ON "renewal_cases" ("originalInstrumentId")
  WHERE "status" = 'IN_PROGRESS';

-- At most one OPEN automated discrepancy per (instrument, check code).
CREATE UNIQUE INDEX "discrepancies_one_open_automated_per_code"
  ON "discrepancies" ("instrumentId", "code")
  WHERE "status" = 'OPEN' AND "source" = 'AUTOMATED' AND "instrumentId" IS NOT NULL;

-- Value sanity at the storage layer (application validation is the primary control).
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_amount_positive" CHECK ("amount" IS NULL OR "amount" > 0);
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_amount_positive" CHECK ("requestedAmount" > 0);
ALTER TABLE "documents" ADD CONSTRAINT "documents_size_positive" CHECK ("sizeBytes" > 0);
