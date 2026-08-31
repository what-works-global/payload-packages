'use client'

import { Pill, useConfig, useDocumentInfo } from '@payloadcms/ui'
import React, { useCallback, useEffect, useState } from 'react'

import { formatBytes } from './formatBytes.js'
import { summariseSkipped } from './skipSummary.js'

/** Poll cadence while a conversion is queued; the panel stops once it settles. */
const POLL_MS = 2500

/**
 * Stop polling after this long. A conversion can legitimately stay `queued` for a
 * while — a chunked ladder waits on later runs, and a run killed mid-encode leaves
 * the row claimed until someone retries — and polling a stalled document forever
 * costs a request every 2.5s for as long as the tab is open.
 */
const POLL_CEILING_MS = 5 * 60 * 1000

interface Rendition {
  filesize: number
  preset: string
  /** Set when the job decided not to store this preset. */
  skippedReason: null | string
  url: null | string
}

interface PanelState {
  encodeDurationMs: null | number
  error: null | string
  mimeType: null | string
  originalFilesize: number
  renditions: Rendition[]
  skippedReason: null | string
  status: null | string
}

const STATUS_PILL: Record<string, { label: string; style: 'error' | 'success' | 'warning' }> = {
  complete: { label: 'Optimised', style: 'success' },
  failed: { label: 'Failed', style: 'error' },
  queued: { label: 'Optimising…', style: 'warning' },
  skipped: { label: 'Skipped', style: 'warning' },
}

const cellStyle: React.CSSProperties = {
  borderTop: '1px solid var(--theme-elevation-100)',
  padding: 'calc(var(--base) / 5) calc(var(--base) / 4)',
}

const actionStyle: React.CSSProperties = {
  background: 'var(--theme-elevation-100)',
  border: 'none',
  borderRadius: '3px',
  color: 'var(--theme-elevation-800)',
  cursor: 'pointer',
  display: 'inline-block',
  fontSize: '0.75rem',
  lineHeight: 1.4,
  padding: '1px 7px',
  textDecoration: 'none',
}

const noteStyle: React.CSSProperties = {
  color: 'var(--theme-elevation-500)',
  fontSize: '0.85rem',
  margin: 0,
}

/**
 * Live sidebar control panel for the conversion lifecycle: polls the document
 * while the background job runs (no refresh needed), then presents every preset as
 * a condensed table — size and savings for stored renditions, the reason for the
 * ones deliberately skipped, an Open action (file in a new tab), and a Regenerate
 * action that re-encodes with the current plugin config.
 */
export const VideoConversionPanel: React.FC<{
  /** Preset key → human label, supplied by the plugin from the resolved config. */
  presetLabels?: Record<string, string>
  regeneratePath?: string
}> = ({ presetLabels, regeneratePath }) => {
  const { id, collectionSlug } = useDocumentInfo()
  const { config } = useConfig()
  const [state, setState] = useState<null | PanelState>(null)
  const [busy, setBusy] = useState<null | string>(null)
  const [notice, setNotice] = useState<null | string>(null)
  const [refresh, setRefresh] = useState(0)

  const apiRoute = config.routes.api
  const serverURL = config.serverURL || ''

  useEffect(() => {
    if (!id || !collectionSlug) {
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()

    const load = async (): Promise<void> => {
      try {
        const response = await fetch(
          `${serverURL}${apiRoute}/${collectionSlug}/${id}?depth=1&draft=false`,
          { credentials: 'include' },
        )
        if (!response.ok || cancelled) {
          return
        }
        const doc = (await response.json()) as {
          filesize?: number
          mimeType?: string
          renditions?: { preset?: string; skippedReason?: string; video?: unknown }[] | null
          videoConversion?: null | Record<string, unknown>
        }
        if (cancelled) {
          return
        }

        const videoConversion = doc.videoConversion ?? {}
        const renditions: Rendition[] = []
        for (const row of doc.renditions ?? []) {
          const video = row?.video
          const populated =
            video && typeof video === 'object'
              ? (video as { filesize?: number; url?: string })
              : null
          renditions.push({
            filesize: Number(populated?.filesize ?? 0),
            preset: String(row?.preset ?? ''),
            skippedReason: typeof row?.skippedReason === 'string' ? row.skippedReason : null,
            url: typeof populated?.url === 'string' ? populated.url : null,
          })
        }

        const status = typeof videoConversion.status === 'string' ? videoConversion.status : null
        setState({
          encodeDurationMs:
            typeof videoConversion.encodeDurationMs === 'number'
              ? videoConversion.encodeDurationMs
              : null,
          error: typeof videoConversion.error === 'string' ? videoConversion.error : null,
          mimeType: typeof doc.mimeType === 'string' ? doc.mimeType : null,
          originalFilesize: Number(doc.filesize ?? 0),
          renditions,
          skippedReason:
            typeof videoConversion.skippedReason === 'string'
              ? videoConversion.skippedReason
              : null,
          status,
        })

        // Keep watching until the background job settles, or until it's clear it
        // isn't going to on its own — the header's regenerate action is the way out.
        if (status === 'queued' && Date.now() - startedAt < POLL_CEILING_MS) {
          timer = setTimeout(() => void load(), POLL_MS)
        }
      } catch {
        // transient fetch failure — leave the last known state on screen.
      }
    }

    void load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [id, collectionSlug, apiRoute, serverURL, refresh])

  const regenerate = useCallback(
    async (preset?: string) => {
      if (!id || !collectionSlug || !regeneratePath || busy) {
        return
      }
      setBusy(preset ?? 'all')
      setNotice(null)
      try {
        const response = await fetch(`${serverURL}${apiRoute}${regeneratePath}`, {
          body: JSON.stringify({ id, collection: collectionSlug, ...(preset ? { preset } : {}) }),
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        if (response.status === 409) {
          setNotice('A conversion is already running — try again in a moment.')
        } else if (!response.ok) {
          setNotice('Could not queue the conversion.')
        }
      } catch {
        setNotice('Could not reach the server.')
      } finally {
        setBusy(null)
        setRefresh((n) => n + 1) // restart the poll loop; server-side status is queued.
      }
    },
    [id, collectionSlug, regeneratePath, busy, serverURL, apiRoute],
  )

  // A convertible video with no record yet (a duplicated document, or one uploaded
  // before the plugin) still gets the panel, so it can be converted on demand.
  const convertible = Boolean(
    state?.mimeType?.startsWith('video/') && state.mimeType !== 'video/webm',
  )
  if (!id || !state || (!state.status && !convertible)) {
    return null
  }

  const pill = state.status
    ? (STATUS_PILL[state.status] ?? { label: state.status, style: 'warning' as const })
    : { label: 'Not converted', style: 'warning' as const }

  // Only renditions that exist earn a row: a table entry reading "larger than
  // source" looks like a failure when it is the size guard working as intended.
  const stored = state.renditions.filter((rendition) => rendition.url)
  // …but a configured preset vanishing without explanation is its own confusion, so
  // the skipped ones collapse into a single footnote. Redundant when nothing at all
  // was stored — the status message above already says why.
  const skippedNote =
    stored.length > 0
      ? summariseSkipped(
          state.renditions.filter((rendition) => !rendition.url),
          presetLabels,
        )
      : null

  return (
    <div className="field-type" style={{ marginBottom: 'var(--base)' }}>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: 'calc(var(--base) / 2)',
          marginBottom: 'calc(var(--base) / 4)',
        }}
      >
        <span style={{ fontWeight: 600 }}>WebM conversion</span>
        <Pill pillStyle={pill.style} size="small">
          {busy ? 'Optimising…' : pill.label}
        </Pill>
        {regeneratePath && (
          <button
            disabled={busy !== null}
            onClick={() => void regenerate()}
            style={{ ...actionStyle, marginLeft: 'auto' }}
            title={
              state.status === 'queued'
                ? 'Queue the conversion again — use this if a run was interrupted'
                : 'Re-encode every rendition with the current plugin config'
            }
            type="button"
          >
            {state.status ? '↺ all' : 'Convert'}
          </button>
        )}
      </div>

      {state.status === 'queued' && (
        <p style={noteStyle}>Optimising in the background — this panel updates automatically.</p>
      )}

      {state.status === 'failed' && state.error && (
        <p style={{ ...noteStyle, color: 'var(--theme-error-500)' }}>{state.error}</p>
      )}

      {state.status === 'skipped' && (
        <p style={noteStyle}>
          {state.skippedReason === 'output-larger'
            ? 'Every WebM rendition would be larger than the source, so none were stored.'
            : (state.skippedReason ?? 'Skipped.')}
        </p>
      )}

      {notice && <p style={{ ...noteStyle, color: 'var(--theme-error-500)' }}>{notice}</p>}

      {stored.length > 0 && (
        <table
          style={{
            borderCollapse: 'collapse',
            fontSize: '0.8rem',
            marginTop: 'calc(var(--base) / 4)',
            width: '100%',
          }}
        >
          <tbody>
            {stored.map((rendition) => {
              const savings =
                state.originalFilesize > 0 && rendition.filesize > 0
                  ? Math.round((1 - rendition.filesize / state.originalFilesize) * 100)
                  : null
              const label = presetLabels?.[rendition.preset] ?? rendition.preset
              return (
                <tr key={rendition.preset}>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>{label}</td>
                  <td
                    style={{
                      ...cellStyle,
                      color: 'var(--theme-elevation-500)',
                      textAlign: 'right',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatBytes(rendition.filesize)}
                    {savings !== null && savings > 0 ? ` (−${savings}%)` : ''}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <a
                      href={rendition.url ?? undefined}
                      rel="noopener noreferrer"
                      style={actionStyle}
                      target="_blank"
                      title="Open this rendition in a new tab"
                    >
                      Open ↗
                    </a>{' '}
                    {regeneratePath && (
                      <button
                        disabled={busy !== null}
                        onClick={() => void regenerate(rendition.preset)}
                        style={actionStyle}
                        title={`Re-encode ${label} with the current plugin config`}
                        type="button"
                      >
                        {busy === rendition.preset ? '…' : '↺'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {skippedNote && (
        <p
          style={{
            color: 'var(--theme-elevation-400)',
            fontSize: '0.75rem',
            margin: 'calc(var(--base) / 4) 0 0',
          }}
        >
          Not stored — {skippedNote}
        </p>
      )}

      {state.status === 'complete' && state.encodeDurationMs !== null && (
        <p
          style={{
            color: 'var(--theme-elevation-400)',
            fontSize: '0.75rem',
            margin: 'calc(var(--base) / 4) 0 0',
          }}
        >
          Source kept unchanged ({formatBytes(state.originalFilesize)}) · encoded in{' '}
          {(state.encodeDurationMs / 1000).toFixed(1)}s
        </p>
      )}
    </div>
  )
}
