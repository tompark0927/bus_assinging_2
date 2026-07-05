// @ts-nocheck
/* eslint-disable */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const { generateMonthlyScheduleV2 } = await import('../src/services/solverDispatchService');
  const { prisma } = await import('../src/utils/prisma');
  const r = await generateMonthlyScheduleV2({
    companyId: 3, year: 2026, month: 7, adminId: 2, overwriteDraft: true,
  });
  console.log(`scheduleId=${r.scheduleId} slotsCreated=${r.slotsCreated} policy=${r.policyUsed} ${r.elapsedMs}ms`);
  console.log('--- summary ---');
  console.log(r.output.summary);
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
