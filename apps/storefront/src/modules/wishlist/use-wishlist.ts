"use client"

import { useCallback, useSyncExternalStore } from "react"
import {
  parseWishlist,
  serializeWishlist,
  toggleWishlist,
  WISHLIST_KEY,
} from "./wishlist-storage"

const EMPTY: readonly string[] = Object.freeze([])

let current: string[] | null = null
let unsaved = false
const listeners = new Set<() => void>()
let storageBound = false

const readStorage = (): string[] => {
  try {
    return parseWishlist(window.localStorage.getItem(WISHLIST_KEY))
  } catch {
    // Storage blocked: keep whatever is already held in memory.
    return current ?? []
  }
}

const emit = () => {
  listeners.forEach((listener) => listener())
}

const onStorage = (event: StorageEvent) => {
  if (event.key !== null && event.key !== WISHLIST_KEY) {
    return
  }
  if (unsaved) {
    return
  }
  current = readStorage()
  emit()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  if (!storageBound && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage)
    storageBound = true
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && storageBound) {
      window.removeEventListener("storage", onStorage)
      storageBound = false
      if (!unsaved) {
        current = null
      }
    }
  }
}

const getSnapshot = (): readonly string[] => {
  if (current === null) {
    current = readStorage()
  }
  return current
}

const getServerSnapshot = (): readonly string[] => EMPTY

const write = (next: string[]) => {
  current = next
  try {
    window.localStorage.setItem(WISHLIST_KEY, serializeWishlist(next))
    unsaved = false
  } catch {
    // In-memory list keeps working for this session.
    unsaved = true
  }
  emit()
}

export function useWishlist(): {
  ids: readonly string[]
  has: (id: string) => boolean
  toggle: (id: string) => void
} {
  const ids = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const has = useCallback((id: string) => ids.includes(id), [ids])
  const toggle = useCallback((id: string) => {
    write(toggleWishlist([...getSnapshot()], id))
  }, [])

  return { ids, has, toggle }
}
