const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789░▒▓█#/\\|+<>*"
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA"])

const hash = (i: number, salt: number) => {
  let x = Math.imul((i + 1) ^ (salt + 1), 1597334677)
  x = Math.imul(x ^ (x >>> 16), 2246822507)
  x = Math.imul(x ^ (x >>> 13), 3266489909)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

type Glyph = { node: Text; original: string }

const collect = (root: HTMLElement, out: Glyph[]) => {
  const walk = (n: Node) => {
    if (n instanceof HTMLElement && (SKIP.has(n.tagName) || n.dataset.scramble === "off")) return
    if (n.nodeType === Node.TEXT_NODE) {
      const original = n.nodeValue ?? ""
      if (!original) return
      out.push({ node: n as Text, original })
      return
    }
    n.childNodes.forEach(walk)
  }
  walk(root)
}

const mix = (from: string, to: string, amount: number, tick: number) => {
  const oldLines = from.split("\n")
  const newLines = to.split("\n")
  return newLines
    .map((line, row) => {
      const prev = oldLines[row] ?? ""
      let out = ""
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!
        if (prev[i] === ch || amount <= 0 || ch === " ") {
          out += ch
          continue
        }
        const id = row * 131 + i
        if (hash(id, tick) < amount) out += GLYPHS[(hash(id, tick + 19) * GLYPHS.length) | 0]!
        else out += ch
      }
      return out
    })
    .join("\n")
}

export const createScramble = (roots: HTMLElement[]) => {
  let glyphs: Glyph[] = []
  let from = ""
  let to = ""
  let amount = 0
  let tick = 0
  let lastTick = 0

  const capture = () => {
    glyphs = []
    for (const root of roots) collect(root, glyphs)
  }

  const read = () => glyphs.map((g) => g.original).join("\n")

  const restore = () => {
    for (const g of glyphs) {
      if (g.node.isConnected) g.node.nodeValue = g.original
    }
  }

  const paint = () => {
    if (!glyphs.length) return
    const mixed = mix(from, to, amount, tick)
    const parts = mixed.split("\n")
    let offset = 0
    for (const g of glyphs) {
      if (!g.node.isConnected) continue
      const lines = g.original.split("\n").length
      g.node.nodeValue = parts.slice(offset, offset + lines).join("\n")
      offset += lines
    }
  }

  return {
    invalidate() {
      capture()
      const next = read()
      if (next === to) {
        if (amount > 0) paint()
        return
      }
      from = to
      to = next
      amount = from ? 1 : 0
      if (amount > 0) paint()
    },
    step(now: number, dt: number) {
      if (amount <= 0) return
      amount = Math.max(0, amount - 5.4 * dt)
      if (now - lastTick >= 28) {
        tick++
        lastTick = now
      }
      if (amount <= 0) restore()
      else paint()
    },
  }
}
