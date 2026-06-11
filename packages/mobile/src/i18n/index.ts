import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import ko from './locales/ko.json';

// 한국인 전용 서비스 — 디바이스 로케일 무시하고 무조건 한국어 사용.
// 향후 다국어가 필요해지면 expo-localization 기반 감지 로직을 다시 추가하면 된다.
i18n
  .use(initReactI18next)
  .init({
    resources: {
      ko: { translation: ko },
    },
    lng: 'ko',
    fallbackLng: 'ko',
    // Hermes(RN 엔진)는 Intl.PluralRules 미지원 → v4 는 시작 시 콘솔 에러 후 v3 로 폴백한다.
    // 한국어는 복수형 구분이 없고 복수형 접미사 키도 안 쓰므로 처음부터 v3 로 지정해 경고 제거.
    compatibilityJSON: 'v3',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

export default i18n;
