-- CreateEnum
CREATE TYPE "BillingPeriodicity" AS ENUM ('per_order', 'monthly');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('BON_COMMANDE', 'BON_COLLECTE', 'BORDEREAU_TRIAGE', 'BON_LIVRAISON', 'FACTURE', 'AVOIR');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('email', 'sms', 'manual_download');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('draft', 'issued', 'cancelled');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "billingMode" "BillingPeriodicity" NOT NULL DEFAULT 'per_order';

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "year" INTEGER NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentDelivery" (
    "id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT,
    "invoiceId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "method" "DeliveryMethod" NOT NULL DEFAULT 'email',
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "legalForm" TEXT,
    "ninea" TEXT,
    "rcNumber" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Senegal',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "vatRate" DECIMAL(5,4) NOT NULL DEFAULT 0.18,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "bankSwift" TEXT,
    "legalMentions" TEXT,
    "paymentTerms" TEXT NOT NULL DEFAULT 'Paiement sous 30 jours',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT,
    "invoiceId" TEXT,
    "clientId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amountFcfa" DECIMAL(14,2) NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'draft',
    "issuedAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_type_year_key" ON "DocumentSequence"("type", "year");

-- CreateIndex
CREATE INDEX "DocumentDelivery_orderId_idx" ON "DocumentDelivery"("orderId");

-- CreateIndex
CREATE INDEX "DocumentDelivery_type_status_idx" ON "DocumentDelivery"("type", "status");

-- CreateIndex
CREATE INDEX "DocumentDelivery_number_idx" ON "DocumentDelivery"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");

-- CreateIndex
CREATE INDEX "CreditNote_clientId_idx" ON "CreditNote"("clientId");

-- CreateIndex
CREATE INDEX "CreditNote_orderId_idx" ON "CreditNote"("orderId");
