-- CreateEnum
CREATE TYPE "CollectionRoundStatus" AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "collectionRoundId" TEXT;

-- CreateTable
CREATE TABLE "CollectionRound" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "plannedAt" TIMESTAMP(3) NOT NULL,
    "status" "CollectionRoundStatus" NOT NULL DEFAULT 'planned',
    "notes" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectionRound_number_key" ON "CollectionRound"("number");

-- CreateIndex
CREATE INDEX "CollectionRound_status_idx" ON "CollectionRound"("status");

-- CreateIndex
CREATE INDEX "CollectionRound_vehicleId_idx" ON "CollectionRound"("vehicleId");

-- CreateIndex
CREATE INDEX "CollectionRound_plannedAt_idx" ON "CollectionRound"("plannedAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_collectionRoundId_fkey" FOREIGN KEY ("collectionRoundId") REFERENCES "CollectionRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionRound" ADD CONSTRAINT "CollectionRound_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
