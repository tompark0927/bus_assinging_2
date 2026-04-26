import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../utils/prisma';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const AI_MODEL_CHAT = process.env.AI_MODEL_CHAT || 'claude-opus-4-6';
const AI_MODEL_FAST = process.env.AI_MODEL_FAST || 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `당신은 대한민국 버스 배차 전문 AI 어시스턴트입니다. 공공버스 ERP 시스템의 배차 원리를 깊이 이해하고 있습니다.

══════════════════════════════════════════════
📚 대한민국 버스 배차 핵심 원리 (학습된 지식)
══════════════════════════════════════════════

【1】 배차의 기본 단위: 차량 기준
- 배차표는 "차량(버스) 수"가 기준이 됩니다
- 매일 운행해야 할 차량대수 = 그날 필요한 기사 수 (1일 1교대 기준)
- 1일 2교대: 차량대수 × 2명의 기사가 매일 필요
- 공식: 필요 총 기사수 = 차량대수 × 교대수 × (사이클일수 ÷ 근무일수)
  예) 14대 × 1교대 × (7÷5) = 19.6 → 최소 20명 필요
  예) 14대 × 2교대 × (7÷5) = 39.2 → 최소 40명 필요

【2】 5일 근무 / 2일 휴무 사이클 (한국 공공버스 표준)
- 전체 기사를 7개 그룹으로 분산: 매일 전체의 5/7(≈71%)이 근무
- 매일 전체의 2/7(≈29%)이 휴무
- 그룹 오프셋: 0,1,2,3,4,5,6 → 각 그룹의 휴무 시작일이 다름
- 목표: 어떤 날도 14대 차량 운행을 보장해야 함

【3】 교대 방식 (1일 2교대 시스템)
- 오전(AM) 기사: 새벽 4~5시 ~ 낮 12~14시 (약 8~10시간)
- 오후(PM) 기사: 낮 12~14시 ~ 밤 22~24시 (약 8~10시간)
- 한 차량에 AM/PM 기사 각 1명씩 배정
- 교대 시 차량을 인수인계하며 운행 지속

【4】 기사 유형과 역할
- 메인(정규) 기사: 특정 노선, 특정 차량에 고정 배치
- 예비(스페어) 기사: 메인 기사 결원/휴무 시 대체
  * 예비기사 오프셋 = 메인기사들의 휴무일에 근무하도록 설정
  * 예비기사 수 = 최소 (차량대수 × 2/7) 이상 필요

【5】 노선별 배차 균형
- 노선별로 독립적인 배차 그룹 구성
- 노선 내 기사들의 휴무일이 균등하게 분산되어야 함
- 동일 노선 기사들이 같은 날 모두 쉬는 것은 불가

【6】 준법 기준 (한국 근로기준법 + 버스 특례)
- 주 52시간 상한 (1일 8시간 기준)
- 버스기사 특례: 연속 운행 4시간 초과 금지, 중간 휴식 30분 의무
- 월간 휴무일 수 = 총일수 × (휴무일수/사이클일수)

【7】 배차표 작성 순서 (큐버스 ERP 방식)
1. 차량대수 입력 → 필요 기사수 자동 계산
2. 기사 명단 입력 (메인/예비 구분)
3. 사이클 시작일 및 오프셋 설정
4. 자동으로 월별 근무/휴무 배치
5. 예외사항(휴가, 병가) 수동 조정
6. 노선별 일일 커버리지 검증

══════════════════════════════════════════════
🎯 당신의 역할
══════════════════════════════════════════════
1. 관리자가 입력하는 회사 규칙과 지자체 규정을 이해하고 구조화합니다
2. 위 배차 원리를 바탕으로 최적 배차 방안을 제안합니다
3. 인력 부족/과잉 진단, 교대 방식 추천, 예비기사 수 계산을 돕습니다
4. 배차 관련 질문에 구체적인 수치와 근거를 들어 한국어로 답변합니다

응답 형식:
- 규칙 파악 시: 핵심 규칙을 구조화하여 보여주세요
- 질문 응답 시: 명확하고 간결하게 답변하세요
- 배차 제안 시: 차량대수 기준 공식과 함께 구체적 수치를 제시하세요`;

export async function chatWithAI(
  sessionId: number,
  userMessage: string,
  includeRules = true
): Promise<{ reply: string; structuredRules?: Record<string, unknown> }> {
  // Load conversation history
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 20, // last 20 messages for context
      },
    },
  });

  if (!session) throw new Error('채팅 세션을 찾을 수 없습니다.');

  // Load active company rules as context (자사 규칙만)
  let rulesContext = '';
  if (includeRules) {
    const rules = await prisma.companyRule.findMany({
      where: { isActive: true, companyId: session.companyId },
      select: { title: true, content: true, category: true },
    });

    if (rules.length > 0) {
      rulesContext = `\n\n현재 등록된 회사 규칙:\n${rules.map(r => `[${r.category}] ${r.title}: ${r.content}`).join('\n')}`;
    }
  }

  const messages: Anthropic.MessageParam[] = session.messages.map(msg => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  messages.push({ role: 'user', content: userMessage });

  // Save user message
  await prisma.chatMessage.create({
    data: { sessionId, role: 'user', content: userMessage },
  });

  const response = await anthropic.messages.create({
    model: AI_MODEL_CHAT,
    max_tokens: 2048,
    system: SYSTEM_PROMPT + rulesContext,
    messages,
  });

  const reply = response.content[0].type === 'text' ? response.content[0].text : '';

  // Save assistant message
  await prisma.chatMessage.create({
    data: { sessionId, role: 'assistant', content: reply },
  });

  // Update session title if first message
  if (session.messages.length === 0) {
    const title = userMessage.slice(0, 30) + (userMessage.length > 30 ? '...' : '');
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { title },
    });
  }

  // Try to extract structured rules if the message looks like a rule input
  let structuredRules: Record<string, unknown> | undefined;
  if (userMessage.includes('규칙') || userMessage.includes('규정') || userMessage.includes('정책')) {
    try {
      const extractionResponse = await anthropic.messages.create({
        model: AI_MODEL_FAST,
        max_tokens: 1024,
        system: '다음 텍스트에서 버스 배차 관련 규칙을 JSON 형태로 추출하세요. workDays(근무일수), restDays(휴무일수), shifts(근무형태), specialRules(특별규정) 등의 키를 포함하세요. JSON만 출력하세요.',
        messages: [{ role: 'user', content: userMessage }],
      });

      const extractedText = extractionResponse.content[0].type === 'text'
        ? extractionResponse.content[0].text.trim()
        : '{}';

      const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        structuredRules = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Ignore extraction errors
    }
  }

  return { reply, structuredRules };
}

export async function generateScheduleWithAI(
  companyId: number,
  year: number,
  month: number,
  adminNotes: string
): Promise<{ recommendations: string; parameters: Record<string, unknown> }> {
  const drivers = await prisma.user.findMany({
    where: { companyId, role: 'DRIVER', isActive: true },
    select: {
      id: true,
      name: true,
      driverType: true,
      routeAssignments: { where: { isActive: true }, include: { route: true } },
    },
  });

  const routes = await prisma.route.findMany({ where: { companyId, isActive: true } });
  const rules = await prisma.companyRule.findMany({ where: { companyId, isActive: true } });

  const context = `
배차 생성 요청: ${year}년 ${month}월

현재 기사 현황 (총 ${drivers.length}명):
${drivers.map(d => `- ${d.name} (${d.driverType || '미분류'}): ${d.routeAssignments.map((a: any) => a.route.routeNumber).join(', ') || '노선 미배정'}`).join('\n')}

운행 노선 (총 ${routes.length}개):
${routes.map(r => `- ${r.routeNumber}: ${r.name}`).join('\n')}

회사 규칙:
${rules.map(r => `- ${r.title}: ${r.content}`).join('\n')}

관리자 메모: ${adminNotes}
`;

  const response = await anthropic.messages.create({
    model: AI_MODEL_CHAT,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${context}\n\n위 정보를 바탕으로 ${year}년 ${month}월 최적 배차 방안을 추천해주세요. 특히 주의해야 할 점, 인력 부족 위험, 개선 제안을 포함해주세요.`,
    }],
  });

  const recommendations = response.content[0].type === 'text' ? response.content[0].text : '';

  // Extract parameters for auto-generation
  const paramResponse = await anthropic.messages.create({
    model: AI_MODEL_FAST,
    max_tokens: 512,
    system: '배차 생성 파라미터를 JSON으로만 출력하세요. { workDays: number, restDays: number } 형식.',
    messages: [{
      role: 'user',
      content: `규칙: ${rules.map(r => r.content).join(' ')}`,
    }],
  });

  let parameters: Record<string, unknown> = { workDays: 5, restDays: 2 };
  try {
    const paramText = paramResponse.content[0].type === 'text' ? paramResponse.content[0].text.trim() : '{}';
    const jsonMatch = paramText.match(/\{[\s\S]*\}/);
    if (jsonMatch) parameters = JSON.parse(jsonMatch[0]);
  } catch {
    // Use defaults
  }

  return { recommendations, parameters };
}
