import * as THREE from "three"
import { fibonacciPoint, fibonacciSphere, slotForNumber } from "./fibonacciSphere.ts"

export type MethodId = "cyclic" | "polar" | "greedy" | "optimal" | "squared"

export type MethodInfo = {
  id: MethodId
  label: string
  hint: string
  heavy?: boolean
}

export const METHODS: MethodInfo[] = [
  {
    id: "cyclic",
    label: "Cyclic order",
    hint: "Keep numerical order: the pick becomes 1, the next number becomes 2, and so on.",
  },
  {
    id: "polar",
    label: "Polar rank",
    hint: "Match by distance from the new center, then twist the lattice so longitudes line up.",
  },
  {
    id: "greedy",
    label: "Greedy nearest",
    hint: "Repeatedly pair the closest remaining point and slot, searching over lattice twist.",
  },
  {
    id: "optimal",
    label: "Min total travel",
    hint: "Hungarian assignment: least total geodesic angle, searching over lattice twist.",
    heavy: true,
  },
  {
    id: "squared",
    label: "Min squared travel",
    hint: "Same as min total travel, but the cost is angle² — one long hop costs more than two medium ones.",
    heavy: true,
  },
]

export const OPTIMAL_MAX = 220

export type Metrics = {
  meanDeg: number
  maxDeg: number
  crossings: number
  twistDeg: number
}

export type Assignment = {
  targets: Float32Array
  metrics: Metrics
}

const poleSlot = (count: number) => slotForNumber(1, count)

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpC = new THREE.Vector3()
const tmpD = new THREE.Vector3()
const tmpN1 = new THREE.Vector3()
const tmpN2 = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpTwist = new THREE.Quaternion()
const tmpAxis = new THREE.Vector3()
const tmpPole = new THREE.Vector3()
const tmpLocal = new THREE.Vector3()
const tmpX = new THREE.Vector3()
const tmpY = new THREE.Vector3()
const tmpRef = new THREE.Vector3()

const read = (buf: Float32Array, i: number, out: THREE.Vector3) =>
  out.set(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2])

const write = (buf: Float32Array, i: number, v: THREE.Vector3) => {
  buf[i * 3] = v.x
  buf[i * 3 + 1] = v.y
  buf[i * 3 + 2] = v.z
}

const clampDot = (d: number) => Math.min(1, Math.max(-1, d))

const angleBetween = (a: THREE.Vector3, b: THREE.Vector3) => {
  const la = a.length()
  const lb = b.length()
  if (la < 1e-12 || lb < 1e-12) return 0
  return Math.acos(clampDot(a.dot(b) / (la * lb)))
}

type PairCost = (a: THREE.Vector3, b: THREE.Vector3) => number

const angleCost: PairCost = (a, b) => angleBetween(a, b)

const squaredCost: PairCost = (a, b) => {
  const t = angleBetween(a, b)
  return t * t
}

const samePoint = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceToSquared(b) < 1e-10

const shortArcsCross = (
  a0: THREE.Vector3,
  a1: THREE.Vector3,
  b0: THREE.Vector3,
  b1: THREE.Vector3,
) => {
  if (samePoint(a0, b1) && samePoint(a1, b0)) return true
  if (samePoint(a0, b0) || samePoint(a0, b1) || samePoint(a1, b0) || samePoint(a1, b1)) {
    return false
  }

  tmpN1.crossVectors(a0, a1)
  tmpN2.crossVectors(b0, b1)
  if (tmpN1.lengthSq() < 1e-14 || tmpN2.lengthSq() < 1e-14) return false

  const s1 = Math.sign(tmpN1.dot(b0))
  const s2 = Math.sign(tmpN1.dot(b1))
  const s3 = Math.sign(tmpN2.dot(a0))
  const s4 = Math.sign(tmpN2.dot(a1))
  return s1 * s2 < 0 && s3 * s4 < 0
}

const countCrossings = (from: Float32Array, to: Float32Array, count: number) => {
  const starts: THREE.Vector3[] = []
  const ends: THREE.Vector3[] = []

  for (let i = 0; i < count; i++) {
    const a = read(from, i, new THREE.Vector3()).normalize()
    const b = read(to, i, new THREE.Vector3()).normalize()
    if (angleBetween(a, b) < 1e-4) continue
    starts.push(a)
    ends.push(b)
  }

  let crossings = 0
  for (let i = 0; i < starts.length; i++) {
    for (let j = i + 1; j < starts.length; j++) {
      if (shortArcsCross(starts[i], ends[i], starts[j], ends[j])) crossings++
    }
  }
  return crossings
}

const travelMetrics = (from: Float32Array, to: Float32Array, count: number, twist: number) => {
  let sum = 0
  let max = 0
  for (let i = 0; i < count; i++) {
    const deg = angleBetween(read(from, i, tmpA), read(to, i, tmpB)) * (180 / Math.PI)
    sum += deg
    if (deg > max) max = deg
  }
  return {
    meanDeg: sum / count,
    maxDeg: max,
    crossings: countCrossings(from, to, count),
    twistDeg: ((twist * 180) / Math.PI + 360) % 360,
  }
}

const latticeRotation = (count: number, pole: THREE.Vector3, twist: number) => {
  const localPole = fibonacciPoint(poleSlot(count), count)
  tmpLocal.set(localPole[0], localPole[1], localPole[2]).normalize()
  tmpPole.copy(pole).normalize()
  tmpQ.setFromUnitVectors(tmpLocal, tmpPole)
  tmpTwist.setFromAxisAngle(tmpAxis.copy(tmpPole), twist)
  return tmpQ.premultiply(tmpTwist)
}

export const orientSlots = (
  count: number,
  radius: number,
  pole: THREE.Vector3,
  twist: number,
) => {
  const local = fibonacciSphere(count, radius)
  const q = latticeRotation(count, pole, twist)
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    tmpA.set(local[i * 3], local[i * 3 + 1], local[i * 3 + 2]).applyQuaternion(q)
    write(out, i, tmpA)
  }
  return out
}

export const orientedSpiral = (
  count: number,
  radius: number,
  pole: THREE.Vector3,
  twist: number,
) => {
  const q = latticeRotation(count, pole, twist)
  const segs = count > 400 ? 8 : 20
  const samples = (count - 1) * segs + 1
  const out = new Float32Array(samples * 3)
  let w = 0
  for (let n = 0; n < count - 1; n++) {
    const i0 = count - 1 - n
    const i1 = i0 - 1
    for (let s = 0; s < segs; s++) {
      const point = fibonacciPoint(i0 + (i1 - i0) * (s / segs), count, radius)
      tmpA.set(point[0], point[1], point[2]).applyQuaternion(q)
      write(out, w++, tmpA)
    }
  }
  const last = fibonacciPoint(0, count, radius)
  tmpA.set(last[0], last[1], last[2]).applyQuaternion(q)
  write(out, w, tmpA)
  return out
}

const basisAround = (pole: THREE.Vector3) => {
  tmpRef.set(0, 1, 0)
  if (Math.abs(pole.y) > 0.9) tmpRef.set(1, 0, 0)
  tmpX.crossVectors(tmpRef, pole).normalize()
  tmpY.crossVectors(pole, tmpX).normalize()
}

const azimuthOf = (p: THREE.Vector3) => Math.atan2(p.dot(tmpY), p.dot(tmpX))

const remainingPoints = (count: number, center: number) => {
  const ids = new Array<number>(count - 1)
  let k = 0
  for (let i = 0; i < count; i++) if (i !== center) ids[k++] = i
  return ids
}

const remainingSlots = (count: number) => {
  const pole = poleSlot(count)
  const ids = new Array<number>(count - 1)
  let k = 0
  for (let s = 0; s < count; s++) if (s !== pole) ids[k++] = s
  return ids
}

const applyMap = (
  count: number,
  center: number,
  slots: Float32Array,
  pointToSlot: number[],
) => {
  const targets = new Float32Array(count * 3)
  write(targets, center, read(slots, poleSlot(count), tmpA))
  const points = remainingPoints(count, center)
  for (let i = 0; i < points.length; i++) {
    write(targets, points[i], read(slots, pointToSlot[i], tmpA))
  }
  return targets
}

const cyclicMap = (count: number, center: number) => {
  const points = remainingPoints(count, center)
  const map = new Array<number>(points.length)
  const centerNum = center + 1
  for (let i = 0; i < points.length; i++) {
    const num = points[i] + 1
    const newNum = ((num - centerNum + count) % count) + 1
    map[i] = slotForNumber(newNum, count)
  }
  return map
}

const polarMap = (positions: Float32Array, count: number, center: number, slots: Float32Array) => {
  const pole = read(positions, center, tmpPole).normalize()
  const points = remainingPoints(count, center)
  const slotIds = remainingSlots(count)

  const pointRank = points
    .map((i) => ({ i, a: angleBetween(read(positions, i, tmpA), pole) }))
    .sort((a, b) => a.a - b.a)

  const slotRank = slotIds
    .map((s) => ({ s, a: angleBetween(read(slots, s, tmpB), pole) }))
    .sort((a, b) => a.a - b.a)

  const slotOfPoint = new Map<number, number>()
  for (let r = 0; r < pointRank.length; r++) {
    slotOfPoint.set(pointRank[r].i, slotRank[r].s)
  }
  return points.map((i) => slotOfPoint.get(i)!)
}

const polarTwist = (
  positions: Float32Array,
  count: number,
  center: number,
  slots: Float32Array,
  map: number[],
) => {
  const pole = read(positions, center, tmpC).normalize()
  basisAround(pole)
  const points = remainingPoints(count, center)
  let sx = 0
  let sy = 0
  for (let i = 0; i < points.length; i++) {
    const d = azimuthOf(read(positions, points[i], tmpA)) - azimuthOf(read(slots, map[i], tmpB))
    sx += Math.cos(d)
    sy += Math.sin(d)
  }
  return Math.atan2(sy, sx)
}

const greedyMap = (cost: number[], n: number) => {
  const pairs = new Array<{ i: number; j: number; c: number }>(n * n)
  let k = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pairs[k++] = { i, j, c: cost[i * n + j] }
    }
  }
  pairs.sort((a, b) => a.c - b.c)

  const usedI = new Uint8Array(n)
  const usedJ = new Uint8Array(n)
  const map = new Array<number>(n)
  let left = n
  for (const pair of pairs) {
    if (usedI[pair.i] || usedJ[pair.j]) continue
    usedI[pair.i] = 1
    usedJ[pair.j] = 1
    map[pair.i] = pair.j
    if (--left === 0) break
  }
  return map
}

/** Min-cost assignment via potentials (cp-algorithms Hungarian). */
const hungarian = (cost: number[], n: number) => {
  const u = new Float64Array(n + 1)
  const v = new Float64Array(n + 1)
  const p = new Int32Array(n + 1)
  const way = new Int32Array(n + 1)
  const minv = new Float64Array(n + 1)
  const used = new Uint8Array(n + 1)

  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    minv.fill(Infinity)
    used.fill(0)
    do {
      used[j0] = 1
      const i0 = p[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue
        const cur = cost[(i0 - 1) * n + (j - 1)] - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }

  const map = new Array<number>(n)
  for (let j = 1; j <= n; j++) {
    if (p[j] > 0) map[p[j] - 1] = j - 1
  }
  return map
}

const fillCost = (
  positions: Float32Array,
  slots: Float32Array,
  points: number[],
  slotIds: number[],
  cost: number[],
  pair: PairCost,
) => {
  const n = points.length
  for (let i = 0; i < n; i++) {
    read(positions, points[i], tmpA)
    for (let j = 0; j < n; j++) {
      cost[i * n + j] = pair(tmpA, read(slots, slotIds[j], tmpB))
    }
  }
}

const resolveSlotMap = (indexMap: number[], slotIds: number[]) =>
  indexMap.map((j) => slotIds[j])

const mapCost = (
  positions: Float32Array,
  slots: Float32Array,
  points: number[],
  map: number[],
  pair: PairCost,
) => {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    sum += pair(read(positions, points[i], tmpA), read(slots, map[i], tmpB))
  }
  return sum
}

const searchTwist = (
  samples: number,
  refine: number,
  evaluate: (twist: number) => number,
) => {
  let best = 0
  let bestCost = Infinity
  for (let i = 0; i < samples; i++) {
    const twist = (i / samples) * Math.PI * 2
    const cost = evaluate(twist)
    if (cost < bestCost) {
      bestCost = cost
      best = twist
    }
  }
  const window = (Math.PI * 2) / samples
  for (let i = 0; i < refine; i++) {
    const twist = best - window + (i / Math.max(refine - 1, 1)) * 2 * window
    const cost = evaluate(twist)
    if (cost < bestCost) {
      bestCost = cost
      best = twist
    }
  }
  return ((best % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
}

const buildTargets = (
  positions: Float32Array,
  count: number,
  center: number,
  radius: number,
  twist: number,
  mapForSlots: (slots: Float32Array) => number[],
) => {
  const pole = read(positions, center, tmpD).clone()
  const slots = orientSlots(count, radius, pole, twist)
  const map = mapForSlots(slots)
  return applyMap(count, center, slots, map)
}

export const reassign = (options: {
  positions: Float32Array
  count: number
  center: number
  method: MethodId
  radius: number
  twist?: number
}): Assignment => {
  const { positions, count, center, method, radius } = options
  if (count <= 1) {
    return {
      targets: positions.slice(),
      metrics: { meanDeg: 0, maxDeg: 0, crossings: 0, twistDeg: 0 },
    }
  }

  const pole = read(positions, center, tmpD).clone()
  const points = remainingPoints(count, center)
  const slotIds = remainingSlots(count)
  const n = points.length
  const cost = new Array<number>(n * n)

  let twist = options.twist
  let map: number[]

  if (method === "cyclic") {
    map = cyclicMap(count, center)
    if (twist === undefined) {
      twist = searchTwist(48, 16, (t) => {
        const slots = orientSlots(count, radius, pole, t)
        return mapCost(positions, slots, points, map, angleCost)
      })
    }
  } else if (method === "polar") {
    const aligned = orientSlots(count, radius, pole, 0)
    map = polarMap(positions, count, center, aligned)
    twist ??= polarTwist(positions, count, center, aligned, map)
  } else if (method === "greedy") {
    const assignAt = (t: number) => {
      const slots = orientSlots(count, radius, pole, t)
      fillCost(positions, slots, points, slotIds, cost, angleCost)
      return resolveSlotMap(greedyMap(cost, n), slotIds)
    }
    if (twist === undefined) {
      twist = searchTwist(32, 12, (t) => {
        const slots = orientSlots(count, radius, pole, t)
        const next = assignAt(t)
        return mapCost(positions, slots, points, next, angleCost)
      })
    }
    map = assignAt(twist)
  } else {
    if (count > OPTIMAL_MAX) {
      return reassign({ ...options, method: "greedy" })
    }
    const pair = method === "squared" ? squaredCost : angleCost
    const assignAt = (t: number) => {
      const slots = orientSlots(count, radius, pole, t)
      fillCost(positions, slots, points, slotIds, cost, pair)
      return resolveSlotMap(hungarian(cost, n), slotIds)
    }
    if (twist === undefined) {
      twist = searchTwist(14, 8, (t) => {
        const slots = orientSlots(count, radius, pole, t)
        const next = assignAt(t)
        return mapCost(positions, slots, points, next, pair)
      })
    }
    map = assignAt(twist)
  }

  const targets = buildTargets(positions, count, center, radius, twist, () => map)
  return {
    targets,
    metrics: travelMetrics(positions, targets, count, twist),
  }
}
