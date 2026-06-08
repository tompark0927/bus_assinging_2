import { MarketingNav, MarketingFooter } from '../components/MarketingShell';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <MarketingNav />

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl lg:text-4xl font-bold mb-2">이용약관</h1>
        <p className="text-sm text-gray-500 mb-10">최종 업데이트: 2026년 5월 14일</p>

        <div className="prose dark:prose-invert max-w-none space-y-6 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold mb-2">제1조 (목적)</h2>
            <p>
              본 약관은 Busync(이하 “회사”)가 제공하는 버스 배차 자동화 서비스(이하 “서비스”)의 이용과 관련하여
              회사와 이용자 간의 권리, 의무 및 책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">제2조 (정의)</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>“서비스”란 회사가 제공하는 배차표 생성, 운영, 알림 등 일체의 기능을 의미합니다.</li>
              <li>“이용자”란 본 약관에 따라 회사가 제공하는 서비스를 이용하는 회원 및 비회원을 말합니다.</li>
              <li>“회사 계정”이란 운수회사가 발급받아 직원에게 분배하는 사용 단위를 의미합니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">제3조 (약관의 효력 및 변경)</h2>
            <p>
              회사는 관련 법령을 위반하지 않는 범위에서 본 약관을 변경할 수 있으며, 변경 시 적용일자 7일 전부터 공지합니다.
              이용자가 변경된 약관에 동의하지 않을 경우 서비스 이용을 중단하고 탈퇴할 수 있습니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">제4조 (서비스의 제공 및 변경)</h2>
            <p>
              회사는 서비스 운영상·기술상 필요에 따라 서비스 내용의 일부 또는 전부를 변경할 수 있으며, 사전에 공지합니다.
              불가피한 사유로 사전 공지가 어려운 경우 사후에 즉시 통지합니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">제5조 (이용자의 의무)</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>이용자는 타인의 계정·비밀번호를 도용하거나 부정 사용해서는 안 됩니다.</li>
              <li>서비스 운영을 방해하거나, 회사의 명시적 허가 없이 자동화된 방식으로 데이터를 수집해서는 안 됩니다.</li>
              <li>관계 법령, 본 약관의 규정, 이용안내 및 주의사항을 준수해야 합니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">제6조 (책임 제한)</h2>
            <p>
              회사는 천재지변, 정전, 통신장애 등 불가항력으로 인한 서비스 중단에 대해 책임을 지지 않습니다.
              이용자의 귀책사유로 인한 서비스 이용 장애에 대해서도 책임을 지지 않습니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">제7조 (분쟁 해결)</h2>
            <p>
              서비스 이용과 관련하여 발생한 분쟁에 대해서는 회사의 본사 소재지 관할 법원을 합의 관할로 합니다.
            </p>
          </section>

          <p className="text-sm text-gray-500 pt-6 border-t border-gray-200 dark:border-white/10">
            본 약관에 관한 문의: <a href="mailto:support.busync@gmail.com" className="text-blue-600 hover:underline">support.busync@gmail.com</a>
          </p>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
