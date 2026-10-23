import Link from 'next/link'
import { getOrders, getMetrics, getLastPollRun } from '@/lib/queries'
import { STAGE_LABELS, STAGE_COLORS } from '@/lib/types'
import { TimeAgo } from '@/components/time-ago'
import { SyncButton } from '@/components/sync-button'

export const dynamic = 'force-dynamic'

function MetricCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  )
}

function StageBadge({ stage }: { stage: string }) {
  const colors = STAGE_COLORS[stage] ?? 'bg-gray-100 text-gray-600'
  const label = STAGE_LABELS[stage] ?? stage
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors}`}>
      {label}
    </span>
  )
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string }>
}) {
  const params = await searchParams
  const [orders, metrics, lastPoll] = await Promise.all([
    getOrders({ stage: params.stage, search: params.q }),
    getMetrics(),
    getLastPollRun(),
  ])

  const stages = Object.keys(STAGE_LABELS)

  return (
    <div className="space-y-6">
      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Total" value={metrics.total} accent="text-[var(--foreground)]" />
        <MetricCard label="En tránsito" value={metrics.enTransito} accent="text-cyan-600" />
        <MetricCard label="Entregados" value={metrics.entregados} accent="text-green-600" />
        <MetricCard label="Cancelados" value={metrics.cancelados} accent="text-gray-500" />
      </div>

      {/* Sync button + last poll info */}
      <div className="flex flex-wrap items-center gap-4">
        <SyncButton />
        {lastPoll && (
          <p className="text-xs text-[var(--muted)]">
            Último sync: {lastPoll.finished_at ? <TimeAgo date={lastPoll.finished_at} /> : 'en curso'} — {lastPoll.orders_read ?? 0} órdenes leídas, {lastPoll.changes ?? 0} cambios
          </p>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <a
          href="/"
          className={`rounded-full px-3 py-1 text-sm border ${
            !params.stage ? 'bg-[var(--foreground)] text-[var(--background)]' : 'border-[var(--border)]'
          }`}
        >
          Todas
        </a>
        {stages.map((s) => (
          <a
            key={s}
            href={`/?stage=${s}${params.q ? `&q=${params.q}` : ''}`}
            className={`rounded-full px-3 py-1 text-sm border ${
              params.stage === s ? 'bg-[var(--foreground)] text-[var(--background)]' : 'border-[var(--border)]'
            }`}
          >
            {STAGE_LABELS[s]}
          </a>
        ))}
      </div>

      {/* Search */}
      <form className="flex gap-2">
        {params.stage && <input type="hidden" name="stage" value={params.stage} />}
        <input
          type="text"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Buscar por orden, nombre, teléfono o ciudad..."
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm text-[var(--background)]"
        >
          Buscar
        </button>
      </form>

      {/* Orders table */}
      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
              <th className="px-4 py-3">#Orden</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3 hidden sm:table-cell">Ciudad</th>
              <th className="px-4 py-3">Etapa</th>
              <th className="px-4 py-3 hidden md:table-cell">Transportadora</th>
              <th className="px-4 py-3 hidden sm:table-cell">Total</th>
              <th className="px-4 py-3 hidden lg:table-cell">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--muted)]">
                  No se encontraron órdenes
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr key={o.order_id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--background)] transition-colors">
                <td className="px-4 py-3 font-mono">
                  <Link href={`/orden/${o.order_id}`} className="text-cyan-600 hover:underline">
                    {o.order_id}
                  </Link>
                </td>
                <td className="px-4 py-3">{o.customer_name ?? '—'}</td>
                <td className="px-4 py-3 hidden sm:table-cell">{o.city ?? '—'}</td>
                <td className="px-4 py-3">
                  <StageBadge stage={o.stage} />
                </td>
                <td className="px-4 py-3 hidden md:table-cell">{o.shipping_company ?? '—'}</td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  {o.total ? `$${Number(o.total).toLocaleString('es-MX')}` : '—'}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-[var(--muted)]">
                  {o.dropi_created_at
                    ? new Date(o.dropi_created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
