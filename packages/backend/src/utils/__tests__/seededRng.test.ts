import { createRng, rngInt, rngChance, rngPick, rngFloat } from '../seededRng';

describe('seededRng', () => {
  it('같은 시드는 동일한 시퀀스를 만든다', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('다른 시드는 다른 시퀀스를 만든다', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBeCloseTo(b(), 10);
  });

  it('rngInt는 [min, max] 정수 범위를 결정론적으로 만든다', () => {
    const r = createRng(7);
    const vals = Array.from({ length: 50 }, () => rngInt(r, 3, 6));
    expect(vals.every((v) => v >= 3 && v <= 6 && Number.isInteger(v))).toBe(true);
    const r2 = createRng(7);
    const vals2 = Array.from({ length: 50 }, () => rngInt(r2, 3, 6));
    expect(vals).toEqual(vals2);
  });

  it('createRng(42) 첫 5개 값이 고정 스냅샷과 일치한다 (교차버전 결정론 가드)', () => {
    const r = createRng(42);
    expect([r(), r(), r(), r(), r()]).toEqual([
      0.6011037519201636,
      0.44829055899754167,
      0.8524657934904099,
      0.6697340414393693,
      0.17481389874592423,
    ]);
  });

  it('rngFloat는 [min, max) 범위이고 결정론적이다', () => {
    const r = createRng(11);
    const vals = Array.from({ length: 30 }, () => rngFloat(r, 2, 5));
    expect(vals.every((v) => v >= 2 && v < 5)).toBe(true);
    const r2 = createRng(11);
    expect(Array.from({ length: 30 }, () => rngFloat(r2, 2, 5))).toEqual(vals);
  });

  it('rngChance와 rngPick도 결정론적이다', () => {
    const r = createRng(99);
    const c1 = Array.from({ length: 20 }, () => rngChance(r, 0.5));
    const r2 = createRng(99);
    const c2 = Array.from({ length: 20 }, () => rngChance(r2, 0.5));
    expect(c1).toEqual(c2);
    const r3 = createRng(5);
    expect(rngPick(r3, ['a', 'b', 'c'])).toBe(rngPick(createRng(5), ['a', 'b', 'c']));
  });
});
