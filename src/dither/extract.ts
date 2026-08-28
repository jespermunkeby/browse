import { clamp01, parseHexColor } from "./image.ts"
import { MAX_PALETTE, MIN_IMAGE_PALETTE, type PaletteStrategyId } from "./settings.ts"

export type RGB = [number, number, number]

const SAMPLE = 96

const canvas = document.createElement("canvas")
const ctx = canvas.getContext("2d", { willReadFrequently: true })!

const dist2 = (a: RGB, b: RGB) => {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return dr * dr + dg * dg + db * db
}

export const rgbToHex = (c: RGB) => {
  const h = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`
}

export const hexToRgb = (hex: string): RGB => parseHexColor(hex)

const cloneRgb = (c: RGB): RGB => [c[0], c[1], c[2]]

const luma = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

const chroma = (c: RGB) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])

const toLin = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4)
const toSrgb = (u: number) => (u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055)

const average = (pixels: RGB[]): RGB => {
  let r = 0
  let g = 0
  let b = 0
  for (const p of pixels) {
    r += p[0]
    g += p[1]
    b += p[2]
  }
  const n = Math.max(1, pixels.length)
  return [r / n, g / n, b / n]
}

const longestChannel = (pixels: RGB[]) => {
  let minR = 1
  let maxR = 0
  let minG = 1
  let maxG = 0
  let minB = 1
  let maxB = 0
  for (const p of pixels) {
    minR = Math.min(minR, p[0])
    maxR = Math.max(maxR, p[0])
    minG = Math.min(minG, p[1])
    maxG = Math.max(maxG, p[1])
    minB = Math.min(minB, p[2])
    maxB = Math.max(maxB, p[2])
  }
  const ranges: RGB = [maxR - minR, maxG - minG, maxB - minB]
  if (ranges[0] >= ranges[1] && ranges[0] >= ranges[2]) return 0
  if (ranges[1] >= ranges[2]) return 1
  return 2
}

const rangeScore = (pixels: RGB[]) => {
  if (pixels.length <= 1) return 0
  let minR = 1
  let maxR = 0
  let minG = 1
  let maxG = 0
  let minB = 1
  let maxB = 0
  for (const p of pixels) {
    minR = Math.min(minR, p[0])
    maxR = Math.max(maxR, p[0])
    minG = Math.min(minG, p[1])
    maxG = Math.max(maxG, p[1])
    minB = Math.min(minB, p[2])
    maxB = Math.max(maxB, p[2])
  }
  return Math.max(maxR - minR, maxG - minG, maxB - minB) * pixels.length
}

const medianCut = (pixels: RGB[], count: number) => {
  const buckets = [pixels]
  while (buckets.length < count) {
    let splitAt = -1
    let best = 0
    for (let i = 0; i < buckets.length; i++) {
      const score = rangeScore(buckets[i]!)
      if (score > best) {
        best = score
        splitAt = i
      }
    }
    if (splitAt < 0 || best === 0) break
    const bucket = buckets[splitAt]!
    const ch = longestChannel(bucket)
    bucket.sort((a, b) => a[ch] - b[ch])
    const mid = Math.max(1, bucket.length >> 1)
    buckets.splice(splitAt, 1, bucket.slice(0, mid), bucket.slice(mid))
  }
  return buckets.filter((bucket) => bucket.length > 0).map(average)
}

const refine = (pixels: RGB[], centroids: RGB[], rounds: number) => {
  for (let round = 0; round < rounds; round++) {
    const groups = centroids.map(() => [] as RGB[])
    for (const p of pixels) {
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < centroids.length; i++) {
        const d = dist2(p, centroids[i]!)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      groups[best]!.push(p)
    }
    for (let i = 0; i < centroids.length; i++) {
      const group = groups[i]!
      if (group.length) centroids[i] = average(group)
    }
  }
  return centroids
}

const lumaSeeds = (pixels: RGB[], count: number) => {
  const ranked = pixels.slice().sort((a, b) => luma(a) - luma(b))
  const last = ranked.length - 1
  const seeds: RGB[] = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1)
    seeds.push(cloneRgb(ranked[Math.round(t * last)]!))
  }
  return seeds
}

const lumaBands = (pixels: RGB[], count: number) => {
  const ranked = pixels.slice().sort((a, b) => luma(a) - luma(b))
  const out: RGB[] = []
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * ranked.length) / count)
    const end = Math.max(start + 1, Math.floor(((i + 1) * ranked.length) / count))
    out.push(average(ranked.slice(start, end)))
  }
  return out
}

const greedyPick = (candidates: { rgb: RGB; score: number }[], count: number) => {
  const ranked = candidates.slice().sort((a, b) => b.score - a.score)
  const picked: RGB[] = []
  let minD = 0.05
  while (picked.length < count && minD > 0.0015) {
    for (const item of ranked) {
      if (picked.length >= count) break
      if (picked.some((c) => dist2(c, item.rgb) < minD)) continue
      picked.push(item.rgb)
    }
    minD *= 0.45
  }
  if (picked.length < count) {
    for (const band of lumaBands(
      ranked.map((item) => item.rgb),
      count,
    )) {
      if (picked.length >= count) break
      if (picked.some((c) => dist2(c, band) < 0.002)) continue
      picked.push(band)
    }
  }
  return picked
}

const dominantColors = (pixels: RGB[], count: number) => {
  const buckets = new Map<number, { sum: RGB; n: number }>()
  for (const p of pixels) {
    const r = Math.round(p[0] * 15)
    const g = Math.round(p[1] * 15)
    const b = Math.round(p[2] * 15)
    const key = (r << 8) | (g << 4) | b
    const slot = buckets.get(key)
    if (slot) {
      slot.sum[0] += p[0]
      slot.sum[1] += p[1]
      slot.sum[2] += p[2]
      slot.n++
    } else {
      buckets.set(key, { sum: cloneRgb(p), n: 1 })
    }
  }
  const candidates = [...buckets.values()].map((slot) => ({
    rgb: [slot.sum[0] / slot.n, slot.sum[1] / slot.n, slot.sum[2] / slot.n] as RGB,
    score: slot.n,
  }))
  return greedyPick(candidates, count)
}

const vividColors = (pixels: RGB[], count: number) => {
  const buckets = new Map<number, { sum: RGB; n: number; chroma: number }>()
  for (const p of pixels) {
    const r = Math.round(p[0] * 15)
    const g = Math.round(p[1] * 15)
    const b = Math.round(p[2] * 15)
    const key = (r << 8) | (g << 4) | b
    const slot = buckets.get(key)
    if (slot) {
      slot.sum[0] += p[0]
      slot.sum[1] += p[1]
      slot.sum[2] += p[2]
      slot.n++
      slot.chroma += chroma(p)
    } else {
      buckets.set(key, { sum: cloneRgb(p), n: 1, chroma: chroma(p) })
    }
  }
  const candidates = [...buckets.values()].map((slot) => {
    const rgb: RGB = [slot.sum[0] / slot.n, slot.sum[1] / slot.n, slot.sum[2] / slot.n]
    return { rgb, score: (slot.chroma / slot.n) * Math.sqrt(slot.n) }
  })
  return greedyPick(candidates, count)
}

const samplePixels = (source: ImageBitmap) => {
  const scale = SAMPLE / Math.max(source.width, source.height, 1)
  const w = Math.max(1, Math.round(source.width * scale))
  const h = Math.max(1, Math.round(source.height * scale))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const pixels: RGB[] = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue
    pixels.push([data[i]! / 255, data[i + 1]! / 255, data[i + 2]! / 255])
  }
  return pixels
}

const uniqueSortedHexes = (colors: RGB[]) => {
  colors.sort((a, b) => luma(a) - luma(b))
  const hexes: string[] = []
  for (const c of colors) {
    const hex = rgbToHex(c)
    if (!hexes.includes(hex)) hexes.push(hex)
  }
  return hexes.length ? hexes : ["#000000", "#ffffff"]
}

export const extractPalette = (source: ImageBitmap, count: number, strategy: PaletteStrategyId) => {
  const n = Math.max(MIN_IMAGE_PALETTE, Math.min(count, MAX_PALETTE))
  const pixels = samplePixels(source)
  if (!pixels.length) return ["#000000", "#ffffff"]
  const colors =
    strategy === "k-means"
      ? refine(pixels, lumaSeeds(pixels, n), 12)
      : strategy === "dominant"
        ? dominantColors(pixels, n)
        : strategy === "vivid"
          ? vividColors(pixels, n)
          : strategy === "spread"
            ? lumaBands(pixels, n)
            : refine(pixels, medianCut(pixels, n), 4)
  return uniqueSortedHexes(colors)
}

export const remapPalette = (from: RGB[], toLen: number): RGB[] => {
  const n = Math.max(0, toLen)
  if (n <= 0) return []
  if (!from.length) return Array.from({ length: n }, () => [0, 0, 0] as RGB)
  if (from.length === n) return from.map(cloneRgb)
  const last = from.length - 1
  const out: RGB[] = []
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1)
    const x = t * last
    const j = Math.min(last, Math.floor(x))
    const f = x - j
    const a = from[j]!
    const b = from[Math.min(last, j + 1)]!
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
  }
  return out
}

const mixChannel = (a: number, b: number, k: number) => toSrgb(toLin(a) + (toLin(b) - toLin(a)) * k)

export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [
  mixChannel(a[0], b[0], t),
  mixChannel(a[1], b[1], t),
  mixChannel(a[2], b[2], t),
]

/** Blend `from` toward `to` at t in [0, 1]. */
export const mixPalette = (from: RGB[], to: RGB[], t: number): RGB[] => {
  if (!to.length) return []
  if (t <= 0) return (from.length === to.length ? from : remapPalette(from, to.length)).map(cloneRgb)
  if (t >= 1) return to.map(cloneRgb)
  const src = from.length === to.length ? from : remapPalette(from, to.length)
  return to.map((b, i) => mixRgb(src[i]!, b, t))
}
