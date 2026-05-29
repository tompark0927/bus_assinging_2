/**
 * 기사 최초 비밀번호 생성 유틸.
 *
 * 정책: "이름을 영문 키보드로 친 문자열" + "전화번호 뒷 4자리"
 *   예) 이름 "최진호", 전화 "010-1234-6788" → "chlwlsgh6788"
 *
 * 한글 이름은 두벌식(2-bul) 자판 기준으로 각 자모를 QWERTY 키로 변환합니다.
 * (브라우저/OS 한글 입력기에서 실제로 그 글자를 칠 때 누르는 키 순서)
 */

// 두벌식 자판 매핑 (호환 자모 → QWERTY 키)
const CONSONANT: Record<string, string> = {
  ㄱ: 'r', ㄲ: 'R', ㄴ: 's', ㄷ: 'e', ㄸ: 'E', ㄹ: 'f', ㅁ: 'a',
  ㅂ: 'q', ㅃ: 'Q', ㅅ: 't', ㅆ: 'T', ㅇ: 'd', ㅈ: 'w', ㅉ: 'W',
  ㅊ: 'c', ㅋ: 'z', ㅌ: 'x', ㅍ: 'v', ㅎ: 'g',
};

const VOWEL: Record<string, string> = {
  ㅏ: 'k', ㅐ: 'o', ㅑ: 'i', ㅒ: 'O', ㅓ: 'j', ㅔ: 'p', ㅕ: 'u',
  ㅖ: 'P', ㅗ: 'h', ㅛ: 'y', ㅜ: 'n', ㅠ: 'b', ㅡ: 'm', ㅣ: 'l',
  // 복합 모음
  ㅘ: 'hk', ㅙ: 'ho', ㅚ: 'hl', ㅝ: 'nj', ㅞ: 'np', ㅟ: 'nl', ㅢ: 'ml',
};

// 종성(받침) → QWERTY (복합 받침은 분해)
const JONG: Record<string, string> = {
  '': '',
  ㄱ: 'r', ㄲ: 'R', ㄳ: 'rt', ㄴ: 's', ㄵ: 'sw', ㄶ: 'sg', ㄷ: 'e',
  ㄹ: 'f', ㄺ: 'fr', ㄻ: 'fa', ㄼ: 'fq', ㄽ: 'ft', ㄾ: 'fx', ㄿ: 'fv',
  ㅀ: 'fg', ㅁ: 'a', ㅂ: 'q', ㅄ: 'qt', ㅅ: 't', ㅆ: 'T', ㅇ: 'd',
  ㅈ: 'w', ㅊ: 'c', ㅋ: 'z', ㅌ: 'x', ㅍ: 'v', ㅎ: 'g',
};

// 유니코드 한글 분해용 자모 테이블
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONG_LIST = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

/** 한글 이름을 두벌식 영문 키 입력 문자열로 변환. 비한글 영숫자는 소문자로 통과. */
export function hangulToQwerty(name: string): string {
  let out = '';
  for (const ch of String(name)) {
    const code = ch.charCodeAt(0);
    // 완성형 한글 음절
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = code - 0xac00;
      const cho = CHO[Math.floor(idx / 588)];
      const jung = JUNG[Math.floor((idx % 588) / 28)];
      const jong = JONG_LIST[idx % 28];
      out += (CONSONANT[cho] ?? '') + (VOWEL[jung] ?? '') + (JONG[jong] ?? '');
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      out += ch.toLowerCase();
    }
    // 그 외(공백/특수문자)는 무시
  }
  return out;
}

/** 전화번호 정규화: 숫자만 남김 (하이픈/공백 유무와 무관하게 동일 값 보장) */
export function normalizePhone(phone: string | null | undefined): string {
  return String(phone ?? '').replace(/\D/g, '');
}

/** 전화번호에서 숫자만 추출 후 뒷 4자리 반환 */
export function phoneLast4(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.slice(-4);
}

/**
 * 기사 최초 비밀번호 = 이름(영문 키 입력) + 전화번호 뒷 4자리
 * 예) ("최진호", "010-1234-6788") → "chlwlsgh6788"
 */
export function generateInitialPassword(name: string, phone: string | null | undefined): string {
  return `${hangulToQwerty(name)}${phoneLast4(phone)}`;
}
