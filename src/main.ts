import "./style.css"
import * as THREE from "three"
import {
  COUNT,
  MAX_COUNT,
  SPHERE_RADIUS,
  SPIRAL_MAX_POINTS,
  setCount,
  slotPoint,
  slotRange,
  writeLatticePose,
  writeSpiral,
  writeSlotTargets,
  writeSlotVelocities,
} from "./lattice.ts"
import { reassign } from "./assign.ts"
import {
  DEFAULT_SETTINGS,
  MAX_PALETTE,
  MODES,
  formatCoarseness,
  settingsJson,
  type ModeId,
  type Settings,
} from "./dither/settings.ts"
import { createDitherPass } from "./dither/pass.ts"
import { disposePhoto, photoFromFile, photoSize, type Photo } from "./photos.ts"

const sim = {
  spring: 0.2,
  damping: 0.5,
  spin: 0.85,
  alignSpring: 0.8,
  alignDamping: 0.4,
  alignMass: 1.1,
  spiralSpring: 0.55,
  spiralDamping: 0.45,
  spiralMass: 1,
  zoom: 0.028,
  zoomDamp: 2.8,
  zoomHandoff: 4.6,
}

const tweakFields: { key: keyof typeof sim; label: string; min: number; max: number; step: number }[] = [
  { key: "spring", label: "Spring", min: 0, max: 1.5, step: 0.05 },
  { key: "damping", label: "Damping", min: 0.05, max: 1.4, step: 0.05 },
  { key: "spin", label: "Spin", min: 0, max: 2, step: 0.05 },
  { key: "alignSpring", label: "Align spring", min: 0, max: 1.5, step: 0.05 },
  { key: "alignDamping", label: "Align damping", min: 0.05, max: 1.4, step: 0.05 },
  { key: "alignMass", label: "Align mass", min: 0.2, max: 4, step: 0.1 },
  { key: "spiralSpring", label: "Spiral spring", min: 0, max: 1.5, step: 0.05 },
  { key: "spiralDamping", label: "Spiral damping", min: 0.05, max: 1.4, step: 0.05 },
  { key: "spiralMass", label: "Spiral mass", min: 0.2, max: 4, step: 0.1 },
  { key: "zoom", label: "Zoom speed", min: 0.002, max: 0.05, step: 0.002 },
  { key: "zoomDamp", label: "Zoom damp", min: 0.4, max: 10, step: 0.2 },
  { key: "zoomHandoff", label: "Zoom handoff", min: 0, max: 10, step: 0.1 },
]

const PICK_PAD = 4
const PAN_ROTATE = 0.0024
const PAN_HANDOFF_MS = 140
const PAN_VEL_SMOOTH = 0.38
const FOCUS_STABLE_MS = 160
const ZOOM_LOCK_MS = 260
const PAN_CLASSIFY_MS = 70
const FRAME = 1.12

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!
const tweaks = document.querySelector<HTMLElement>("#tweaks")!
const motion = document.querySelector<HTMLElement>("#motion")!
const empty = document.querySelector<HTMLElement>("#empty")!
const addBtn = document.querySelector<HTMLElement>("#addBtn")!
const settingsBtn = document.querySelector<HTMLButtonElement>("#settingsBtn")!
const settingsClose = document.querySelector<HTMLButtonElement>("#settingsClose")!
const fileInput = document.querySelector<HTMLInputElement>("#file")!
const addMore = document.querySelector<HTMLButtonElement>("#addMore")!
const clearImages = document.querySelector<HTMLButtonElement>("#clearImages")!
const imageCount = document.querySelector<HTMLElement>("#imageCount")!
const paletteEl = document.querySelector<HTMLElement>("#palette")!
const addColor = document.querySelector<HTMLButtonElement>("#addColor")!
const modeSelect = document.querySelector<HTMLSelectElement>("#mode")!
const coarsenessInput = document.querySelector<HTMLInputElement>("#coarseness")!
const coarsenessVal = document.querySelector<HTMLElement>("#coarsenessVal")!
const copySettings = document.querySelector<HTMLButtonElement>("#copySettings")!
const projectionSelect = document.querySelector<HTMLSelectElement>("#projection")!
const spiralCheck = document.querySelector<HTMLInputElement>("#spiral")!
const imageAreaInput = document.querySelector<HTMLInputElement>("#imageArea")!
const areaVal = document.querySelector<HTMLElement>("#areaVal")!
const vignetteRadiusInput = document.querySelector<HTMLInputElement>("#vignetteRadius")!
const vigRadiusVal = document.querySelector<HTMLElement>("#vigRadiusVal")!
const vignetteSoftnessInput = document.querySelector<HTMLInputElement>("#vignetteSoftness")!
const vigSoftVal = document.querySelector<HTMLElement>("#vigSoftVal")!
const vignetteStrengthInput = document.querySelector<HTMLInputElement>("#vignetteStrength")!
const vigStrVal = document.querySelector<HTMLElement>("#vigStrVal")!

type ProjectionId = "stereo" | "area" | "equidistant" | "ortho"

const projections: { id: ProjectionId; label: string }[] = [
  { id: "stereo", label: "Stereographic" },
  { id: "area", label: "Equal-area" },
  { id: "equidistant", label: "Equidistant" },
  { id: "ortho", label: "Orthographic" },
]

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  colors: [...DEFAULT_SETTINGS.colors],
}
const photos: Photo[] = []

let showSpiral = false
let projection: ProjectionId = "stereo"

const formatTweak = (value: number, step: number) => value.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)

const setSettingsOpen = (open: boolean) => {
  tweaks.hidden = !open
  settingsBtn.hidden = open
  settingsBtn.setAttribute("aria-expanded", String(open))
}

settingsBtn.addEventListener("click", () => setSettingsOpen(true))
settingsClose.addEventListener("click", () => setSettingsOpen(false))

for (const option of projections) {
  const el = document.createElement("option")
  el.value = option.id
  el.textContent = option.label
  projectionSelect.append(el)
}
projectionSelect.value = projection

for (const item of MODES) {
  const el = document.createElement("option")
  el.value = item.id
  el.textContent = item.label
  modeSelect.append(el)
}
modeSelect.value = settings.mode
coarsenessInput.value = String(Math.round(Math.log2(settings.coarseness)))
imageAreaInput.value = String(settings.imageArea)
vignetteRadiusInput.value = String(settings.vignetteRadius)
vignetteSoftnessInput.value = String(settings.vignetteSoftness)
vignetteStrengthInput.value = String(settings.vignetteStrength)

spiralCheck.checked = showSpiral

for (const field of tweakFields) {
  const label = document.createElement("label")
  const value = document.createElement("span")
  value.textContent = formatTweak(sim[field.key], field.step)
  const input = document.createElement("input")
  input.type = "range"
  input.min = String(field.min)
  input.max = String(field.max)
  input.step = String(field.step)
  input.value = String(sim[field.key])
  input.addEventListener("input", () => {
    sim[field.key] = Number(input.value)
    value.textContent = formatTweak(sim[field.key], field.step)
  })
  label.append(Object.assign(document.createElement("span"), { textContent: field.label }), value, input)
  motion.append(label)
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.setClearColor(0x000000, 1)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x000000)

const camera = new THREE.OrthographicCamera(-FRAME, FRAME, FRAME, -FRAME, -10, 10)
camera.position.set(0, 0, 5)

const ditherPass = createDitherPass(renderer)

const content = new THREE.Group()
scene.add(content)

const markers = new THREE.Group()
content.add(markers)

const thumbGeo = new THREE.PlaneGeometry(1, 1)
const thumbs: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = []
for (let i = 0; i < MAX_COUNT; i++) {
  const mesh = new THREE.Mesh(
    thumbGeo,
    new THREE.MeshBasicMaterial({ depthTest: false, toneMapped: false }),
  )
  mesh.frustumCulled = false
  mesh.renderOrder = 3
  mesh.visible = false
  scene.add(mesh)
  thumbs.push(mesh)
}

const spiralGeometry = new THREE.BufferGeometry()
const spiral = new THREE.Line(
  spiralGeometry,
  new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }),
)
spiral.frustumCulled = false
spiral.renderOrder = 2
spiral.visible = false
scene.add(spiral)

let diskPx = 1

spiralCheck.addEventListener("change", () => {
  showSpiral = spiralCheck.checked
  spiral.visible = showSpiral
  if (showSpiral) setSpiral()
})

projectionSelect.addEventListener("change", () => {
  projection = projectionSelect.value as ProjectionId
})

const pickWorld = new THREE.Vector3()
const seekVec = new THREE.Vector3()
const axisVec = new THREE.Vector3()
const forceVec = new THREE.Vector3()
const velVec = new THREE.Vector3()
const omega = new THREE.Vector3()
const viewDir = new THREE.Vector3(0, 0, 1)
const worldPole = new THREE.Vector3()
const ndc = new THREE.Vector2()
const plane = new THREE.Vector2()
const prevHit = new THREE.Vector3()
const currHit = new THREE.Vector3()
const rotQ = new THREE.Quaternion()
const alignQ = new THREE.Quaternion()
const lastContentQ = new THREE.Quaternion()
const invQ = new THREE.Quaternion()
const poseNow = new THREE.Quaternion()
const poseTarget = new THREE.Quaternion()
const poseVel = new THREE.Vector3()
const alignVel = new THREE.Vector3()

const positions = new Float32Array(MAX_COUNT * 3)
const velocity = new Float32Array(MAX_COUNT * 3)
const seek = new Float32Array(MAX_COUNT * 3)
const prevLattice = new Float32Array(MAX_COUNT * 3)
const remapped = new Uint8Array(MAX_COUNT)
const slotK = new Int32Array(MAX_COUNT)
const imageIds = new Int32Array(MAX_COUNT)
const behind: number[] = []
const ahead: number[] = []
const occupied = new Uint8Array(MAX_COUNT + 2)
const entering = new Int32Array(MAX_COUNT)
const poleDir = new THREE.Vector3(0, -1, 0)
const centerDir = new THREE.Vector3(0, 0, 1)
const spiralLocal = new Float32Array(SPIRAL_MAX_POINTS * 3)
const spiralPos = new Float32Array(SPIRAL_MAX_POINTS * 3)
const spiralCol = new Float32Array(SPIRAL_MAX_POINTS * 3)
let growth = 0
let zoomVel = 0
let center = 0
let twist = 0
let aimed = -1
let lastTime = performance.now()
let pointerDown = { x: 0, y: 0 }
let dragging = false
let lastActiveWheel = 0
let lastPinch = 0
let lastWheelMag = 0
let wheelDecay = 0
let pendingPanAt = 0
let pendingPanDx = 0
let pendingPanDy = 0
let panVx = 0
let panVy = 0
let handedOff = true
let seeking = true
let focusCandidate = -1
let focusCandidateSince = 0
let spiralReady = false
let lastSpiralGrowth = Number.NaN
let lastSpiralLocalCount = 0

const marker = (i: number) => markers.children[i]

/** Map a unit vector on the front hemisphere into the unit disk. */
const projectHemisphere = (x: number, y: number, z: number, out: THREE.Vector3) => {
  switch (projection) {
    case "stereo": {
      const inv = 1 / (1 + z)
      return out.set(x * inv, y * inv, 0)
    }
    case "area": {
      const inv = 1 / Math.sqrt(1 + z)
      return out.set(x * inv, y * inv, 0)
    }
    case "equidistant": {
      const s = Math.hypot(x, y)
      if (s < 1e-12) return out.set(0, 0, 0)
      const r = (2 / Math.PI) * Math.acos(Math.min(1, z))
      return out.set((x * r) / s, (y * r) / s, 0)
    }
    case "ortho":
      return out.set(x, y, 0)
  }
}

/** Inverse of `projectHemisphere`. `(px, py)` is already clamped to the unit disk. */
const unprojectDisk = (px: number, py: number, out: THREE.Vector3) => {
  const rho2 = px * px + py * py
  switch (projection) {
    case "stereo": {
      const d = 1 + rho2
      return out.set((2 * px) / d, (2 * py) / d, (1 - rho2) / d)
    }
    case "area": {
      const s = Math.sqrt(Math.max(0, 2 - rho2))
      return out.set(px * s, py * s, 1 - rho2)
    }
    case "equidistant": {
      const rho = Math.sqrt(rho2)
      if (rho < 1e-12) return out.set(0, 0, 1)
      const theta = rho * Math.PI * 0.5
      const s = Math.sin(theta) / rho
      return out.set(px * s, py * s, Math.cos(theta))
    }
    case "ortho":
      return out.set(px, py, Math.sqrt(Math.max(0, 1 - rho2)))
  }
}

const projectPoint = (local: THREE.Vector3, out: THREE.Vector3) => {
  out.copy(local).applyQuaternion(content.quaternion).normalize()
  if (out.z < 0) return false
  projectHemisphere(out.x, out.y, out.z, out)
  return true
}

const screenToPlane = (sx: number, sy: number, out: THREE.Vector2) => {
  const x = (sx / canvas.clientWidth) * 2 - 1
  const y = -(sy / canvas.clientHeight) * 2 + 1
  out.set(
    camera.left + (x * 0.5 + 0.5) * (camera.right - camera.left),
    camera.bottom + (y * 0.5 + 0.5) * (camera.top - camera.bottom),
  )
  return out
}

const thumbSize = (photo: Photo) => photoSize(photo.aspect, settings.imageArea)

const projectThumbs = () => {
  for (let i = 0; i < MAX_COUNT; i++) {
    const mesh = thumbs[i]!
    if (i >= COUNT) {
      mesh.visible = false
      continue
    }
    const photo = photos[imageIds[i]]
    if (!photo || !projectPoint(marker(i).position, pickWorld)) {
      mesh.visible = false
      continue
    }
    mesh.visible = true
    mesh.position.copy(pickWorld)
    const { w, h } = thumbSize(photo)
    mesh.scale.set(w, h, 1)
    mesh.renderOrder = slotK[i] === 0 ? 5 : 3
    if (mesh.material.map !== photo.texture) {
      mesh.material.map = photo.texture
      mesh.material.needsUpdate = true
    }
  }
}

const readPositions = () => {
  for (let i = 0; i < COUNT; i++) {
    const p = marker(i).position
    positions[i * 3] = p.x
    positions[i * 3 + 1] = p.y
    positions[i * 3 + 2] = p.z
  }
  return positions
}

const polePoint = () => {
  let best = 0
  for (let i = 1; i < COUNT; i++) if (slotK[i] < slotK[best]) best = i
  return best
}

const restockQueues = () => {
  behind.length = 0
  ahead.length = 0
  const used = new Set<number>()
  for (let i = 0; i < COUNT; i++) used.add(imageIds[i])
  for (let i = photos.length - 1; i >= 0; i--) if (!used.has(i)) ahead.push(i)
}

const resetZoomWindow = () => {
  growth = 0
  zoomVel = 0
  restockQueues()
}

const TAU = Math.PI * 2

const setSpiral = () => {
  if (!showSpiral) return

  if (!spiralReady || growth !== lastSpiralGrowth) {
    lastSpiralLocalCount = writeSpiral(growth, spiralLocal)
    lastSpiralGrowth = growth
    if (!spiralReady) {
      spiralGeometry.setAttribute("position", new THREE.BufferAttribute(spiralPos, 3))
      spiralGeometry.setAttribute("color", new THREE.BufferAttribute(spiralCol, 3))
      spiralReady = true
    }
    const fadeDen = Math.max(lastSpiralLocalCount - 1, 1)
    for (let i = 0; i < lastSpiralLocalCount; i++) {
      const fade = 0.12 + 0.38 * (1 - i / fadeDen)
      spiralCol[i * 3] = fade
      spiralCol[i * 3 + 1] = fade
      spiralCol[i * 3 + 2] = fade
    }
    spiralGeometry.getAttribute("color").needsUpdate = true
  }

  for (let i = 0; i < lastSpiralLocalCount; i++) {
    const p = i * 3
    pickWorld.set(spiralLocal[p], spiralLocal[p + 1], spiralLocal[p + 2]).applyQuaternion(poseNow)
    pickWorld.applyQuaternion(content.quaternion).normalize()
    if (pickWorld.z < 0) {
      spiralPos[p] = Number.NaN
      spiralPos[p + 1] = Number.NaN
      spiralPos[p + 2] = Number.NaN
      continue
    }
    projectHemisphere(pickWorld.x, pickWorld.y, pickWorld.z, pickWorld)
    spiralPos[p] = pickWorld.x
    spiralPos[p + 1] = pickWorld.y
    spiralPos[p + 2] = 0
  }

  spiralGeometry.getAttribute("position").needsUpdate = true
  spiralGeometry.setDrawRange(0, lastSpiralLocalCount)
}

const stepSpiralPose = (dt: number) => {
  centerDir.set(0, 0, 1).applyQuaternion(invQ.copy(content.quaternion).invert()).normalize()
  writeLatticePose(poleDir, twist, poseTarget)
  rotQ.setFromUnitVectors(worldPole.copy(poleDir).normalize(), centerDir)
  poseTarget.premultiply(rotQ)

  const k = sim.spiralSpring * 12
  if (k <= 0) {
    poseNow.copy(poseTarget)
    poseVel.set(0, 0, 0)
    return
  }

  invQ.copy(poseNow).invert()
  rotQ.copy(poseTarget).multiply(invQ)
  if (rotQ.w < 0) {
    rotQ.x = -rotQ.x
    rotQ.y = -rotQ.y
    rotQ.z = -rotQ.z
    rotQ.w = -rotQ.w
  }
  const ang = 2 * Math.acos(Math.min(1, Math.max(-1, rotQ.w)))
  if (ang > 1e-6) axisVec.set(rotQ.x, rotQ.y, rotQ.z).setLength(ang)
  else axisVec.set(0, 0, 0)

  const mass = Math.max(0.05, sim.spiralMass)
  const c = 2 * sim.spiralDamping * Math.sqrt(k * mass)
  forceVec.copy(axisVec).multiplyScalar(k).addScaledVector(poseVel, -c)
  poseVel.addScaledVector(forceVec, dt / mass)

  const step = poseVel.length() * dt
  if (step > 1e-8) {
    alignQ.setFromAxisAngle(axisVec.copy(poseVel).normalize(), step)
    poseNow.premultiply(alignQ).normalize()
  }
}

const setSeek = (index: number) => {
  if (COUNT === 0) return
  const assignment = reassign(readPositions(), index)
  seek.set(assignment.targets)
  center = index
  focusCandidate = index
  poleDir.copy(marker(index).position).normalize()
  slotK.set(assignment.ranks)
  resetZoomWindow()
  prevLattice.set(assignment.targets)
  seeking = true
  twist = ((assignment.twist % TAU) + TAU) % TAU
}

const pinchLive = (now = performance.now()) => now - lastPinch < ZOOM_LOCK_MS
const zooming = (now = performance.now()) => Math.abs(zoomVel) > sim.zoomHandoff || pinchLive(now)

const takeId = (stack: number[], other: number[]) => {
  if (stack.length) return stack.pop()!
  if (other.length) return other.shift()!
  return 0
}

const captureLattice = () => {
  writeSlotTargets(slotK, growth, poleDir, twist, prevLattice)
}

const slideOnLattice = () => {
  writeSlotTargets(slotK, growth, poleDir, twist, seek)
  for (let i = 0; i < COUNT; i++) {
    const p = i * 3
    const pos = marker(i).position
    if (remapped[i]) {
      pos.set(seek[p], seek[p + 1], seek[p + 2])
      velocity[p] = 0
      velocity[p + 1] = 0
      velocity[p + 2] = 0
      continue
    }
    velVec.set(prevLattice[p], prevLattice[p + 1], prevLattice[p + 2])
    seekVec.set(seek[p], seek[p + 1], seek[p + 2])
    if (velVec.lengthSq() > 1e-12 && seekVec.lengthSq() > 1e-12 && velVec.distanceToSquared(seekVec) > 1e-16) {
      rotQ.setFromUnitVectors(velVec.normalize(), seekVec.normalize())
      pos.applyQuaternion(rotQ)
    }
    pos.setLength(SPHERE_RADIUS)
  }
  prevLattice.set(seek)
}

const syncSlotsToGrowth = () => {
  const { kMin, kMax } = slotRange(growth)
  const span = kMax - kMin + 1
  occupied.fill(0, 0, span)
  remapped.fill(0)
  for (let i = 0; i < COUNT; i++) {
    const k = slotK[i]
    if (k >= kMin && k <= kMax) occupied[k - kMin] = 1
  }
  let enteringN = 0
  for (let k = kMin; k <= kMax; k++) if (!occupied[k - kMin]) entering[enteringN++] = k
  for (let i = 0; i < COUNT; i++) {
    if (slotK[i] >= kMin && slotK[i] <= kMax) continue
    if (enteringN === 0) continue
    const next = entering[--enteringN]
    if (slotK[i] > kMax) {
      behind.push(imageIds[i])
      imageIds[i] = takeId(ahead, behind)
    } else {
      ahead.push(imageIds[i])
      imageIds[i] = takeId(behind, ahead)
    }
    slotK[i] = next
    remapped[i] = 1
  }
}

const kickZoom = (impulse: number) => {
  if (impulse === 0) return
  if (!zooming()) {
    captureLattice()
    focusCandidate = center
  }
  zoomVel += impulse
}

const handoffZoom = () => {
  if (Math.abs(zoomVel) <= 1e-8) return
  syncSlotsToGrowth()
  writeSlotTargets(slotK, growth, poleDir, twist, seek)
  writeSlotVelocities(slotK, growth, poleDir, twist, zoomVel, velocity)
  zoomVel = 0
  center = polePoint()
  focusCandidate = center
}

const stepZoom = (dt: number) => {
  if (!zooming()) {
    if (Math.abs(zoomVel) > 1e-8) handoffZoom()
    else zoomVel = 0
    return false
  }
  growth += zoomVel * dt
  zoomVel *= Math.exp(-sim.zoomDamp * dt)
  syncSlotsToGrowth()
  slideOnLattice()
  const nextCenter = polePoint()
  if (nextCenter !== center) {
    center = nextCenter
    focusCandidate = nextCenter
  }
  if (!zooming()) {
    handoffZoom()
    return false
  }
  return true
}

const pointerNdc = (event: PointerEvent) => {
  const rect = canvas.getBoundingClientRect()
  ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  return ndc
}

const ndcToHemisphere = (x: number, y: number, out: THREE.Vector3) => {
  let px = camera.left + (x * 0.5 + 0.5) * (camera.right - camera.left)
  let py = camera.bottom + (y * 0.5 + 0.5) * (camera.top - camera.bottom)
  const r2 = px * px + py * py
  if (r2 > 1) {
    const inv = 1 / Math.sqrt(r2)
    px *= inv
    py *= inv
  }
  return unprojectDisk(px, py, out)
}

const readContentDelta = () => {
  invQ.copy(lastContentQ).invert()
  rotQ.copy(content.quaternion).multiply(invQ)
  lastContentQ.copy(content.quaternion)
  const ang = 2 * Math.acos(Math.min(1, Math.max(-1, rotQ.w)))
  omega.set(rotQ.x, rotQ.y, rotQ.z)
  return ang
}

const kickPointsFromSpin = (ang: number) => {
  if (sim.spin <= 0 || ang < 1e-5 || omega.lengthSq() < 1e-12) return
  forceVec.copy(omega).setLength(ang * sim.spin)
  forceVec.applyQuaternion(invQ.copy(content.quaternion).invert())
  for (let i = 0; i < COUNT; i++) {
    velVec.crossVectors(forceVec, marker(i).position)
    velocity[i * 3] += velVec.x
    velocity[i * 3 + 1] += velVec.y
    velocity[i * 3 + 2] += velVec.z
  }
}

const applySphereSpin = (dt: number) => {
  const step = alignVel.length() * dt
  if (step > 1e-8) {
    alignQ.setFromAxisAngle(axisVec.copy(alignVel).normalize(), step)
    content.quaternion.premultiply(alignQ)
  }
  lastContentQ.copy(content.quaternion)
}

const autoAlign = (dt: number) => {
  const k = sim.alignSpring * 12
  if (k > 0) {
    const mass = Math.max(0.05, sim.alignMass)
    const c = 2 * sim.alignDamping * Math.sqrt(k * mass)
    if (seeking || zooming()) {
      worldPole.copy(poleDir).normalize()
      worldPole.applyQuaternion(content.quaternion)
      viewDir.set(0, 0, 1)
      rotQ.setFromUnitVectors(worldPole, viewDir)
      const ang = 2 * Math.acos(Math.min(1, Math.max(-1, rotQ.w)))
      if (ang > 1e-6) axisVec.set(rotQ.x, rotQ.y, rotQ.z).setLength(ang)
      else axisVec.set(0, 0, 0)
      forceVec.copy(axisVec).multiplyScalar(k).addScaledVector(alignVel, -c)
      alignVel.addScaledVector(forceVec, dt / mass)
    } else {
      alignVel.addScaledVector(alignVel, (-c * dt) / mass)
    }
  }
  applySphereSpin(dt)
}

const stepFocus = (now: number) => {
  if (zooming() || dragging || !handedOff) {
    focusCandidate = -1
    return
  }

  const candidate = aimed >= 0 ? aimed : center
  if (seeking && candidate === center) return

  if (candidate !== focusCandidate) {
    focusCandidate = candidate
    focusCandidateSince = now
  }

  const stable = now - focusCandidateSince >= FOCUS_STABLE_MS
  const slow = alignVel.length() < 1.15
  if (stable && slow) setSeek(candidate)
}

const stepPhysics = (dt: number) => {
  const k = sim.spring * 36
  const c = 2 * sim.damping * Math.sqrt(k)
  const steps = Math.min(4, Math.max(1, Math.ceil(dt / 0.008)))
  const h = dt / steps

  for (let i = 0; i < COUNT; i++) {
    const pos = marker(i).position
    seekVec.set(seek[i * 3], seek[i * 3 + 1], seek[i * 3 + 2])
    velVec.set(velocity[i * 3], velocity[i * 3 + 1], velocity[i * 3 + 2])
    for (let s = 0; s < steps; s++) {
      axisVec.crossVectors(pos, seekVec)
      if (axisVec.lengthSq() < 1e-12) velVec.multiplyScalar(Math.max(0, 1 - c * h))
      else {
        forceVec.crossVectors(axisVec, pos).setLength(pos.angleTo(seekVec) * k)
        forceVec.addScaledVector(velVec, -c)
        velVec.addScaledVector(forceVec, h)
      }
      velVec.addScaledVector(pos, -velVec.dot(pos) / pos.lengthSq())
      pos.addScaledVector(velVec, h).setLength(SPHERE_RADIUS)
      velVec.addScaledVector(pos, -velVec.dot(pos) / pos.lengthSq())
    }
    velocity[i * 3] = velVec.x
    velocity[i * 3 + 1] = velVec.y
    velocity[i * 3 + 2] = velVec.z
  }
}

const pickIndexAt = (sx: number, sy: number, extraPx: number) => {
  let best = -1
  let bestDist = Infinity
  screenToPlane(sx, sy, plane)
  const extra = extraPx / diskPx
  for (let i = 0; i < COUNT; i++) {
    const photo = photos[imageIds[i]]
    if (!photo || !projectPoint(marker(i).position, pickWorld)) continue
    const { w, h } = thumbSize(photo)
    const dx = Math.abs(pickWorld.x - plane.x)
    const dy = Math.abs(pickWorld.y - plane.y)
    if (dx > w * 0.5 + extra || dy > h * 0.5 + extra) continue
    const dist = Math.hypot(dx / w, dy / h)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

const nearestToCenter = () => pickIndexAt(canvas.clientWidth * 0.5, canvas.clientHeight * 0.5, Infinity)

const clearMarkers = () => {
  for (let i = markers.children.length - 1; i >= 0; i--) markers.remove(markers.children[i])
}

const layout = () => {
  for (let i = 0; i < COUNT; i++) {
    const node = new THREE.Object3D()
    node.userData.index = i
    imageIds[i] = i
    slotK[i] = i
    const point = slotPoint(i, 0)
    node.position.set(point[0], point[1], point[2])
    markers.add(node)
  }
}

const updateImageUi = () => {
  const n = photos.length
  empty.hidden = n > 0
  addBtn.hidden = n === 0
  imageCount.textContent = n === 0 ? "No images" : n === 1 ? "1 image" : `${n} images`
  clearImages.disabled = n === 0
}

const rebuildPoints = (n: number) => {
  setCount(n)
  clearMarkers()
  velocity.fill(0)
  seek.fill(0)
  behind.length = 0
  ahead.length = 0
  growth = 0
  zoomVel = 0
  twist = 0
  center = 0
  focusCandidate = -1
  seeking = true
  aimed = -1
  alignVel.set(0, 0, 0)
  for (let i = 0; i < MAX_COUNT; i++) thumbs[i]!.visible = false
  if (COUNT === 0) {
    restockQueues()
    updateImageUi()
    return
  }
  layout()
  restockQueues()
  poleDir.copy(marker(0).position).normalize()
  writeLatticePose(poleDir, twist, poseNow)
  poseVel.set(0, 0, 0)
  seek.set(readPositions())
  prevLattice.set(seek)
  lastContentQ.copy(content.quaternion)
  lastSpiralGrowth = Number.NaN
  lastSpiralLocalCount = 0
  setSpiral()
  updateImageUi()
}

const updateSettingLabels = () => {
  coarsenessVal.textContent = formatCoarseness(settings.coarseness)
  areaVal.textContent = settings.imageArea.toFixed(2)
  vigRadiusVal.textContent = settings.vignetteRadius.toFixed(2)
  vigSoftVal.textContent = settings.vignetteSoftness.toFixed(2)
  vigStrVal.textContent = settings.vignetteStrength.toFixed(2)
}

const syncDither = () => {
  updateSettingLabels()
  ditherPass.setSettings(settings)
}

const syncPalette = () => {
  paletteEl.replaceChildren()
  for (const [i, hex] of settings.colors.entries()) {
    const label = document.createElement("label")
    label.className = "swatch"
    const input = document.createElement("input")
    input.type = "color"
    input.value = hex
    input.addEventListener("input", () => {
      settings.colors[i] = input.value
      syncDither()
    })
    const remove = document.createElement("button")
    remove.type = "button"
    remove.textContent = "×"
    remove.disabled = settings.colors.length <= 2
    remove.addEventListener("click", (e) => {
      e.preventDefault()
      if (settings.colors.length <= 2) return
      settings.colors.splice(i, 1)
      syncPalette()
      syncDither()
    })
    label.append(input, remove)
    paletteEl.append(label)
  }
  addColor.disabled = settings.colors.length >= MAX_PALETTE
  updateSettingLabels()
}

modeSelect.addEventListener("change", () => {
  settings.mode = modeSelect.value as ModeId
  syncDither()
})
coarsenessInput.addEventListener("input", () => {
  settings.coarseness = 2 ** Number(coarsenessInput.value)
  syncDither()
})
imageAreaInput.addEventListener("input", () => {
  settings.imageArea = Number(imageAreaInput.value)
  updateSettingLabels()
})
vignetteRadiusInput.addEventListener("input", () => {
  settings.vignetteRadius = Number(vignetteRadiusInput.value)
  syncDither()
})
vignetteSoftnessInput.addEventListener("input", () => {
  settings.vignetteSoftness = Number(vignetteSoftnessInput.value)
  syncDither()
})
vignetteStrengthInput.addEventListener("input", () => {
  settings.vignetteStrength = Number(vignetteStrengthInput.value)
  syncDither()
})
addColor.addEventListener("click", () => {
  if (settings.colors.length >= MAX_PALETTE) return
  settings.colors.push("#6b8f71")
  syncPalette()
  syncDither()
})
copySettings.addEventListener("click", async () => {
  await navigator.clipboard.writeText(settingsJson(settings))
  copySettings.textContent = "Copied"
  window.setTimeout(() => {
    copySettings.textContent = "Copy settings JSON"
  }, 1200)
})

const addFiles = async (files: File[]) => {
  const images = files.filter((file) => file.type.startsWith("image/"))
  if (!images.length) return
  for (const file of images) photos.push(await photoFromFile(file))
  rebuildPoints(Math.min(photos.length, MAX_COUNT))
}

const clearAllImages = () => {
  for (const photo of photos) disposePhoto(photo)
  photos.length = 0
  rebuildPoints(0)
}

fileInput.addEventListener("change", () => {
  void addFiles([...(fileInput.files ?? [])])
  fileInput.value = ""
})
addBtn.addEventListener("click", () => fileInput.click())
addMore.addEventListener("click", () => fileInput.click())
clearImages.addEventListener("click", clearAllImages)

const prevent = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
}
for (const ev of ["dragenter", "dragover", "dragleave", "drop"] as const) {
  document.addEventListener(ev, prevent)
}
document.addEventListener("dragenter", () => document.body.classList.add("drag"))
document.addEventListener("dragover", () => document.body.classList.add("drag"))
document.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) document.body.classList.remove("drag")
})
document.addEventListener("drop", (e) => {
  document.body.classList.remove("drag")
  void addFiles([...(e.dataTransfer?.files ?? [])])
})
document.addEventListener("paste", (e) => {
  void addFiles([...(e.clipboardData?.files ?? [])])
})

const resize = () => {
  const css = Math.min(innerWidth, innerHeight)
  camera.left = -FRAME
  camera.right = FRAME
  camera.top = FRAME
  camera.bottom = -FRAME
  camera.updateProjectionMatrix()
  ditherPass.resize(css)
  diskPx = css / (2 * FRAME)
}

const rotateByPointer = (event: PointerEvent) => {
  pointerNdc(event)
  ndcToHemisphere(ndc.x, ndc.y, currHit)
  if (prevHit.dot(currHit) < 0.999999) {
    rotQ.setFromUnitVectors(prevHit, currHit)
    content.quaternion.premultiply(rotQ)
  }
  prevHit.copy(currHit)
}

canvas.addEventListener("pointerdown", (event) => {
  pointerDown = { x: event.clientX, y: event.clientY }
  dragging = true
  pointerNdc(event)
  ndcToHemisphere(ndc.x, ndc.y, prevHit)
  lastContentQ.copy(content.quaternion)
  canvas.setPointerCapture(event.pointerId)
})

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return
  if (seeking && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) seeking = false
  rotateByPointer(event)
})

canvas.addEventListener("pointerup", (event) => {
  if (!dragging) return
  dragging = false
  const dragged = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5
  if (!dragged) {
    const rect = canvas.getBoundingClientRect()
    const index = pickIndexAt(event.clientX - rect.left, event.clientY - rect.top, PICK_PAD)
    if (index >= 0) setSeek(index)
    return
  }
  seeking = false
  handedOff = true
})

canvas.addEventListener("pointercancel", () => {
  dragging = false
})

const isOsMomentum = (event: WheelEvent, mag: number) => {
  const phase =
    (event as WheelEvent & { momentumPhase?: number; webkitMomentumPhase?: number }).momentumPhase ??
    (event as WheelEvent & { webkitMomentumPhase?: number }).webkitMomentumPhase ??
    0
  if (phase) return true
  if (handedOff) return mag <= lastWheelMag * 1.15
  if (mag + 0.2 < lastWheelMag * 0.82) wheelDecay += 1
  else if (mag > lastWheelMag) wheelDecay = 0
  lastWheelMag = mag
  return wheelDecay >= 4
}

const handoffPan = () => {
  if (handedOff) return
  handedOff = true
  const mass = Math.max(0.05, sim.alignMass)
  alignVel.x = panVx / mass
  alignVel.y = panVy / mass
  alignVel.z = 0
  panVx = 0
  panVy = 0
}

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault()
    if (COUNT === 0) return
    const now = performance.now()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1
    let dx = event.deltaX * unit
    let dy = event.deltaY * unit
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)
    const pinch = event.ctrlKey || (pinchLive(now) && absY > absX * 1.15)

    if (pinch) {
      lastPinch = now
      pendingPanAt = 0
      pendingPanDx = 0
      pendingPanDy = 0
      kickZoom(-dy * sim.zoom * 28)
      return
    }

    if (pinchLive(now) || Math.abs(zoomVel) > sim.zoomHandoff) return

    if (handedOff) {
      if (!pendingPanAt) {
        pendingPanAt = now
        pendingPanDx = dx
        pendingPanDy = dy
        return
      }
      pendingPanDx += dx
      pendingPanDy += dy
      if (now - pendingPanAt < PAN_CLASSIFY_MS) return
      dx = pendingPanDx
      dy = pendingPanDy
      pendingPanAt = 0
      pendingPanDx = 0
      pendingPanDy = 0
    } else {
      pendingPanAt = 0
    }

    const mag = Math.hypot(dx, dy)
    if (mag === 0) return
    if (isOsMomentum(event, mag)) {
      lastWheelMag = mag
      handoffPan()
      return
    }
    const dt = Math.min(0.05, Math.max(0.008, (now - lastActiveWheel) / 1000))
    const vx = (-dy * PAN_ROTATE) / dt
    const vy = (-dx * PAN_ROTATE) / dt
    if (handedOff) {
      alignVel.set(0, 0, 0)
      wheelDecay = 0
      panVx = vx
      panVy = vy
    } else {
      panVx += (vx - panVx) * PAN_VEL_SMOOTH
      panVy += (vy - panVy) * PAN_VEL_SMOOTH
    }
    lastWheelMag = mag
    lastActiveWheel = now
    handedOff = false
    seeking = false
    rotQ.setFromAxisAngle(axisVec.set(0, 1, 0), -dx * PAN_ROTATE)
    content.quaternion.premultiply(rotQ)
    rotQ.setFromAxisAngle(axisVec.set(1, 0, 0), -dy * PAN_ROTATE)
    content.quaternion.premultiply(rotQ)
  },
  { passive: false },
)

const ignoreGesture = (event: Event) => event.preventDefault()
canvas.addEventListener("gesturestart", ignoreGesture)
canvas.addEventListener("gesturechange", ignoreGesture)
canvas.addEventListener("gestureend", ignoreGesture)

addEventListener("resize", resize)

syncPalette()
syncDither()
updateImageUi()
resize()
lastContentQ.copy(content.quaternion)

renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.05, (now - lastTime) / 1000)
  lastTime = now

  if (COUNT === 0) {
    ditherPass.render(scene, camera, settings)
    return
  }

  aimed = nearestToCenter()

  if (!dragging && !handedOff && now - lastActiveWheel > PAN_HANDOFF_MS) handoffPan()
  stepFocus(now)

  if (stepZoom(dt)) {
    autoAlign(dt)
  } else if (dragging) {
    const ang = readContentDelta()
    if (dt > 1e-5 && ang > 1e-6 && omega.lengthSq() > 1e-12) alignVel.copy(omega).setLength(ang / dt)
    else alignVel.set(0, 0, 0)
    kickPointsFromSpin(ang)
    stepPhysics(dt)
  } else if (!handedOff) {
    kickPointsFromSpin(readContentDelta())
    stepPhysics(dt)
  } else {
    autoAlign(dt)
    const ang = 2 * Math.asin(Math.min(1, alignVel.length() * dt * 0.5))
    if (ang > 1e-5) {
      omega.copy(alignVel)
      kickPointsFromSpin(ang)
    }
    stepPhysics(dt)
  }

  stepSpiralPose(dt)
  setSpiral()
  projectThumbs()
  ditherPass.render(scene, camera, settings)
})
