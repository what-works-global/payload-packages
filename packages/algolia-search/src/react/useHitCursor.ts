'use client'

import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import { useCallback, useEffect, useState } from 'react'

import type { SearchHit } from './types.js'

export interface UseHitCursorOptions<THit extends SearchHit = SearchHit> {
  /** Called when the user presses Enter on the active hit. */
  onSelect?: (hit: THit) => void
}

export interface UseHitCursorResult<THit extends SearchHit = SearchHit> {
  /** The hit the cursor is on, if any. */
  activeHit: THit | undefined
  /**
   * Attach to the active hit's element only —
   * `ref={hit.objectID === cursor ? activeItemRef : undefined}` — and the
   * element is scrolled into view whenever the cursor lands on it.
   */
  activeItemRef: (element: HTMLElement | null) => void
  /** `objectID` of the active hit. */
  cursor: string | undefined
  /** Attach to the search input: ArrowUp/ArrowDown move (wrapping), Enter selects. */
  onKeyDown: (event: ReactKeyboardEvent) => void
  /** Move the cursor directly, e.g. from a hit's `onMouseEnter`. */
  setCursor: (objectID: string | undefined) => void
}

/**
 * Keyboard cursor over a hit list: ArrowUp/ArrowDown move with wrap-around,
 * Enter hands the active hit to `onSelect`, and the cursor snaps back to the
 * first hit whenever the results no longer contain it.
 */
export function useHitCursor<THit extends SearchHit = SearchHit>(
  hits: THit[],
  options: UseHitCursorOptions<THit> = {},
): UseHitCursorResult<THit> {
  const { onSelect } = options
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  // When the results change, keep the cursor on a hit that still exists.
  useEffect(() => {
    if (!hits.some((hit) => hit.objectID === cursor)) {
      setCursor(hits[0]?.objectID)
    }
  }, [cursor, hits])

  const activeHit = hits.find((hit) => hit.objectID === cursor)

  const move = (offset: -1 | 1) => {
    if (hits.length === 0) {
      return
    }
    const index = Math.max(
      0,
      hits.findIndex((hit) => hit.objectID === cursor),
    )
    setCursor(hits[(hits.length + index + offset) % hits.length]?.objectID)
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
    } else if (event.key === 'Enter' && activeHit) {
      event.preventDefault()
      onSelect?.(activeHit)
    }
  }

  // Callback ref: fires each time it attaches to a new element, i.e. exactly
  // when the cursor moves to a different hit. `nearest` no-ops when visible.
  const activeItemRef = useCallback((element: HTMLElement | null) => {
    element?.scrollIntoView({ block: 'nearest' })
  }, [])

  return { activeHit, activeItemRef, cursor, onKeyDown, setCursor }
}
