export type MetaSource = {
  name: string
  path: string
  kind: string
  type: string
  bytes: number
  modified: number
  width?: number
  height?: number
}

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const pad = (n: number) => String(n).padStart(2, "0")

const formatTime = (ms: number) => {
  if (!ms) return "—"
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return "—"
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export const renderMeta = (el: HTMLElement, src: MetaSource | null) => {
  if (!src) {
    el.textContent = "no file focused"
    return
  }
  const rows: [string, string][] = [
    ["name", src.name],
    ["path", src.path || src.name],
    ["kind", src.kind],
    ["type", src.type || "—"],
    ["size", formatBytes(src.bytes)],
    ["mtime", formatTime(src.modified)],
  ]
  if (src.width && src.height) {
    rows.push(["dim", `${src.width} × ${src.height}`])
    rows.push(["aspect", (src.width / src.height).toFixed(3)])
  }
  const keyW = Math.max(...rows.map(([key]) => key.length))
  const body = rows.map(([key, value]) => `${key.padEnd(keyW)}    ${value}`).join("\n")
  el.textContent = `── file ${"─".repeat(Math.max(8, keyW + 4))}\n${body}`
}
