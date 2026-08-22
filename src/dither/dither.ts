import { clamp01, ColorImage, parseHexColor } from "./image.ts"
import { blueNoiseMap, thresholdAt } from "./blueNoise.ts"
import { MODES, bayerLevelFor, paletteColors, type ModeId, type Settings } from "./settings.ts"

type RGB = [number, number, number]
type KernelTap = { x: number; y: number; w: number }

export const generateBayer = (level: number) => {
  let size = 2
  let cells = new Float32Array([0, 2, 3, 1])
  for (let n = 0; n < level; n++) {
    const next = size * 2
    const out = new Float32Array(next * next)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = 4 * cells[y * size + x]!
        out[y * next + x] = v
        out[y * next + (x + size)] = v + 2
        out[(y + size) * next + x] = v + 3
        out[(y + size) * next + (x + size)] = v + 1
      }
    }
    cells = out
    size = next
  }
  const denom = size * size
  for (let i = 0; i < cells.length; i++) cells[i]! /= denom
  return cells
}

export const bayerSize = (level: number) => 2 << level

const dist2 = (a: RGB, b: RGB) => {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return dr * dr + dg * dg + db * db
}

const clampRgb = (c: RGB): RGB => [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])]

const nearest = (palette: RGB[], c: RGB): RGB => {
  let best = palette[0]!
  let bestD = Infinity
  for (const p of palette) {
    const d = dist2(p, c)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

export const resolvePalette = (settings: Settings) => paletteColors(settings).map((hex) => parseHexColor(hex))

const downsample = (src: ColorImage, coarse: number) => {
  if (coarse <= 1) return src
  const w = Math.ceil(src.width / coarse)
  const h = Math.ceil(src.height / coarse)
  const out = new ColorImage(w, h)
  for (let by = 0; by < h; by++) {
    const y0 = by * coarse
    const y1 = Math.min(y0 + coarse, src.height)
    for (let bx = 0; bx < w; bx++) {
      const x0 = bx * coarse
      const x1 = Math.min(x0 + coarse, src.width)
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * src.width + x) * 3
          r += src.data[i]!
          g += src.data[i + 1]!
          b += src.data[i + 2]!
          n++
        }
      }
      const o = (by * w + bx) * 3
      out.data[o] = r / n
      out.data[o + 1] = g / n
      out.data[o + 2] = b / n
    }
  }
  return out
}

const upsample = (src: ColorImage, width: number, height: number, coarse: number) => {
  if (coarse <= 1) return src
  const out = new ColorImage(width, height)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, (y / coarse) | 0)
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, (x / coarse) | 0)
      const i = (y * width + x) * 3
      const j = (sy * src.width + sx) * 3
      out.data[i] = src.data[j]!
      out.data[i + 1] = src.data[j + 1]!
      out.data[i + 2] = src.data[j + 2]!
    }
  }
  return out
}

const write = (img: ColorImage, x: number, y: number, c: RGB) => {
  const i = (y * img.width + x) * 3
  img.data[i] = c[0]
  img.data[i + 1] = c[1]
  img.data[i + 2] = c[2]
}

const read = (img: ColorImage, x: number, y: number): RGB => {
  const i = (y * img.width + x) * 3
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]
}

const add = (img: ColorImage, x: number, y: number, err: RGB, w: number) => {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  const i = (y * img.width + x) * 3
  img.data[i]! += err[0] * w
  img.data[i + 1]! += err[1] * w
  img.data[i + 2]! += err[2] * w
}

const orderedDither = (img: ColorImage, palette: RGB[], threshold: (x: number, y: number) => number) => {
  const spread = palette.length > 1 ? 1 / (palette.length - 1) : 0.5
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = read(img, x, y)
      const t = threshold(x, y)
      write(img, x, y, nearest(palette, [c[0] + (t - 0.5) * spread, c[1] + (t - 0.5) * spread, c[2] + (t - 0.5) * spread]))
    }
  }
}

const SIMPLE: KernelTap[] = [
  { x: 1, y: 0, w: 0.5 },
  { x: 0, y: 1, w: 0.5 },
]

const FLOYD_STEINBERG: KernelTap[] = [
  { x: 1, y: 0, w: 7 / 16 },
  { x: -1, y: 1, w: 3 / 16 },
  { x: 0, y: 1, w: 5 / 16 },
  { x: 1, y: 1, w: 1 / 16 },
]

const errorDiffuse = (img: ColorImage, palette: RGB[], kernel: KernelTap[]) => {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const sample = clampRgb(read(img, x, y))
      const pick = nearest(palette, sample)
      write(img, x, y, pick)
      const err: RGB = [sample[0] - pick[0], sample[1] - pick[1], sample[2] - pick[2]]
      for (const tap of kernel) add(img, x + tap.x, y + tap.y, err, tap.w)
    }
  }
}

const ditherFine = (img: ColorImage, settings: Settings, palette: RGB[]) => {
  const { mode } = settings
  const bayerLevel = bayerLevelFor(mode)
  if (bayerLevel !== null) {
    const map = generateBayer(bayerLevel)
    const size = bayerSize(bayerLevel)
    orderedDither(img, palette, (x, y) => thresholdAt(map, size, x, y))
    return
  }
  if (mode === "blue-noise") {
    const map = blueNoiseMap(64)
    orderedDither(img, palette, (x, y) => thresholdAt(map, 64, x, y))
    return
  }
  if (mode === "simple-ed") {
    errorDiffuse(img, palette, SIMPLE)
    return
  }
  errorDiffuse(img, palette, FLOYD_STEINBERG)
}

export const applyDither = (src: ColorImage, settings: Settings) => {
  const coarse = Math.max(1, settings.coarseness)
  const palette = resolvePalette(settings)
  const work = downsample(src, coarse).clone()
  ditherFine(work, settings, palette)
  return upsample(work, src.width, src.height, coarse)
}

/** Circular fade to the primary color. Radius/softness are in inscribed-square NDC: 1 is mid-edge. */
export const applyCircularVignette = (
  img: ColorImage,
  radius: number,
  softness: number,
  strength: number,
  background: RGB = [0, 0, 0],
) => {
  const w = img.width
  const h = img.height
  const square = Math.min(w, h)
  const outer = radius + Math.max(1e-4, softness)
  const span = outer - radius
  for (let y = 0; y < h; y++) {
    const py = (((y + 0.5) / h) * 2 - 1) * (h / square)
    for (let x = 0; x < w; x++) {
      const px = (((x + 0.5) / w) * 2 - 1) * (w / square)
      const r = Math.hypot(px, py)
      let t = (r - radius) / span
      t = t < 0 ? 0 : t > 1 ? 1 : t
      t = t * t * (3 - 2 * t) * strength
      const i = (y * w + x) * 3
      img.data[i] += (background[0] - img.data[i]!) * t
      img.data[i + 1] += (background[1] - img.data[i + 1]!) * t
      img.data[i + 2] += (background[2] - img.data[i + 2]!) * t
    }
  }
  return img
}

export const modeLabel = (mode: ModeId) => MODES.find((item) => item.id === mode)?.label ?? mode
