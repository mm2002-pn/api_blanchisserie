-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "enrolledSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VehicleEnrollment" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "pdaId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleEnrollment_vehicleId_endsAt_idx" ON "VehicleEnrollment"("vehicleId", "endsAt");

-- CreateIndex
CREATE INDEX "VehicleEnrollment_driverId_idx" ON "VehicleEnrollment"("driverId");

-- CreateIndex
CREATE INDEX "VehicleEnrollment_pdaId_idx" ON "VehicleEnrollment"("pdaId");

-- AddForeignKey
ALTER TABLE "VehicleEnrollment" ADD CONSTRAINT "VehicleEnrollment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleEnrollment" ADD CONSTRAINT "VehicleEnrollment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleEnrollment" ADD CONSTRAINT "VehicleEnrollment_pdaId_fkey" FOREIGN KEY ("pdaId") REFERENCES "Pda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
