import * as THREE from "three"

/** Fixed window of Vogel slots. Zoom slides this window; it does not change the count. */
export const MIN_COUNT = 1
export const MAX_COUNT = 70
export let COUNT = 0
export const SPHERE_RADIUS = 1.03

export const setCount = (n: number) => {
  COUNT = Math.min(MAX_COUNT, Math.max(0, Math.round(n)))
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

const LOCAL_POLE = new THREE.Vector3(0, -1, 0)
const tmp = new THREE.Vector3()
const tmpPole = new THREE.Vector3()
const tmpAxis = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpTwist = new THREE.Quaternion()

/**
 * Slack before the innermost slot counts as gone. Zooming out by the amount you zoomed in lands a
 * hair either side of the integer; without this the original centre could flicker out and back.
 */
export const ZOOM_EPS = 0.05

export const slotRange = (growth: number) => {
  const kMin = Math.ceil(-growth - ZOOM_EPS)
  return { kMin, kMax: kMin + COUNT - 1 }
}

/** k = 0 is the facing centre / spiral origin. growth pushes every slot toward the back. */
const writeSlotCoords = (k: number, growth: number, radius: number, out: THREE.Vector3) => {
  const y = Math.min(1, Math.max(-1, -1 + (2 * (k + growth)) / COUNT))
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

export const writeLatticePose = (pole: THREE.Vector3, twist: number, out: THREE.Quaternion) => {
  tmpPole.copy(pole).normalize()
  out.setFromUnitVectors(LOCAL_POLE, tmpPole)
  tmpTwist.setFromAxisAngle(tmpAxis.copy(tmpPole), twist)
  return out.premultiply(tmpTwist)
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
    const y = -1 + (2 * (k + growth)) / COUNT
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

/** Local-space spiral (pole at -Y). Pose it with `writeLatticePose` on the object. */
export const writeSpiral = (growth: number, out: Float32Array, segs = SPIRAL_SEGS) => {
  const { kMax } = slotRange(growth)
  const kStart = -growth
  const steps = Math.max(1, Math.round((kMax - kStart) * segs))
  let w = 0
  for (let i = 0; i <= steps; i++) {
    writeSlotCoords(kStart + i / segs, growth, SPHERE_RADIUS, tmp)
    out[w * 3] = tmp.x
    out[w * 3 + 1] = tmp.y
    out[w * 3 + 2] = tmp.z
    w++
  }
  return w
}
