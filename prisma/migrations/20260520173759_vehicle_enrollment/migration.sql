/*
  Warnings:

  - You are about to drop the column `assignedDriverId` on the `Pda` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Pda" DROP CONSTRAINT "Pda_assignedDriverId_fkey";

-- DropIndex
DROP INDEX "Pda_assignedDriverId_idx";

-- AlterTable
ALTER TABLE "Pda" DROP COLUMN "assignedDriverId";

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "enrolledDriverId" TEXT,
ADD COLUMN     "enrolledPdaId" TEXT;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_enrolledDriverId_fkey" FOREIGN KEY ("enrolledDriverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_enrolledPdaId_fkey" FOREIGN KEY ("enrolledPdaId") REFERENCES "Pda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
