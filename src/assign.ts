import * as THREE from "three"
import { createLapjvScratch, lapjv } from "./lapjv.ts"
import { fibonacciPoint, fibonacciSphere, slotForNumber } from "./fibonacciSphere.ts"

export const COUNT = 200
const COARSE = 14
const REFINE = 8

export type Assignment = {
  targets: Float32Array
  twist: number
}

const poleSlot = (count: number) => slotForNumber(1, count)

const tmpA = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpTwist = new THREE.Quaternion()
const tmpAxis = new THREE.Vector3()
const tmpPole = new THREE.Vector3()
const tmpLocal = new THREE.Vector3()
const tmpV = new THREE.Vector3()

const write = (buf: Float32Array, i: number, v: THREE.Vector3) => {
  buf[i * 3] = v.x
  buf[i * 3 + 1] = v.y
  buf[i * 3 + 2] = v.z
}

const clampDot = (d: number) => (d < -1 ? -1 : d > 1 ? 1 : d)

const squaredAngleFromDot = (dot: number) => {
  const t = Math.acos(clampDot(dot))
  return t * t
}

const latticeRotation = (count: number, pole: THREE.Vector3, twist: number) => {
  const localPole = fibonacciPoint(poleSlot(count), count, 1)
  tmpLocal.set(localPole[0], localPole[1], localPole[2]).normalize()
  tmpPole.copy(pole).normalize()
  tmpQ.setFromUnitVectors(tmpLocal, tmpPole)
  tmpTwist.setFromAxisAngle(tmpAxis.copy(tmpPole), twist)
  return tmpQ.premultiply(tmpTwist)
}

export const orientedSpiral = (
  count: number,
  radius: number,
  pole: THREE.Vector3,
  twist: number,
) => {
  const q = latticeRotation(count, pole, twist)
  const segs = 20
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

const applyQuaternion = (buf: Float32Array, count: number, q: THREE.Quaternion) => {
  for (let i = 0; i < count; i++) {
    tmpV.set(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]).applyQuaternion(q)
    buf[i * 3] = tmpV.x
    buf[i * 3 + 1] = tmpV.y
    buf[i * 3 + 2] = tmpV.z
  }
}

const alignToPole = (
  local: Float32Array,
  count: number,
  pole: THREE.Vector3,
  out: Float32Array,
) => {
  out.set(local)
  const ps = poleSlot(count)
  tmpLocal.set(out[ps * 3], out[ps * 3 + 1], out[ps * 3 + 2]).normalize()
  tmpPole.copy(pole).normalize()
  tmpQ.setFromUnitVectors(tmpLocal, tmpPole)
  applyQuaternion(out, count, tmpQ)
}

const twistAroundPole = (
  aligned: Float32Array,
  count: number,
  pole: THREE.Vector3,
  twist: number,
  out: Float32Array,
) => {
  const kx = pole.x
  const ky = pole.y
  const kz = pole.z
  const c = Math.cos(twist)
  const s = Math.sin(twist)
  const w = 1 - c
  for (let i = 0; i < count; i++) {
    const x = aligned[i * 3]
    const y = aligned[i * 3 + 1]
    const z = aligned[i * 3 + 2]
    const kdot = kx * x + ky * y + kz * z
    const cx = ky * z - kz * y
    const cy = kz * x - kx * z
    const cz = kx * y - ky * x
    out[i * 3] = x * c + cx * s + kx * kdot * w
    out[i * 3 + 1] = y * c + cy * s + ky * kdot * w
    out[i * 3 + 2] = z * c + cz * s + kz * kdot * w
  }
}

const fillSquaredCost = (
  pointDirs: Float32Array,
  slots: Float32Array,
  slotIds: number[],
  n: number,
  cost: Float64Array,
) => {
  for (let i = 0; i < n; i++) {
    const px = pointDirs[i * 3]
    const py = pointDirs[i * 3 + 1]
    const pz = pointDirs[i * 3 + 2]
    const row = i * n
    for (let j = 0; j < n; j++) {
      const s = slotIds[j] * 3
      cost[row + j] = squaredAngleFromDot(px * slots[s] + py * slots[s + 1] + pz * slots[s + 2])
    }
  }
}

const packPointDirs = (positions: Float32Array, pointIds: number[], out: Float32Array) => {
  for (let i = 0; i < pointIds.length; i++) {
    const p = pointIds[i] * 3
    const x = positions[p]
    const y = positions[p + 1]
    const z = positions[p + 2]
    const inv = 1 / Math.hypot(x, y, z)
    out[i * 3] = x * inv
    out[i * 3 + 1] = y * inv
    out[i * 3 + 2] = z * inv
  }
}

const applyMap = (
  count: number,
  center: number,
  slots: Float32Array,
  pointIds: number[],
  slotIds: number[],
  assign: Int32Array,
  radius: number,
) => {
  const targets = new Float32Array(count * 3)
  const ps = poleSlot(count)
  targets[center * 3] = slots[ps * 3] * radius
  targets[center * 3 + 1] = slots[ps * 3 + 1] * radius
  targets[center * 3 + 2] = slots[ps * 3 + 2] * radius
  for (let i = 0; i < pointIds.length; i++) {
    const p = pointIds[i] * 3
    const s = slotIds[assign[i]] * 3
    targets[p] = slots[s] * radius
    targets[p + 1] = slots[s + 1] * radius
    targets[p + 2] = slots[s + 2] * radius
  }
  return targets
}

const localSphereCache = new Map<number, Float32Array>()

const cachedLocalSphere = (count: number) => {
  const hit = localSphereCache.get(count)
  if (hit) return hit
  const local = fibonacciSphere(count, 1)
  localSphereCache.set(count, local)
  return local
}

/** Min-squared-travel recenter: LAPJV on θ², 14+8 twist search. */
export const reassign = (
  positions: Float32Array,
  count: number,
  center: number,
  radius: number,
): Assignment => {
  const pointIds = remainingPoints(count, center)
  const slotIds = remainingSlots(count)
  const n = pointIds.length
  if (n === 0) return { targets: positions.slice(), twist: 0 }

  const local = cachedLocalSphere(count)
  const aligned = new Float32Array(count * 3)
  const twisted = new Float32Array(count * 3)
  const pointDirs = new Float32Array(n * 3)
  const cost = new Float64Array(n * n)
  const assign = new Int32Array(n)
  const jv = createLapjvScratch(n)
  packPointDirs(positions, pointIds, pointDirs)

  const pole = new THREE.Vector3(
    positions[center * 3],
    positions[center * 3 + 1],
    positions[center * 3 + 2],
  ).normalize()
  alignToPole(local, count, pole, aligned)

  let bestCost = Infinity
  let bestTwist = 0
  let bestAssign = new Int32Array(n)
  let bestSlots = new Float32Array(count * 3)

  const consider = (twist: number) => {
    twistAroundPole(aligned, count, pole, twist, twisted)
    fillSquaredCost(pointDirs, twisted, slotIds, n, cost)
    const total = lapjv(cost, n, assign, jv)
    if (total < bestCost) {
      bestCost = total
      bestTwist = twist
      bestAssign.set(assign)
      bestSlots.set(twisted)
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

  const wrap = ((bestTwist % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return {
    targets: applyMap(count, center, bestSlots, pointIds, slotIds, bestAssign, radius),
    twist: wrap,
  }
}

export const nearestToDir = (
  positions: Float32Array,
  count: number,
  dirx: number,
  diry: number,
  dirz: number,
  k: number,
) => {
  const scored = new Array<{ i: number; dot: number }>(count)
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    const inv = 1 / Math.hypot(x, y, z)
    scored[i] = { i, dot: (x * dirx + y * diry + z * dirz) * inv }
  }
  scored.sort((a, b) => b.dot - a.dot)
  const n = Math.min(k, count)
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) out[i] = scored[i].i
  return out
}
