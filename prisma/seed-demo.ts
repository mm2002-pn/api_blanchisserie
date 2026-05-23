/**
 * Seed démo — peuple la base avec des données réalistes pour démo / dev :
 *  - 5 clients (hôtels + 1 restaurant) avec emails/téléphones
 *  - 5 users staff (driver/operator/supervisor/manager) — mdp `Password!1`
 *  - 4 véhicules
 *  - 1 tarif par défaut avec TariffItems pour tous les types de linge
 *  - 25 commandes réparties sur les 7 étapes du workflow
 *  - les commandes triées génèrent leurs ItemTags en état `triaged`
 *    → directement utilisables par POST /batches/suggest pour exercer Groq
 *
 * Idempotent : supprime puis recrée toutes les données marquées "DEMO-".
 *
 * Usage : `npm run prisma:seed-demo` (après le seed de base).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

/* ════════════ FIXTURES ════════════ */

// NB. Les emails Almadies/Radisson/Pullman matchent volontairement les
// raccourcis "Comptes de test" affichés sur l'écran de login mobile
// (app/(auth)/sign-in.tsx) — pas besoin de rebuilder l'APK quand on
// veut tester ces 3 hôtels.
const HOTELS = [
  { name: 'Hôtel Teranga', type: 'hotel_4_etoiles', address: 'Place de l\'Indépendance', city: 'Dakar', email: 'reception@teranga.sn', phone: '+221331234001' },
  { name: 'Radisson Blu Dakar', type: 'hotel_5_etoiles', address: 'Corniche Ouest', city: 'Dakar', email: 'radisson@blanchisserie.sn', phone: '+221331234002' },
  { name: 'Hôtel des Almadies', type: 'hotel_3_etoiles', address: 'Route des Almadies', city: 'Dakar', email: 'hotel@blanchisserie.sn', phone: '+221331234003' },
  { name: 'Pullman Dakar', type: 'hotel_5_etoiles', address: 'Avenue Senghor', city: 'Dakar', email: 'pullman@blanchisserie.sn', phone: '+221331234004' },
  { name: 'Restaurant Le Lagon', type: 'restaurant', address: 'Route de la Corniche', city: 'Dakar', email: 'admin@lelagon.sn', phone: '+221331234005' },
] as const;

const STAFF = [
  { email: 'driver@blanchisserie.sn', firstName: 'Mamadou', lastName: 'Diop', role: 'driver' },
  { email: 'driver2@blanchisserie.sn', firstName: 'Ibrahima', lastName: 'Ndoye', role: 'driver' },
  { email: 'op1@blanchisserie.sn', firstName: 'Fatou', lastName: 'Sarr', role: 'operator' },
  { email: 'op2@blanchisserie.sn', firstName: 'Awa', lastName: 'Ndiaye', role: 'operator' },
  { email: 'sup@blanchisserie.sn', firstName: 'Cheikh', lastName: 'Fall', role: 'supervisor' },
  { email: 'mgr@blanchisserie.sn', firstName: 'Ousmane', lastName: 'Bâ', role: 'manager' },
] as const;

const VEHICLES = [
  { matricule: 'DK-1001-AA', brand: 'Renault', model: 'Master', capacityKg: 1500 },
  { matricule: 'DK-1002-AA', brand: 'Iveco', model: 'Daily', capacityKg: 2000 },
  { matricule: 'DK-1003-AA', brand: 'Ford', model: 'Transit', capacityKg: 1200 },
  { matricule: 'DK-1004-AA', brand: 'Mercedes', model: 'Sprinter', capacityKg: 1800 },
] as const;

/** Distribution des commandes : 5 par stade × 5 stades = 25 commandes. */
const STAGE_COUNT = {
  pending: 5,
  confirmed: 5,
  collected: 5,
  received: 5,
  triaged: 5,
} as const;

/** Composition standard d'une commande hôtel (kg réalistes). */
const ORDER_TEMPLATE = [
  { code: 'LP-001', qty: 20 }, // Drap 2 personnes × 20 = 16 kg
  { code: 'LP-003', qty: 40 }, // Taies × 40 = 8 kg
  { code: 'LP-005', qty: 30 }, // Grande serviette × 30 = 15 kg
  { code: 'LP-006', qty: 30 }, // Petite serviette × 30 = 9 kg
  { code: 'LP-007', qty: 15 }, // Nappes × 15 = 4 kg (resto)
];

function daysAgo(d: number): Date {
  return new Date(Date.now() - d * 86_400_000);
}

function pick<T>(arr: readonly T[], i: number): T {
  const v = arr[i % arr.length];
  if (v === undefined) throw new Error('pick: empty array');
  return v;
}

/* ════════════ CLEAN ════════════ */

async function cleanDemo() {
  // Tags / triages / orders de demo
  await prisma.itemTag.deleteMany({ where: { tag: { startsWith: 'DEMO-' } } });
  await prisma.triageRecord.deleteMany({
    where: { order: { orderNumber: { startsWith: 'DEMO-' } } },
  });
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: 'DEMO-' } } });

  // Tarifs
  await prisma.tariffItem.deleteMany({
    where: { tariff: { code: 'DEMO-STANDARD' } },
  });
  await prisma.tariff.deleteMany({ where: { code: 'DEMO-STANDARD' } });

  // Véhicules
  await prisma.vehicle.deleteMany({
    where: { matricule: { in: VEHICLES.map((v) => v.matricule) } },
  });

  // Clients démo
  await prisma.client.deleteMany({
    where: { email: { in: HOTELS.map((h) => h.email) } },
  });

  // Staff démo (sauf admin)
  await prisma.user.deleteMany({
    where: { email: { in: STAFF.map((s) => s.email) } },
  });
}

/* ════════════ MAIN ════════════ */

async function main() {
  console.log('🎬 Seeding demo data…');

  const admin = await prisma.user.findUnique({
    where: { email: 'admin@blanchisserie.sn' },
  });
  if (!admin) {
    throw new Error('Run base seed first: npm run prisma:seed');
  }

  await cleanDemo();
  console.log('  ✓ previous demo data cleared');

  /* ── STAFF ─────────────────────────────────────────────── */
  const passwordHash = await argon2.hash('Password!1', { type: argon2.argon2id });
  const staffById: Record<string, { id: string; role: string }> = {};
  for (const u of STAFF) {
    const created = await prisma.user.create({
      data: {
        email: u.email,
        passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
      },
    });
    staffById[u.role] = { id: created.id, role: created.role };
  }
  console.log(`  ✓ ${STAFF.length} staff users (mdp: Password!1)`);

  const drivers = await prisma.user.findMany({ where: { role: 'driver' } });
  const operators = await prisma.user.findMany({ where: { role: 'operator' } });
  const supervisor = staffById.supervisor;

  /* ── CLIENTS ───────────────────────────────────────────── */
  const clients = [];
  for (const h of HOTELS) {
    const c = await prisma.client.create({
      data: {
        name: h.name,
        type: h.type,
        address: h.address,
        city: h.city,
        email: h.email,
        phone: h.phone,
        ninea: `SN-NINEA-${Math.floor(Math.random() * 99999)}`,
        notes: 'demo',
      },
    });
    clients.push(c);
  }
  console.log(`  ✓ ${clients.length} clients`);

  /* ── VEHICLES ──────────────────────────────────────────── */
  for (const v of VEHICLES) {
    await prisma.vehicle.create({ data: v });
  }
  console.log(`  ✓ ${VEHICLES.length} vehicles`);

  /* ── DEFAULT TARIFF ────────────────────────────────────── */
  const linenTypes = await prisma.linenType.findMany({ where: { isActive: true } });
  const tariff = await prisma.tariff.create({
    data: {
      code: 'DEMO-STANDARD',
      name: 'Tarif démo standard',
      type: 'standard',
      isActive: true,
      isDefault: true,
      validFrom: new Date(),
      items: {
        create: linenTypes.map((lt) => ({
          linenTypeCode: lt.code,
          linenTypeName: lt.name,
          billingMode: lt.billingMode,
          pricePerPiece: lt.billingMode === 'piece' ? lt.unitPrice : null,
          pricePerKg: lt.billingMode === 'weight' ? lt.unitPrice : null,
        })),
      },
    },
  });
  // Démet tout autre tarif par défaut
  await prisma.tariff.updateMany({
    where: { isDefault: true, id: { not: tariff.id } },
    data: { isDefault: false },
  });
  // Affecte ce tarif à tous les clients
  await prisma.client.updateMany({
    where: { id: { in: clients.map((c) => c.id) } },
    data: { tariffId: tariff.id },
  });
  console.log(`  ✓ default tariff with ${linenTypes.length} items`);

  /* ── ORDERS PAR STAGE ──────────────────────────────────── */
  const ltByCode = Object.fromEntries(linenTypes.map((lt) => [lt.code, lt]));
  let orderSeq = 100;
  let totalCreated = 0;

  function buildEstimatedItems() {
    return ORDER_TEMPLATE.map((t) => ({
      category: ltByCode[t.code]?.category ?? 'LP',
      type: t.code,
      quantity: t.qty,
    }));
  }

  function estWeight() {
    return ORDER_TEMPLATE.reduce(
      (s, t) => s + (ltByCode[t.code]?.averageWeight ?? 500) * t.qty,
      0,
    );
  }

  async function makeOrder(stage: keyof typeof STAGE_COUNT, idx: number) {
    const client = pick(clients, idx);
    const orderNumber = `DEMO-${stage.toUpperCase()}-${String(orderSeq++).padStart(3, '0')}`;
    const estimatedItems = buildEstimatedItems();
    const estimatedWeight = estWeight();
    const collectionDate = daysAgo(stage === 'pending' ? -1 : 1); // pending = demain, sinon hier

    const driver = pick(drivers, idx);
    const operator = pick(operators, idx);

    const data: Prisma.OrderCreateInput = {
      orderNumber,
      client: { connect: { id: client.id } },
      estimatedItems: estimatedItems as unknown as Prisma.InputJsonValue,
      estimatedWeight,
      collectionDate,
      status: 'pending',
      workflowState: 'COLLECTE_SCHEDULED',
    };

    if (stage === 'pending') {
      // Rien de plus
    } else if (stage === 'confirmed') {
      data.status = 'collection_planned';
      data.collectionPlannedAt = daysAgo(0);
      data.collectionDriver = { connect: { id: driver.id } };
    } else if (stage === 'collected') {
      data.status = 'collected';
      data.workflowState = 'COLLECTE_COMPLETED';
      data.collectedAt = daysAgo(2);
      data.collectionDriver = { connect: { id: driver.id } };
      data.driverWeight = Math.round(estimatedWeight * 1.05);
      data.driverPieces = ORDER_TEMPLATE.reduce((s, t) => s + t.qty, 0);
    } else if (stage === 'received') {
      data.status = 'received';
      data.workflowState = 'WEIGHING_COMPLETED';
      data.collectedAt = daysAgo(3);
      data.receivedAt = daysAgo(2);
      data.collectionDriver = { connect: { id: driver.id } };
      data.driverWeight = Math.round(estimatedWeight * 1.05);
      data.receivedWeight = Math.round(estimatedWeight * 1.03);
      data.receivedPieces = ORDER_TEMPLATE.reduce((s, t) => s + t.qty, 0);
      data.weightDeviation = 3;
    } else if (stage === 'triaged') {
      data.status = 'triaged';
      data.workflowState = 'TRIAGE_COMPLETED';
      data.collectedAt = daysAgo(4);
      data.receivedAt = daysAgo(3);
      data.triagedAt = daysAgo(2);
      data.collectionDriver = { connect: { id: driver.id } };
      data.driverWeight = Math.round(estimatedWeight * 1.05);
      data.receivedWeight = Math.round(estimatedWeight * 1.03);
      data.receivedPieces = ORDER_TEMPLATE.reduce((s, t) => s + t.qty, 0);
      data.weightDeviation = 3;
    }

    const order = await prisma.order.create({ data });

    // Pour les commandes triées, créer TriageRecord + TriageItems + ItemTags
    if (stage === 'triaged') {
      const triage = await prisma.triageRecord.create({
        data: {
          orderId: order.id,
          totalPieces: ORDER_TEMPLATE.reduce((s, t) => s + t.qty, 0),
          totalWeight: estimatedWeight,
          deviationPct: 0,
          performedBy: operator.id,
          performedAt: daysAgo(2),
        },
      });

      for (const t of ORDER_TEMPLATE) {
        const lt = ltByCode[t.code];
        if (!lt) continue;
        await prisma.triageItem.create({
          data: {
            triageId: triage.id,
            linenTypeId: lt.id,
            pieces: t.qty,
            weight: lt.averageWeight * t.qty,
          },
        });

        // 1 ItemTag par pièce — état `triaged` → batchable par l'IA
        const tags = Array.from({ length: t.qty }, (_, i) => ({
          tag: `DEMO-${order.orderNumber}-${t.code}-${String(i + 1).padStart(3, '0')}`,
          orderId: order.id,
          linenTypeId: lt.id,
          weight: lt.averageWeight,
          state: 'triaged' as const,
        }));
        await prisma.itemTag.createMany({ data: tags });
      }
    }

    totalCreated++;
  }

  for (const [stage, count] of Object.entries(STAGE_COUNT) as [
    keyof typeof STAGE_COUNT,
    number,
  ][]) {
    for (let i = 0; i < count; i++) await makeOrder(stage, i);
  }

  console.log(`  ✓ ${totalCreated} orders distributed across 5 stages`);

  // Stats finales
  const triagedTags = await prisma.itemTag.count({ where: { state: 'triaged' } });
  console.log(`  ✓ ${triagedTags} ItemTags in 'triaged' state — ready for AI bin-packing`);

  console.log('🎉 Demo seed done');
  console.log('   → POST /api/v1/batches/suggest to exercise Groq');
  console.log('   → Logins: driver@/op1@/sup@/mgr@blanchisserie.sn (Password!1)');
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    void prisma.$disconnect();
    process.exit(1);
  });
