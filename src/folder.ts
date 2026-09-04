export type FolderFile = {
  file: File
  path: string
}

const posix = (path: string) => path.replaceAll("\\", "/")

export const filesFromList = (list: Iterable<File>): FolderFile[] => {
  const out: FolderFile[] = []
  for (const file of list) {
    const rel = file.webkitRelativePath || file.name
    out.push({ file, path: posix(rel) })
  }
  return out
}

type Entry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file: (ok: (file: File) => void, err?: (error: DOMException) => void) => void
  createReader: () => {
    readEntries: (ok: (entries: Entry[]) => void, err?: (error: DOMException) => void) => void
  }
}

const asEntry = (item: DataTransferItem): Entry | null => {
  const extra = item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }
  return (extra.webkitGetAsEntry?.() as Entry | null | undefined) ?? null
}

const readFile = (entry: Entry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject))

const readAllEntries = async (reader: ReturnType<Entry["createReader"]>) => {
  const all: Entry[] = []
  for (;;) {
    const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) break
    all.push(...batch)
  }
  return all
}

const walkEntry = async (entry: Entry, out: FolderFile[], path: string) => {
  if (entry.isFile) {
    out.push({ file: await readFile(entry), path })
    return
  }
  if (!entry.isDirectory) return
  const children = await readAllEntries(entry.createReader())
  for (const child of children) await walkEntry(child, out, `${path}/${child.name}`)
}

export const filesFromDataTransfer = async (dt: DataTransfer): Promise<FolderFile[]> => {
  const entries = [...dt.items].map(asEntry).filter((entry): entry is Entry => entry !== null)
  if (entries.length) {
    const out: FolderFile[] = []
    for (const entry of entries) await walkEntry(entry, out, entry.name)
    return out
  }
  return filesFromList(dt.files)
}
