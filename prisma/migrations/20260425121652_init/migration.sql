-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'manager', 'supervisor', 'operator', 'driver', 'hotel');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('hotel_5_etoiles', 'hotel_4_etoiles', 'hotel_3_etoiles', 'restaurant', 'autre');

-- CreateEnum
CREATE TYPE "LinenCategory" AS ENUM ('LP', 'LF', 'NAE');

-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('weight', 'piece');

-- CreateEnum
CREATE TYPE "MachineKind" AS ENUM ('laveuse', 'secheuse', 'calandre', 'presse', 'secheuse_repasseuse');

-- CreateEnum
CREATE TYPE "MachineStatus" AS ENUM ('active', 'maintenance', 'hors_service');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'confirmed', 'collection_planned', 'collected', 'received', 'triaged', 'in_production', 'ready', 'delivered', 'invoiced', 'cancelled');

-- CreateEnum
CREATE TYPE "WorkflowState" AS ENUM ('COLLECTE_SCHEDULED', 'COLLECTE_IN_PROGRESS', 'COLLECTE_COMPLETED', 'RECEPTION_PENDING', 'WEIGHING_IN_PROGRESS', 'WEIGHING_COMPLETED', 'TRIAGE_PENDING', 'TRIAGE_IN_PROGRESS', 'TRIAGE_COMPLETED', 'LAVAGE_PENDING', 'LAVAGE_IN_PROGRESS', 'LAVAGE_COMPLETED', 'SECHAGE_PENDING', 'SECHAGE_IN_PROGRESS', 'SECHAGE_COMPLETED', 'CALANDRAGE_PENDING', 'CALANDRAGE_IN_PROGRESS', 'CALANDRAGE_COMPLETED', 'REPASSAGE_PENDING', 'REPASSAGE_IN_PROGRESS', 'REPASSAGE_COMPLETED', 'FINITION_PENDING', 'FINITION_IN_PROGRESS', 'FINITION_COMPLETED', 'LIVRAISON_SCHEDULED', 'LIVRAISON_IN_PROGRESS', 'LIVRAISON_COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('available', 'in_route', 'maintenance', 'out_of_service');

-- CreateEnum
CREATE TYPE "ItemTagState" AS ENUM ('triaged', 'in_lavage', 'in_sechage', 'in_calandrage', 'in_repassage', 'in_finition', 'done', 'lost');

-- CreateEnum
CREATE TYPE "BatchStage" AS ENUM ('lavage', 'sechage', 'calandrage', 'repassage', 'finition');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('suggested', 'validated', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "TariffType" AS ENUM ('standard', 'premium', 'forfait', 'segment', 'service');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'pending', 'paid', 'overdue', 'cancelled');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'delete', 'login', 'logout', 'permission', 'scan', 'weigh', 'sign', 'print', 'ai_suggest', 'ai_validate');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'push', 'sms');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('queued', 'sent', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "deviceName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ClientType" NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Dakar',
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "ninea" TEXT,
    "geoLat" DOUBLE PRECISION,
    "geoLng" DOUBLE PRECISION,
    "tariffId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinenType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LinenCategory" NOT NULL,
    "averageWeight" INTEGER NOT NULL,
    "billingMode" "BillingMode" NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "treatmentMinutes" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinenType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" "MachineKind" NOT NULL,
    "capacityKg" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "status" "MachineStatus" NOT NULL DEFAULT 'active',
    "lastMaintenanceAt" TIMESTAMP(3),
    "nextMaintenanceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WashingProgram" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "temperature" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "spinSpeed" INTEGER NOT NULL,
    "waterLiters" INTEGER NOT NULL,
    "detergentType" TEXT NOT NULL,
    "suitable" "LinenCategory"[],
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WashingProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "workflowState" "WorkflowState" NOT NULL DEFAULT 'COLLECTE_SCHEDULED',
    "estimatedItems" JSONB NOT NULL,
    "estimatedWeight" INTEGER,
    "estimatedPriceFcfa" DECIMAL(12,2),
    "driverWeight" INTEGER,
    "driverPieces" INTEGER,
    "visualEstimation" TEXT,
    "collectionPhotos" TEXT[],
    "receivedWeight" INTEGER,
    "receivedPieces" INTEGER,
    "weightDeviation" DOUBLE PRECISION,
    "collectionDate" TIMESTAMP(3) NOT NULL,
    "collectionPlannedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "triagedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "collectionDriverId" TEXT,
    "collectionVehicleId" TEXT,
    "collectionGeoLat" DOUBLE PRECISION,
    "collectionGeoLng" DOUBLE PRECISION,
    "collectionSignatureUrl" TEXT,
    "collectionRecipientName" TEXT,
    "deliveryDriverId" TEXT,
    "deliveryVehicleId" TEXT,
    "deliveryPhotos" TEXT[],
    "deliverySignatureUrl" TEXT,
    "deliveryRecipientName" TEXT,
    "instructions" TEXT,
    "cancelReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "matricule" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "capacityKg" INTEGER NOT NULL,
    "fuelLevel" INTEGER NOT NULL DEFAULT 100,
    "status" "VehicleStatus" NOT NULL DEFAULT 'available',
    "lastMaintenanceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageRecord" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "totalPieces" INTEGER NOT NULL,
    "totalWeight" INTEGER NOT NULL,
    "deviationPct" DOUBLE PRECISION NOT NULL,
    "performedBy" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "labelsPrinted" BOOLEAN NOT NULL DEFAULT false,
    "labelsPrintedAt" TIMESTAMP(3),

    CONSTRAINT "TriageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageItem" (
    "id" TEXT NOT NULL,
    "triageId" TEXT NOT NULL,
    "linenTypeId" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,

    CONSTRAINT "TriageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemTag" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "linenTypeId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "state" "ItemTagState" NOT NULL DEFAULT 'triaged',
    "currentBatchId" TEXT,
    "scannedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagScan" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "scannedBy" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "TagScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "stage" "BatchStage" NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'suggested',
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "machineId" TEXT NOT NULL,
    "programId" TEXT,
    "capacity" INTEGER NOT NULL,
    "currentLoad" INTEGER NOT NULL DEFAULT 0,
    "utilization" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedDurationMin" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "estimatedEndAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "actualWaterL" INTEGER,
    "actualEnergyKwh" INTEGER,
    "suggestedByAi" BOOLEAN NOT NULL DEFAULT false,
    "aiScore" DOUBLE PRECISION,
    "aiRationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchContributor" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,

    CONSTRAINT "BatchContributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tariff" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TariffType" NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "monthlyPriceFcfa" DECIMAL(12,2),
    "monthlyKgLimit" INTEGER,
    "overagePerKgFcfa" DECIMAL(10,2),
    "applicableClientTypes" "ClientType"[],

    CONSTRAINT "Tariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TariffItem" (
    "id" TEXT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "linenTypeCode" TEXT NOT NULL,
    "linenTypeName" TEXT NOT NULL,
    "pricePerKg" DECIMAL(10,2),
    "pricePerPiece" DECIMAL(10,2),
    "billingMode" "BillingMode" NOT NULL,

    CONSTRAINT "TariffItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tariffId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidDate" TIMESTAMP(3),
    "subtotalFcfa" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,4) NOT NULL,
    "taxAmountFcfa" DECIMAL(14,2) NOT NULL,
    "totalFcfa" DECIMAL(14,2) NOT NULL,
    "paidAmountFcfa" DECIMAL(14,2),
    "paymentMethod" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "pdfUrl" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orderId" TEXT,
    "linenTypeId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "weight" INTEGER,
    "unitPriceFcfa" DECIMAL(10,2) NOT NULL,
    "totalFcfa" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "payload" JSONB,
    "device" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "geoLat" DOUBLE PRECISION,
    "geoLng" DOUBLE PRECISION,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'queued',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE INDEX "User_clientId_idx" ON "User"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPushToken_token_key" ON "UserPushToken"("token");

-- CreateIndex
CREATE INDEX "UserPushToken_userId_isActive_idx" ON "UserPushToken"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Client_type_isActive_idx" ON "Client"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LinenType_code_key" ON "LinenType"("code");

-- CreateIndex
CREATE INDEX "LinenType_category_idx" ON "LinenType"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_reference_key" ON "Machine"("reference");

-- CreateIndex
CREATE INDEX "Machine_kind_status_idx" ON "Machine"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WashingProgram_code_key" ON "WashingProgram"("code");

-- CreateIndex
CREATE INDEX "WashingProgram_isActive_idx" ON "WashingProgram"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_clientId_status_idx" ON "Order"("clientId", "status");

-- CreateIndex
CREATE INDEX "Order_workflowState_idx" ON "Order"("workflowState");

-- CreateIndex
CREATE INDEX "Order_collectionDate_idx" ON "Order"("collectionDate");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_matricule_key" ON "Vehicle"("matricule");

-- CreateIndex
CREATE INDEX "Vehicle_status_idx" ON "Vehicle"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TriageRecord_orderId_key" ON "TriageRecord"("orderId");

-- CreateIndex
CREATE INDEX "TriageRecord_performedBy_idx" ON "TriageRecord"("performedBy");

-- CreateIndex
CREATE INDEX "TriageItem_triageId_idx" ON "TriageItem"("triageId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemTag_tag_key" ON "ItemTag"("tag");

-- CreateIndex
CREATE INDEX "ItemTag_orderId_idx" ON "ItemTag"("orderId");

-- CreateIndex
CREATE INDEX "ItemTag_state_idx" ON "ItemTag"("state");

-- CreateIndex
CREATE INDEX "ItemTag_currentBatchId_idx" ON "ItemTag"("currentBatchId");

-- CreateIndex
CREATE INDEX "TagScan_tagId_idx" ON "TagScan"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_code_key" ON "Batch"("code");

-- CreateIndex
CREATE INDEX "Batch_stage_status_idx" ON "Batch"("stage", "status");

-- CreateIndex
CREATE INDEX "Batch_machineId_idx" ON "Batch"("machineId");

-- CreateIndex
CREATE INDEX "BatchContributor_orderId_idx" ON "BatchContributor"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "BatchContributor_batchId_orderId_key" ON "BatchContributor"("batchId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Tariff_code_key" ON "Tariff"("code");

-- CreateIndex
CREATE INDEX "Tariff_isActive_idx" ON "Tariff"("isActive");

-- CreateIndex
CREATE INDEX "TariffItem_tariffId_idx" ON "TariffItem"("tariffId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_clientId_status_idx" ON "Invoice"("clientId", "status");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "Notification_status_channel_idx" ON "Notification"("status", "channel");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_idx" ON "Notification"("recipientUserId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPushToken" ADD CONSTRAINT "UserPushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_collectionDriverId_fkey" FOREIGN KEY ("collectionDriverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_collectionVehicleId_fkey" FOREIGN KEY ("collectionVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryDriverId_fkey" FOREIGN KEY ("deliveryDriverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryVehicleId_fkey" FOREIGN KEY ("deliveryVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageRecord" ADD CONSTRAINT "TriageRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageItem" ADD CONSTRAINT "TriageItem_triageId_fkey" FOREIGN KEY ("triageId") REFERENCES "TriageRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageItem" ADD CONSTRAINT "TriageItem_linenTypeId_fkey" FOREIGN KEY ("linenTypeId") REFERENCES "LinenType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTag" ADD CONSTRAINT "ItemTag_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTag" ADD CONSTRAINT "ItemTag_linenTypeId_fkey" FOREIGN KEY ("linenTypeId") REFERENCES "LinenType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTag" ADD CONSTRAINT "ItemTag_currentBatchId_fkey" FOREIGN KEY ("currentBatchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagScan" ADD CONSTRAINT "TagScan_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "ItemTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_programId_fkey" FOREIGN KEY ("programId") REFERENCES "WashingProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchContributor" ADD CONSTRAINT "BatchContributor_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffItem" ADD CONSTRAINT "TariffItem_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_linenTypeId_fkey" FOREIGN KEY ("linenTypeId") REFERENCES "LinenType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
