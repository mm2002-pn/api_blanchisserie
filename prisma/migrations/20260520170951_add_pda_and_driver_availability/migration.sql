-- CreateEnum
CREATE TYPE "DriverAvailability" AS ENUM ('available', 'on_route', 'off_duty', 'unavailable');

-- CreateEnum
CREATE TYPE "PdaStatus" AS ENUM ('available', 'in_use', 'maintenance', 'out_of_service');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "collectionPdaId" TEXT,
ADD COLUMN     "deliveryPdaId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "driverStatus" "DriverAvailability" DEFAULT 'available';

-- CreateTable
CREATE TABLE "Pda" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "status" "PdaStatus" NOT NULL DEFAULT 'available',
    "batteryLevel" INTEGER,
    "lastSyncAt" TIMESTAMP(3),
    "assignedDriverId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pda_reference_key" ON "Pda"("reference");

-- CreateIndex
CREATE INDEX "Pda_status_idx" ON "Pda"("status");

-- CreateIndex
CREATE INDEX "Pda_assignedDriverId_idx" ON "Pda"("assignedDriverId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_collectionPdaId_fkey" FOREIGN KEY ("collectionPdaId") REFERENCES "Pda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryPdaId_fkey" FOREIGN KEY ("deliveryPdaId") REFERENCES "Pda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pda" ADD CONSTRAINT "Pda_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
