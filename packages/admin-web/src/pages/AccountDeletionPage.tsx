import { MarketingNav, MarketingFooter } from '../components/MarketingShell';

export default function AccountDeletionPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <MarketingNav />

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl lg:text-4xl font-bold mb-2">계정 및 데이터 삭제 요청</h1>
        <p className="text-sm text-gray-500 mb-10">최종 업데이트: 2026년 7월 13일</p>

        <div className="prose dark:prose-invert max-w-none space-y-6 leading-relaxed">

          <section>
            <h2 className="text-xl font-bold mb-2">1. 삭제 요청 방법</h2>
            <p>
              소속 회사 관리자에게 요청하시거나, 아래 이메일로 요청해 주세요.
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                이메일:{' '}
                <a
                  href="mailto:support.busync@gmail.com?subject=계정 삭제 요청"
                  className="text-blue-600 hover:underline"
                >
                  support.busync@gmail.com
                </a>
              </li>
              <li>포함할 정보: 성함, 전화번호, 소속 회사명</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">2. 삭제되는 데이터</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>계정 정보: 이름, 전화번호, 이메일(있는 경우), 비밀번호</li>
              <li>알림 정보: 푸시 알림 토큰(기기 식별자)</li>
              <li>이용자 생성 콘텐츠: 대타·휴무 요청 사유 등 본인이 입력한 내용</li>
              <li>본인과 연동된 배차·근무 관련 개인 데이터</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">3. 보관 후 삭제되는 데이터</h2>
            <p>
              아래 항목은 관계 법령에 따라 일정 기간 보관 후 파기됩니다.
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>계약 또는 청약철회 등에 관한 기록: 5년</li>
              <li>전자금융 거래에 관한 기록: 5년</li>
              <li>접속 로그 기록: 3개월</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">4. 처리 기간</h2>
            <p>
              요청 접수 후 영업일 기준 30일 이내에 처리하며, 처리 완료 시 요청하신 연락처로 안내합니다.
            </p>
          </section>

          <p className="text-sm text-gray-500 pt-6 border-t border-gray-200 dark:border-white/10">
            본 안내는{' '}
            <a href="/privacy" className="text-blue-600 hover:underline">
              개인정보처리방침
            </a>
            의 일부이며, 법령 또는 서비스 변경에 따라 개정될 수 있습니다.
          </p>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
