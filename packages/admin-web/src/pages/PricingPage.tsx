import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Sparkles } from 'lucide-react';
import { MarketingNav, MarketingFooter } from '../components/MarketingShell';

/* ------------------------------------------------------------------ */
/*  Plans                                                              */
/* ------------------------------------------------------------------ */

interface Plan {
  id: string;
  name: string;
  tagline: string;
  monthlyKrw: number | null; // null = "문의"
  yearlyKrw: number | null;
  highlight?: boolean;
  features: string[];
  cta: string;
}

const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: '소규모 회사를 위한 기본 패키지',
    monthlyKrw: 99000,
    yearlyKrw: 990000,
    features: [
      '기사 최대 30명',
      '버스·노선 무제한',
      'AI 자동 배차 (월 1회)',
      '기사 모바일 앱 제공',
      '실시간 결원 알림',
      '이메일 지원',
    ],
    cta: '14일 무료 시작',
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: '대부분의 운수회사가 선택하는 인기 플랜',
    monthlyKrw: 249000,
    yearlyKrw: 2490000,
    highlight: true,
    features: [
      '기사 최대 100명',
      '버스·노선 무제한',
      'AI 자동 배차 (무제한)',
      '결원 자동 매칭 + 푸시 알림',
      '대시보드 KPI 차트',
      '운영 추적 + 감사 로그',
      'AI 에이전트 결정 검토',
      '카카오톡 우선 지원',
    ],
    cta: '14일 무료 시작',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: '100명 이상 · 다중 영업소 운영',
    monthlyKrw: null,
    yearlyKrw: null,
    features: [
      '기사 무제한',
      '다중 영업소 / 회사 통합',
      'SSO / 권한 정책 커스텀',
      '온프레미스 / 전용 서버 옵션',
      'SLA 99.9% + 전담 매니저',
      'API · 웹훅 연동 지원',
      '커스텀 KPI 보고서',
    ],
    cta: '도입 상담 신청',
  },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function PricingPage() {
  const navigate = useNavigate();
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');

  const handleCta = (plan: Plan) => {
    if (plan.id === 'enterprise') {
      navigate('/support#contact');
    } else {
      navigate('/register');
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white">
      <MarketingNav />

      {/* Hero */}
      <section className="pt-20 pb-12 lg:pt-28 lg:pb-16">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-blue-600 dark:text-blue-400 text-sm font-medium mb-6">
            <Sparkles size={14} />
            14일 무료 체험 · 신용카드 불필요
          </span>
          <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight mb-4">
            회사 규모에 맞는 요금제를 고르세요
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-lg leading-relaxed">
            무료 체험 기간 동안 모든 기능을 제한 없이 사용해 보실 수 있습니다.<br />
            결제는 만족하셨을 때만 진행하시면 됩니다.
          </p>

          {/* Billing toggle */}
          <div className="mt-8 inline-flex bg-gray-100 dark:bg-white/5 rounded-full p-1">
            <BillingChoice active={billing === 'monthly'} onClick={() => setBilling('monthly')}>월간</BillingChoice>
            <BillingChoice active={billing === 'yearly'} onClick={() => setBilling('yearly')}>
              연간 <span className="text-emerald-600 dark:text-emerald-400 ml-1 text-xs font-semibold">2개월 무료</span>
            </BillingChoice>
          </div>
        </div>
      </section>

      {/* Plans */}
      <section className="pb-20">
        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-3 gap-6">
          {PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} billing={billing} onCta={() => handleCta(p)} />
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 bg-gray-50 dark:bg-white/[0.02] border-y border-gray-200 dark:border-white/5">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-2xl lg:text-3xl font-bold mb-10 text-center">자주 묻는 질문</h2>
          <div className="space-y-4">
            <Faq q="무료 체험 후 자동으로 결제되나요?">
              아니요. 무료 체험은 신용카드 없이 시작하므로 자동 결제되지 않습니다. 만족하시면 그때 결제 수단을 등록하시면 됩니다.
            </Faq>
            <Faq q="중간에 플랜을 변경할 수 있나요?">
              언제든 가능합니다. 업그레이드는 즉시 반영되고, 다운그레이드는 다음 결제 주기에 반영됩니다.
            </Faq>
            <Faq q="기사 수가 일시적으로 많아져도 괜찮나요?">
              네, 일시적인 초과는 자동으로 다음 상위 플랜이 적용되고 일할 계산되어 청구됩니다. 갑작스러운 채용에도 운영이 끊기지 않습니다.
            </Faq>
            <Faq q="세금계산서 발행이 가능한가요?">
              가능합니다. 회사 정보(사업자등록번호) 등록 후 카드 결제 또는 계산서 발행을 선택하실 수 있습니다.
            </Faq>
            <Faq q="데이터는 어디에 저장되나요?">
              국내 클라우드(AWS Seoul)에 저장되며, 매일 자동 백업됩니다. 개인정보는 암호화되어 보관됩니다.
            </Faq>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 text-center">
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="text-3xl font-bold mb-4">아직 고민되신다면?</h2>
          <p className="text-gray-500 dark:text-gray-400 text-lg mb-8">
            무엇이든 편하게 물어보세요. 보통 1영업일 안에 답변드립니다.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/register"
              className="bg-blue-600 hover:bg-blue-700 text-white px-7 py-3 rounded-xl font-semibold text-base inline-flex items-center justify-center gap-2"
            >
              무료로 시작하기
            </Link>
            <Link
              to="/support"
              className="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/15 text-gray-800 dark:text-white px-7 py-3 rounded-xl font-semibold text-base inline-flex items-center justify-center"
            >
              고객 지원 문의
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function BillingChoice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-1.5 rounded-full text-sm font-semibold transition-colors ${
        active
          ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow'
          : 'text-gray-500 dark:text-gray-400'
      }`}
    >
      {children}
    </button>
  );
}

function PlanCard({
  plan,
  billing,
  onCta,
}: {
  plan: Plan;
  billing: 'monthly' | 'yearly';
  onCta: () => void;
}) {
  const isCustom = plan.monthlyKrw === null;
  const price = billing === 'monthly' ? plan.monthlyKrw : plan.yearlyKrw;
  const monthlyEquivalent = billing === 'yearly' && plan.yearlyKrw ? plan.yearlyKrw / 12 : null;

  return (
    <div
      className={`relative rounded-2xl border p-7 flex flex-col ${
        plan.highlight
          ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50/40 dark:bg-blue-500/[0.06] shadow-lg shadow-blue-100/40 dark:shadow-none'
          : 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03]'
      }`}
    >
      {plan.highlight && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
          추천
        </span>
      )}
      <div>
        <h3 className="text-2xl font-bold">{plan.name}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{plan.tagline}</p>
      </div>

      <div className="my-6">
        {isCustom ? (
          <div className="text-4xl font-extrabold">맞춤 견적</div>
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-extrabold tracking-tight">
                ₩{price!.toLocaleString()}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                /{billing === 'monthly' ? '월' : '년'}
              </span>
            </div>
            {monthlyEquivalent && (
              <p className="text-xs text-gray-400 mt-1">
                월 ₩{Math.round(monthlyEquivalent).toLocaleString()} 상당
              </p>
            )}
          </>
        )}
      </div>

      <ul className="space-y-2.5 mb-7 flex-1">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
            <Check size={16} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={onCta}
        className={`w-full px-5 py-3 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
          plan.highlight
            ? 'bg-blue-600 hover:bg-blue-700 text-white'
            : 'bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/15 text-gray-900 dark:text-white'
        }`}
      >
        {plan.cta}
      </button>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-semibold text-gray-900 dark:text-white">{q}</span>
        <span className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-gray-600 dark:text-gray-300 leading-relaxed border-t border-gray-100 dark:border-white/5">
          {children}
        </div>
      )}
    </div>
  );
}

