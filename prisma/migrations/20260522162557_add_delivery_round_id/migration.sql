-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryRoundId" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryRoundId_fkey" FOREIGN KEY ("deliveryRoundId") REFERENCES "CollectionRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;
