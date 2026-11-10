// 시험·도구 스크립트용 로더: 앱 코드를 Next 없이 node 로 그대로 불러 쓰게 해 준다.
//   node --import ./scripts/_register.mjs scripts/test-w02.mjs
// - '@/…' 별칭과 확장자 없는 상대 import 를 .ts/.tsx 파일로 풀어 준다 (tsconfig 의 paths 와 같은 규칙)
// - .env.local 의 값을 process.env 로 읽어 온다 (이미 있는 값은 덮어쓰지 않음)
import { registerHooks } from 'node:module'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const envFile = resolve(root, '.env.local')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim()
  }
}

const isFile = (p) => existsSync(p) && statSync(p).isFile()
function withExt(base) {
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (isFile(c)) return c
  return null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null
    if (specifier.startsWith('@/')) base = resolve(root, specifier.slice(2))
    else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:') && !context.parentURL.includes('/node_modules/')) {
      base = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    }
    if (base) {
      const hit = withExt(base)
      if (hit) return nextResolve(pathToFileURL(hit).href, context)
    }
    // next/headers 같은 Next 내부 경로는 확장자를 붙여야 node 가 찾는다 (시험에서 import 만 되면 충분하다)
    if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context)
    return nextResolve(specifier, context)
  },
})
