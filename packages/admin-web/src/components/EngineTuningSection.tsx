import { CalendarDays } from 'lucide-react';
import HolidayReviewPanel from './HolidayReviewPanel';

/**
 * 공휴일 — 배차 설정의 두 번째 탭.
 *
 * 2026-08-31 이전에는 여기에 엔진 튜닝 설정 22개(순번 로테이션·감차 방식·
 * 짝궁 교대 규칙·예비 운영·공정성 λ …)가 카탈로그 자동 렌더링으로 붙어
 * 있었다. 전부 걷어냈다.
 *
 * 이유: 손잡이가 22개나 되니 회사마다 다른 값이 쌓였고, 그 값들이 솔버
 * 가중치와 서로 싸워 달마다 배차표 모양이 달라졌다. 7월은 멀쩡한데 8월이
 * 무너진 원인이 이것이었다. 이제 배차 규칙은 **기본 틀**(엔진 frame.py 의
 * 13일 계단 사이클)이 정한다 — 근무 5일 → 휴무 1일 → 근무 5일 → 휴무 2일,
 * 차량마다 하루씩 밀린 계단. 회사가 고르는 것은 공휴일뿐이다.
 *
 * 근무일수·연속근무·최소 휴식 같은 법규 항목은 [운영 정책] 탭이 주인이고
 * 그대로 살아 있다. 되살릴 게 있다면 엔진 카탈로그(policy.py SETTINGS_CATALOG)는
 * 그대로 있으니 필요한 항목만 다시 노출하면 된다.
 */
export default function EngineTuningSection({ onGoToPolicy }: { onGoToPolicy: () => void }) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-5 dark:border-blue-500/20 dark:bg-blue-500/5">
        <div className="flex items-start gap-3">
          <CalendarDays className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" size={20} />
          <div className="space-y-2">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              배차 규칙은 기본 틀이 정합니다
            </h3>
            <p className="max-w-3xl text-[14px] leading-relaxed text-gray-600 dark:text-gray-300">
              메인(정·부)은 <b>근무 5일 → 휴무 1일 → 근무 5일 → 휴무 2일</b> 주기로 돌고,
              차량마다 하루씩 밀린 계단으로 깔립니다. 짝꿍은 같은 날 함께 쉬고 오전·오후만
              서로 반대로 탑니다. 이 틀은 조절하는 값이 아니라 회사의 규칙이라, 설정 항목으로
              두지 않습니다.
            </p>
            <p className="max-w-3xl text-[14px] leading-relaxed text-gray-600 dark:text-gray-300">
              근무일수·연속근무 한도·최소 휴식은{' '}
              <button
                type="button"
                onClick={onGoToPolicy}
                className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400"
              >
                운영 정책
              </button>{' '}
              탭에서 관리합니다.
            </p>
          </div>
        </div>
      </section>

      <HolidayReviewPanel />
    </div>
  );
}
