// 서버가 켜질 때 DB 스키마와 원본 자료 적재를 미리 시작해요 (첫 화면이 느려지지 않게).
// /healthz 는 이 작업을 기다리지 않아서 배포 확인(60초)에 영향이 없어요.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { isDbConfigured, ensureSchema } = await import('@/lib/db')
  if (isDbConfigured()) void ensureSchema().catch((e) => console.error('[시작 시 DB 준비 실패]', e))
}
