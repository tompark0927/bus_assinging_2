import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Home } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  404 — Not Found                                                    */
/* ------------------------------------------------------------------ */

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-white dark:bg-gray-950 text-gray-900 dark:text-white">
      <div className="w-full max-w-[1022px] text-center">
        {/* Illustration */}
        <img
          src="/not-found.png"
          alt="길을 잃은 버스 일러스트"
          className="w-full mx-auto mb-6 select-none pointer-events-none"
          style={{ maxWidth: 'calc(32rem + 415px)' }}
          draggable={false}
        />

        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight mb-8">
          404번 버스가 길을 잃은 것 같아요
        </h1>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-7 py-3.5 rounded-xl font-semibold transition-all shadow-lg shadow-blue-600/25"
          >
            <Home size={18} />
            홈으로 가기
          </Link>
          <button
            onClick={() => navigate(-1)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900 transition-all"
          >
            <ArrowLeft size={18} />
            이전 페이지
          </button>
        </div>
      </div>
    </div>
  );
}
