import { MarketingNav, MarketingFooter } from '../components/MarketingShell';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <MarketingNav />

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl lg:text-4xl font-bold mb-2">개인정보처리방침</h1>
        <p className="text-sm text-gray-500 mb-10">최종 업데이트: 2026년 5월 14일</p>

        <div className="prose dark:prose-invert max-w-none space-y-6 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold mb-2">1. 수집하는 개인정보 항목</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>회원가입·로그인: 회사 코드, 이름, 전화번호, 이메일(선택), 비밀번호(암호화 저장)</li>
              <li>서비스 이용 과정: 배차 이력, 출퇴근 기록, 알림 수신 기기 정보</li>
              <li>자동 수집: 접속 IP, 브라우저/기기 정보, 서비스 이용 로그</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">2. 개인정보의 수집 및 이용 목적</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>회원 식별 및 본인 확인, 서비스 제공·운영</li>
              <li>배차 관리, 알림 발송, 고객 지원</li>
              <li>서비스 개선 및 부정 이용 방지</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">3. 개인정보의 보유 및 이용 기간</h2>
            <p>
              회원 탈퇴 시 지체 없이 파기합니다. 단, 관계 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>계약 또는 청약철회 등에 관한 기록: 5년</li>
              <li>전자금융 거래에 관한 기록: 5년</li>
              <li>접속 로그 기록: 3개월</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">4. 개인정보의 제3자 제공</h2>
            <p>회사는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다.
              다만, 법령에 따라 수사기관이 적법한 절차에 의해 요청하는 경우에 한해 제공합니다.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">5. 개인정보의 처리 위탁</h2>
            <p>안정적 서비스 제공을 위해 다음 업무를 위탁할 수 있습니다.</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>클라우드 인프라 운영 (AWS, GCP 등)</li>
              <li>SMS·푸시 알림 발송</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">6. 이용자의 권리</h2>
            <p>이용자는 언제든지 본인의 개인정보 열람·정정·삭제·처리정지를 요청할 수 있으며,
              회사는 지체 없이 조치합니다.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">7. 개인정보 보호책임자</h2>
            <p>
              개인정보 보호책임자: Busync 운영팀<br />
              이메일: <a href="mailto:support.busync@gmail.com" className="text-blue-600 hover:underline">support.busync@gmail.com</a>
            </p>
          </section>

          <p className="text-sm text-gray-500 pt-6 border-t border-gray-200 dark:border-white/10">
            본 방침은 법령 또는 서비스 변경에 따라 개정될 수 있으며, 변경 시 공지합니다.
          </p>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
