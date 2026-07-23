'use client'

/**
 * The floating edit button: a corner-pinned dot that expands into a split
 * pill — the main segment deep-links to the current document's admin edit
 * view, the chevron opens a menu with status, the ancestor trail, and the
 * secondary admin actions. Drag it to any viewport corner (the choice
 * persists per browser, like Next's dev indicator).
 *
 * Framework-agnostic React: no `next/*` imports, styles injected inline, and
 * visibility driven by {@link usePathsEditButton}'s hint-gated endpoint check
 * — so the component can sit in any layout without affecting static pages or
 * anonymous visitors.
 */
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from 'react'

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Corner } from './storage.js'
import type { UsePathsEditButtonOptions } from './useEditButton.js'

import { CORNERS, nearestCorner, readCorner, writeCorner } from './storage.js'
import { usePathsEditButton } from './useEditButton.js'

export type PathsEditButtonProps = {
  /** Corner used until the user drags it somewhere else. @default 'bottom-right' */
  defaultCorner?: Corner
  /** URL of an exit-preview route (see `createExitPreviewRoute` in
   * `@whatworks/payload-paths/next`). Shown while `draft` is set; the current
   * pathname is appended as `?redirect=`. */
  exitPreviewURL?: string
  /** What to show when the pathname resolves to no document: nothing, or a
   * dashboard-only button. @default 'hide' */
  fallback?: 'dashboard' | 'hide'
  /** Called instead of navigating when the exit-preview item is clicked. */
  onExitPreview?: () => void
  /** Disable all of the button's transitions when the OS requests reduced
   * motion (`prefers-reduced-motion`). Set `false` to animate regardless —
   * an editor-only widget is a reasonable place to make that call, but
   * leaving it on is the accessible default. @default true */
  respectReducedMotion?: boolean
  /** Render even when embedded in an iframe (hidden by default so the button
   * stays out of the admin's own live-preview pane). @default false */
  showInIframe?: boolean
  zIndex?: number
} & UsePathsEditButtonOptions

const STATUS_LABEL: Record<string, string> = {
  changed: 'Changed',
  draft: 'Draft',
  published: 'Published',
}

/** Coarse relative time ("3 hours ago") in the browser's locale. */
const formatRelative = (iso: string): null | string => {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) {
    return null
  }
  let value = (then - Date.now()) / 1000
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.348, 'week'],
    [12, 'month'],
  ]
  try {
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    for (const [size, unit] of steps) {
      if (Math.abs(value) < size) {
        return format.format(Math.round(value), unit)
      }
      value /= size
    }
    return format.format(Math.round(value), 'year')
  } catch {
    return null
  }
}

const ICONS = {
  chevron: ['m6 9 6 6 6-6'],
  code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
  dashboard: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
  exit: ['M18 6 6 18', 'm6 6 12 12'],
  eye: [
    'M2.06 12.35a1 1 0 0 1 0-.7C3.42 8.03 7.22 5 12 5s8.58 3.03 9.94 6.65a1 1 0 0 1 0 .7C20.58 15.97 16.78 19 12 19s-8.58-3.03-9.94-6.65Z',
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  ],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  parent: ['M9 14 4 9l5-5', 'M20 20v-7a4 4 0 0 0-4-4H4'],
  pencil: ['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z'],
  user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  versions: ['M12 7v5l3 2', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
} satisfies Record<string, string[]>

const Icon = ({ name, size = 15 }: { name: keyof typeof ICONS; size?: number }): ReactNode => (
  <svg
    aria-hidden="true"
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.8"
    viewBox="0 0 24 24"
    width={size}
  >
    {ICONS[name].map((d) => (
      <path d={d} key={d} />
    ))}
  </svg>
)

/** Distance (px) a pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 6

const CSS = `
.pp-eb{position:fixed;z-index:2147483000;--pp-offset:16px;--pp-bg:#131316;--pp-bg-hover:rgba(255,255,255,.08);--pp-fg:#fafafa;--pp-muted:#9d9da8;--pp-border:rgba(255,255,255,.14);--pp-published:#4ade80;--pp-changed:#fbbf24;--pp-draft:#9d9da8;--pp-shadow:0 6px 24px rgba(0,0,0,.38),0 1px 3px rgba(0,0,0,.3);color-scheme:dark;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased}
.pp-eb,.pp-eb *{box-sizing:border-box}
.pp-eb[data-corner='bottom-right']{bottom:var(--pp-offset);right:var(--pp-offset)}
.pp-eb[data-corner='bottom-left']{bottom:var(--pp-offset);left:var(--pp-offset)}
.pp-eb[data-corner='top-right']{top:var(--pp-offset);right:var(--pp-offset)}
.pp-eb[data-corner='top-left']{top:var(--pp-offset);left:var(--pp-offset)}
.pp-eb-pill{display:flex;align-items:stretch;height:40px;background:var(--pp-bg);color:var(--pp-fg);border:1px solid var(--pp-border);border-radius:9999px;box-shadow:var(--pp-shadow);overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab}
.pp-eb[data-dragging='true']{opacity:.9}
.pp-eb[data-dragging='true'] .pp-eb-pill{cursor:grabbing}
.pp-eb-main{display:flex;align-items:center;padding:0 12px;color:inherit;text-decoration:none;white-space:nowrap;cursor:pointer}
.pp-eb-main:hover{background:var(--pp-bg-hover)}
.pp-eb-main>svg{flex:none}
.pp-eb-main .pp-eb-dot{margin-left:6px}
.pp-eb-dot{width:7px;height:7px;border-radius:9999px;flex:none}
.pp-eb [data-status='published']{background:var(--pp-published)}
.pp-eb [data-status='changed']{background:var(--pp-changed)}
.pp-eb [data-status='draft']{border:1.5px solid var(--pp-draft)}
/* The expand animation tweens EXPLICIT pixel widths — the label's target
 * width is measured off the DOM and supplied via --pp-eb-label-width, because
 * intrinsic-size tweens (max-width overshoot, 0fr→1fr grid tracks) either
 * snap/stall or fail to interpolate for auto-width columns in some engines.
 * Px→px transitions animate everywhere. */
.pp-eb-label{width:0;overflow:hidden;transition:width .18s cubic-bezier(.32,.72,0,1)}
.pp-eb-label-inner{display:inline-block;white-space:nowrap;padding-left:7px;opacity:0;transition:opacity .14s ease}
.pp-eb:hover .pp-eb-label,.pp-eb:focus-within .pp-eb-label,.pp-eb[data-open='true'] .pp-eb-label{width:var(--pp-eb-label-width,220px)}
.pp-eb:hover .pp-eb-label-inner,.pp-eb:focus-within .pp-eb-label-inner,.pp-eb[data-open='true'] .pp-eb-label-inner{opacity:1}
.pp-eb-more{display:flex;align-items:center;justify-content:center;width:0;padding:0;overflow:hidden;opacity:0;background:none;border:0;border-left:1px solid transparent;color:var(--pp-muted);font:inherit;cursor:pointer;transition:width .18s cubic-bezier(.32,.72,0,1),opacity .14s ease,border-color .18s ease}
.pp-eb:hover .pp-eb-more,.pp-eb:focus-within .pp-eb-more,.pp-eb[data-open='true'] .pp-eb-more{width:31px;opacity:1;border-left-color:var(--pp-border)}
.pp-eb-more:hover{background:var(--pp-bg-hover);color:var(--pp-fg)}
.pp-eb[data-open='true'] .pp-eb-more svg{transform:rotate(180deg)}
.pp-eb[data-corner^='top'] .pp-eb-more svg{transform:rotate(180deg)}
.pp-eb[data-corner^='top'][data-open='true'] .pp-eb-more svg{transform:none}
.pp-eb-menu{position:absolute;min-width:264px;max-width:320px;max-height:min(70vh,480px);overflow:hidden auto;background:var(--pp-bg);color:var(--pp-fg);border:1px solid var(--pp-border);border-radius:14px;box-shadow:var(--pp-shadow);padding:5px}
.pp-eb[data-corner^='bottom'] .pp-eb-menu{bottom:calc(100% + 10px)}
.pp-eb[data-corner^='top'] .pp-eb-menu{top:calc(100% + 10px)}
.pp-eb[data-corner$='right'] .pp-eb-menu{right:0}
.pp-eb[data-corner$='left'] .pp-eb-menu{left:0}
.pp-eb-head{padding:9px 11px 8px}
.pp-eb-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp-eb-sub{color:var(--pp-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp-eb-status{display:flex;align-items:center;gap:6px;margin-top:7px;font-size:12px;color:var(--pp-muted)}
.pp-eb-item{display:flex;align-items:center;gap:9px;width:100%;padding:7px 11px;border:0;border-radius:9px;background:none;color:var(--pp-fg);font:inherit;text-align:left;text-decoration:none;cursor:pointer}
.pp-eb-item:hover{background:var(--pp-bg-hover)}
.pp-eb-item svg{color:var(--pp-muted);flex:none}
.pp-eb-item-sub{margin-left:auto;padding-left:12px;color:var(--pp-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:45%}
.pp-eb-sep{height:1px;margin:5px 7px;background:var(--pp-border)}
.pp-eb-group{padding:6px 11px 2px;color:var(--pp-muted);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.pp-eb-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 11px 6px}
.pp-eb-email{color:var(--pp-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp-eb-corners{display:flex;gap:5px;flex:none}
.pp-eb-corner{position:relative;width:22px;height:22px;padding:0;background:none;border:1px solid var(--pp-border);border-radius:6px;cursor:pointer}
.pp-eb-corner::after{content:'';position:absolute;width:6px;height:6px;border-radius:2px;background:var(--pp-muted)}
.pp-eb-corner[data-corner$='left']::after{left:3px}
.pp-eb-corner[data-corner$='right']::after{right:3px}
.pp-eb-corner[data-corner^='top']::after{top:3px}
.pp-eb-corner[data-corner^='bottom']::after{bottom:3px}
.pp-eb-corner:hover{border-color:var(--pp-muted)}
.pp-eb-corner[data-active='true']{border-color:var(--pp-fg)}
.pp-eb-corner[data-active='true']::after{background:var(--pp-fg)}
@media (prefers-reduced-motion:reduce){.pp-eb[data-respect-reduced-motion] *{transition:none!important}}
`

export const PathsEditButton = (props: PathsEditButtonProps): ReactNode => {
  const {
    defaultCorner = 'bottom-right',
    exitPreviewURL,
    fallback = 'hide',
    onExitPreview,
    respectReducedMotion = true,
    showInIframe = false,
    zIndex,
    ...hookOptions
  } = props

  const { context, pathname, signOutLocally, status } = usePathsEditButton(hookOptions)

  const rootRef = useRef<HTMLDivElement>(null)
  const labelInnerRef = useRef<HTMLSpanElement>(null)
  const suppressClickRef = useRef(false)

  const [mounted, setMounted] = useState(false)
  const [corner, setCorner] = useState<Corner>(defaultCorner)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [hoverCapable, setHoverCapable] = useState(true)
  const [labelWidth, setLabelWidth] = useState<null | number>(null)

  useEffect(() => {
    setMounted(true)
    setCorner(readCorner() ?? defaultCorner)
    setHoverCapable(window.matchMedia('(hover: hover)').matches)
  }, [defaultCorner])

  // Close the menu on Escape and on any press outside the widget.
  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    const onPointerDown = (event: globalThis.PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const pinTo = useCallback((next: Corner) => {
    setCorner(next)
    writeCorner(next)
  }, [])

  // Drag tracking runs on WINDOW listeners armed by pointerdown — never via
  // pointer capture. Capturing on pointerdown retargets the compatibility
  // mouse events to the pill, so the browser computes the eventual `click`
  // target as the pill instead of the link/chevron, breaking both. With
  // window listeners a press that never crosses the threshold is completely
  // untouched and clicks work natively; only a real drag suppresses its
  // trailing click.
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }
      const pointerId = event.pointerId
      const startX = event.clientX
      const startY = event.clientY
      let moved = false

      const onMove = (move: globalThis.PointerEvent): void => {
        if (move.pointerId !== pointerId) {
          return
        }
        const dx = move.clientX - startX
        const dy = move.clientY - startY
        if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
          return
        }
        if (!moved) {
          moved = true
          setDragging(true)
          setOpen(false)
        }
        if (rootRef.current) {
          rootRef.current.style.transform = `translate(${dx}px, ${dy}px)`
        }
      }

      const onEnd = (end: globalThis.PointerEvent): void => {
        if (end.pointerId !== pointerId) {
          return
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onEnd)
        window.removeEventListener('pointercancel', onEnd)
        if (!moved) {
          return
        }
        // Swallow the click this drag would otherwise produce on the link.
        suppressClickRef.current = true
        setDragging(false)
        if (rootRef.current) {
          rootRef.current.style.transform = ''
        }
        pinTo(nearestCorner(end.clientX, end.clientY, window.innerWidth, window.innerHeight))
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onEnd)
      window.addEventListener('pointercancel', onEnd)
    },
    [pinTo],
  )

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }
  }, [])

  const doc = context?.doc ?? null
  const relativeUpdated = useMemo(
    () => (doc?.updatedAt ? formatRelative(doc.updatedAt) : null),
    [doc?.updatedAt],
  )

  // The hover expansion tweens to an explicit pixel width, so the label's
  // natural width is measured off the DOM (before paint) whenever its text
  // changes and fed to the CSS via --pp-eb-label-width.
  const primaryLabel = doc ? `Edit ${doc.collectionLabel.toLowerCase()}` : 'Dashboard'
  useLayoutEffect(() => {
    const inner = labelInnerRef.current
    if (inner) {
      setLabelWidth(Math.ceil(inner.getBoundingClientRect().width))
    }
  }, [primaryLabel, status])

  if (!mounted || status !== 'ready' || !context) {
    return null
  }
  if (!showInIframe && typeof window !== 'undefined' && window.self !== window.top) {
    return null
  }
  if (!doc && fallback === 'hide') {
    return null
  }

  const { urls, user } = context
  const primaryURL = doc ? doc.editURL : urls.admin
  const draft = hookOptions.draft ?? false
  const showExitPreview = draft && Boolean(exitPreviewURL || onExitPreview)

  const logout = (): void => {
    void fetch(urls.logout, { credentials: 'include', method: 'post' })
      .catch(() => undefined)
      .finally(() => {
        setOpen(false)
        signOutLocally()
      })
  }

  return (
    <div
      className="pp-eb"
      data-corner={corner}
      data-dragging={dragging || undefined}
      data-open={open || undefined}
      data-respect-reduced-motion={respectReducedMotion ? '' : undefined}
      onClickCapture={onClickCapture}
      ref={rootRef}
      style={
        {
          ...(zIndex === undefined ? {} : { zIndex }),
          ...(labelWidth === null ? {} : { '--pp-eb-label-width': `${labelWidth}px` }),
        } as CSSProperties
      }
    >
      <style>{CSS}</style>
      <div className="pp-eb-pill" onPointerDown={onPointerDown}>
        <a
          aria-label={doc ? `Edit "${doc.title}" in the admin` : 'Open the admin dashboard'}
          className="pp-eb-main"
          href={primaryURL}
          onClick={(event) => {
            // No hover on touch devices: the first tap reveals the menu
            // instead of instantly navigating away.
            if (!hoverCapable && !open) {
              event.preventDefault()
              setOpen(true)
            }
          }}
        >
          <Icon name="pencil" />
          {doc?.status ? <span className="pp-eb-dot" data-status={doc.status} /> : null}
          <span className="pp-eb-label">
            <span className="pp-eb-label-inner" ref={labelInnerRef}>
              {primaryLabel}
            </span>
          </span>
        </a>
        <button
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="More actions"
          className="pp-eb-more"
          onClick={() => {
            setOpen((current) => !current)
          }}
          type="button"
        >
          <Icon name="chevron" size={14} />
        </button>
      </div>

      {open ? (
        <div aria-label="Page actions" className="pp-eb-menu" role="menu">
          {doc ? (
            <>
              <div className="pp-eb-head">
                <div className="pp-eb-title">{doc.title}</div>
                <div className="pp-eb-sub">
                  {doc.collectionLabel} · {doc.url}
                </div>
                {doc.status ? (
                  <div className="pp-eb-status">
                    <span className="pp-eb-dot" data-status={doc.status} />
                    {STATUS_LABEL[doc.status] ?? doc.status}
                    {relativeUpdated ? ` · Updated ${relativeUpdated}` : null}
                  </div>
                ) : null}
              </div>
              <div className="pp-eb-sep" />
              <a className="pp-eb-item" href={doc.editURL} role="menuitem">
                <Icon name="pencil" />
                Edit {doc.collectionLabel.toLowerCase()}
              </a>
              {doc.previewURL ? (
                <a className="pp-eb-item" href={doc.previewURL} role="menuitem">
                  <Icon name="eye" />
                  Live preview
                </a>
              ) : null}
              {doc.versionsURL ? (
                <a className="pp-eb-item" href={doc.versionsURL} role="menuitem">
                  <Icon name="versions" />
                  Versions
                </a>
              ) : null}
              {doc.apiURL ? (
                <a className="pp-eb-item" href={doc.apiURL} role="menuitem">
                  <Icon name="code" />
                  API
                </a>
              ) : null}
              {doc.ancestors.length > 0 ? (
                <>
                  <div className="pp-eb-sep" />
                  <div className="pp-eb-group">Parents</div>
                  {doc.ancestors.map((ancestor) => (
                    <a
                      className="pp-eb-item"
                      href={ancestor.editURL}
                      key={`${ancestor.id}`}
                      role="menuitem"
                    >
                      <Icon name="parent" />
                      {ancestor.title}
                      <span className="pp-eb-item-sub">{ancestor.url}</span>
                    </a>
                  ))}
                </>
              ) : null}
              <div className="pp-eb-sep" />
            </>
          ) : null}
          <a className="pp-eb-item" href={urls.admin} role="menuitem">
            <Icon name="dashboard" />
            Dashboard
          </a>
          <a className="pp-eb-item" href={urls.account} role="menuitem">
            <Icon name="user" />
            Account
          </a>
          {showExitPreview ? (
            exitPreviewURL ? (
              <a
                className="pp-eb-item"
                href={`${exitPreviewURL}?redirect=${encodeURIComponent(pathname ?? '/')}`}
                role="menuitem"
              >
                <Icon name="exit" />
                Exit preview
              </a>
            ) : (
              <button className="pp-eb-item" onClick={onExitPreview} role="menuitem" type="button">
                <Icon name="exit" />
                Exit preview
              </button>
            )
          ) : null}
          <button className="pp-eb-item" onClick={logout} role="menuitem" type="button">
            <Icon name="logout" />
            Log out
          </button>
          <div className="pp-eb-sep" />
          <div className="pp-eb-foot">
            <span className="pp-eb-email">{user.email ?? user.id}</span>
            <div aria-label="Button position" className="pp-eb-corners" role="group">
              {CORNERS.map((option) => (
                <button
                  aria-label={`Pin to ${option.replace('-', ' ')}`}
                  className="pp-eb-corner"
                  data-active={option === corner || undefined}
                  data-corner={option}
                  key={option}
                  onClick={() => {
                    pinTo(option)
                  }}
                  type="button"
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
