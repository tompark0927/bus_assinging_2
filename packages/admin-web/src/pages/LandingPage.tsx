import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ChevronRight,
  Calendar,
  Brain,
  Bell,
  ClipboardList,
  BarChart3,
  Building2,
  Users,
  Bus,
  Clock,
  Zap,
  Smartphone,
  Star,
  Quote,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { contactApi } from '../services/api';
import { MarketingNav, MarketingFooter } from '../components/MarketingShell';

/* ------------------------------------------------------------------ */
/*  CSS-only scroll-triggered fade-in hook                            */
/* ------------------------------------------------------------------ */
function useInView<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  return { ref, visible };
}

function Section({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */
const FEATURES = [
  { icon: Calendar, title: '자동 배차', desc: '근무/휴무 사이클에 맞춰 월간 배차표를 자동 생성합니다.' },
  { icon: Brain, title: 'AI 추천', desc: 'AI가 회사 규칙을 학습하여 최적의 배차 조합을 추천합니다.' },
  { icon: Bell, title: '실시간 알림', desc: '결원 발생 시 쉬는 기사에게 즉시 푸시 알림을 보냅니다.' },
  { icon: ClipboardList, title: '근태 관리', desc: '휴무 요청부터 승인까지 앱 하나로 투명하게 관리합니다.' },
  { icon: BarChart3, title: '운영 대시보드', desc: '결원율, 대응 시간, 기사별 부담을 한눈에 추적합니다.' },
  { icon: Smartphone, title: '기사 모바일 앱', desc: '내 일정 확인부터 휴무 신청, 대타 수락까지 앱 하나로.' },
];

const PERSONAS = [
  { icon: Building2, title: '버스 회사 대표', desc: '수기 배차에 드는 인건비와 리스크를 줄이고 싶은 경영자' },
  { icon: Users, title: '배차 관리자', desc: '매달 반복되는 배차표 작성의 고통에서 벗어나고 싶은 담당자' },
  { icon: Bus, title: '운전 기사', desc: '내 스케줄을 앱으로 확인하고 휴무를 편하게 신청하고 싶은 기사님' },
];

const STATS = [
  { value: '90%', label: '배차 시간 감소', icon: Clock },
  { value: '5분', label: '결원 대응 시간', icon: Zap },
  { value: '실시간', label: '기사 알림 전달', icon: Bell },
];

const TESTIMONIALS = [
  {
    quote: '매달 3일 걸리던 배차표 작성이 30분이면 끝납니다. 처음엔 반신반의했는데, 이제 없으면 안 되는 시스템이 됐어요.',
    name: '김상현 대표',
    company: '한성운수 (인천)',
    stars: 5,
  },
  {
    quote: '기사님들이 앱으로 스케줄 확인하니까 전화 문의가 확 줄었어요. 결원 알림 덕분에 운행 펑크도 거의 사라졌습니다.',
    name: '박정미 배차계장',
    company: '대한교통 (수원)',
    stars: 5,
  },
  {
    quote: '눈치 안 보고 휴가 신청할 수 있어서 좋습니다. 내 스케줄을 직접 확인할 수 있다는 것만으로도 큰 변화예요.',
    name: '이동준 기사',
    company: '삼화버스 (서울)',
    stars: 5,
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function LandingPage() {
  const navigate = useNavigate();
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await contactApi.submit({ name: contactName, phone: contactPhone, topic: 'demo' });
      setContactName('');
      setContactPhone('');
      toast.success('도입 문의가 접수되었습니다. 곧 연락드리겠습니다!');
    } catch (error) {
      console.error(error);
      toast.error('문의 접수 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white font-sans overflow-x-hidden">
      <MarketingNav />

      {/* ============================================================ */}
      {/*  Hero                                                         */}
      {/* ============================================================ */}
      <section id="hero" className="relative pt-28 pb-20 lg:pt-40 lg:pb-32 overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-blue-400/20 dark:bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] bg-blue-300/10 dark:bg-blue-600/5 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-7xl mx-auto px-6 text-center relative z-10">
          <Section>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-blue-600 dark:text-blue-400 text-sm font-medium mb-6">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              차세대 버스 배차 자동화 SaaS
            </span>
          </Section>

          <Section delay={100}>
            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-extrabold tracking-tight leading-tight mb-6">
              버스 배차,{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-blue-400">
                이제 자동으로
              </span>
            </h1>
          </Section>

          <Section delay={200}>
            <p className="text-lg lg:text-xl text-gray-500 dark:text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
              수기 배차의 실수와 시간 낭비는 그만. AI 기반 자동 배차, 실시간 결원 대응,
              기사 전용 앱까지 — 배차 업무의 모든 것을 하나로 해결하세요.
            </p>
          </Section>

          <Section delay={300}>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => navigate('/register')}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25"
              >
                시작하기
                <ArrowRight size={20} />
              </button>
              <button
                onClick={() => scrollTo('contact')}
                className="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/15 text-gray-800 dark:text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all border border-gray-200 dark:border-white/10"
              >
                데모 요청
              </button>
            </div>
          </Section>

          {/* Hero visual — abstract dashboard mockup */}
          <Section delay={400}>
            <div className="mt-16 mx-auto max-w-4xl rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-900 shadow-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-white/10">
                <span className="w-3 h-3 rounded-full bg-red-400" />
                <span className="w-3 h-3 rounded-full bg-yellow-400" />
                <span className="w-3 h-3 rounded-full bg-green-400" />
                <span className="ml-3 text-xs text-gray-400 font-mono">admin.busync.co.kr</span>
              </div>
              <div className="p-6 md:p-10 grid grid-cols-3 md:grid-cols-7 gap-2 md:gap-3">
                {/* Fake schedule grid */}
                {Array.from({ length: 35 }).map((_, i) => {
                  const variants = [
                    'bg-blue-500 text-white',
                    'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
                    'bg-gray-100 dark:bg-gray-800 text-gray-400',
                    'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
                  ];
                  const v = variants[i % 4];
                  return (
                    <div key={i} className={`${v} rounded-lg h-10 md:h-12 flex items-center justify-center text-xs font-semibold`}>
                      {i % 4 === 0 ? '근무' : i % 4 === 1 ? '오전' : i % 4 === 2 ? '휴무' : '대타'}
                    </div>
                  );
                })}
              </div>
            </div>
          </Section>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  Features                                                     */}
      {/* ============================================================ */}
      <section id="features" className="py-24 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-6">
          <Section>
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl lg:text-4xl font-bold mb-4">배차 업무를 위한 올인원 솔루션</h2>
              <p className="text-gray-500 dark:text-gray-400 text-lg">복잡한 배차 관리를 6가지 핵심 기능으로 단순하게 만듭니다.</p>
            </div>
          </Section>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <Section key={f.title} delay={i * 80}>
                <div className="bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-white/10 rounded-2xl p-7 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 h-full">
                  <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center mb-5">
                    <f.icon size={24} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">{f.title}</h3>
                  <p className="text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</p>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  For Who                                                      */}
      {/* ============================================================ */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <Section>
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl lg:text-4xl font-bold mb-4">이런 분들을 위해 만들었습니다</h2>
              <p className="text-gray-500 dark:text-gray-400 text-lg">버스 운송 현장의 모든 구성원이 체감하는 변화</p>
            </div>
          </Section>

          <div className="grid md:grid-cols-3 gap-8">
            {PERSONAS.map((p, i) => (
              <Section key={p.title} delay={i * 100}>
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center mb-5">
                    <p.icon size={32} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">{p.title}</h3>
                  <p className="text-gray-500 dark:text-gray-400 leading-relaxed">{p.desc}</p>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  Stats                                                        */}
      {/* ============================================================ */}
      <section id="stats" className="py-24 bg-blue-600 dark:bg-blue-700 text-white">
        <div className="max-w-7xl mx-auto px-6">
          <Section>
            <h2 className="text-3xl lg:text-4xl font-bold text-center mb-16">도입 기업이 체감하는 성과</h2>
          </Section>

          <div className="grid md:grid-cols-3 gap-10 text-center">
            {STATS.map((s, i) => (
              <Section key={s.label} delay={i * 120}>
                <div>
                  <s.icon size={36} className="mx-auto mb-4 text-blue-200" />
                  <div className="text-5xl lg:text-6xl font-extrabold mb-2">{s.value}</div>
                  <div className="text-blue-100 text-lg font-medium">{s.label}</div>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  Testimonials                                                 */}
      {/* ============================================================ */}
      <section id="testimonials" className="py-24 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-6">
          <Section>
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl lg:text-4xl font-bold mb-4">고객 후기</h2>
              <p className="text-gray-500 dark:text-gray-400 text-lg">Busync를 도입한 현장의 생생한 이야기</p>
            </div>
          </Section>

          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <Section key={t.name} delay={i * 100}>
                <div className="bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-white/10 rounded-2xl p-7 h-full flex flex-col">
                  <Quote size={24} className="text-blue-200 dark:text-blue-800 mb-4 flex-shrink-0" />
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-6 flex-1">"{t.quote}"</p>
                  <div className="flex items-center gap-3 pt-4 border-t border-gray-100 dark:border-white/5">
                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold text-sm">
                      {t.name[0]}
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{t.name}</div>
                      <div className="text-gray-400 text-xs">{t.company}</div>
                    </div>
                    <div className="ml-auto flex gap-0.5">
                      {Array.from({ length: t.stars }).map((_, si) => (
                        <Star key={si} size={14} className="fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                  </div>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  CTA + Contact                                                */}
      {/* ============================================================ */}
      <section id="contact" className="py-24">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <Section>
            <h2 className="text-3xl lg:text-5xl font-bold mb-4">지금 무료로 시작하세요</h2>
            <p className="text-gray-500 dark:text-gray-400 text-lg mb-10 max-w-xl mx-auto">
              14일 무료 체험, 신용카드 불필요. 설정은 10분이면 충분합니다.
            </p>
          </Section>

          <Section delay={100}>
            <button
              onClick={() => navigate('/register')}
              className="bg-blue-600 hover:bg-blue-700 text-white px-10 py-4 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-600/25 inline-flex items-center gap-2 mb-16"
            >
              무료로 시작하기
              <ArrowRight size={20} />
            </button>
          </Section>

          <Section delay={200}>
            <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-2xl p-8 lg:p-10 text-left max-w-xl mx-auto">
              <h3 className="text-xl font-bold mb-1">데모 상담 신청</h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">연락처를 남겨주시면 빠르게 연락드리겠습니다.</p>

              <form onSubmit={handleContactSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">회사명 또는 이름</label>
                  <input
                    type="text"
                    required
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-white/10 rounded-xl px-4 py-3 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                    placeholder="회사명"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">연락처</label>
                  <input
                    type="tel"
                    required
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-white/10 rounded-xl px-4 py-3 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                    placeholder="010-0000-0000"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>상담 신청하기 <ChevronRight size={18} /></>
                  )}
                </button>
              </form>
            </div>
          </Section>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
