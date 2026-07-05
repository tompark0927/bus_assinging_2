import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Building2,
  Save,
  Users,
  Bus,
  Map,
  Calendar,
  Loader2,
  Hash,
  ChevronRight,
  Lock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { companyInfoApi } from '../services/api';
import PageHeader from '../components/PageHeader';
import { companyInfoHelp } from '../help/helpContent';

/* ────────────────────────────────────────────
   Types
   ──────────────────────────────────────────── */

interface CompanyInfo {
  id: number;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
  stats: {
    drivers: number;
    buses: number;
    routes: number;
  };
}

/* ────────────────────────────────────────────
   Page
   ──────────────────────────────────────────── */

export default function CompanyInfoPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<CompanyInfo>({
    queryKey: ['company-info'],
    queryFn: () => companyInfoApi.get().then((r) => r.data.data),
  });

  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.name && !dirty) setName(data.name);
  }, [data, dirty]);

  const update = useMutation({
    mutationFn: () => companyInfoApi.update({ name: name.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-info'] });
      toast.success('회사 정보가 수정되었습니다.');
      setDirty(false);
    },
    onError: (e) =>
      toast.error(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message
          || '저장 중 오류가 발생했습니다.',
      ),
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const created = new Date(data.createdAt);
  const createdStr = created.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader icon={Building2} title="회사 정보" description="회사 기본 정보와 등록 현황입니다." help={companyInfoHelp} />

      {/* 기본 정보 카드 */}
      <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl p-6">
        <h2 className="text-[18px] font-semibold text-gray-900 dark:text-gray-100 mb-5">기본 정보</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-200 mb-1.5">
              회사 이름
            </label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
              maxLength={50}
              className="w-full bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-xl px-3 py-2.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <p className="text-[13px] text-gray-400 mt-1">기사들이 모바일 앱에서 보는 회사명입니다.</p>
          </div>

          <div>
            <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-200 mb-1.5">
              회사 코드
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 inline-flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/10">
                <Hash size={14} className="text-gray-400" />
                <span className="font-mono text-[16px] font-semibold text-gray-900 dark:text-gray-100">{data.code}</span>
              </div>
              <span className="inline-flex items-center gap-1 text-[12px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1.5 rounded-lg">
                <Lock size={11} /> 변경 불가
              </span>
            </div>
            <p className="text-[13px] text-gray-400 mt-1">
              로그인 시 사용되는 고유 코드입니다. 변경하려면 고객 지원에 문의하세요.
            </p>
          </div>

          <div>
            <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-200 mb-1.5">
              가입일
            </label>
            <div className="text-[15px] text-gray-700 dark:text-gray-200">{createdStr}</div>
          </div>
        </div>

        {dirty && (
          <div className="flex justify-end gap-2 pt-5 mt-5 border-t border-gray-100 dark:border-white/10">
            <button
              onClick={() => { setName(data.name); setDirty(false); }}
              className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 text-[15px]"
            >
              되돌리기
            </button>
            <button
              onClick={() => update.mutate()}
              disabled={update.isPending || !name.trim()}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white inline-flex items-center gap-2 text-[15px] font-medium"
            >
              {update.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              저장
            </button>
          </div>
        )}
      </section>

      {/* 등록 현황 */}
      <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl p-6">
        <h2 className="text-[18px] font-semibold text-gray-900 dark:text-gray-100 mb-5">등록 현황</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatLink
            to="/dashboard/data?tab=drivers"
            icon={<Users className="w-6 h-6 text-blue-500" />}
            label="활성 기사"
            value={data.stats.drivers}
            unit="명"
          />
          <StatLink
            to="/dashboard/data?tab=buses"
            icon={<Bus className="w-6 h-6 text-emerald-500" />}
            label="운행 버스"
            value={data.stats.buses}
            unit="대"
          />
          <StatLink
            to="/dashboard/data?tab=routes"
            icon={<Map className="w-6 h-6 text-purple-500" />}
            label="활성 노선"
            value={data.stats.routes}
            unit="개"
          />
        </div>
      </section>

      {/* 빠른 진입 */}
      <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl p-6">
        <h2 className="text-[18px] font-semibold text-gray-900 dark:text-gray-100 mb-5">빠른 진입</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <QuickLink
            to="/dashboard/settings"
            icon={<Calendar className="w-5 h-5 text-blue-500" />}
            title="배차 설정"
            desc="시프트·승무 모델·휴무 사이클 등 운영 정책"
          />
          <QuickLink
            to="/dashboard/accounts"
            icon={<Users className="w-5 h-5 text-emerald-500" />}
            title="계정 관리"
            desc="배차담당·관리자 등 직원 계정"
          />
        </div>
      </section>
    </div>
  );
}

/* ────────────────────────────────────────────
   Sub-components
   ──────────────────────────────────────────── */

function StatLink({ to, icon, label, value, unit }: { to: string; icon: React.ReactNode; label: string; value: number; unit: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-white/10 hover:border-blue-300 dark:hover:border-blue-500/40 transition group"
    >
      <div className="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02]">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-gray-500 dark:text-gray-400">{label}</div>
        <div className="text-[24px] font-bold text-gray-900 dark:text-gray-100 leading-tight">
          {value}<span className="text-[14px] font-normal text-gray-400 ml-1">{unit}</span>
        </div>
      </div>
      <ChevronRight size={16} className="text-gray-300 group-hover:text-blue-500 transition" />
    </Link>
  );
}

function QuickLink({ to, icon, title, desc }: { to: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 dark:border-white/10 hover:border-blue-400 dark:hover:border-blue-500/50 hover:bg-blue-50 dark:hover:bg-blue-500/5 transition"
    >
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
      </div>
      <ChevronRight size={16} className="text-gray-300" />
    </Link>
  );
}
