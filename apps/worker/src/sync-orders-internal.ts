import type pg from 'pg'
import {
  type InternalOrder,
  type OrderHistoryEntry,
  applyStatus,
  type StageState,
  toE164Mx,
  DEFAULT_FINAL_STAGES,
} from '@dropi-ordenes/core'

interface OrderSource {
  listAllOrders(params: { from: string; until: string; status?: string }): Promise<InternalOrder[]>
  getOrderHistory(orderId: number): Promise<OrderHistoryEntry[]>
}

interface SyncResult {
  ordersRead: number
  newOrders: number
  changes: number
  movementsBackfilled: number
  errors: Array<{ orderId: number; error: string }>
}

interface SyncLogger {
  info(m: string): void
  error(m: string, d?: unknown): void
}

export async function syncOrdersInternal(
  client: OrderSource,
  db: pg.Pool,
  tenantId: string,
  logger: SyncLogger,
): Promise<SyncResult> {
  const result: SyncResult = { ordersRead: 0, newOrders: 0, changes: 0, movementsBackfilled: 0, errors: [] }

  const now = new Date()
  const from = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  logger.info(`Polling orders from ${fmt(from)} to ${fmt(now)}`)

  let orders: InternalOrder[]
  try {
    orders = await client.listAllOrders({ from: fmt(from), until: fmt(now) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Failed to fetch orders', { error: msg })
    result.errors.push({ orderId: 0, error: msg })
    return result
  }

  result.ordersRead = orders.length
  logger.info(`Fetched ${orders.length} orders`)

  for (const order of orders) {
    try {
      await processOrder(order, client, db, tenantId, result, logger)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Error processing order ${order.id}`, { error: msg })
      result.errors.push({ orderId: order.id, error: msg })
    }
  }

  return result
}

function customerName(o: InternalOrder): string | null {
  const parts = [o.name, o.surname].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

function buildItems(o: InternalOrder): unknown[] | null {
  if (!o.orderdetails?.length) return null
  return o.orderdetails.map((d) => ({
    product_id: d.product_id,
    product_name: d.product?.name ?? null,
    variation_id: d.variation_id,
  }))
}

async function processOrder(
  order: InternalOrder,
  client: OrderSource,
  db: pg.Pool,
  tenantId: string,
  result: SyncResult,
  logger: SyncLogger,
): Promise<void> {
  const { rows: existing } = await db.query(
    `SELECT status_raw, stage, max_rank, is_final FROM orders WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, order.id],
  )

  if (existing.length === 0) {
    await insertNewOrder(order, client, db, tenantId, result, logger)
    return
  }

  const row = existing[0]!

  // Always update address, items, notes even if status unchanged
  await db.query(
    `UPDATE orders SET
      last_checked_at = now(),
      address = COALESCE($3, address),
      items = COALESCE($4, items),
      notes = COALESCE($5, notes),
      tracking_code = COALESCE($6, tracking_code)
    WHERE tenant_id = $1 AND order_id = $2`,
    [
      tenantId,
      order.id,
      order.dir,
      buildItems(order) ? JSON.stringify(buildItems(order)) : null,
      order.notes,
      order.shipping_guide,
    ],
  )

  try {
    const history = await client.getOrderHistory(order.id)
    if (history.length > 0) {
      const backfilled = await backfillOrderHistory(order.id, history, db, tenantId)
      result.movementsBackfilled += backfilled
    }
  } catch {
    // Order detail history is best-effort
  }

  if (row.status_raw === order.status) return

  await handleStatusChange(order, row, db, tenantId, result)
}

async function insertNewOrder(
  order: InternalOrder,
  client: OrderSource,
  db: pg.Pool,
  tenantId: string,
  result: SyncResult,
  logger: SyncLogger,
): Promise<void> {
  const carrier = order.shipping_company ?? ''
  const update = applyStatus(null, carrier, order.status)
  const phone = order.phone ? toE164Mx(order.phone) : null

  await db.query(
    `INSERT INTO orders (
      tenant_id, order_id, status_raw, stage, max_rank,
      customer_name, phone_e164, address, city, total, currency,
      payment_method, rate_type, shipping_company, tracking_code,
      items, notes, dropi_created_at, first_seen_at, last_checked_at, is_final
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'MXN','',$11,$12,$13,$14,$15,$16,now(),now(),$17)`,
    [
      tenantId,
      order.id,
      order.status,
      update.state.stage,
      update.state.maxRank,
      customerName(order),
      phone,
      order.dir,
      order.city,
      order.total_order,
      order.rate_type,
      order.shipping_company,
      order.shipping_guide,
      buildItems(order) ? JSON.stringify(buildItems(order)) : null,
      order.notes,
      order.created_at,
      DEFAULT_FINAL_STAGES.has(update.state.stage),
    ],
  )

  // Insert first_seen history entry
  await db.query(
    `INSERT INTO order_status_history (tenant_id, order_id, prev_status, new_status, prev_stage, new_stage, detected_at, source)
    VALUES ($1, $2, NULL, $3, NULL, $4, now(), 'first_seen')`,
    [tenantId, order.id, order.status, update.state.stage],
  )

  // Backfill movement history — prefer guide history (more detailed) over servientrega_movements
  try {
    const history = await client.getOrderHistory(order.id)
    if (history.length > 0) {
      const backfilled = await backfillOrderHistory(order.id, history, db, tenantId)
      result.movementsBackfilled += backfilled
      logger.info(`Order ${order.id}: backfilled ${backfilled} status history entries`)
    }
  } catch {
    // Order detail history is best-effort
  }

  result.newOrders++
}

async function handleStatusChange(
  order: InternalOrder,
  existing: { status_raw: string; stage: string; max_rank: number },
  db: pg.Pool,
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

  await db.query(
    `UPDATE orders SET
      status_raw = $3, stage = $4, max_rank = $5, last_checked_at = now(),
      is_final = $6, tracking_code = COALESCE($7, tracking_code)
    WHERE tenant_id = $1 AND order_id = $2`,
    [
      tenantId,
      order.id,
      order.status,
      update.state.stage,
      update.state.maxRank,
      DEFAULT_FINAL_STAGES.has(update.state.stage),
      order.shipping_guide,
    ],
  )

  await db.query(
    `INSERT INTO order_status_history (
      tenant_id, order_id, prev_status, new_status, prev_stage, new_stage,
      detected_at, source
    ) VALUES ($1,$2,$3,$4,$5,$6,now(),'poll')`,
    [tenantId, order.id, existing.status_raw, order.status, existing.stage, update.state.stage],
  )

  result.changes++
}

async function backfillOrderHistory(
  orderId: number,
  history: OrderHistoryEntry[],
  db: pg.Pool,
  tenantId: string,
): Promise<number> {
  let count = 0

  const sorted = [...history].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!
    const prev = i > 0 ? sorted[i - 1]! : null

    const { rows: existing } = await db.query(
      `SELECT id FROM order_status_history
       WHERE tenant_id = $1 AND order_id = $2 AND dropi_movement_id = $3`,
      [tenantId, orderId, entry.id],
    )
    if (existing.length > 0) continue

    await db.query(
      `INSERT INTO order_status_history (
        tenant_id, order_id, prev_status, new_status, prev_stage, new_stage,
        detected_at, dropi_timestamp, dropi_movement_id, source
      ) VALUES ($1,$2,$3,$4,NULL,NULL,$5,$5,$6,'dropi_status')`,
      [tenantId, orderId, prev?.status ?? null, entry.status, entry.created_at, entry.id],
    )
    count++
  }

  return count
}
