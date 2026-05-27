/**
 * 회사명 → 회사 코드 자동 생성 (규칙기반 로마자 변환).
 *
 * 목표
 *  - "진호버스" → "JHBUS" (앞 글자 초성 + BUS)
 *  - 충돌 시 숫자 대신 로마자를 늘려 유도리 있게: "JHBUS" 사용중 → "JHOBUS" → "JINHOBUS" ...
 *  - 되도록 숫자는 쓰지 않는다 (모든 로마자 후보가 소진된 경우에만 알파벳 접미사).
 *
 * 한글 한 음절을 (초성/중성/종성) 으로 분해해 로마자화한다.
 */

// 초성 19자
const CHO = ['G', 'KK', 'N', 'D', 'TT', 'R', 'M', 'B', 'PP', 'S', 'SS', '', 'J', 'JJ', 'CH', 'K', 'T', 'P', 'H'];
// 중성 21자
const JUNG = ['A', 'AE', 'YA', 'YAE', 'EO', 'E', 'YEO', 'YE', 'O', 'WA', 'WAE', 'OE', 'YO', 'U', 'WO', 'WE', 'WI', 'YU', 'EU', 'UI', 'I'];
// 종성 28자 (0=받침없음)
const JONG = ['', 'G', 'KK', 'GS', 'N', 'NJ', 'NH', 'D', 'L', 'LG', 'LM', 'LB', 'LS', 'LT', 'LP', 'LH', 'M', 'B', 'BS', 'S', 'SS', 'NG', 'J', 'CH', 'K', 'T', 'P', 'H'];

// 버스 회사 흔한 접미사 → 의미 보존을 위해 "BUS" 로 치환
const BUS_SUFFIXES = ['버스'];

interface Syllable {
  cho: string;  // 초성 로마자
  jung: string; // 중성 로마자
  jong: string; // 종성 로마자
  /** 초성 표기 — 초성이 ㅇ(묵음)이면 중성으로 대체해 의미있는 글자 확보 */
  initial: string;
  /** 전체 로마자 (초성+중성+종성), ㅇ 초성은 생략 */
  full: string;
}

function decompose(ch: string): Syllable | null {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null; // 한글 음절 아님
  const cho = CHO[Math.floor(code / 588)];
  const jung = JUNG[Math.floor((code % 588) / 28)];
  const jong = JONG[code % 28];
  const initial = cho || jung; // ㅇ 초성 → 중성으로 대체 (예: 이→I, 아→A)
  const full = `${cho}${jung}${jong}`;
  return { cho, jung, jong, initial, full };
}

/** 영문/숫자만 남기고 대문자화 */
function sanitize(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * 회사명으로부터 코드 후보 목록을 "축약 → 상세" 순서로 생성한다.
 * 모두 영문 대문자, 2~10자로 정규화된다.
 */
export function buildCompanyCodeCandidates(rawName: string): string[] {
  const name = (rawName || '').trim();

  // 1) 비한글(영문) 회사명: 영문/숫자만 추려서 사용
  const hangulSyllables = [...name].filter((c) => decompose(c) !== null);
  if (hangulSyllables.length === 0) {
    const base = sanitize(name).slice(0, 10);
    return base.length >= 2 ? [base] : [];
  }

  // 2) 접미사(버스) 분리 → "BUS"
  let core = name;
  let suffix = '';
  for (const suf of BUS_SUFFIXES) {
    if (core.endsWith(suf)) {
      core = core.slice(0, core.length - suf.length).trim();
      suffix = 'BUS';
      break;
    }
  }

  const coreSyllables = [...core].map(decompose).filter((s): s is Syllable => s !== null);

  // core 가 비었으면 (예: 회사명이 "버스" 뿐) 접미사만 사용
  if (coreSyllables.length === 0) {
    return suffix ? [suffix] : [];
  }

  const n = coreSyllables.length;
  const candidates: string[] = [];

  // level k: 뒤에서 k개 음절을 full 로마자, 나머지는 initial 만 → 축약→상세 점진 확장
  for (let k = 0; k <= n; k++) {
    const parts = coreSyllables.map((syl, idx) => (idx >= n - k ? syl.full : syl.initial));
    const code = sanitize(parts.join('') + suffix).slice(0, 10);
    if (code.length >= 2) candidates.push(code);
  }

  // 중복 제거 (순서 유지)
  return [...new Set(candidates)];
}

/**
 * 유일한 회사 코드를 생성한다.
 * @param rawName 회사명
 * @param isTaken 코드 사용중 여부 (대문자 코드 기준) 비동기 검사
 */
export async function generateUniqueCompanyCode(
  rawName: string,
  isTaken: (code: string) => Promise<boolean>,
): Promise<string> {
  const candidates = buildCompanyCodeCandidates(rawName);

  // 후보가 전혀 없으면 안전한 기본값
  const base = candidates[0] ?? 'BUSCO';

  // 1) 로마자 후보 순서대로 시도 (숫자 없음)
  for (const cand of candidates) {
    if (!(await isTaken(cand))) return cand;
  }

  // 2) 알파벳 접미사 (A~Z, 그 다음 AA~ZZ) — 여전히 숫자 회피
  const root = base.slice(0, 9); // 접미사 1글자 자리 확보
  for (let i = 0; i < 26; i++) {
    const cand = (root + String.fromCharCode(65 + i)).slice(0, 10);
    if (!(await isTaken(cand))) return cand;
  }
  const root2 = base.slice(0, 8);
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const cand = (root2 + String.fromCharCode(65 + i) + String.fromCharCode(65 + j)).slice(0, 10);
      if (!(await isTaken(cand))) return cand;
    }
  }

  // 3) 최후의 수단 (사실상 도달 불가)
  return (base.slice(0, 4) + Date.now().toString(36).toUpperCase()).slice(0, 10);
}
