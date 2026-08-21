const cache = new Map<number, Float32Array>()

const gaussianTable = (size: number, sigma: number) => {
  const twoSigma2 = 2 * sigma * sigma
  const g = new Float64Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x, size - x)
      const dy = Math.min(y, size - y)
      g[y * size + x] = Math.exp(-(dx * dx + dy * dy) / twoSigma2)
    }
  }
  return g
}

class BinaryField {
  readonly bits: Uint8Array
  readonly energy: Float64Array
  private readonly size: number
  private readonly g: Float64Array

  constructor(size: number, g: Float64Array, bits?: Uint8Array, energy?: Float64Array) {
    this.size = size
    this.g = g
    this.bits = bits ?? new Uint8Array(size * size)
    this.energy = energy ?? new Float64Array(size * size)
  }

  clone(): BinaryField {
    return new BinaryField(this.size, this.g, this.bits.slice(), this.energy.slice())
  }

  private wrap(dx: number, dy: number): number {
    const size = this.size
    const x = ((dx % size) + size) % size
    const y = ((dy % size) + size) % size
    return this.g[y * size + x]!
  }

  addImpulse(index: number, sign: number): void {
    const size = this.size
    const px = index % size
    const py = (index / size) | 0
    const n = size * size
    for (let i = 0; i < n; i++) {
      const x = i % size
      const y = (i / size) | 0
      this.energy[i]! += sign * this.wrap(x - px, y - py)
    }
  }

  setBit(index: number, value: 0 | 1): void {
    if (this.bits[index] === value) return
    this.bits[index] = value
    this.addImpulse(index, value === 1 ? 1 : -1)
  }

  tightestCluster(): number {
    let best = -1
    let bestE = -Infinity
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i] && this.energy[i]! > bestE) {
        bestE = this.energy[i]!
        best = i
      }
    }
    return best
  }

  largestVoid(): number {
    let best = -1
    let bestE = Infinity
    for (let i = 0; i < this.bits.length; i++) {
      if (!this.bits[i] && this.energy[i]! < bestE) {
        bestE = this.energy[i]!
        best = i
      }
    }
    return best
  }
}

const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const generate = (size: number) => {
  const n = size * size
  const g = gaussianTable(size, 1.5)
  const field = new BinaryField(size, g)
  const rand = mulberry32(size * 9973 + 42)
  const initialOnes = Math.max(1, Math.round(n * 0.1))
  let placed = 0
  while (placed < initialOnes) {
    const i = (rand() * n) | 0
    if (!field.bits[i]) {
      field.setBit(i, 1)
      placed++
    }
  }

  for (let iter = 0; iter < n; iter++) {
    const cluster = field.tightestCluster()
    field.setBit(cluster, 0)
    const voidIndex = field.largestVoid()
    if (voidIndex === cluster) {
      field.setBit(cluster, 1)
      break
    }
    field.setBit(voidIndex, 1)
  }

  const ranks = new Float32Array(n)
  const prototype = field.clone()
  let ones = 0
  for (let i = 0; i < n; i++) if (prototype.bits[i]) ones++

  const shrinking = prototype.clone()
  for (let rank = ones - 1; rank >= 0; rank--) {
    const i = shrinking.tightestCluster()
    ranks[i] = rank
    shrinking.setBit(i, 0)
  }

  const growing = prototype.clone()
  for (let rank = ones; rank < n; rank++) {
    const i = growing.largestVoid()
    ranks[i] = rank
    growing.setBit(i, 1)
  }

  for (let i = 0; i < n; i++) ranks[i]! /= n
  return ranks
}

export const blueNoiseMap = (size = 64) => {
  const cached = cache.get(size)
  if (cached) return cached
  const map = generate(size)
  cache.set(size, map)
  return map
}

export const thresholdAt = (map: Float32Array, size: number, x: number, y: number) => {
  const mx = ((x % size) + size) % size
  const my = ((y % size) + size) % size
  return map[my * size + mx]!
}
