'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useCallback, useState } from 'react'

export const BackfillButton: React.FC = () => {
  const { config } = useConfig()
  const [pending, setPending] = useState(false)

  const apiRoute = config.routes?.api || '/api'
  const baseURL = config.serverURL || ''

  const onClick = useCallback(async () => {
    if (pending) {
      return
    }
    setPending(true)
    try {
      const res = await fetch(`${baseURL}${apiRoute}/video-pipeline/backfill`, {
        credentials: 'include',
        method: 'POST',
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; jobIds?: string[] }
      if (!res.ok) {
        throw new Error(body.error ?? `Backfill failed (${res.status})`)
      }
      const count = body.jobIds?.length ?? 0
      toast.success(
        `Backfill queued for ${count} collection${count === 1 ? '' : 's'} — only stale sizes will regenerate.`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Backfill failed')
    } finally {
      setPending(false)
    }
  }, [apiRoute, baseURL, pending])

  return (
    <Button disabled={pending} onClick={onClick} size="small" type="button">
      {pending ? 'Queuing backfill…' : 'Backfill all video collections'}
    </Button>
  )
}
