import type pg from 'pg'
import {
  type DropiClient,
  type DropiOrder,
  applyStatus,
  type StageState,
  toE164Mx,
  DEFAULT_FINAL_STAGES,
} from '@dropi-ordenes/core'

interface SyncResult {
  ordersRead: number
  newOrders: number
  changes: number
  errors: Array<{ orderId: number; error: string }>
}

interface SyncLogger {
  info(m: string): void
  error(m: string, d?: unknown): void
}

export async function syncOrders(
  client: DropiClient,
  db: pg.Pool,
  tenantId: string,
  logger: SyncLogger,
): Promise<SyncResult> {
  const result: SyncResult = { ordersRead: 0, newOrders: 0, changes: 0, errors: [] }

  const now = new Date()
  const from = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000)
  const formatDate = (d: Date) => d.toISOString().slice(0, 10)

  logger.info(`Polling orders from ${formatDate(from)} to ${formatDate(now)}`)

  let orders: DropiOrder[]
  try {
    orders = await client.listAllOrders({
      from: formatDate(from),
      until: formatDate(now),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Failed to fetch orders from MCP', { error: msg })
    result.errors.push({ orderId: 0, error: msg })
    return result
  }

  result.ordersRead = orders.length
  logger.info(`Fetched ${orders.length} orders from MCP`)

  for (const order of orders) {
    try {
      await processOrder(order, db, client, tenantId, result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Error processing order ${order.order_id}`, { error: msg })
      result.errors.push({ orderId: order.order_id, error: msg })
    }
  }

  return result
}

async function processOrder(
  order: DropiOrder,
  db: pg.Pool,
  client: DropiClient,
  tenantId: string,
  result: SyncResult,
): Promise<void> {
  const { rows: existing } = await db.query(
    `SELECT status_raw, stage, max_rank, is_final FROM orders WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, order.order_id],
  )

  if (existing.length === 0) {
    await insertNewOrder(order, db, tenantId, result)
    return
  }

  const row = existing[0]
  if (row.status_raw === order.status) {
    await db.query(
      `UPDATE orders SET last_checked_at = now() WHERE tenant_id = $1 AND order_id = $2`,
      [tenantId, order.order_id],
    )
    return
  }

  await handleStatusChange(order, row, db, client, tenantId, result)
}

async function insertNewOrder(
  order: DropiOrder,
  db: pg.Pool,
  tenantId: string,
  result: SyncResult,
): Promise<void> {
  const prev = null
  const carrier = order.shipping_company ?? ''
  const update = applyStatus(prev, carrier, order.status)

  const phone = order.customer_phone ? toE164Mx(order.customer_phone) : null

  await db.query(
    `INSERT INTO orders (
      tenant_id, order_id, status_raw, stage, max_rank,
      customer_name, phone_e164, city, total, currency,
      payment_method, rate_type, shipping_company, tracking_code,
      dropi_created_at, first_seen_at, last_checked_at, is_final
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now(),$16)`,
    [
      tenantId,
      order.order_id,
      order.status,
      update.state.stage,
      update.state.maxRank,
      order.customer_name ?? null,
      phone,
      order.city ?? null,
      order.total ?? null,
      order.currency,
      order.payment_method ?? null,
      order.rate_type ?? null,
      order.shipping_company ?? null,
      order.tracking_code ?? null,
      order.created_at ?? null,
      DEFAULT_FINAL_STAGES.has(update.state.stage),
    ],
  )

  await db.query(
    `INSERT INTO order_status_history (tenant_id, order_id, prev_status, new_status, prev_stage, new_stage, detected_at, source)
    VALUES ($1, $2, NULL, $3, NULL, $4, now(), 'first_seen')`,
    [tenantId, order.order_id, order.status, update.state.stage],
  )

  result.newOrders++
}

async function handleStatusChange(
  order: DropiOrder,
  existing: { status_raw: string; stage: string; max_rank: number; is_final: boolean },
  db: pg.Pool,
  client: DropiClient,
  tenantId: string,
  result: SyncResult,
): Promise<void> {
  const prevState: StageState = {
    statusRaw: existing.status_raw,
    stage: existing.stage as StageState['stage'],
    maxRank: existing.max_rank,
  }

  const carrier = order.shipping_company ?? ''
  const update = applyStatus(prevState, carrier, order.status)

  let dropiUpdatedAt: string | null = null
  let address: string | null = null
  let items: unknown = null

  try {
    const detail = await client.getOrder(order.order_id)
    dropiUpdatedAt = detail.updated_at ?? null
    address = detail.address ?? null
    items = detail.items ?? null
  } catch {
    // get_order failed — continue with what we have
  }

  await db.query(
    `UPDATE orders SET
      status_raw = $3, stage = $4, max_rank = $5, last_checked_at = now(),
      is_final = $6,
      dropi_updated_at = COALESCE($7, dropi_updated_at),
      address = COALESCE($8, address),
      items = COALESCE($9, items),
      tracking_code = COALESCE($10, tracking_code)
    WHERE tenant_id = $1 AND order_id = $2`,
    [
      tenantId,
      order.order_id,
      order.status,
      update.state.stage,
      update.state.maxRank,
      DEFAULT_FINAL_STAGES.has(update.state.stage),
      dropiUpdatedAt,
      address,
      items ? JSON.stringify(items) : null,
      order.tracking_code ?? null,
    ],
  )

  await db.query(
    `INSERT INTO order_status_history (
      tenant_id, order_id, prev_status, new_status, prev_stage, new_stage,
      detected_at, dropi_updated_at, source
    ) VALUES ($1,$2,$3,$4,$5,$6,now(),$7,'poll')`,
    [
      tenantId,
      order.order_id,
      existing.status_raw,
      order.status,
      existing.stage,
      update.state.stage,
      dropiUpdatedAt,
    ],
  )

  result.changes++
}
