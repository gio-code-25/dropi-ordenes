'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function SyncButton() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const router = useRouter()

  async function handleSync() {
    setLoading(true)
    setMessage('Sincronizando...')

    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const data = await res.json()

      if (res.status === 409) {
        setMessage('Ya hay un sync en curso')
        return
      }

      if (data.ok) {
        const s = data.summary
        setMessage(
          `Listo: ${s.ordersRead ?? 0} órdenes, ${s.newOrders ?? 0} nuevas, ${s.changes ?? 0} cambios`,
        )
        router.refresh()
      } else {
        setMessage('Error en el sync')
      }
    } catch {
      setMessage('Error de conexión')
    } finally {
      setLoading(false)
      setTimeout(() => setMessage(''), 8000)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleSync}
        disabled={loading}
        className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 text-base font-bold text-white shadow-lg shadow-cyan-500/40 hover:from-cyan-400 hover:to-blue-500 hover:shadow-xl hover:shadow-cyan-400/50 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all"
      >
        {loading ? 'Sincronizando...' : 'Sincronizar ahora'}
      </button>
      {message && !loading && (
        <span className="text-xs text-[var(--muted)]">{message}</span>
      )}
    </div>
  )
}
