-- CreateEnum
CREATE TYPE "RoundType" AS ENUM ('collect', 'delivery');

-- AlterTable
ALTER TABLE "CollectionRound" ADD COLUMN     "type" "RoundType" NOT NULL DEFAULT 'collect';

-- CreateIndex
CREATE INDEX "CollectionRound_type_idx" ON "CollectionRound"("type");
