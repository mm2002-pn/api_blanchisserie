/**
 * Wipe all order-related data.
 * Garde intact : users, clients, machines, linen types, programmes, vehicules,
 * services, PDAs, enrollements, audit logs.
 *
 * Run: npx tsx prisma/wipe-orders.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🗑️  Wiping order data...');

  // 1. Documents commerciaux liés aux commandes
  const deliveries = await prisma.documentDelivery.deleteMany();
  console.log(`  ✓ ${deliveries.count} document deliveries`);

  const creditNotes = await prisma.creditNote.deleteMany();
  console.log(`  ✓ ${creditNotes.count} credit notes`);

  // 2. Invoices (→ InvoiceLine cascade)
  const invoices = await prisma.invoice.deleteMany();
  console.log(`  ✓ ${invoices.count} invoices`);

  // 3. Batches (→ BatchContributor cascade)
  const batches = await prisma.batch.deleteMany();
  console.log(`  ✓ ${batches.count} batches`);

  // 4. Orders (→ TriageRecord → TriageItem cascade, ItemTag cascade)
  //    Doivent partir AVANT les CollectionRound (Order.collectionRoundId FK).
  const orders = await prisma.order.deleteMany();
  console.log(`  ✓ ${orders.count} orders`);

  // 5. Tournees de collecte (apres les orders)
  const rounds = await prisma.collectionRound.deleteMany();
  console.log(`  ✓ ${rounds.count} collection rounds`);

  // 6. Reset compteurs documents
  const seqs = await prisma.documentSequence.deleteMany();
  console.log(`  ✓ ${seqs.count} document sequences`);

  // 7. Reset statuts PDA / chauffeur (au cas ou bloques en in_use / on_route)
  const pdaReset = await prisma.pda.updateMany({
    where: { status: 'in_use' },
    data: { status: 'available' },
  });
  console.log(`  ✓ ${pdaReset.count} PDAs reset to available`);

  const driverReset = await prisma.user.updateMany({
    where: { role: 'driver', driverStatus: 'on_route' },
    data: { driverStatus: 'available' },
  });
  console.log(`  ✓ ${driverReset.count} drivers reset to available`);

  console.log(
    '✅ Wipe done. Users / clients / machines / linen / programmes / vehicles / PDAs / enrollements préservés.',
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    void prisma.$disconnect();
    process.exit(1);
  });
