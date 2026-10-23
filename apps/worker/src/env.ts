import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

export function loadEnv(): void {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const root = resolve(thisDir, '..', '..', '..')
  const envPath = resolve(root, '.env.local')
  let content: string
  try {
    content = readFileSync(envPath, 'utf8')
  } catch {
    return
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq)
    const val = trimmed.slice(eq + 1)
    if (!process.env[key]) process.env[key] = val
  }
}
