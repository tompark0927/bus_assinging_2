import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Mail,
  Phone,
  MessageCircle,
  Clock,
  MapPin,
  Send,
  Loader2,
  CheckCircle2,
  HelpCircle,
  Bug,
  Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { contactApi } from '../services/api';
import { MarketingNav, MarketingFooter } from '../components/MarketingShell';

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white">
      <MarketingNav />

      {/* Hero */}
      <section className="pt-20 pb-12 lg:pt-28 lg:pb-16">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-blue-600 dark:text-blue-400 text-sm font-medium mb-6">
            <MessageCircle size={14} />
            평균 응답 시간 — 1영업일 이내
          </span>
          <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight mb-4">
            언제든 도와드립니다
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-lg leading-relaxed">
            문의·도입 상담·기술 지원 모두 한 곳에서.<br />
            바쁘신 운수 현장을 가장 잘 이해하는 팀이 직접 답변드립니다.
          </p>
        </div>
      </section>

      {/* Channels */}
      <section className="pb-12">
        <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-3 gap-5">
          <ChannelCard
            icon={<Phone size={22} />}
            tone="blue"
            title="전화 지원"
            primary="032-000-0000"
            sub={
              <>
                평일 09:00 ~ 18:00<br />
                토·일·공휴일 휴무
              </>
            }
            href="tel:032-000-0000"
            cta="전화 걸기"
          />
          <ChannelCard
            icon={<Mail size={22} />}
            tone="emerald"
            title="이메일"
            primary="support@busync.co.kr"
            sub="기능 요청·버그 리포트 환영"
            href="mailto:support@busync.co.kr"
            cta="메일 보내기"
          />
          <ChannelCard
            icon={<MessageCircle size={22} />}
            tone="amber"
            title="카카오톡 채널"
            primary="@busync"
            sub="가장 빠른 응답 · 모바일에서 편리"
            href="https://pf.kakao.com/_busync"
            cta="채널 추가"
          />
        </div>
      </section>

      {/* Hours / Address */}
      <section className="pb-16">
        <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-2 gap-5">
          <InfoCard
            icon={<Clock size={20} className="text-blue-600 dark:text-blue-400" />}
            title="운영 시간"
            rows={[
              ['평일', '09:00 - 18:00'],
              ['토요일', '휴무'],
              ['일요일·공휴일', '휴무'],
              ['긴급 운영 장애', '24시간 (Pro 이상)'],
            ]}
          />
          <InfoCard
            icon={<MapPin size={20} className="text-blue-600 dark:text-blue-400" />}
            title="주소"
            rows={[
              ['본사', '인천광역시 남동구'],
              ['우편번호', '21565'],
              ['사업자등록번호', '000-00-00000'],
              ['대표', '홍길동'],
            ]}
          />
        </div>
      </section>

      {/* Resource shortcuts */}
      <section className="pb-16">
        <div className="max-w-5xl mx-auto px-6 grid sm:grid-cols-2 gap-4">
          <ResourceLink
            icon={<HelpCircle size={20} />}
            title="자주 묻는 질문"
            desc="결제·요금제·운영 문의"
            to="/pricing#faq"
          />
          <ResourceLink
            icon={<Bug size={20} />}
            title="버그 리포트"
            desc="문제가 발생하면 아래 폼으로 알려주세요"
            to="#contact"
          />
        </div>
      </section>

      {/* Contact form */}
      <section id="contact" className="py-16 bg-gray-50 dark:bg-white/[0.02] border-y border-gray-200 dark:border-white/5">
        <div className="max-w-2xl mx-auto px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3 inline-flex items-center gap-2">
              <Sparkles size={22} className="text-blue-600 dark:text-blue-400" />
              문의 보내기
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              아래 폼을 작성해 주시면 1영업일 안에 답변드립니다.
            </p>
          </div>

          <ContactForm />
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ChannelCard({
  icon,
  tone,
  title,
  primary,
  sub,
  href,
  cta,
}: {
  icon: React.ReactNode;
  tone: 'blue' | 'emerald' | 'amber';
  title: string;
  primary: string;
  sub: React.ReactNode;
  href: string;
  cta: string;
}) {
  const toneCls = {
    blue:    'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
    amber:   'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  }[tone];

  return (
    <a
      href={href}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel="noreferrer"
      className="group bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-2xl p-6 hover:border-blue-300 dark:hover:border-blue-500/40 hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      <div className={`w-11 h-11 rounded-xl ${toneCls} flex items-center justify-center mb-4`}>
        {icon}
      </div>
      <h3 className="text-lg font-bold mb-1">{title}</h3>
      <p className="text-base font-semibold text-gray-900 dark:text-white">{primary}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5">{sub}</p>
      <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mt-4 inline-flex items-center gap-1 group-hover:gap-1.5 transition-all">
        {cta} →
      </p>
    </a>
  );
}

function InfoCard({
  icon,
  title,
  rows,
}: {
  icon: React.ReactNode;
  title: string;
  rows: [string, string][];
}) {
  return (
    <div className="bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="text-lg font-bold">{title}</h3>
      </div>
      <dl className="space-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between items-center text-sm">
            <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
            <dd className="text-gray-900 dark:text-white font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ResourceLink({
  icon,
  title,
  desc,
  to,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  to: string;
}) {
  const isHash = to.startsWith('#');
  const Comp = isHash ? 'a' : Link;
  const props = isHash ? { href: to } : { to };

  return (
    // @ts-expect-error union of Link/anchor props
    <Comp
      {...props}
      className="group flex items-start gap-3 bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-xl p-4 hover:border-blue-300 dark:hover:border-blue-500/40 transition-colors"
    >
      <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-gray-900 dark:text-white text-[15px] group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {title}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
      </div>
    </Comp>
  );
}

/* ------------------------------------------------------------------ */
/*  Contact form                                                       */
/* ------------------------------------------------------------------ */

function ContactForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [topic, setTopic] = useState<'general' | 'demo' | 'pricing' | 'bug'>('general');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      toast.error('이름과 연락처를 입력해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      await contactApi.submit({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        topic,
        message: message.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      console.error(err);
      toast.error('문의 접수 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-2xl p-10 text-center">
        <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-4" />
        <h3 className="text-2xl font-bold mb-2">접수되었습니다</h3>
        <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
          문의를 잘 받았습니다. 1영업일 안에 연락드리겠습니다.<br />
          급하신 경우 평일 09:00~18:00에 <a href="tel:032-000-0000" className="text-blue-600 dark:text-blue-400 font-semibold hover:underline">032-000-0000</a>으로 전화 주세요.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-2xl p-7 lg:p-9 space-y-5"
    >
      <Field label="문의 유형">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { v: 'general', l: '일반 문의' },
              { v: 'demo', l: '도입 상담' },
              { v: 'pricing', l: '요금·결제' },
              { v: 'bug', l: '버그 리포트' },
            ] as const
          ).map((o) => (
            <button
              type="button"
              key={o.v}
              onClick={() => setTopic(o.v)}
              className={`px-3.5 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                topic === o.v
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:border-blue-400'
              }`}
            >
              {o.l}
            </button>
          ))}
        </div>
      </Field>

      <Field label="이름 / 회사명" required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="홍길동 / OO버스"
          className={inputCls}
        />
      </Field>

      <Field label="연락처" required>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          placeholder="010-1234-5678"
          className={inputCls}
        />
      </Field>

      <Field label="이메일 (선택)">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.com"
          className={inputCls}
        />
      </Field>

      <Field label="문의 내용 (선택)">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="궁금한 점이나 도입 검토 중인 환경을 자유롭게 적어주세요."
          className={`${inputCls} resize-none`}
        />
      </Field>

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 size={16} className="animate-spin" /> 보내는 중...
          </>
        ) : (
          <>
            <Send size={16} /> 문의 보내기
          </>
        )}
      </button>

      <p className="text-xs text-gray-400 text-center">
        제출하시면 개인정보 처리방침에 따라 응답을 위한 정보로만 사용됩니다.
      </p>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-white/10 rounded-xl px-4 py-3 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow';
