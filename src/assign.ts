import * as THREE from "three"
import { createLapjvScratch, lapjv } from "./lapjv.ts"
import { COUNT, MAX_COUNT, SPHERE_RADIUS, writeUnitSlots } from "./lattice.ts"

const COARSE = 14
const REFINE = 8
const MAX_N = MAX_COUNT - 1
const SLOT_IDS = Array.from({ length: MAX_N }, (_, i) => i + 1)

export type Assignment = {
  targets: Float32Array
  ranks: Int32Array
  twist: number
}

const tmpPole = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const local = new Float32Array(MAX_COUNT * 3)
const aligned = new Float32Array(MAX_COUNT * 3)
const twisted = new Float32Array(MAX_COUNT * 3)
const pointDirs = new Float32Array(MAX_N * 3)
const cost = new Float64Array(MAX_N * MAX_N)
const assign = new Int32Array(MAX_N)
const bestAssign = new Int32Array(MAX_N)
const bestSlots = new Float32Array(MAX_COUNT * 3)
const jv = createLapjvScratch(MAX_N)
const pointIds = new Array<number>(MAX_N)
let packedCount = 0

const syncSlots = () => {
  if (packedCount === COUNT) return
  packedCount = COUNT
  writeUnitSlots(local)
}

const clampDot = (d: number) => (d < -1 ? -1 : d > 1 ? 1 : d)

const squaredAngleFromDot = (dot: number) => {
  const t = Math.acos(clampDot(dot))
  return t * t
}

const applyQuaternion = (buf: Float32Array, q: THREE.Quaternion) => {
  const v = tmpPole
  for (let i = 0; i < COUNT; i++) {
    v.set(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]).applyQuaternion(q)
    buf[i * 3] = v.x
    buf[i * 3 + 1] = v.y
    buf[i * 3 + 2] = v.z
  }
}

const alignToPole = (pole: THREE.Vector3, out: Float32Array) => {
  out.set(local)
  tmpPole.set(out[0], out[1], out[2]).normalize()
  tmpQ.setFromUnitVectors(tmpPole, pole)
  applyQuaternion(out, tmpQ)
}

const twistAroundPole = (src: Float32Array, pole: THREE.Vector3, twist: number, out: Float32Array) => {
  const { x: kx, y: ky, z: kz } = pole
  const c = Math.cos(twist)
  const s = Math.sin(twist)
  const w = 1 - c
  for (let i = 0; i < COUNT; i++) {
    const x = src[i * 3]
    const y = src[i * 3 + 1]
    const z = src[i * 3 + 2]
    const kdot = kx * x + ky * y + kz * z
    out[i * 3] = x * c + (ky * z - kz * y) * s + kx * kdot * w
    out[i * 3 + 1] = y * c + (kz * x - kx * z) * s + ky * kdot * w
    out[i * 3 + 2] = z * c + (kx * y - ky * x) * s + kz * kdot * w
  }
}

const fillSquaredCost = (n: number, slotIds: number[]) => {
  for (let i = 0; i < n; i++) {
    const px = pointDirs[i * 3]
    const py = pointDirs[i * 3 + 1]
    const pz = pointDirs[i * 3 + 2]
    const row = i * n
    for (let j = 0; j < n; j++) {
      const s = slotIds[j] * 3
      cost[row + j] = squaredAngleFromDot(px * twisted[s] + py * twisted[s + 1] + pz * twisted[s + 2])
    }
  }
}

const packPointDirs = (positions: Float32Array, pointIds: number[]) => {
  for (let i = 0; i < pointIds.length; i++) {
    const p = pointIds[i] * 3
    const x = positions[p]
    const y = positions[p + 1]
    const z = positions[p + 2]
    const inv = 1 / Math.hypot(x, y, z)
    pointDirs[i * 3] = x * inv
    pointDirs[i * 3 + 1] = y * inv
    pointDirs[i * 3 + 2] = z * inv
  }
}

const applyMap = (center: number, pointIds: number[], slotIds: number[]) => {
  const targets = new Float32Array(COUNT * 3)
  const ranks = new Int32Array(COUNT)
  ranks[center] = 0
  targets[center * 3] = bestSlots[0] * SPHERE_RADIUS
  targets[center * 3 + 1] = bestSlots[1] * SPHERE_RADIUS
  targets[center * 3 + 2] = bestSlots[2] * SPHERE_RADIUS
  for (let i = 0; i < pointIds.length; i++) {
    const id = pointIds[i]
    const slot = slotIds[assign[i]]
    ranks[id] = slot
    const p = id * 3
    const s = slot * 3
    targets[p] = bestSlots[s] * SPHERE_RADIUS
    targets[p + 1] = bestSlots[s + 1] * SPHERE_RADIUS
    targets[p + 2] = bestSlots[s + 2] * SPHERE_RADIUS
  }
  return { targets, ranks }
}

/** Min-squared-travel recenter: LAPJV on θ², 14+8 twist search. */
export const reassign = (positions: Float32Array, center: number): Assignment => {
  syncSlots()
  const n = COUNT - 1
  let k = 0
  for (let i = 0; i < COUNT; i++) if (i !== center) pointIds[k++] = i
  pointIds.length = n

  packPointDirs(positions, pointIds)
  const pole = new THREE.Vector3(
    positions[center * 3],
    positions[center * 3 + 1],
    positions[center * 3 + 2],
  ).normalize()
  alignToPole(pole, aligned)

  let bestCost = Infinity
  let bestTwist = 0

  const consider = (twist: number) => {
    twistAroundPole(aligned, pole, twist, twisted)
    fillSquaredCost(n, SLOT_IDS)
    const total = lapjv(cost, n, assign, jv)
    if (total < bestCost) {
      bestCost = total
      bestTwist = twist
      bestAssign.set(assign.subarray(0, n))
      bestSlots.set(twisted.subarray(0, COUNT * 3))
    }
    return total
  }

  let coarseBest = 0
  let coarseValue = Infinity
  for (let i = 0; i < COARSE; i++) {
    const twist = (i / COARSE) * Math.PI * 2
    const value = consider(twist)
    if (value < coarseValue) {
      coarseValue = value
      coarseBest = twist
    }
  }
  const window = (Math.PI * 2) / COARSE
  for (let i = 0; i < REFINE; i++) {
    consider(coarseBest - window + (i / Math.max(REFINE - 1, 1)) * 2 * window)
  }

  assign.set(bestAssign)
  const mapped = applyMap(center, pointIds, SLOT_IDS)
  return {
    targets: mapped.targets,
    ranks: mapped.ranks,
    twist: ((bestTwist % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
  }
}
