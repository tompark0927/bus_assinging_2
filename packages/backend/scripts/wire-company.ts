/**
 * 특정 회사의 버스↔노선, 기사↔담당차량을 자동 기본배정한다 (온보딩 autoWire 와 동일 로직).
 * 사용: npx ts-node scripts/wire-company.ts <companyId>
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { autoWireBusesAndCrews } from '../src/utils/autoWire';

const companyId = Number(process.argv[2]);
if (!companyId) {
  console.error('companyId 인자가 필요합니다. 예: npx ts-node scripts/wire-company.ts 29');
  process.exit(1);
}

autoWireBusesAndCrews(companyId)
  .then((r) => {
    console.log(`완료 — company ${companyId}: 버스 ${r.busesWired}대, 기사 ${r.driversWired}명 자동배정`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
