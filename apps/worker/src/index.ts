import { DropiClient, type OAuthConfig } from '@dropi-ordenes/core'
import { getDb } from './db.js'
import { DbTokenStore } from './db-token-store.js'
import { syncOrders } from './sync-orders.js'

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_HOURS ?? 8) * 60 * 60 * 1000

const config: OAuthConfig = {
  clientId: process.env.DROPI_OAUTH_CLIENT_ID!,
  redirectUri: process.env.DROPI_OAUTH_REDIRECT_URI ?? 'http://localhost:3000/callback',
  authorizeUrl: process.env.DROPI_OAUTH_AUTHORIZE_URL!,
  tokenUrl: process.env.DROPI_OAUTH_TOKEN_URL!,
  mcpUrl: process.env.DROPI_MCP_URL!,
}

const logger = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: 'info', msg, ...data, ts: new Date().toISOString() })),
  warn: (msg: string, data?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ level: 'warn', msg, ...data, ts: new Date().toISOString() })),
  error: (msg: string, data?: Record<string, unknown>) =>
    console.error(JSON.stringify({ level: 'error', msg, ...data, ts: new Date().toISOString() })),
}

async function runPollCycle(tenantId: string): Promise<void> {
  const db = getDb()
  const store = new DbTokenStore(db, tenantId)
  const client = new DropiClient(config, store, logger)

  const { rows: [run] } = await db.query(
    `INSERT INTO poll_runs (tenant_id) VALUES ($1) RETURNING id`,
    [tenantId],
  )

  const startTime = Date.now()
  logger.info('Poll cycle started', { tenantId, runId: run.id })

  let result
  try {
    const syncLog = { info: (m: string) => logger.info(m), error: (m: string) => logger.error(m) }
    result = await syncOrders(client, db, tenantId, syncLog)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Poll cycle failed', { tenantId, error: msg })
    await db.query(
      `UPDATE poll_runs SET finished_at = now(), errors = $2 WHERE id = $1`,
      [run.id, JSON.stringify([{ error: msg }])],
    )
    return
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  await db.query(
    `UPDATE poll_runs SET
      finished_at = now(),
      orders_read = $2,
      changes = $3,
      errors = $4
    WHERE id = $1`,
    [
      run.id,
      result.ordersRead,
      result.changes,
      result.errors.length > 0 ? JSON.stringify(result.errors) : null,
    ],
  )

  logger.info('Poll cycle finished', {
    tenantId,
    runId: run.id,
    ordersRead: result.ordersRead,
    newOrders: result.newOrders,
    changes: result.changes,
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
}

async function main(): Promise<void> {
  logger.info('Worker started', { intervalHours: POLL_INTERVAL_MS / 3600000 })

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

main().catch((err) => {
  logger.error('Worker crashed', { error: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})
