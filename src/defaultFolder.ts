import type { FolderFile } from "./folder.ts"

export type DemoEntry = {
  path: string
  type: string
  modified: number
}

type Manifest = {
  files: DemoEntry[]
}

const encodeSeg = (seg: string) => encodeURIComponent(seg).replaceAll("%3D", "=")

const demoUrl = (path: string) => `/demo/${path.split("/").map(encodeSeg).join("/")}`

const isHtml = (type: string) => type.includes("text/html")

export const loadDemoIndex = async (): Promise<DemoEntry[]> => {
  const res = await fetch("/demo/manifest.json")
  if (!res.ok || isHtml(res.headers.get("content-type") ?? "")) return []
  const manifest = (await res.json()) as Manifest
  return Array.isArray(manifest.files) ? manifest.files : []
}

export const fetchDemoFile = async (entry: DemoEntry): Promise<FolderFile | null> => {
  const res = await fetch(demoUrl(entry.path))
  const mime = res.headers.get("content-type") ?? ""
  if (!res.ok || isHtml(mime)) return null
  const blob = await res.blob()
  if (isHtml(blob.type)) return null
  const name = entry.path.split("/").pop() ?? "file"
  const type = entry.type.startsWith("image/") ? entry.type : blob.type
  return {
    file: new File([blob], name, { type, lastModified: entry.modified }),
    path: entry.path,
  }
}
