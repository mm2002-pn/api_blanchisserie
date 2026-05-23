/**
 * Normalise les poids des commandes créées avant le fix collect mobile.
 * Si `driverWeight` ou `receivedWeight` <= 1000g (faux fallback),
 * on les recale sur `estimatedWeight` calculé par le backend depuis les items.
 *
 * Run: npx tsx prisma/backfill-weights.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('⚖️  Backfill des poids commandes...');

  const orders = await prisma.order.findMany({
    where: {
      estimatedWeight: { not: null },
    },
    select: {
      id: true,
      orderNumber: true,
      estimatedWeight: true,
      driverWeight: true,
      driverPieces: true,
      receivedWeight: true,
      receivedPieces: true,
      estimatedItems: true,
    },
  });

  let fixedDriver = 0;
  let fixedReceived = 0;

  for (const o of orders) {
    const est = o.estimatedWeight ?? 0;
    if (est === 0) continue;

    // Total pièces depuis estimatedItems (JSON)
    let totalPieces = 0;
    const items = (o.estimatedItems as Array<{ quantity?: number }> | null) ?? [];
    for (const it of items) totalPieces += it.quantity ?? 0;

    const data: { driverWeight?: number; driverPieces?: number; receivedWeight?: number; receivedPieces?: number } = {};

    // driverWeight douteux (≤ 1000g et < est) → recale
    if (o.driverWeight != null && o.driverWeight <= 1000 && o.driverWeight < est) {
      data.driverWeight = est;
      if ((o.driverPieces ?? 0) <= 1 && totalPieces > 1) data.driverPieces = totalPieces;
      fixedDriver++;
    }

    // receivedWeight douteux (≤ 1000g et < est) → recale
    if (o.receivedWeight != null && o.receivedWeight <= 1000 && o.receivedWeight < est) {
      data.receivedWeight = est;
      if ((o.receivedPieces ?? 0) <= 1 && totalPieces > 1) data.receivedPieces = totalPieces;
      fixedReceived++;
    }

    if (Object.keys(data).length > 0) {
      await prisma.order.update({ where: { id: o.id }, data });
      console.log(`  ✓ ${o.orderNumber} :`, data);
    }
  }

  console.log(`✅ Done. driverWeight recalé sur ${fixedDriver} commande(s), receivedWeight sur ${fixedReceived}.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    void prisma.$disconnect();
    process.exit(1);
  });
