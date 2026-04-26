import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { usersApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';
import {
  Download, Trash2, ShieldCheck, AlertTriangle, Database,
  Clock, Loader2,
} from 'lucide-react';

interface DataCategory {
  category: string;
  count: number;
  retentionYears: number;
  description: string;
}

export default function MyDataPage() {
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [password, setPassword] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const { data: categories, isLoading } = useQuery<DataCategory[]>({
    queryKey: ['my-data-categories'],
    queryFn: () => usersApi.getDataCategories().then(r => r.data.data),
  });

  const exportMutation = useMutation({
    mutationFn: () => usersApi.exportMyData(),
    onSuccess: (response) => {
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (pw: string) => usersApi.deleteMyData(pw),
    onSuccess: () => {
      logout();
      navigate('/login');
    },
    onError: (err: any) => {
      setDeleteError(err.response?.data?.message || '삭제 중 오류가 발생했습니다.');
    },
  });

  const handleDelete = () => {
    if (!password.trim()) {
      setDeleteError('비밀번호를 입력해주세요.');
      return;
    }
    setDeleteError('');
    deleteMutation.mutate(password);
  };

  const totalRecords = categories?.reduce((sum, c) => sum + c.count, 0) || 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="text-blue-600 dark:text-blue-400" size={28} />
          <h1 className="text-2xl font-bold">내 데이터 관리</h1>
        </div>
        <p className="text-gray-500 dark:text-gray-400">
          개인정보보호법에 따라 본인의 개인정보를 열람, 내보내기, 삭제할 수 있습니다.
        </p>
      </div>

      {/* Summary Card */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <Database className="text-blue-600 dark:text-blue-400" size={20} />
          <h2 className="font-semibold text-blue-900 dark:text-blue-100">보유 데이터 현황</h2>
        </div>
        <p className="text-sm text-blue-700 dark:text-blue-300">
          총 <span className="font-bold text-lg">{totalRecords.toLocaleString()}</span>건의 데이터가 저장되어 있습니다.
        </p>
      </div>

      {/* Data Categories */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold">데이터 카테고리별 현황</h2>
        </div>
        {isLoading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="animate-spin text-gray-400" size={24} />
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {categories?.map((cat) => (
              <div key={cat.category} className="px-6 py-4 flex items-center justify-between">
                <div className="flex-1">
                  <p className="font-medium text-gray-900 dark:text-gray-100">{cat.category}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{cat.description}</p>
                </div>
                <div className="flex items-center gap-6 ml-4">
                  <span className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums min-w-[60px] text-right">
                    {cat.count.toLocaleString()}건
                  </span>
                  <div className="flex items-center gap-1 text-xs text-gray-400 min-w-[80px]">
                    <Clock size={12} />
                    {cat.retentionYears > 0 ? `${cat.retentionYears}년 보관` : '삭제 가능'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Export */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3 mb-3">
            <Download className="text-green-600" size={22} />
            <h3 className="font-semibold text-lg">데이터 내보내기</h3>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            모든 개인정보를 JSON 파일로 다운로드합니다. 프로필, 근태, 급여, 휴무, 결재, 교육 기록이 포함됩니다.
          </p>
          <button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
            className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-base"
          >
            {exportMutation.isPending ? (
              <><Loader2 className="animate-spin" size={18} /> 준비 중...</>
            ) : (
              <><Download size={18} /> 데이터 내보내기</>
            )}
          </button>
        </div>

        {/* Delete */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-red-200 dark:border-red-900 p-6">
          <div className="flex items-center gap-3 mb-3">
            <Trash2 className="text-red-600" size={22} />
            <h3 className="font-semibold text-lg">계정 삭제</h3>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            계정을 삭제하고 개인정보를 익명 처리합니다. 이 작업은 되돌릴 수 없습니다.
          </p>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-base"
          >
            <Trash2 size={18} /> 계정 삭제 요청
          </button>
        </div>
      </div>

      {/* Legal Retention Notice */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" size={20} />
          <div>
            <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-2">법적 보관 의무 안내</h3>
            <ul className="text-sm text-amber-800 dark:text-amber-200 space-y-1.5">
              <li>- 급여 기록: 근로기준법에 따라 <strong>5년간</strong> 보관 의무</li>
              <li>- 교육 기록: 여객자동차운수사업법에 따라 <strong>5년간</strong> 보관 의무</li>
              <li>- 사고/위반 기록: 교통안전법에 따라 <strong>5년간</strong> 보관 의무</li>
              <li>- 근태 기록: 근로기준법에 따라 <strong>3년간</strong> 보관 의무</li>
              <li>- 계정 삭제 시에도 위 기록은 보관 기간 경과 후 자동 삭제됩니다.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <AlertTriangle className="text-red-600" size={20} />
              </div>
              <h3 className="text-lg font-bold">계정 삭제 확인</h3>
            </div>

            <div className="mb-4 text-sm text-gray-600 dark:text-gray-300 space-y-2">
              <p>계정을 삭제하면 다음이 처리됩니다:</p>
              <ul className="list-disc ml-5 space-y-1">
                <li>이름, 이메일, 전화번호, 면허번호가 삭제됩니다</li>
                <li>로그인이 불가능합니다</li>
                <li>법적 보관 의무가 있는 기록은 유지됩니다</li>
              </ul>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1.5">비밀번호 확인</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="현재 비밀번호를 입력하세요"
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-base focus:ring-2 focus:ring-red-500 focus:border-transparent"
                onKeyDown={(e) => e.key === 'Enter' && handleDelete()}
              />
              {deleteError && (
                <p className="text-red-500 text-sm mt-1.5">{deleteError}</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeleteConfirm(false); setPassword(''); setDeleteError(''); }}
                className="flex-1 py-3 px-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors text-base"
              >
                취소
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-base"
              >
                {deleteMutation.isPending ? (
                  <><Loader2 className="animate-spin" size={16} /> 처리 중...</>
                ) : (
                  '삭제 확인'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
