import * as THREE from "three"

/** Fixed window of Vogel slots. Zoom slides this window; it does not change the count. */
export const COUNT = 200
export const SPHERE_RADIUS = 1.03

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

const tmp = new THREE.Vector3()
const tmpLocal = new THREE.Vector3()
const tmpPole = new THREE.Vector3()
const tmpAxis = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpTwist = new THREE.Quaternion()

export const slotRange = (growth: number) => ({
  kMin: Math.ceil(-growth - 0.5),
  kMax: Math.floor(COUNT - growth - 0.5),
})

/** k = 0 is the facing centre. growth pushes every slot toward the back. */
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

export const unitSlots = () => {
  const positions = new Float32Array(COUNT * 3)
  for (let k = 0; k < COUNT; k++) positions.set(slotPoint(k, 0, 1), k * 3)
  return positions
}

const pose = (pole: THREE.Vector3, twist: number) => {
  writeSlotCoords(0, 0, 1, tmpLocal).normalize()
  tmpPole.copy(pole).normalize()
  tmpQ.setFromUnitVectors(tmpLocal, tmpPole)
  tmpTwist.setFromAxisAngle(tmpAxis.copy(tmpPole), twist)
  return tmpQ.premultiply(tmpTwist)
}

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
export const SPIRAL_MAX_POINTS = COUNT * SPIRAL_SEGS + 1

/** Writes the oriented spiral into `out` and returns the point count. */
export const writeOrientedSpiral = (
  pole: THREE.Vector3,
  twist: number,
  growth: number,
  out: Float32Array,
  segs = SPIRAL_SEGS,
) => {
  const q = pose(pole, twist)
  const { kMin, kMax } = slotRange(growth)
  let w = 0
  for (let k = kMin; k < kMax; k++) {
    for (let s = 0; s < segs; s++) writeOriented(k + s / segs, growth, SPHERE_RADIUS, q, out, w++)
  }
  writeOriented(kMax, growth, SPHERE_RADIUS, q, out, w++)
  return w
}
