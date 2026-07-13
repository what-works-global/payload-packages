'use client'

import { Button, Modal, toast, useConfig, useModal, useTranslation } from '@payloadcms/ui'
import React, { useCallback, useState } from 'react'

export const reindexModalSlug = 'algolia-search-reindex'

type ReindexResponse = {
  error?: string
  indexed?: Record<string, number>
  total?: number
}

export type ReindexActionProps = {
  /** Slugs of the collections configured for search, in config order. */
  collections: string[]
  reindexPath: string
}

/** Magnifier whose lens is drawn as two refresh arrows — search + resync. */
const ReindexIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
  >
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14a9 3 0 0 0 12 2.84" />
    <path d="M21 5v3" />
    <path d="m21 12-3 5h4l-3 5" />
    <path d="M3 12a9 3 0 0 0 11.59 2.87" />
  </svg>
)

const CloseIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="1.5"
    viewBox="0 0 20 20"
  >
    <path d="M 5.5 5.5 L 14.5 14.5" />
    <path d="M 14.5 5.5 L 5.5 14.5" />
  </svg>
)

const CheckIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.75"
    viewBox="0 0 20 20"
  >
    <path d="M 4.5 10.5 L 8.5 14.5 L 15.5 6" />
  </svg>
)

const css = `
.algolia-reindex {
  display: flex;
  align-items: center;
}
.algolia-reindex__trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(var(--base) * 0.2);
  margin: 1px;
  border: 0;
  border-radius: 9999px;
  background: var(--theme-bg);
  color: var(--theme-text);
  box-shadow: 0 0 0 1px var(--theme-elevation-150);
  cursor: pointer;
}
.algolia-reindex__trigger:hover {
  background: var(--theme-elevation-100);
  box-shadow: 0 0 0 1px var(--theme-elevation-500);
}
.algolia-reindex__trigger svg {
  display: block;
  width: calc(var(--base) * 0.8);
  height: calc(var(--base) * 0.8);
}
.algolia-reindex__trigger--busy svg {
  animation: algolia-reindex-pulse 1.2s ease-in-out infinite;
}
@keyframes algolia-reindex-pulse {
  50% { opacity: 0.35; }
}
@keyframes algolia-reindex-spin {
  to { transform: rotate(360deg); }
}

.algolia-reindex__modal {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--base);
}
.algolia-reindex__overlay {
  position: absolute;
  inset: 0;
  border: 0;
  padding: 0;
  background: color-mix(in srgb, var(--theme-bg) 50%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  cursor: default;
}
.algolia-reindex__card {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: calc(var(--base) * 0.8);
  width: min(560px, 100%);
  padding: calc(var(--base) * 1.2);
  border: 1px solid var(--theme-elevation-150);
  border-radius: calc(var(--style-radius-m) * 2);
  background: var(--theme-elevation-0);
  box-shadow: 0 12px 48px color-mix(in srgb, var(--theme-elevation-1000) 16%, transparent);
}

.algolia-reindex__header {
  display: flex;
  align-items: flex-start;
  gap: calc(var(--base) * 0.6);
}
.algolia-reindex__badge {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--base) * 2);
  height: calc(var(--base) * 2);
  border-radius: calc(var(--style-radius-m) * 2);
  background: var(--theme-elevation-100);
  color: var(--theme-elevation-800);
}
.algolia-reindex__badge svg {
  width: var(--base);
  height: var(--base);
}
.algolia-reindex__heading {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.algolia-reindex__heading h2 {
  margin: 0;
  font-size: calc(var(--base) * 0.9);
  line-height: 1.25;
}
.algolia-reindex__heading p {
  margin: 0;
  color: var(--theme-elevation-500);
  font-size: calc(var(--base) * 0.65);
  line-height: 1.4;
}
.algolia-reindex__close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--base) * 1.4);
  height: calc(var(--base) * 1.4);
  padding: 0;
  border: 0;
  border-radius: var(--style-radius-m);
  background: transparent;
  color: var(--theme-elevation-500);
  cursor: pointer;
}
.algolia-reindex__close:hover {
  background: var(--theme-elevation-100);
  color: var(--theme-text);
}
.algolia-reindex__close svg {
  width: calc(var(--base) * 0.7);
  height: calc(var(--base) * 0.7);
}

.algolia-reindex__list {
  border: 1px solid var(--theme-elevation-150);
  border-radius: calc(var(--style-radius-m) * 1.5);
  overflow: hidden;
}
.algolia-reindex__row {
  display: flex;
  align-items: center;
  gap: calc(var(--base) * 0.5);
  padding: calc(var(--base) * 0.45) calc(var(--base) * 0.6);
}
.algolia-reindex__row + .algolia-reindex__row {
  border-top: 1px solid var(--theme-elevation-100);
}
.algolia-reindex__row-label {
  flex-grow: 1;
  font-size: calc(var(--base) * 0.7);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.algolia-reindex__row-status {
  color: var(--theme-elevation-500);
  font-size: calc(var(--base) * 0.6);
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
}
.algolia-reindex__row-button {
  padding: calc(var(--base) * 0.1) calc(var(--base) * 0.5);
  border: 1px solid var(--theme-elevation-200);
  border-radius: var(--style-radius-m);
  background: transparent;
  color: var(--theme-text);
  font-size: calc(var(--base) * 0.6);
  cursor: pointer;
}
.algolia-reindex__row-button:hover:not(:disabled) {
  background: var(--theme-elevation-50);
  border-color: var(--theme-elevation-400);
}
.algolia-reindex__row-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.algolia-reindex__spinner {
  display: inline-block;
  width: calc(var(--base) * 0.7);
  height: calc(var(--base) * 0.7);
  border: 2px solid var(--theme-elevation-200);
  border-top-color: var(--theme-elevation-800);
  border-radius: 50%;
  animation: algolia-reindex-spin 0.7s linear infinite;
}

.algolia-reindex__panel {
  display: flex;
  align-items: flex-start;
  gap: calc(var(--base) * 0.4);
  padding: calc(var(--base) * 0.5) calc(var(--base) * 0.6);
  border-radius: calc(var(--style-radius-m) * 1.5);
  font-size: calc(var(--base) * 0.65);
  line-height: 1.45;
}
.algolia-reindex__panel svg {
  flex-shrink: 0;
  width: calc(var(--base) * 0.8);
  height: calc(var(--base) * 0.8);
  margin-top: 1px;
}
.algolia-reindex__panel--success {
  background: color-mix(in srgb, var(--theme-success-500) 10%, transparent);
  color: var(--theme-success-600);
}
.algolia-reindex__panel--error {
  background: color-mix(in srgb, var(--theme-error-500) 10%, transparent);
  color: var(--theme-error-500);
}

.algolia-reindex__footer {
  display: flex;
  align-items: center;
  gap: calc(var(--base) * 0.4);
}
.algolia-reindex__footer .btn {
  margin: 0;
  flex-shrink: 0;
}
.algolia-reindex__footer-note {
  flex-grow: 1;
  margin: 0;
  padding-right: calc(var(--base) * 0.4);
  color: var(--theme-elevation-400);
  font-size: calc(var(--base) * 0.55);
  line-height: 1.4;
}

@media (max-width: 560px) {
  .algolia-reindex__card {
    padding: calc(var(--base) * 0.8);
  }
  .algolia-reindex__footer {
    flex-wrap: wrap;
  }
  .algolia-reindex__footer-note {
    flex-basis: 100%;
    order: 1;
  }
}
`

/**
 * Header action: an icon next to the other admin header controls that opens
 * the reindex modal — rebuild the whole index (atomic) or one collection.
 */
export const ReindexAction: React.FC<ReindexActionProps> = ({ collections, reindexPath }) => {
  const { config } = useConfig()
  const { i18n } = useTranslation()
  const { closeModal, isModalOpen, openModal } = useModal()

  const [counts, setCounts] = useState<Record<string, number>>({})
  const [outcome, setOutcome] = useState<{ message: string; ok: boolean } | null>(null)
  /** `null` scope = all collections. */
  const [running, setRunning] = useState<{ scope: null | string } | null>(null)

  const labelFor = useCallback(
    (slug: string): string => {
      const plural = config.collections.find((entry) => entry.slug === slug)?.labels?.plural
      if (typeof plural === 'string') {
        return plural
      }
      if (plural && typeof plural === 'object') {
        return plural[i18n.language] ?? Object.values(plural)[0] ?? slug
      }
      return slug
    },
    [config.collections, i18n.language],
  )

  const run = useCallback(
    (scope: null | string): void => {
      if (running) {
        return
      }
      setRunning({ scope })
      setOutcome(null)

      const query = scope ? `?collection=${encodeURIComponent(scope)}` : ''
      const url = `${config.serverURL ?? ''}${config.routes.api}${reindexPath}${query}`
      const scopeLabel = scope ? `“${labelFor(scope)}”` : 'all collections'

      void fetch(url, { credentials: 'include', method: 'POST' })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as null | ReindexResponse
          if (!response.ok) {
            throw new Error(body?.error ?? `Reindex failed (${response.status})`)
          }
          const indexed = body?.indexed
          if (indexed) {
            setCounts((previous) => ({ ...previous, ...indexed }))
          }
          const total = body?.total ?? 0
          const message = `Indexed ${total} document${total === 1 ? '' : 's'} from ${scopeLabel}.`
          setOutcome({ message, ok: true })
          if (!isModalOpen(reindexModalSlug)) {
            toast.success(message)
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Reindex failed'
          setOutcome({ message, ok: false })
          if (!isModalOpen(reindexModalSlug)) {
            toast.error(message)
          }
        })
        .finally(() => {
          setRunning(null)
        })
    },
    [config.routes.api, config.serverURL, isModalOpen, labelFor, reindexPath, running],
  )

  return (
    <div className="algolia-reindex">
      <style>{css}</style>
      <button
        aria-label="Rebuild search index"
        className={`algolia-reindex__trigger${running ? ' algolia-reindex__trigger--busy' : ''}`}
        onClick={() => openModal(reindexModalSlug)}
        title="Rebuild search index"
        type="button"
      >
        <ReindexIcon />
      </button>
      {isModalOpen(reindexModalSlug) && (
        <Modal className="algolia-reindex__modal" closeOnBlur={false} slug={reindexModalSlug}>
          <button
            aria-label="Close"
            className="algolia-reindex__overlay"
            onClick={() => closeModal(reindexModalSlug)}
            tabIndex={-1}
            type="button"
          />
          <div className="algolia-reindex__card">
            <header className="algolia-reindex__header">
              <div className="algolia-reindex__badge">
                <ReindexIcon />
              </div>
              <div className="algolia-reindex__heading">
                <h2>Rebuild search index</h2>
                <p>Push fresh records for published documents to Algolia.</p>
              </div>
              <button
                aria-label="Close"
                className="algolia-reindex__close"
                onClick={() => closeModal(reindexModalSlug)}
                type="button"
              >
                <CloseIcon />
              </button>
            </header>

            <div className="algolia-reindex__list">
              {collections.map((slug) => {
                const busyHere = running && (running.scope === null || running.scope === slug)
                const count = counts[slug]
                return (
                  <div className="algolia-reindex__row" key={slug}>
                    <span className="algolia-reindex__row-label">{labelFor(slug)}</span>
                    <span className="algolia-reindex__row-status">
                      {busyHere ? (
                        <span className="algolia-reindex__spinner" />
                      ) : count === undefined ? (
                        '—'
                      ) : (
                        `${count} record${count === 1 ? '' : 's'}`
                      )}
                    </span>
                    <button
                      className="algolia-reindex__row-button"
                      disabled={Boolean(running)}
                      onClick={() => run(slug)}
                      type="button"
                    >
                      Reindex
                    </button>
                  </div>
                )
              })}
            </div>

            {outcome && (
              <div
                className={`algolia-reindex__panel algolia-reindex__panel--${outcome.ok ? 'success' : 'error'}`}
                role="status"
              >
                {outcome.ok && <CheckIcon />}
                <span>{outcome.message}</span>
              </div>
            )}

            <footer className="algolia-reindex__footer">
              <p className="algolia-reindex__footer-note">
                {running
                  ? 'You can close this window — the rebuild finishes on the server.'
                  : 'Rebuilds swap in atomically, so search keeps serving results while they run.'}
              </p>
              <Button
                buttonStyle="secondary"
                onClick={() => closeModal(reindexModalSlug)}
                size="medium"
              >
                Close
              </Button>
              <Button disabled={Boolean(running)} onClick={() => run(null)} size="medium">
                {running ? 'Reindexing…' : 'Reindex all'}
              </Button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  )
}
