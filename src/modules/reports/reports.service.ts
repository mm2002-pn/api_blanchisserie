import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { NotFoundError } from '../../utils/errors.js';
import type { ClientReportDto, PeriodDto } from './reports.dto.js';

/**
 * Service de reporting / agrégats.
 *
 * Toutes les requêtes sont en lecture seule, regroupées dans `prisma.$transaction`
 * (snapshot cohérent) sans isolation Serializable (lecture only).
 */

function resolvePeriod(p: PeriodDto) {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  return {
    from: p.from ? new Date(p.from) : monthAgo,
    to: p.to ? new Date(p.to) : now,
  };
}

/* ════════════ DASHBOARD ════════════ */

export async function dashboardSummary() {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    ordersByStatus,
    batchesByStatus,
    invoicesPending,
    invoicesOverdue,
    todayOrders,
    weekOrders,
    weekKgAgg,
    revenueMonth,
    paidMonth,
  ] = await prisma.$transaction([
    prisma.order.groupBy({ by: ['status'], _count: true, orderBy: { status: 'asc' } }),
    prisma.batch.groupBy({ by: ['status'], _count: true, orderBy: { status: 'asc' } }),
    prisma.invoice.aggregate({
      where: { status: 'pending' },
      _sum: { totalFcfa: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { status: 'overdue' },
      _sum: { totalFcfa: true },
      _count: true,
    }),
    prisma.order.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.order.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.order.aggregate({
      where: { receivedAt: { gte: sevenDaysAgo } },
      _sum: { receivedWeight: true },
    }),
    prisma.invoice.aggregate({
      where: { invoiceDate: { gte: startOfMonth }, status: { not: 'cancelled' } },
      _sum: { totalFcfa: true },
    }),
    prisma.invoice.aggregate({
      where: { paidDate: { gte: startOfMonth } },
      _sum: { paidAmountFcfa: true },
    }),
  ]);

  const ordersStatus = Object.fromEntries(
    ordersByStatus.map((row) => [row.status, row._count]),
  );
  const batchesStatus = Object.fromEntries(
    batchesByStatus.map((row) => [row.status, row._count]),
  );

  return {
    orders: {
      byStatus: ordersStatus,
      today: todayOrders,
      last7Days: weekOrders,
    },
    production: {
      batchesByStatus: batchesStatus,
      kgReceivedLast7Days:
        ((weekKgAgg._sum.receivedWeight ?? 0) as number) / 1000,
    },
    invoices: {
      pendingCount: invoicesPending._count,
      pendingTotalFcfa: invoicesPending._sum.totalFcfa?.toFixed(2) ?? '0.00',
      overdueCount: invoicesOverdue._count,
      overdueTotalFcfa: invoicesOverdue._sum.totalFcfa?.toFixed(2) ?? '0.00',
    },
    revenue: {
      monthInvoicedFcfa: revenueMonth._sum.totalFcfa?.toFixed(2) ?? '0.00',
      monthPaidFcfa: paidMonth._sum.paidAmountFcfa?.toFixed(2) ?? '0.00',
    },
  };
}

/* ════════════ PRODUCTION ════════════ */

export async function productionReport(period: PeriodDto) {
  const { from, to } = resolvePeriod(period);

  const [completedBatches, machineUtil, kgByDay, deviation] =
    await prisma.$transaction([
      prisma.batch.aggregate({
        where: { status: 'completed', completedAt: { gte: from, lte: to } },
        _count: true,
        _sum: { actualWaterL: true, actualEnergyKwh: true },
        _avg: { utilization: true },
      }),
      prisma.batch.groupBy({
        by: ['machineId'],
        where: { status: 'completed', completedAt: { gte: from, lte: to } },
        _avg: { utilization: true },
        _count: true,
        orderBy: { machineId: 'asc' },
      }),
      prisma.$queryRaw<{ day: Date; total_kg: number }[]>`
        SELECT
          date_trunc('day', "receivedAt") AS day,
          COALESCE(SUM("receivedWeight"), 0) / 1000.0 AS total_kg
        FROM "Order"
        WHERE "receivedAt" BETWEEN ${from} AND ${to}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      prisma.order.aggregate({
        where: { receivedAt: { gte: from, lte: to }, weightDeviation: { not: null } },
        _avg: { weightDeviation: true },
        _max: { weightDeviation: true },
      }),
    ]);

  const machineIds = machineUtil.map((m) => m.machineId);
  const machines = await prisma.machine.findMany({
    where: { id: { in: machineIds } },
    select: { id: true, reference: true, brand: true, model: true, kind: true },
  });
  const machineLookup = new Map(machines.map((m) => [m.id, m]));

  return {
    period: { from, to },
    batchesCompleted: completedBatches._count,
    waterConsumedL: completedBatches._sum.actualWaterL ?? 0,
    energyConsumedKwh: completedBatches._sum.actualEnergyKwh ?? 0,
    avgBatchUtilization: completedBatches._avg.utilization ?? 0,
    avgWeightDeviationPct: deviation._avg.weightDeviation ?? 0,
    maxWeightDeviationPct: deviation._max.weightDeviation ?? 0,
    machineBreakdown: machineUtil.map((row) => ({
      machine: machineLookup.get(row.machineId) ?? { id: row.machineId },
      batchesCompleted: row._count,
      avgUtilization: row._avg?.utilization ?? 0,
    })),
    kgByDay: kgByDay.map((d) => ({ day: d.day, kg: Number(d.total_kg) })),
  };
}

/* ════════════ REVENUE ════════════ */

export async function revenueReport(period: PeriodDto) {
  const { from, to } = resolvePeriod(period);

  const [totals, byStatus, topClients, revenueByMonth] = await prisma.$transaction([
    prisma.invoice.aggregate({
      where: { invoiceDate: { gte: from, lte: to } },
      _sum: { totalFcfa: true, paidAmountFcfa: true, taxAmountFcfa: true },
      _count: true,
    }),
    prisma.invoice.groupBy({
      by: ['status'],
      where: { invoiceDate: { gte: from, lte: to } },
      _sum: { totalFcfa: true },
      _count: true,
      orderBy: { status: 'asc' },
    }),
    prisma.invoice.groupBy({
      by: ['clientId'],
      where: { invoiceDate: { gte: from, lte: to }, status: { not: 'cancelled' } },
      _sum: { totalFcfa: true },
      _count: true,
      orderBy: { _sum: { totalFcfa: 'desc' } },
      take: 10,
    }),
    prisma.$queryRaw<{ month: Date; total_fcfa: number; paid_fcfa: number }[]>`
      SELECT
        date_trunc('month', "invoiceDate") AS month,
        COALESCE(SUM("totalFcfa"), 0) AS total_fcfa,
        COALESCE(SUM("paidAmountFcfa"), 0) AS paid_fcfa
      FROM "Invoice"
      WHERE "invoiceDate" BETWEEN ${from} AND ${to}
        AND status <> 'cancelled'
      GROUP BY 1
      ORDER BY 1 ASC
    `,
  ]);

  const clientIds = topClients.map((t) => t.clientId);
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds } },
    select: { id: true, name: true, type: true },
  });
  const clientLookup = new Map(clients.map((c) => [c.id, c]));

  return {
    period: { from, to },
    invoicesCount: totals._count,
    totalInvoicedFcfa: totals._sum.totalFcfa?.toFixed(2) ?? '0.00',
    totalPaidFcfa: totals._sum.paidAmountFcfa?.toFixed(2) ?? '0.00',
    totalTaxFcfa: totals._sum.taxAmountFcfa?.toFixed(2) ?? '0.00',
    byStatus: byStatus.map((row) => ({
      status: row.status,
      count: row._count,
      totalFcfa: row._sum?.totalFcfa?.toFixed(2) ?? '0.00',
    })),
    topClients: topClients.map((row) => ({
      client: clientLookup.get(row.clientId) ?? { id: row.clientId },
      invoicesCount: row._count,
      totalFcfa: row._sum?.totalFcfa?.toFixed(2) ?? '0.00',
    })),
    monthly: revenueByMonth.map((m) => ({
      month: m.month,
      totalFcfa: Number(m.total_fcfa),
      paidFcfa: Number(m.paid_fcfa),
    })),
  };
}

/* ════════════ CLIENT REPORT ════════════ */

export async function clientReport(dto: ClientReportDto) {
  const { from, to } = resolvePeriod(dto);
  const client = await prisma.client.findUnique({
    where: { id: dto.clientId },
    select: { id: true, name: true, type: true, email: true },
  });
  if (!client) throw new NotFoundError('Client not found');

  const [orderStats, weight, invoices, onTimeStats] = await prisma.$transaction([
    prisma.order.aggregate({
      where: { clientId: dto.clientId, createdAt: { gte: from, lte: to } },
      _count: true,
    }),
    prisma.order.aggregate({
      where: {
        clientId: dto.clientId,
        receivedAt: { gte: from, lte: to },
      },
      _sum: { receivedWeight: true, receivedPieces: true },
    }),
    prisma.invoice.aggregate({
      where: {
        clientId: dto.clientId,
        invoiceDate: { gte: from, lte: to },
        status: { not: 'cancelled' },
      },
      _sum: { totalFcfa: true, paidAmountFcfa: true },
      _count: true,
    }),
    prisma.$queryRaw<{ on_time: number; total: number }[]>`
      SELECT
        COUNT(*) FILTER (WHERE "deliveredAt" IS NOT NULL AND "collectionPlannedAt" IS NOT NULL AND "deliveredAt" <= "collectionPlannedAt") AS on_time,
        COUNT(*) FILTER (WHERE "deliveredAt" IS NOT NULL AND "collectionPlannedAt" IS NOT NULL) AS total
      FROM "Order"
      WHERE "clientId" = ${dto.clientId}
        AND "deliveredAt" BETWEEN ${from} AND ${to}
    `,
  ]);

  const onTimeRow = onTimeStats[0] ?? { on_time: 0, total: 0 };
  const onTimeRate =
    Number(onTimeRow.total) > 0
      ? Number(onTimeRow.on_time) / Number(onTimeRow.total)
      : null;

  const totalFcfa = invoices._sum.totalFcfa ?? new Prisma.Decimal(0);
  const paidFcfa = invoices._sum.paidAmountFcfa ?? new Prisma.Decimal(0);
  const outstanding = totalFcfa.sub(paidFcfa);

  return {
    period: { from, to },
    client,
    orders: {
      total: orderStats._count,
      kgReceived: ((weight._sum.receivedWeight ?? 0) as number) / 1000,
      piecesReceived: weight._sum.receivedPieces ?? 0,
    },
    invoices: {
      count: invoices._count,
      totalFcfa: totalFcfa.toFixed(2),
      paidFcfa: paidFcfa.toFixed(2),
      outstandingFcfa: outstanding.toFixed(2),
    },
    quality: {
      onTimeDeliveries: Number(onTimeRow.on_time),
      totalDeliveries: Number(onTimeRow.total),
      onTimeRate,
    },
  };
}
