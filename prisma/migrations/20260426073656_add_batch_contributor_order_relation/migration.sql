-- AddForeignKey
ALTER TABLE "BatchContributor" ADD CONSTRAINT "BatchContributor_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
