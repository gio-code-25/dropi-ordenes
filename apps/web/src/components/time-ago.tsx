'use client'

import { useEffect, useState } from 'react'

function format(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `hace ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs}h`
  const days = Math.floor(hrs / 24)
  return `hace ${days}d`
}

export function TimeAgo({ date }: { date: string }) {
  const [text, setText] = useState('')

  useEffect(() => {
    setText(format(date))
    const id = setInterval(() => setText(format(date)), 60000)
    return () => clearInterval(id)
  }, [date])

  return <span suppressHydrationWarning>{text}</span>
}
