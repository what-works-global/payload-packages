'use client'

import { Button, toast, useConfig, useDocumentInfo } from '@payloadcms/ui'
import { useCallback, useState } from 'react'

interface JobStatusResponse {
  completedAt?: null | string
  hasError?: boolean
}

const pollIntervalMs = 2000

async function pollJob(jobUrl: string): Promise<JobStatusResponse> {
  while (true) {
    const res = await fetch(jobUrl, { credentials: 'include' })
    const job = (await res.json().catch(() => ({}))) as JobStatusResponse
    if (job.completedAt || job.hasError) {
      return job
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
}

export const RegenerateButton: React.FC = () => {
  const { config } = useConfig()
  const { id, collectionSlug } = useDocumentInfo()
  const [pending, setPending] = useState(false)

  const apiRoute = config.routes?.api || '/api'
  const baseURL = config.serverURL || ''

  const onClick = useCallback(async () => {
    if (!collectionSlug || !id || pending) {
      return
    }
    setPending(true)
    try {
      const res = await fetch(`${baseURL}${apiRoute}/${collectionSlug}/${id}/regenerate-video`, {
        credentials: 'include',
        method: 'POST',
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; jobId?: string }
      if (!res.ok || !body.jobId) {
        throw new Error(body.error ?? `Regenerate failed (${res.status})`)
      }

      const job = await pollJob(`${baseURL}${apiRoute}/payload-jobs/${body.jobId}`)
      if (job.hasError) {
        throw new Error('Video regeneration finished with an error — check the job log.')
      }
      toast.success('Video derivatives regenerated. Refresh to see the updated status.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Regenerate failed')
    } finally {
      setPending(false)
    }
  }, [apiRoute, baseURL, collectionSlug, id, pending])

  return (
    <Button disabled={pending} onClick={onClick} size="small" type="button">
      {pending ? 'Regenerating…' : 'Regenerate video derivatives'}
    </Button>
  )
}
