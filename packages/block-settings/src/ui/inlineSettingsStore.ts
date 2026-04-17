'use client'

import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
const openSettingsPaths = new Set<string>()

const emitChange = (): void => {
  for (const listener of listeners) {
    listener()
  }
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

const isInlineSettingsOpen = (path: string): boolean => openSettingsPaths.has(path)

export const openInlineSettings = (path: string): void => {
  if (openSettingsPaths.has(path)) {
    return
  }

  openSettingsPaths.add(path)
  emitChange()
}

export const closeInlineSettings = (path: string): void => {
  if (!openSettingsPaths.has(path)) {
    return
  }

  openSettingsPaths.delete(path)
  emitChange()
}

export const toggleInlineSettings = (path: string): void => {
  if (openSettingsPaths.has(path)) {
    openSettingsPaths.delete(path)
  } else {
    openSettingsPaths.add(path)
  }

  emitChange()
}

export const useInlineSettingsOpen = (path: string): boolean => {
  return useSyncExternalStore(subscribe, () => isInlineSettingsOpen(path), () => false)
}
