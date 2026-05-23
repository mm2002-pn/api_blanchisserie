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

/** Pipeline standards pour les 3 grandes familles. */
const PIPE_PLAT_CALANDRE = ['lavage', 'calandrage']; // drap, taie, nappe, torchon
const PIPE_PLAT_SECHAGE = ['lavage', 'sechage', 'finition']; // housse couette, serviettes éponge
const PIPE_FORME = ['lavage', 'sechage', 'finition']; // tout le linge de forme

/** Catalogue officiel : 18 articles avec poids + pipeline par type. */
const LINEN_TYPES = [
  // ── Linge plat : drap / taie / nappe / torchon → lavage + calandrage
  ['LP-001', 'Drap de lit 2 personnes', 'LP', 800, 'weight', 300, PIPE_PLAT_CALANDRE],
  ['LP-002', 'Drap de lit 1 personne', 'LP', 600, 'weight', 250, PIPE_PLAT_CALANDRE],
  ['LP-003', 'Taie d\'oreiller / Housse de coussin', 'LP', 200, 'piece', 150, PIPE_PLAT_CALANDRE],
  ['LP-007', 'Nappe légère', 'LP', 250, 'piece', 400, PIPE_PLAT_CALANDRE],
  ['LP-008', 'Nappe épaisse', 'LP', 700, 'piece', 600, PIPE_PLAT_CALANDRE],
  ['LP-009', 'Torchon ou serviette', 'LP', 100, 'weight', 100, PIPE_PLAT_CALANDRE],
  // ── Linge plat éponge / housse → lavage + séchage + finition
  ['LP-004', 'Housse de couette 2 personnes', 'LP', 1500, 'piece', 500, PIPE_PLAT_SECHAGE],
  ['LP-005', 'Grande serviette éponge', 'LP', 500, 'weight', 250, PIPE_PLAT_SECHAGE],
  ['LP-006', 'Petite serviette éponge', 'LP', 300, 'weight', 200, PIPE_PLAT_SECHAGE],
  // ── Linge de forme → lavage + séchage + finition
  ['LF-001', 'Jean taille adulte', 'LF', 700, 'piece', 600, PIPE_FORME],
  ['LF-002', 'Pantalon coton adulte', 'LF', 500, 'piece', 500, PIPE_FORME],
  ['LF-003', 'Pantalon coton enfant', 'LF', 120, 'piece', 300, PIPE_FORME],
  ['LF-004', 'Jupe', 'LF', 400, 'piece', 400, PIPE_FORME],
  ['LF-005', 'Chemise adulte', 'LF', 200, 'piece', 400, PIPE_FORME],
  ['LF-006', 'T-shirt adulte', 'LF', 150, 'piece', 300, PIPE_FORME],
  ['LF-007', 'Robe légère adulte', 'LF', 150, 'piece', 400, PIPE_FORME],
  ['LF-008', 'Robe épaisse', 'LF', 500, 'piece', 500, PIPE_FORME],
  ['LF-009', 'Sweat-shirt adulte', 'LF', 400, 'piece', 400, PIPE_FORME],
] as const;

const SERVICES = [
  ['blanchisserie', 'Blanchisserie', 'Lavage standard du linge plat et de forme.', 1],
  ['nettoyage', 'Nettoyage à sec', 'Pressing pour articles délicats (NAE).', 2],
  ['aqua_clean', 'Aqua Clean', 'Lavage à l\'eau pour textiles techniques.', 3],
] as const;

/** Catégories de linge avec label FR + emoji pour affichage UI. */
const LINEN_CATEGORIES = [
  ['LP', 'Linge plat', '🛏', 1],
  ['LF', 'Linge forme', '👔', 2],
  ['NAE', 'Nettoyage à sec', '🥋', 3],
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

  // Linen types — upsert avec MISE À JOUR systématique du name/weight/pipeline
  // pour propager toute évolution du catalogue.
  for (const [code, name, cat, w, mode, price, pipeline] of LINEN_TYPES) {
    const data = {
      code: code as string,
      name: name as string,
      category: cat as 'LP' | 'LF' | 'NAE',
      averageWeight: w as number,
      billingMode: mode as 'weight' | 'piece',
      unitPrice: price as number,
      pipeline: pipeline as string[],
    };
    await prisma.linenType.upsert({
      where: { code: code as string },
      update: {
        name: data.name,
        category: data.category,
        averageWeight: data.averageWeight,
        billingMode: data.billingMode,
        unitPrice: data.unitPrice,
        pipeline: data.pipeline,
      },
      create: data,
    });
  }
  // Nettoie les anciens codes qui ne sont plus dans le catalogue officiel
  // (ex: NAE-* ou anciennes versions LF).
  const keepCodes = LINEN_TYPES.map(([c]) => c as string);
  const removed = await prisma.linenType.deleteMany({
    where: { code: { notIn: keepCodes } },
  });
  console.log(`  ✓ ${LINEN_TYPES.length} linen types (catalogue officiel)${removed.count > 0 ? ` · ${removed.count} obsolète(s) supprimé(s)` : ''}`);

  // Services
  for (const [code, label, description, sortOrder] of SERVICES) {
    await prisma.service.upsert({
      where: { code },
      update: {},
      create: { code, label, description, sortOrder },
    });
  }
  console.log(`  ✓ ${SERVICES.length} services`);

  // Catégories de linge (config affichage)
  for (const [code, label, emoji, sortOrder] of LINEN_CATEGORIES) {
    await prisma.linenCategoryConfig.upsert({
      where: { code: code as 'LP' | 'LF' | 'NAE' },
      update: { label, emoji, sortOrder },
      create: { code: code as 'LP' | 'LF' | 'NAE', label, emoji, sortOrder },
    });
  }
  console.log(`  ✓ ${LINEN_CATEGORIES.length} catégories de linge`);

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
