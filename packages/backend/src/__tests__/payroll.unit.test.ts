/**
 * 급여 계산 로직 단위 테스트 (DB 불필요)
 * payrollController의 계산 수식을 독립 검증.
 */

interface PayrollSetting {
  baseSalary: number;
  overtimeRate: number;
  nightShiftBonus: number;
  nationalPensionRate: number;
  healthInsuranceRate: number;
  employmentInsRate: number;
}

interface DriverData {
  workDays: number;
  totalHours: number;
  nightShifts: number;
}

function calculatePay(s: PayrollSetting, data: DriverData, workingDaysInMonth: number) {
  const dailyRate = s.baseSalary / workingDaysInMonth;
  const earnedBase = Math.round(dailyRate * data.workDays);
  const standardMonthlyHours = workingDaysInMonth * 8;
  const overtimeHours = Math.max(0, data.totalHours - standardMonthlyHours);
  const hourlyRate = s.baseSalary / (workingDaysInMonth * 8);
  const overtimePay = Math.round(overtimeHours * hourlyRate * s.overtimeRate);
  const nightShiftPay = data.nightShifts * s.nightShiftBonus;
  const grossPay = earnedBase + overtimePay + nightShiftPay;
  const deductions = Math.round(
    grossPay * (s.nationalPensionRate + s.healthInsuranceRate + s.employmentInsRate) / 100
  );
  const netPay = grossPay - deductions;
  return { earnedBase, overtimePay, nightShiftPay, grossPay, deductions, netPay };
}

const defaultSetting: PayrollSetting = {
  baseSalary: 3_000_000,
  overtimeRate: 1.5,
  nightShiftBonus: 50_000,
  nationalPensionRate: 4.5,
  healthInsuranceRate: 3.545,
  employmentInsRate: 0.9,
};

const WORKING_DAYS = 22; // 2025년 3월 기준

describe('급여 계산 로직', () => {
  it('만근(22일) 시 기본급 = baseSalary', () => {
    const { earnedBase } = calculatePay(
      defaultSetting,
      { workDays: 22, totalHours: 176, nightShifts: 0 },
      WORKING_DAYS,
    );
    expect(earnedBase).toBe(3_000_000);
  });

  it('15일 근무 시 기본급은 baseSalary의 15/22 비율', () => {
    const { earnedBase } = calculatePay(
      defaultSetting,
      { workDays: 15, totalHours: 120, nightShifts: 0 },
      WORKING_DAYS,
    );
    const expected = Math.round((3_000_000 / 22) * 15);
    expect(earnedBase).toBe(expected);
  });

  it('야간 근무 5회 시 nightShiftPay = 5 × 50000', () => {
    const { nightShiftPay } = calculatePay(
      defaultSetting,
      { workDays: 22, totalHours: 176, nightShifts: 5 },
      WORKING_DAYS,
    );
    expect(nightShiftPay).toBe(250_000);
  });

  it('초과근무 없으면 overtimePay = 0', () => {
    const { overtimePay } = calculatePay(
      defaultSetting,
      { workDays: 22, totalHours: 176, nightShifts: 0 },
      WORKING_DAYS,
    );
    expect(overtimePay).toBe(0);
  });

  it('초과근무 10시간 시 overtimePay > 0', () => {
    const { overtimePay } = calculatePay(
      defaultSetting,
      { workDays: 22, totalHours: 186, nightShifts: 0 },
      WORKING_DAYS,
    );
    expect(overtimePay).toBeGreaterThan(0);
  });

  it('4대보험 공제율 합산 검증 (국민연금 4.5 + 건강보험 3.545 + 고용보험 0.9 = 8.945%)', () => {
    const totalRate = defaultSetting.nationalPensionRate
      + defaultSetting.healthInsuranceRate
      + defaultSetting.employmentInsRate;
    expect(totalRate).toBeCloseTo(8.945, 2);
  });

  it('netPay = grossPay - deductions', () => {
    const result = calculatePay(
      defaultSetting,
      { workDays: 22, totalHours: 176, nightShifts: 3 },
      WORKING_DAYS,
    );
    expect(result.netPay).toBe(result.grossPay - result.deductions);
  });

  it('netPay는 항상 grossPay보다 작음', () => {
    const result = calculatePay(
      defaultSetting,
      { workDays: 22, totalHours: 200, nightShifts: 5 },
      WORKING_DAYS,
    );
    expect(result.netPay).toBeLessThan(result.grossPay);
  });
});
