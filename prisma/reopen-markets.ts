/**
 * One-off backfill: reopen students that an acceptance closed out.
 *
 * Accepting an invite used to set `admissionStatus` / `financeStatus` to
 * PLACED, which removed the student from every other organisation's search and
 * blocked any that had not already engaged them from opening the profile. That
 * rule is gone — an acceptance is now a relationship with one organisation, not
 * an exclusive commitment — but rows written under the old rule are still
 * closed, and nothing recomputes them any more.
 *
 * Safe to re-run: it only ever moves a value to OPEN.
 *
 * It does NOT touch `segment` or `discoverable`. A student whose admission was
 * confirmed is ALUMNI with `discoverable: false`, and that is the one genuinely
 * exclusive state — it stays exactly as it is.
 *
 *   npx ts-node prisma/reopen-markets.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const closed = { OR: [{ admissionStatus: { not: 'OPEN' } }, { financeStatus: { not: 'OPEN' } }] };

  const before = await prisma.studentProfile.findMany({
    where: closed,
    select: { userId: true, admissionStatus: true, financeStatus: true, segment: true, discoverable: true }
  });

  if (!before.length) {
    console.log('Nothing to do — every student market is already open.');
    return;
  }

  console.log(`${before.length} student profile(s) have a closed market:`);
  for (const row of before) {
    console.log(
      `  ${row.userId}  admission=${row.admissionStatus}  finance=${row.financeStatus}` +
        `  segment=${row.segment}  discoverable=${row.discoverable}`
    );
  }

  const result = await prisma.studentProfile.updateMany({
    where: closed,
    data: { admissionStatus: 'OPEN', financeStatus: 'OPEN' }
  });
  console.log(`\nReopened ${result.count}.`);

  const left = await prisma.studentProfile.count({ where: closed });
  console.log(left === 0 ? 'All markets open.' : `Still closed: ${left} — re-run or inspect.`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
