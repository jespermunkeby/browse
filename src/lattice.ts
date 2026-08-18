import * as THREE from "three"

/** Fixed window of Vogel slots. Zoom slides this window; it does not change the count. */
export const MIN_COUNT = 5
export const MAX_COUNT = 70
export let COUNT = 40
export const SPHERE_RADIUS = 1.03

export const setCount = (n: number) => {
  COUNT = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(n)))
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

const tmp = new THREE.Vector3()
const tmpLocal = new THREE.Vector3()
const tmpPole = new THREE.Vector3()
const tmpAxis = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpTwist = new THREE.Quaternion()

/** Geometric pole of the Vogel spiral (k = -0.5). Slot 0 sits a band away. */
export const LOCAL_TIP = new THREE.Vector3(0, -1, 0)

export const slotRange = (growth: number) => ({
  kMin: Math.ceil(-growth - 0.5),
  kMax: Math.floor(COUNT - growth - 0.5),
})

/** k = 0 is the first lattice point. The spiral origin is k = -0.5 (LOCAL_TIP). */
const writeSlotCoords = (k: number, growth: number, radius: number, out: THREE.Vector3) => {
  const y = Math.min(1, Math.max(-1, -1 + (2 * (k + growth + 0.5)) / COUNT))
  const r = Math.sqrt(Math.max(0, 1 - y * y)) * radius
  const theta = GOLDEN_ANGLE * k
  return out.set(Math.cos(theta) * r, y * radius, Math.sin(theta) * r)
}

export const slotPoint = (k: number, growth: number, radius = SPHERE_RADIUS) => {
  writeSlotCoords(k, growth, radius, tmp)
  return [tmp.x, tmp.y, tmp.z] as const
}

export const writeUnitSlots = (out: Float32Array) => {
  for (let k = 0; k < COUNT; k++) {
    writeSlotCoords(k, 0, 1, tmp)
    out[k * 3] = tmp.x
    out[k * 3 + 1] = tmp.y
    out[k * 3 + 2] = tmp.z
  }
  return out
}

export const unitSlots = () => writeUnitSlots(new Float32Array(COUNT * 3))

export const writeLatticePose = (pole: THREE.Vector3, twist: number, out: THREE.Quaternion) => {
  writeSlotCoords(0, 0, 1, tmpLocal).normalize()
  tmpPole.copy(pole).normalize()
  out.setFromUnitVectors(tmpLocal, tmpPole)
  tmpTwist.setFromAxisAngle(tmpAxis.copy(tmpPole), twist)
  return out.premultiply(tmpTwist)
}

/** Content-space direction of the spiral origin for a slot-0-aligned pose. */
export const writeTipDir = (pole: THREE.Vector3, twist: number, out: THREE.Vector3) => {
  writeLatticePose(pole, twist, tmpQ)
  return out.copy(LOCAL_TIP).applyQuaternion(tmpQ)
}

const pose = (pole: THREE.Vector3, twist: number) => writeLatticePose(pole, twist, tmpQ)

const writeOriented = (k: number, growth: number, radius: number, q: THREE.Quaternion, out: Float32Array, i: number) => {
  writeSlotCoords(k, growth, radius, tmp).applyQuaternion(q)
  out[i * 3] = tmp.x
  out[i * 3 + 1] = tmp.y
  out[i * 3 + 2] = tmp.z
}

export const writeSlotTargets = (
  slotK: Int32Array,
  growth: number,
  pole: THREE.Vector3,
  twist: number,
  out: Float32Array,
) => {
  const q = pose(pole, twist)
  for (let i = 0; i < COUNT; i++) writeOriented(slotK[i], growth, SPHERE_RADIUS, q, out, i)
}

/** How a slot slides when growth changes at `zoomVel`. */
export const writeSlotVelocities = (
  slotK: Int32Array,
  growth: number,
  pole: THREE.Vector3,
  twist: number,
  zoomVel: number,
  out: Float32Array,
) => {
  const q = pose(pole, twist)
  const dy = ((2 / COUNT) * zoomVel) * SPHERE_RADIUS
  for (let i = 0; i < COUNT; i++) {
    const k = slotK[i]
    const y = -1 + (2 * (k + growth + 0.5)) / COUNT
    if (y <= -1 || y >= 1) {
      out[i * 3] = 0
      out[i * 3 + 1] = 0
      out[i * 3 + 2] = 0
      continue
    }
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const dr = r > 1e-8 ? (-y / r) * dy : 0
    const theta = GOLDEN_ANGLE * k
    tmp.set(Math.cos(theta) * dr, dy, Math.sin(theta) * dr).applyQuaternion(q)
    out[i * 3] = tmp.x
    out[i * 3 + 1] = tmp.y
    out[i * 3 + 2] = tmp.z
  }
}

export const SPIRAL_SEGS = 20
export const SPIRAL_MAX_POINTS = MAX_COUNT * SPIRAL_SEGS + 1

/** Writes the oriented spiral into `out` and returns the point count. */
export const writeOrientedSpiral = (
  pole: THREE.Vector3,
  twist: number,
  growth: number,
  out: Float32Array,
  segs = SPIRAL_SEGS,
) => writeSpiral(pose(pole, twist), growth, out, segs)

export const writeSpiral = (q: THREE.Quaternion, growth: number, out: Float32Array, segs = SPIRAL_SEGS) => {
  const { kMax } = slotRange(growth)
  const kStart = -growth - 0.5
  const steps = Math.max(1, Math.round((kMax - kStart) * segs))
  let w = 0
  for (let i = 0; i <= steps; i++) writeOriented(kStart + i / segs, growth, SPHERE_RADIUS, q, out, w++)
  return w
}
