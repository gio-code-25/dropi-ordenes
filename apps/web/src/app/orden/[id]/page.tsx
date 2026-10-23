import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getOrder, getOrderHistory } from '@/lib/queries'
import { STAGE_LABELS, STAGE_COLORS } from '@/lib/types'

export const dynamic = 'force-dynamic'

function StageBadge({ stage }: { stage: string }) {
  const colors = STAGE_COLORS[stage] ?? 'bg-gray-100 text-gray-600'
  const label = STAGE_LABELS[stage] ?? stage
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors}`}>
      {label}
    </span>
  )
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between py-2 border-b border-[var(--border)] last:border-0">
      <span className="text-[var(--muted)] text-sm">{label}</span>
      <span className="text-sm font-medium text-right max-w-[60%]">{value ?? '—'}</span>
    </div>
  )
}

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [order, history] = await Promise.all([getOrder(id), getOrderHistory(id)])

  if (!order) notFound()

  const items = Array.isArray(order.items) ? order.items : []

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-[var(--muted)] hover:text-[var(--foreground)] text-sm">
          &larr; Volver
        </Link>
        <h1 className="text-xl font-bold">Orden #{order.order_id}</h1>
        <StageBadge stage={order.stage} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Order info */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="text-sm font-semibold mb-3 text-[var(--muted)] uppercase tracking-wide">
            Datos del pedido
          </h2>
          <InfoRow label="Estatus Dropi" value={order.status_raw} />
          <InfoRow label="Cliente" value={order.customer_name} />
          <InfoRow label="Teléfono" value={order.phone_e164} />
          <InfoRow label="Ciudad" value={order.city} />
          <InfoRow label="Dirección" value={order.address} />
          <InfoRow label="Total" value={order.total ? `$${Number(order.total).toLocaleString('es-MX')} MXN` : null} />
          <InfoRow label="Transportadora" value={order.shipping_company} />
          <InfoRow label="Tracking" value={order.tracking_code} />
          <InfoRow label="Creado en Dropi" value={formatDate(order.dropi_created_at)} />
          <InfoRow label="Último check" value={formatDate(order.last_checked_at)} />
        </div>

        {/* Notes + Products */}
        <div className="space-y-6">
          {order.notes && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
              <h2 className="text-sm font-semibold mb-3 text-[var(--muted)] uppercase tracking-wide">
                Notas
              </h2>
              <p className="text-sm whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}

          {items.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
              <h2 className="text-sm font-semibold mb-3 text-[var(--muted)] uppercase tracking-wide">
                Productos
              </h2>
              <ul className="space-y-2">
                {items.map((raw: unknown, i: number) => {
                  const item = raw as Record<string, unknown>
                  return (
                  <li key={i} className="flex justify-between text-sm">
                    <span>{String(item.product_name ?? `Producto ${item.product_id}`)}</span>
                    {item.unit_price != null && (
                      <span className="text-[var(--muted)]">
                        ${Number(item.unit_price).toLocaleString('es-MX')}
                      </span>
                    )}
                  </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-semibold mb-4 text-[var(--muted)] uppercase tracking-wide">
          Timeline
        </h2>

        {history.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Sin historial de movimientos</p>
        ) : (
          <div className="relative pl-6">
            <div className="absolute left-2 top-1 bottom-1 w-0.5 bg-[var(--border)]" />
            {history.map((h, i) => (
              <div key={h.id ?? i} className="relative pb-6 last:pb-0">
                <div className={`absolute -left-4 top-1 h-3 w-3 rounded-full border-2 ${
                  i === history.length - 1
                    ? 'border-cyan-500 bg-cyan-500'
                    : 'border-[var(--border)] bg-[var(--card)]'
                }`} />
                <div>
                  <p className="text-sm font-medium">{h.new_status ?? '—'}</p>
                  {h.prev_status && (
                    <p className="text-xs text-[var(--muted)]">Antes: {h.prev_status}</p>
                  )}
                  <div className="flex gap-3 mt-1">
                    <span className="text-xs text-[var(--muted)]">
                      {formatDate(h.dropi_timestamp ?? h.detected_at)}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      h.source === 'dropi_movement'
                        ? 'bg-purple-100 text-purple-700'
                        : h.source === 'poll'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}>
                      {h.source === 'dropi_movement' ? 'Movimiento' : h.source === 'poll' ? 'Poll' : 'Primera vez'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
