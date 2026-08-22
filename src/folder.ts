export type TreeNode = {
  name: string
  path: string
  kind: "dir" | "file"
  file?: File
  children?: TreeNode[]
}

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

const sortNodes = (nodes: TreeNode[]) => {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  })
  for (const node of nodes) if (node.children) sortNodes(node.children)
}

export const treeFromFiles = (files: FolderFile[]): TreeNode | null => {
  if (!files.length) return null
  const root: TreeNode = { name: "", path: "", kind: "dir", children: [] }
  for (const { file, path } of files) {
    const parts = posix(path).split("/").filter(Boolean)
    if (!parts.length) continue
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!
      const childPath = parts.slice(0, i + 1).join("/")
      const isFile = i === parts.length - 1
      node.children ??= []
      let child = node.children.find((item) => item.name === name)
      if (!child) {
        child = isFile
          ? { name, path: childPath, kind: "file", file }
          : { name, path: childPath, kind: "dir", children: [] }
        node.children.push(child)
      } else if (isFile) {
        child.file = file
        child.kind = "file"
      }
      node = child
    }
  }
  if (root.children) sortNodes(root.children)
  if (root.children?.length === 1 && root.children[0]!.kind === "dir") return root.children[0]!
  root.name = "."
  return root
}

export const findFile = (node: TreeNode | null, path: string): TreeNode | null => {
  if (!node) return null
  if (node.path === path) return node
  for (const child of node.children ?? []) {
    const hit = findFile(child, path)
    if (hit) return hit
  }
  return null
}

export const renderTree = (
  root: TreeNode | null,
  mount: HTMLElement,
  focusedPath: string | null,
  onSelect: (node: TreeNode) => void,
) => {
  mount.replaceChildren()
  if (!root) {
    const hint = document.createElement("p")
    hint.className = "tree-hint"
    hint.textContent = "Open a folder to list files."
    mount.append(hint)
    return
  }

  const addRow = (node: TreeNode, prefix: string, isLast: boolean, isRoot: boolean) => {
    const row = document.createElement("button")
    row.type = "button"
    row.className = "tree-row"
    if (node.kind === "dir") row.classList.add("is-dir")
    if (node.kind === "file" && node.path === focusedPath) row.classList.add("is-focus")
    row.title = node.path || node.name

    const guide = document.createElement("span")
    guide.className = "tree-guide"
    guide.textContent = isRoot ? "" : `${prefix}${isLast ? "└── " : "├── "}`

    const name = document.createElement("span")
    name.className = "tree-name"
    name.textContent = node.kind === "dir" ? `${node.name}/` : node.name

    row.append(guide, name)
    if (node.kind === "file") row.addEventListener("click", () => onSelect(node))
    else row.tabIndex = -1
    mount.append(row)

    const kids = node.children ?? []
    const nextPrefix = isRoot ? "" : `${prefix}${isLast ? "    " : "│   "}`
    kids.forEach((child, i) => addRow(child, nextPrefix, i === kids.length - 1, false))
  }

  addRow(root, "", true, true)
}
