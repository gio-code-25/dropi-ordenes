import { getDb } from './db.js'
import { BrowserApiProxy } from './browser-api-proxy.js'
import { syncOrdersInternal } from './sync-orders-internal.js'
import { loadEnv } from './env.js'

loadEnv()

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_HOURS ?? 8) * 60 * 60 * 1000
const DROPI_USER_ID = Number(process.env.DROPI_USER_ID ?? 40243)

const logger = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: 'info', msg, ...data, ts: new Date().toISOString() })),
  warn: (msg: string, data?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ level: 'warn', msg, ...data, ts: new Date().toISOString() })),
  error: (msg: string, data?: Record<string, unknown>) =>
    console.error(JSON.stringify({ level: 'error', msg, ...data, ts: new Date().toISOString() })),
}

const proxy = new BrowserApiProxy(
  {
    email: process.env.DROPI_EMAIL!,
    password: process.env.DROPI_PASSWORD!,
    totpSecret: process.env.DROPI_TOTP_SECRET!,
  },
  { userId: DROPI_USER_ID, headless: true },
  { info: (m) => logger.info(m), error: (m, d) => logger.error(m, { detail: d }) },
)

async function runPollCycle(tenantId: string): Promise<void> {
  const db = getDb()

  const {
    rows: [run],
  } = await db.query(`INSERT INTO poll_runs (tenant_id) VALUES ($1) RETURNING id`, [tenantId])

  const startTime = Date.now()
  logger.info('Poll cycle started', { tenantId, runId: run.id })

  let result
  try {
    const syncLog = { info: (m: string) => logger.info(m), error: (m: string) => logger.error(m) }
    result = await syncOrdersInternal(proxy, db, tenantId, syncLog)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Poll cycle failed', { tenantId, error: msg })
    await db.query(`UPDATE poll_runs SET finished_at = now(), errors = $2 WHERE id = $1`, [
      run.id,
      JSON.stringify([{ error: msg }]),
    ])
    return
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  await db.query(
    `UPDATE poll_runs SET finished_at = now(), orders_read = $2, changes = $3, errors = $4 WHERE id = $1`,
    [run.id, result.ordersRead, result.changes, result.errors.length > 0 ? JSON.stringify(result.errors) : null],
  )

  logger.info('Poll cycle finished', {
    tenantId,
    runId: run.id,
    ordersRead: result.ordersRead,
    newOrders: result.newOrders,
    changes: result.changes,
    movementsBackfilled: result.movementsBackfilled,
    errors: result.errors.length,
    elapsedSec: elapsed,
  })
}

async function getAllTenants(): Promise<string[]> {
  const db = getDb()
  const { rows } = await db.query(
    `SELECT t.id FROM tenants t
    JOIN dropi_connections dc ON dc.tenant_id = t.id
    WHERE dc.status = 'ok'`,
  )
  return rows.map((r) => r.id)
}

async function pollAll(): Promise<void> {
  const tenants = await getAllTenants()
  if (tenants.length === 0) {
    logger.warn('No tenants with active Dropi connections')
    return
  }

  for (const tenantId of tenants) {
    await runPollCycle(tenantId)
  }

  await proxy.close()
}

async function main(): Promise<void> {
  logger.info('Worker started', { intervalHours: POLL_INTERVAL_MS / 3600000, userId: DROPI_USER_ID })

  await pollAll()

  setInterval(async () => {
    try {
      await pollAll()
    } catch (err) {
      logger.error('Unhandled error in poll cycle', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, POLL_INTERVAL_MS)
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...')
  await proxy.close()
  process.exit(0)
})

main().catch(async (err) => {
  logger.error('Worker crashed', { error: err instanceof Error ? err.message : String(err) })
  await proxy.close()
  process.exit(1)
})
