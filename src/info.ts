import { blockUrl, channelUrl, userUrl, type ArenaBlock, type ArenaChannel } from "./arena.ts"

export type LocalMeta = {
  name: string
  path: string
  type: string
  bytes: number
  modified: number
  width: number
  height: number
}

export type FocusInfo =
  | { kind: "arena"; block: ArenaBlock; via: ArenaChannel | null }
  | { kind: "local"; meta: LocalMeta }
  | { kind: "none" }

export type BlockPanelOptions = {
  /** Current dither palette as hex strings; rendered as clickable 2×2 swatches. */
  palette: string[]
  onCopyColor: (hex: string) => void
  onDownload: (block: ArenaBlock, button: HTMLButtonElement) => void
}

export type SourceState = "ready" | "pending" | "waiting" | "unavailable"

export type SourceRowsView = {
  channels: ArenaChannel[] | null
  /** Slug of the channel new photos are currently pulled from. */
  activeSlug: string | null
  /** Right-hand text for a row, e.g. "owner · unseen/cached". Updated live while zooming. */
  metaText: (channel: ArenaChannel) => string
  metaTitle: (channel: ArenaChannel) => string
  /** Nothing left to pull or show from this channel. */
  done: (channel: ArenaChannel) => boolean
}

export type SourcesView = SourceRowsView & {
  /** Title of the block whose connections are listed; null when nothing is loaded. */
  title: string | null
  state: SourceState
  poolSize: number
  onSelect: (channel: ArenaChannel) => void
  onCopyLink: () => void
}

export const MAX_SOURCE_ROWS = 14

const formatBytes = (n: number) => {
  if (!n) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

const pad = (n: number) => String(n).padStart(2, "0")

const formatDate = (iso: string | number) => {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return "—"
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const ago = (iso: string) => {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days < 1) return "today"
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

const button = (className: string, text = "") => {
  const b = el("button", className, text)
  b.type = "button"
  return b
}

const link = (href: string, text: string, className = "info-link") => {
  const a = el("a", className, text)
  a.href = href
  a.target = "_blank"
  a.rel = "noopener noreferrer"
  return a
}

const rows = (items: [string, Node | string][]) => {
  const dl = el("dl", "info-rows")
  for (const [k, v] of items) {
    dl.append(el("dt", "", k))
    const dd = el("dd")
    if (typeof v === "string") dd.textContent = v
    else dd.append(v)
    dl.append(dd)
  }
  return dl
}

const group = (className: string, ...children: (Node | null)[]) => {
  const g = el("div", `info-group ${className}`)
  for (const c of children) if (c) g.append(c)
  return g
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

const INSTRUCTIONS: [string, string][] = [
  ["pan", "more different"],
  ["zoom", "more the same"],
]

/** On touch screens the gestures have names of their own. */
const TOUCH_INSTRUCTIONS: [string, string][] = [
  ["drag", "more different"],
  ["pinch", "more the same"],
]

const coarsePointer = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches

export const renderInstructions = (mount: HTMLElement) => {
  mount.replaceChildren()
  for (const [action, effect] of coarsePointer() ? TOUCH_INSTRUCTIONS : INSTRUCTIONS) {
    const line = el("p", "hint-line")
    line.append(el("span", "hint-action", action), el("span", "hint-arrow", "→"), el("span", "hint-effect", effect))
    mount.append(line)
  }
}

// ── Palette swatches ──────────────────────────────────────────────────────

const SWATCH_GLYPHS = "██\n██"

/** Recolours existing swatches in place; rebuilds only when the count changes. Cheap enough per frame. */
export const paintSwatches = (mount: HTMLElement, palette: string[], onCopy: (hex: string) => void) => {
  const row = mount.querySelector<HTMLElement>(".info-swatches")
  if (!row) return
  row.hidden = palette.length === 0
  let chips = row.querySelectorAll<HTMLButtonElement>(".info-swatch")
  if (chips.length !== palette.length) {
    row.replaceChildren()
    for (const _ of palette) {
      const chip = button("info-swatch", SWATCH_GLYPHS)
      chip.addEventListener("click", () => onCopy(chip.dataset.hex ?? ""))
      row.append(chip)
    }
    chips = row.querySelectorAll<HTMLButtonElement>(".info-swatch")
  }
  for (const [i, chip] of chips.entries()) {
    const hex = palette[i]!
    if (chip.style.color === "" || chip.dataset.hex !== hex) chip.style.color = hex
    if (chip.dataset.hex === hex) continue
    chip.dataset.hex = hex
    chip.title = hex
    chip.setAttribute("aria-label", `copy ${hex}`)
  }
}

// ── Left panel: the focused block ─────────────────────────────────────────

export const renderBlockInfo = (mount: HTMLElement, info: FocusInfo, opts: BlockPanelOptions) => {
  mount.replaceChildren()
  if (info.kind === "none") {
    mount.append(group("top", el("p", "info-kicker", "block"), el("p", "info-muted", "nothing focused")))
    return
  }

  const swatches = el("div", "info-swatches")
  swatches.dataset.scramble = "off"

  if (info.kind === "local") {
    const m = info.meta
    mount.append(
      group("top", el("p", "info-kicker", "file"), el("h1", "info-title", m.name)),
      group(
        "bottom",
        rows([
          ["path", m.path || m.name],
          ["type", m.type || "—"],
          ["size", formatBytes(m.bytes)],
          ["modified", formatDate(m.modified)],
          ["dimensions", m.width && m.height ? `${m.width} × ${m.height}` : "—"],
        ]),
        swatches,
      ),
    )
    paintSwatches(mount, opts.palette, opts.onCopyColor)
    return
  }

  const { block, via } = info
  const image = block.image
  const title = block.title?.trim() || "untitled"
  const description = block.description?.plain?.trim() ?? ""
  const source = block.source?.url ?? null

  const top = group("top", el("p", "info-kicker", "block"), el("h1", "info-title", title))
  if (description) top.append(el("p", "info-desc", description))

  const meta: [string, Node | string][] = [
    ["by", link(userUrl(block.user), block.user.name, "info-inline")],
    ["added", `${formatDate(block.created_at)}  ${ago(block.created_at)}`],
  ]
  if (image) {
    meta.push(["dimensions", `${image.width} × ${image.height}`])
    meta.push(["file", `${image.content_type.replace("image/", "")}  ${formatBytes(image.file_size)}`])
  }
  if (via) meta.push(["via", link(channelUrl(via), via.title, "info-inline")])
  if (block.comment_count) meta.push(["comments", String(block.comment_count)])

  const links = el("div", "info-links")
  // The `.info-long` parts are dropped on phones so the links fit on one line beside the swatches.
  const open = link(blockUrl(block), "open")
  open.append(el("span", "info-long", " on are.na"), " ↗")
  links.append(open)
  if (source) {
    const src = link(source, "source")
    src.append(el("span", "info-long", ` · ${hostOf(source)}`), " ↗")
    links.append(src)
  }
  if (image) {
    const download = button("info-link", "download ↓")
    download.addEventListener("click", () => opts.onDownload(block, download))
    links.append(download)
  }

  mount.append(top, group("bottom", rows(meta), swatches, links))
  paintSwatches(mount, opts.palette, opts.onCopyColor)
}

// ── Right panel: where "more of the same" comes from ──────────────────────

export const renderSources = (mount: HTMLElement, view: SourcesView) => {
  mount.replaceChildren()
  if (view.title === null) {
    const top = group("top", el("p", "info-kicker", "sources"))
    const hint = el("div", "info-hint")
    renderInstructions(hint)
    top.append(hint)
    mount.append(top)
    return
  }

  const timer = el("div", "info-timer")
  timer.dataset.scramble = "off"
  timer.setAttribute("aria-hidden", "true")
  const top = group("top", el("p", "info-kicker", "more of the same from"), el("p", "info-context", view.title), timer)

  const mid = group("mid")
  const channels = view.channels ?? []
  if (view.state === "ready" && !channels.length) {
    mid.append(el("p", "info-muted", "no public channels to pull from"))
  } else if (view.state === "ready") {
    const list = el("div", "info-list")
    for (const c of channels.slice(0, MAX_SOURCE_ROWS)) {
      const row = button("info-channel")
      row.dataset.slug = c.slug
      row.tabIndex = -1
      const mark = el("span", "info-channel-mark", " ")
      const meta = el("span", "info-channel-meta", "")
      // Updated live while zooming; keep them out of the scramble so a mid-animation restore can't go stale.
      mark.dataset.scramble = "off"
      meta.dataset.scramble = "off"
      row.append(mark, el("span", "info-channel-title", c.title), meta)
      row.addEventListener("click", () => view.onSelect(c))
      list.append(row)
    }
    if (channels.length > MAX_SOURCE_ROWS) list.append(el("p", "info-muted", `+${channels.length - MAX_SOURCE_ROWS} more`))
    mid.append(list)
  } else if (view.state === "pending") {
    mid.append(el("p", "info-muted", "…"))
  } else if (view.state === "waiting") {
    mid.append(el("p", "info-muted", "waiting for are.na budget"))
  } else {
    mid.append(el("p", "info-muted", "unavailable"))
  }

  const copy = button("info-link", "copy link")
  copy.addEventListener("click", () => {
    view.onCopyLink()
    copy.textContent = "copied"
    window.setTimeout(() => {
      copy.textContent = "copy link"
    }, 1200)
  })
  const links = el("div", "info-links")
  links.append(copy)

  mount.append(top, mid, group("bottom", rows([["cached", `${view.poolSize} images`]]), links))
  updateSourceRows(mount, view)
}

/**
 * Refreshes the per-channel state in place (active marker, done state, right-hand count)
 * without rebuilding the list, so counts can follow the zoom live.
 */
export const updateSourceRows = (mount: HTMLElement, view: SourceRowsView) => {
  const bySlug = new Map((view.channels ?? []).map((c) => [c.slug, c] as const))
  for (const row of mount.querySelectorAll<HTMLButtonElement>(".info-channel[data-slug]")) {
    const c = bySlug.get(row.dataset.slug ?? "")
    if (!c) continue
    const active = c.slug === view.activeSlug
    row.classList.toggle("is-active", active)
    row.classList.toggle("is-done", view.done(c))
    const mark = row.querySelector(".info-channel-mark")
    const meta = row.querySelector(".info-channel-meta")
    const markText = active ? "▸" : " "
    if (mark && mark.textContent !== markText) mark.textContent = markText
    const metaText = view.metaText(c)
    if (meta && meta.textContent !== metaText) meta.textContent = metaText
    const title = view.metaTitle(c)
    if (row.title !== title) row.title = title
  }
}

/** Scales the divider under the context title: 1 = full, 0 = the hold has run out. */
export const paintSourceTimer = (mount: HTMLElement, progress: number) => {
  const timer = mount.querySelector<HTMLElement>(".info-timer")
  if (!timer) return
  const p = Math.min(1, Math.max(0, progress))
  const next = `scaleX(${p.toFixed(4)})`
  if (timer.style.transform !== next) timer.style.transform = next
}
