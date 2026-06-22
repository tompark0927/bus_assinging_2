/**
 * 단위 테스트 — newHireWorkdayTarget 순수 헬퍼
 *
 * DB·솔버 없이 순수 함수만 검증.
 */
import { newHireWorkdayTarget } from '../services/solverDispatchService';
import { POLICY_PRESETS } from '../agents/_solvers/types';

const cityBands = POLICY_PRESETS.CITY_2SHIFT.workdayBands;
const villageBands = POLICY_PRESETS.VILLAGE_1SHIFT.workdayBands;

describe('newHireWorkdayTarget', () => {
  it('isNewHire=false → undefined 반환', () => {
    expect(newHireWorkdayTarget(false, cityBands)).toBeUndefined();
  });

  it('isNewHire=true → DriverWorkdayTarget with exemptReason=NEW_HIRE', () => {
    const result = newHireWorkdayTarget(true, cityBands);
    expect(result).toBeDefined();
    expect(result!.exemptReason).toBe('NEW_HIRE');
  });

  it('isNewHire=true → min/max matches hardMin/hardMax', () => {
    const result = newHireWorkdayTarget(true, cityBands);
    expect(result!.min).toBe(cityBands.hardMin);
    expect(result!.max).toBe(cityBands.hardMax);
  });

  it('isNewHire=true → softMin/softMax matches sweetMin/sweetMax', () => {
    const result = newHireWorkdayTarget(true, cityBands);
    expect(result!.softMin).toBe(cityBands.sweetMin);
    expect(result!.softMax).toBe(cityBands.sweetMax);
  });

  it('isNewHire=true → exemptNote가 비어있지 않다', () => {
    const result = newHireWorkdayTarget(true, cityBands);
    expect(result!.exemptNote).toBeTruthy();
  });

  it('VILLAGE_1SHIFT 밴드에도 올바르게 매핑된다', () => {
    const result = newHireWorkdayTarget(true, villageBands);
    expect(result!.min).toBe(villageBands.hardMin);
    expect(result!.max).toBe(villageBands.hardMax);
    expect(result!.softMin).toBe(villageBands.sweetMin);
    expect(result!.softMax).toBe(villageBands.sweetMax);
    expect(result!.exemptReason).toBe('NEW_HIRE');
  });
});
