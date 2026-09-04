const API = "https://api.are.na/v3"

/** Guest tier: 30 requests per rolling minute, per IP. */
export const RATE_LIMIT = 30
const WINDOW_MS = 60_000
/** Requests kept in reserve for user-initiated actions; background prefetch never eats these. */
const RESERVE = 4
const DEFAULT_COOLDOWN_S = 20

export type ArenaRendition = { src: string; src_2x: string; width: number; height: number }

export type ArenaImage = {
  width: number
  height: number
  src: string
  aspect_ratio?: number
  content_type: string
  filename: string
  file_size: number
  alt_text: string | null
  small: ArenaRendition
  medium: ArenaRendition
  large: ArenaRendition
}

export type ArenaUser = {
  id: number
  type: "User" | "Group"
  name: string
  slug: string
}

export type ArenaSource = {
  url?: string | null
  title?: string | null
  provider?: { name?: string | null; url?: string | null } | null
} | null

export type ArenaBlock = {
  id: number
  type: string
  title: string | null
  description: { plain: string; markdown: string; html: string } | null
  created_at: string
  updated_at: string
  comment_count: number
  user: ArenaUser
  source: ArenaSource
  image: ArenaImage | null
}

export type ArenaChannel = {
  id: number
  slug: string
  title: string
  visibility: string
  updated_at: string
  owner: ArenaUser
  counts: { blocks: number; channels: number; contents: number; collaborators: number }
}

type Page<T> = {
  meta: { current_page: number; total_pages: number; total_count: number; has_more_pages: boolean }
  data: T[]
}

export type ArenaTarget = { kind: "block"; id: number } | { kind: "channel"; slug: string }

export type ArenaState = "idle" | "fetching" | "limited" | "offline"

export type ArenaStatus = {
  state: ArenaState
  used: number
  limit: number
  /** Epoch ms when the cooldown ends (only while limited). */
  retryAt: number
  inflight: number
}

export type Priority = "user" | "background"

export type ArenaErrorKind = "limited" | "offline" | "http" | "budget"

export class ArenaError extends Error {
  kind: ArenaErrorKind
  status: number
  constructor(kind: ArenaErrorKind, message: string, status = 0) {
    super(message)
    this.kind = kind
    this.status = status
  }
}

const RESERVED_SEGMENTS = new Set([
  "block",
  "blocks",
  "search",
  "explore",
  "feed",
  "settings",
  "about",
  "pricing",
  "tools",
  "developers",
  "login",
  "sign_up",
  "signup",
  "terms",
  "privacy",
  "premium",
  "channels",
  "users",
])

/** Accepts block/channel URLs, "block/123", bare ids, and "user/slug" shorthands. */
export const parseArenaTarget = (raw: string): ArenaTarget | null => {
  const text = raw.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return { kind: "block", id: Number(text) }
  let path = text
  if (text.includes("://") || /^([\w-]+\.)*are\.na\//i.test(text)) {
    try {
      const url = new URL(text.includes("://") ? text : `https://${text}`)
      if (!/(^|\.)are\.na$/i.test(url.hostname)) return null
      path = url.pathname
    } catch {
      return null
    }
  }
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent)
  if (!parts.length) return null
  if (parts[0] === "block" && parts[1] && /^\d+$/.test(parts[1])) return { kind: "block", id: Number(parts[1]) }
  if (parts.length === 2 && !RESERVED_SEGMENTS.has(parts[0]!)) return { kind: "channel", slug: parts[1]! }
  return null
}

export const targetToHash = (target: ArenaTarget) =>
  target.kind === "block" ? `#block=${target.id}` : `#channel=${encodeURIComponent(target.slug)}`

export const targetFromHash = (hash: string): ArenaTarget | null => {
  const m = /^#?(block|channel)=(.+)$/.exec(hash)
  if (!m) return null
  if (m[1] === "block") return /^\d+$/.test(m[2]!) ? { kind: "block", id: Number(m[2]) } : null
  return { kind: "channel", slug: decodeURIComponent(m[2]!) }
}

export const blockUrl = (block: ArenaBlock) => `https://www.are.na/block/${block.id}`
export const channelUrl = (channel: ArenaChannel) => `https://www.are.na/${channel.owner.slug}/${channel.slug}`
export const userUrl = (user: ArenaUser) => `https://www.are.na/${user.slug}`

export const isImageBlock = (block: ArenaBlock) => block.type === "Image" && !!block.image?.small?.src_2x

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object"

export const createArenaClient = () => {
  const stamps: number[] = []
  const cache = new Map<string, unknown>()
  const inflight = new Map<string, Promise<unknown>>()
  const listeners = new Set<(status: ArenaStatus) => void>()
  let limitedUntil = 0
  let offline = false
  let active = 0

  const prune = (now: number) => {
    while (stamps.length && now - stamps[0]! > WINDOW_MS) stamps.shift()
  }

  const used = (now = Date.now()) => {
    prune(now)
    return stamps.length
  }

  const status = (): ArenaStatus => {
    const now = Date.now()
    const state: ArenaState =
      limitedUntil > now ? "limited" : offline ? "offline" : active > 0 ? "fetching" : "idle"
    return { state, used: used(now), limit: RATE_LIMIT, retryAt: limitedUntil, inflight: active }
  }

  const emit = () => {
    const s = status()
    for (const fn of listeners) fn(s)
  }

  /** Requests a background task may still issue right now without touching the reserve. */
  const budget = (priority: Priority = "background") => {
    const now = Date.now()
    if (limitedUntil > now) return 0
    const free = RATE_LIMIT - used(now) - active
    return Math.max(0, priority === "user" ? free : free - RESERVE)
  }

  const request = async <T>(path: string, priority: Priority): Promise<T> => {
    const url = `${API}${path}`
    if (cache.has(url)) return cache.get(url) as T
    const pending = inflight.get(url)
    if (pending) return pending as Promise<T>

    const now = Date.now()
    if (limitedUntil > now) throw new ArenaError("limited", "cooling down")
    if (budget(priority) <= 0) {
      // Local window exhausted; act as if limited until the oldest stamp ages out.
      if (priority === "user") limitedUntil = (stamps[0] ?? now) + WINDOW_MS + 250
      emit()
      throw new ArenaError(priority === "user" ? "limited" : "budget", "request budget exhausted")
    }

    const run = (async () => {
      stamps.push(Date.now())
      active++
      emit()
      try {
        const res = await fetch(url, { headers: { Accept: "application/json" } })
        offline = false
        if (res.status === 429) {
          let retry = DEFAULT_COOLDOWN_S
          try {
            const body = (await res.json()) as unknown
            const err = isRecord(body) && isRecord(body.error) ? body.error : null
            const n = Number(err?.retry_after)
            if (Number.isFinite(n) && n > 0) retry = n
          } catch {
            /* body unreadable; keep default */
          }
          limitedUntil = Date.now() + retry * 1000
          throw new ArenaError("limited", "rate limited", 429)
        }
        if (!res.ok) throw new ArenaError("http", `HTTP ${res.status}`, res.status)
        const json = (await res.json()) as T
        cache.set(url, json)
        return json
      } catch (e) {
        if (e instanceof ArenaError) throw e
        offline = true
        throw new ArenaError("offline", "network error")
      } finally {
        active--
        inflight.delete(url)
        emit()
      }
    })()
    inflight.set(url, run)
    return run as Promise<T>
  }

  const q = (params: Record<string, string | number>) =>
    Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&")

  return {
    status,
    budget,
    onStatus(fn: (status: ArenaStatus) => void) {
      listeners.add(fn)
      fn(status())
      return () => listeners.delete(fn)
    },
    block: (id: number, priority: Priority = "user") => request<ArenaBlock>(`/blocks/${id}`, priority),
    channel: (slug: string, priority: Priority = "user") =>
      request<ArenaChannel>(`/channels/${encodeURIComponent(slug)}`, priority),
    blockConnections: (id: number, priority: Priority = "background", per = 50) =>
      request<Page<ArenaChannel>>(`/blocks/${id}/connections?${q({ per })}`, priority),
    /** Channel contents are mixed (no server-side type filter); callers keep only image blocks. */
    channelContents: (slug: string, page: number, per: number, priority: Priority = "background") =>
      request<Page<ArenaBlock>>(`/channels/${encodeURIComponent(slug)}/contents?${q({ per, page })}`, priority),
  }
}

export type ArenaClient = ReturnType<typeof createArenaClient>
