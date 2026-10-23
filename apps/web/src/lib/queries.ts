import { pool } from './db'
import type { Order, StatusHistoryEntry, PollRun } from './types'

const TENANT = process.env.TENANT_ID!

export async function getOrders(filters?: {
  stage?: string
  search?: string
}): Promise<Order[]> {
  let query = `SELECT * FROM orders WHERE tenant_id = $1`
  const params: unknown[] = [TENANT]
  let idx = 2

  if (filters?.stage) {
    query += ` AND stage = $${idx}`
    params.push(filters.stage)
    idx++
  }

  if (filters?.search) {
    query += ` AND (
      order_id::text ILIKE $${idx}
      OR customer_name ILIKE $${idx}
      OR phone_e164 ILIKE $${idx}
      OR city ILIKE $${idx}
    )`
    params.push(`%${filters.search}%`)
    idx++
  }

  query += ` ORDER BY dropi_created_at DESC NULLS LAST`

  const { rows } = await pool.query<Order>(query, params)
  return rows
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const { rows } = await pool.query<Order>(
    `SELECT * FROM orders WHERE tenant_id = $1 AND order_id = $2`,
    [TENANT, orderId],
  )
  return rows[0] ?? null
}

export async function getOrderHistory(orderId: string): Promise<StatusHistoryEntry[]> {
  const { rows } = await pool.query<StatusHistoryEntry>(
    `SELECT * FROM order_status_history
     WHERE tenant_id = $1 AND order_id = $2
     ORDER BY COALESCE(dropi_timestamp, detected_at) ASC`,
    [TENANT, orderId],
  )
  return rows
}

export async function getMetrics(): Promise<{
  total: number
  enTransito: number
  entregados: number
  cancelados: number
}> {
  const { rows } = await pool.query<{ stage: string; count: string }>(
    `SELECT stage, count(*)::int as count FROM orders WHERE tenant_id = $1 GROUP BY stage`,
    [TENANT],
  )

  let total = 0
  let enTransito = 0
  let entregados = 0
  let cancelados = 0

  for (const r of rows) {
    const c = Number(r.count)
    total += c
    if (['EN_TRANSITO', 'EN_CIUDAD_DESTINO', 'EN_REPARTO', 'RECOLECTADO'].includes(r.stage)) enTransito += c
    if (r.stage === 'ENTREGADO') entregados += c
    if (r.stage === 'CANCELADO') cancelados += c
  }

  return { total, enTransito, entregados, cancelados }
}

export async function getLastPollRun(): Promise<PollRun | null> {
  const { rows } = await pool.query<PollRun>(
    `SELECT * FROM poll_runs WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [TENANT],
  )
  return rows[0] ?? null
}
