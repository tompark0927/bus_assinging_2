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
    compatibilityJSON: 'v4',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

export default i18n;
