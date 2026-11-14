// 서버가 켜질 때 DB 스키마와 원본 자료 적재를 미리 시작해요 (첫 화면이 느려지지 않게).
// /healthz 는 이 작업을 기다리지 않아서 배포 확인(60초)에 영향이 없어요.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { isDbConfigured, ensureSchema } = await import('@/lib/db')
  if (!isDbConfigured()) return
  void (async () => {
    await ensureSchema()
    // 운영(배포)에서만: 안건이 하나도 없으면 원본 자료 기반 안건을 한 번 넣는다. 로컬·시험 DB 는 건드리지 않는다.
    if (process.env.NODE_ENV === 'production') {
      const { seedOriginalIfEmpty } = await import('@/lib/app/seed-original')
      await seedOriginalIfEmpty()
    }
  })().catch((e) => console.error('[시작 시 DB 준비 실패]', e))
}
