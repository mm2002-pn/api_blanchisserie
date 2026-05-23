-- AlterTable
ALTER TABLE "LinenType" ADD COLUMN     "pipeline" TEXT[] DEFAULT ARRAY[]::TEXT[];
