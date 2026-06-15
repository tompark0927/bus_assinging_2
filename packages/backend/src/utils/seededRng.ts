/**
 * 결정론적 난수 생성기 (mulberry32).
 * 같은 시드는 항상 같은 시퀀스를 만든다 — 백테스트 재현성의 기반.
 * (기존 dispatch-scenario-generator.ts / scenario-generator.ts 의 중복 구현을 여기로 통합)
 */
export type Rng = () => number;

/** 시드로 0~1 난수 함수를 만든다. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0; // int32 강제 (mulberry32 변형의 JIT 힌트)
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [min, max] 정수 (양끝 포함). */
export function rngInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** [min, max) 실수. */
export function rngFloat(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** p 확률로 true. */
export function rngChance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** 배열에서 하나 균등 선택. */
export function rngPick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
