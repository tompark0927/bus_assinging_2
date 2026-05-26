/**
 * 노선 표시 라벨.
 *
 * route.name 이 노선 번호와 동일하거나 "<번호>번" 형태로 중복 저장된 경우
 * "3-2번 · 3-2번" 처럼 같은 값이 두 번 보이는 문제가 있다.
 * name 이 번호와 의미상 중복이면 "<번호>번" 만, 아니면 "<번호>번 · <이름>" 을 반환한다.
 */
export function routeLabel(routeNumber: string, name?: string | null): string {
  const num = (routeNumber ?? '').trim();
  const nm = (name ?? '').trim();
  const base = `${num}번`;

  if (!nm || nm === num || nm === base) return base;
  return `${base} · ${nm}`;
}
