/**
 * Seed minimal pour démarrer en dev.
 * Crée :
 *  - 1 admin (email: admin@blanchisserie.sn / password: Password!1)
 *  - 4 machines (2 PRIMUS + 2 GIRBAU)
 *  - 22 programmes de lavage du CDC
 *  - quelques types de linge LP/LF/NAE
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const PROGRAMS = [
  ['P01', 'Draps & Taies', 60, 50, 1000, 130, 'Standard', ['LP']],
  ['P02', 'Éponges', 60, 55, 1200, 150, 'Standard', ['LP']],
  ['P03', 'Cuisine', 60, 50, 1000, 140, 'Dégraissant', ['LP', 'LF']],
  ['P04', 'Tenues couleur', 40, 45, 800, 110, 'Couleur', ['LF']],
  ['P05', 'Serpillières', 90, 60, 800, 160, 'Désinfectant', ['LP']],
  ['P06', 'Rideaux', 30, 35, 600, 130, 'Délicat', ['LP']],
  ['P07', 'Voilage', 30, 30, 400, 110, 'Délicat', ['LP']],
  ['P08', 'Nappes couleur', 40, 45, 800, 120, 'Couleur', ['LP']],
  ['P09', 'Piscine', 40, 50, 1000, 150, 'Anti-chlore', ['LP']],
  ['P10', 'Cuisine Javel', 90, 70, 1000, 170, 'Javel', ['LP']],
  ['P11', 'Bleu de travail', 60, 55, 1000, 140, 'Dégraissant', ['LF']],
  ['P12', 'Tapis de sol', 60, 90, 1000, 200, 'Standard', ['LP']],
  ['P13', 'Chemises blanches', 40, 40, 800, 110, 'Blanchissant doux', ['LF']],
  ['P14', 'Décatissage', 30, 25, 400, 100, 'Sans détergent', ['LF']],
  ['P20', 'NAE Vestes/Pantalon', 0, 60, 0, 0, 'Perchloréthylène', ['NAE']],
  ['P21', 'NAE Soie', 0, 45, 0, 0, 'Perchloréthylène doux', ['NAE']],
  ['P22', 'NAE-Dry', 0, 50, 0, 0, 'Hydrocarbure', ['NAE']],
] as const;

const LINEN_TYPES = [
  ['LP-001', 'Drap 2 personnes', 'LP', 800, 'weight', 300],
  ['LP-002', 'Drap 1 personne', 'LP', 600, 'weight', 250],
  ['LP-003', 'Taie d\'oreiller', 'LP', 200, 'piece', 150],
  ['LP-004', 'Housse de couette', 'LP', 1500, 'piece', 500],
  ['LP-005', 'Grande serviette éponge', 'LP', 500, 'weight', 250],
  ['LP-006', 'Petite serviette éponge', 'LP', 300, 'weight', 200],
  ['LP-007', 'Nappe légère', 'LP', 250, 'piece', 400],
  ['LP-008', 'Nappe épaisse', 'LP', 700, 'piece', 600],
  ['LP-009', 'Torchon', 'LP', 100, 'weight', 100],
  ['LF-001', 'Chemise', 'LF', 200, 'piece', 400],
  ['LF-002', 'Pantalon adulte', 'LF', 500, 'piece', 500],
  ['LF-003', 'T-shirt adulte', 'LF', 150, 'piece', 300],
  ['LF-004', 'Jean', 'LF', 700, 'piece', 600],
  ['LF-005', 'Robe', 'LF', 400, 'piece', 500],
  ['NAE-001', 'Veste costume', 'NAE', 600, 'piece', 2500],
  ['NAE-002', 'Pantalon costume', 'NAE', 500, 'piece', 2000],
  ['NAE-003', 'Article en soie', 'NAE', 200, 'piece', 3500],
] as const;

const MACHINES = [
  ['LAV-001', 'PRIMUS', 'FX600', 'laveuse', 60, 'Zone lavage A'],
  ['LAV-002', 'PRIMUS', 'FX350', 'laveuse', 35, 'Zone lavage A'],
  ['LAV-003', 'GIRBAU', 'HS6057', 'laveuse', 57, 'Zone lavage B'],
  ['LAV-004', 'GIRBAU', 'HS6028', 'laveuse', 28, 'Zone lavage B'],
  ['SEC-001', 'PRIMUS', 'I50-320', 'secheuse_repasseuse', 145, 'Zone séchage'],
  ['SEC-002', 'GIRBAU', 'PB5132', 'secheuse_repasseuse', 145, 'Zone séchage'],
  ['SEC-003', 'PRIMUS', 'T 24', 'secheuse', 24, 'Zone séchage'],
  ['CAL-001', 'PRIMUS', 'FI280', 'calandre', 45, 'Zone finition'],
] as const;

async function main() {
  console.log('🌱 Seeding database…');

  // Admin
  const passwordHash = await argon2.hash('Password!1', { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { email: 'admin@blanchisserie.sn' },
    update: {},
    create: {
      email: 'admin@blanchisserie.sn',
      passwordHash,
      firstName: 'Admin',
      lastName: 'Blanchisserie SN',
      role: 'admin',
    },
  });
  console.log('  ✓ admin user (admin@blanchisserie.sn / Password!1)');

  // Programmes
  for (const [code, name, t, dur, spin, water, det, suit] of PROGRAMS) {
    await prisma.washingProgram.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name,
        temperature: t,
        durationMin: dur,
        spinSpeed: spin,
        waterLiters: water,
        detergentType: det,
        suitable: suit as ('LP' | 'LF' | 'NAE')[],
      },
    });
  }
  console.log(`  ✓ ${PROGRAMS.length} washing programs`);

  // Linen types
  for (const [code, name, cat, w, mode, price] of LINEN_TYPES) {
    await prisma.linenType.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name,
        category: cat as 'LP' | 'LF' | 'NAE',
        averageWeight: w,
        billingMode: mode as 'weight' | 'piece',
        unitPrice: price,
      },
    });
  }
  console.log(`  ✓ ${LINEN_TYPES.length} linen types`);

  // Machines
  for (const [ref, brand, model, kind, cap, loc] of MACHINES) {
    await prisma.machine.upsert({
      where: { reference: ref },
      update: {},
      create: {
        reference: ref,
        brand,
        model,
        kind: kind as 'laveuse' | 'secheuse' | 'calandre' | 'presse' | 'secheuse_repasseuse',
        capacityKg: cap,
        location: loc,
        status: 'active',
      },
    });
  }
  console.log(`  ✓ ${MACHINES.length} machines`);

  console.log('✅ Seed done');
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    void prisma.$disconnect();
    process.exit(1);
  });
