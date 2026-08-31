'use client'

import {
  type TrackHTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type VideoHTMLAttributes,
} from 'react'

import type { VideoDerivativeSource } from './toVideoSources.js'

export type { VideoDerivativeSource } from './toVideoSources.js'

export interface VideoFile {
  mimeType?: string
  url: string
  videoDerivatives?: VideoDerivativeSource[]
}

export interface VideoProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src'> {
  file: VideoFile
  /** Caption/subtitle `<track>` elements — pass at least one for accessible video. */
  tracks?: TrackHTMLAttributes<HTMLTrackElement>[]
}

interface ActiveSource {
  mimeType?: string
  url: string
}

/** Descending by breakpoint, with the no-breakpoint fallback variant last. */
function sortSources(sources: VideoDerivativeSource[]): VideoDerivativeSource[] {
  return [...sources].sort((a, b) => {
    if (a.breakpointMinWidth === null) {
      return 1
    }
    if (b.breakpointMinWidth === null) {
      return -1
    }
    return b.breakpointMinWidth - a.breakpointMinWidth
  })
}

/**
 * `<source media="...">` is only evaluated once at load, so viewport
 * changes after that don't re-select a source. This picks the source
 * imperatively via `matchMedia` instead, so resizing across a configured
 * breakpoint swaps the active `<source>` while preserving playback state.
 */
export const Video: React.FC<VideoProps> = ({ file, tracks, ...videoProps }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const sortedSources = useMemo(
    () => sortSources(file.videoDerivatives ?? []),
    [file.videoDerivatives],
  )
  const fallback = useMemo<ActiveSource>(
    () => ({ mimeType: file.mimeType, url: file.url }),
    [file.mimeType, file.url],
  )

  const pickSource = useCallback((): ActiveSource => {
    if (sortedSources.length === 0) {
      return fallback
    }
    const width = window.innerWidth
    const match = sortedSources.find(
      (source) => source.breakpointMinWidth === null || width >= source.breakpointMinWidth,
    )
    return match ? { mimeType: match.mimeType, url: match.url } : fallback
  }, [fallback, sortedSources])

  // Initialize to the fallback so client hydration matches the server
  // render — the real breakpoint match happens after mount, below.
  const [current, setCurrent] = useState<ActiveSource>(fallback)
  const currentUrlRef = useRef(fallback.url)

  useEffect(() => {
    // Captured once so the cleanup below always targets the same node this
    // effect attached listeners to, even if the ref moves on before it runs.
    const videoNode = videoRef.current
    let pendingLoadListener: (() => void) | null = null

    // Changing a mounted <source>'s `src` doesn't make the browser pick it
    // up on its own — the video element needs an explicit `.load()` after
    // the new src commits to the DOM, per the HTML spec.
    const applySource = (next: ActiveSource): void => {
      if (next.url === currentUrlRef.current) {
        return
      }
      currentUrlRef.current = next.url

      const wasPlaying = Boolean(videoNode && !videoNode.paused)
      const resumeAt = videoNode?.currentTime ?? 0

      setCurrent(next)

      if (videoNode) {
        if (pendingLoadListener) {
          videoNode.removeEventListener('loadedmetadata', pendingLoadListener)
        }
        const onLoaded = (): void => {
          videoNode.currentTime = resumeAt
          if (wasPlaying) {
            void videoNode.play()
          }
          videoNode.removeEventListener('loadedmetadata', onLoaded)
          pendingLoadListener = null
        }
        pendingLoadListener = onLoaded
        videoNode.addEventListener('loadedmetadata', onLoaded)
        requestAnimationFrame(() => videoNode.load())
      }
    }

    applySource(pickSource())

    const breakpoints = Array.from(
      new Set(
        sortedSources
          .map((source) => source.breakpointMinWidth)
          .filter((width): width is number => width !== null),
      ),
    )
    const queries = breakpoints.map((width) => window.matchMedia(`(min-width: ${width}px)`))
    const handleChange = (): void => applySource(pickSource())

    for (const query of queries) {
      query.addEventListener('change', handleChange)
    }
    return () => {
      for (const query of queries) {
        query.removeEventListener('change', handleChange)
      }
      if (pendingLoadListener) {
        videoNode?.removeEventListener('loadedmetadata', pendingLoadListener)
      }
    }
  }, [pickSource, sortedSources])

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- captions are opt-in via the `tracks` prop; the static rule can't see through the .map() below
    <video ref={videoRef} {...videoProps}>
      <source src={current.url} type={current.mimeType} />
      {tracks?.map((track) => <track key={track.src ?? track.label} {...track} />)}
    </video>
  )
}
