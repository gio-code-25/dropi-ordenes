import { spawn } from 'child_process'
import { NextResponse } from 'next/server'
import path from 'path'

export const dynamic = 'force-dynamic'

let running = false

export async function POST() {
  if (running) {
    return NextResponse.json({ error: 'Sync already in progress' }, { status: 409 })
  }

  running = true

  const workerDir = path.resolve(process.cwd(), '..', 'worker')
  const workerEntry = path.join(workerDir, 'src', 'index.ts')

  try {
    const result = await new Promise<{ ok: boolean; output: string }>((resolve) => {
      const chunks: string[] = []
      const child = spawn('npx', ['tsx', workerEntry, '--once'], {
        cwd: path.resolve(process.cwd(), '..', '..'),
        shell: true,
        timeout: 120_000,
        env: { ...process.env, NODE_ENV: 'production' },
      })

      child.stdout.on('data', (d: Buffer) => chunks.push(d.toString()))
      child.stderr.on('data', (d: Buffer) => chunks.push(d.toString()))

      child.on('close', (code) => {
        resolve({ ok: code === 0, output: chunks.join('') })
      })

      child.on('error', (err) => {
        resolve({ ok: false, output: err.message })
      })
    })

    const lines = result.output.trim().split('\n')
    let summary: Record<string, unknown> = {}
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.msg === 'Poll cycle finished') {
          summary = parsed
          break
        }
      } catch { /* skip non-JSON lines */ }
    }
    if (Object.keys(summary).length === 0) {
      try { summary = JSON.parse(lines.at(-1) ?? '{}') } catch { summary = { raw: lines.at(-1) } }
    }

    return NextResponse.json({ ok: result.ok, summary })
  } finally {
    running = false
  }
}
