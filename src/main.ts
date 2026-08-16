import "./style.css"
import * as THREE from "three"
import { badgeTexture } from "./badge.ts"
import {
  COUNT,
  SPHERE_RADIUS,
  SPIRAL_MAX_POINTS,
  slotPoint,
  slotRange,
  writeOrientedSpiral,
  writeSlotTargets,
  writeSlotVelocities,
} from "./lattice.ts"
import { reassign } from "./assign.ts"

const sim = {
  spring: 0.2,
  damping: 0.5,
  spin: 0.85,
  alignSpring: 0.8,
  alignDamping: 0.4,
  alignMass: 1.1,
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
  { key: "zoom", label: "Zoom speed", min: 0.002, max: 0.05, step: 0.002 },
  { key: "zoomDamp", label: "Zoom damp", min: 0.4, max: 10, step: 0.2 },
  { key: "zoomHandoff", label: "Zoom handoff", min: 0, max: 10, step: 0.1 },
]

const CROSSHAIR_PX = 14
const PAN_ROTATE = 0.0024

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!
const crosshair = document.querySelector<HTMLElement>(".crosshair")!
const tweaks = document.querySelector<HTMLElement>("#tweaks")!

let showSpiral = true

const formatTweak = (value: number, step: number) => value.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)

const spiralToggle = document.createElement("label")
spiralToggle.className = "toggle"
const spiralCheck = document.createElement("input")
spiralCheck.type = "checkbox"
spiralCheck.checked = showSpiral
spiralToggle.append(spiralCheck, Object.assign(document.createElement("span"), { textContent: "Show spiral" }))
tweaks.append(spiralToggle)

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
  tweaks.append(label)
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x111111)

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
camera.position.set(0, 0, 3.2)

scene.add(new THREE.AmbientLight(0xffffff, 0.55))
const light = new THREE.DirectionalLight(0xffffff, 0.9)
light.position.set(2, 2, 3)
scene.add(light)

const content = new THREE.Group()
scene.add(content)
content.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.85 }),
  ),
)

const markers = new THREE.Group()
content.add(markers)

const spiralGeometry = new THREE.BufferGeometry()
const spiral = new THREE.Line(
  spiralGeometry,
  new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  }),
)
spiral.frustumCulled = false
spiral.renderOrder = 2
content.add(spiral)

spiralCheck.addEventListener("change", () => {
  showSpiral = spiralCheck.checked
  spiral.visible = showSpiral
  if (showSpiral) {
    lastSpiralGrowth = Number.NaN
    setSpiral()
  }
})

const pickWorld = new THREE.Vector3()
const seekVec = new THREE.Vector3()
const axisVec = new THREE.Vector3()
const forceVec = new THREE.Vector3()
const velVec = new THREE.Vector3()
const omega = new THREE.Vector3()
const viewDir = new THREE.Vector3()
const worldPole = new THREE.Vector3()
const ndc = new THREE.Vector2()
const prevHit = new THREE.Vector3()
const currHit = new THREE.Vector3()
const rotQ = new THREE.Quaternion()
const alignQ = new THREE.Quaternion()
const lastContentQ = new THREE.Quaternion()
const invQ = new THREE.Quaternion()
const alignVel = new THREE.Vector3()

const positions = new Float32Array(COUNT * 3)
const velocity = new Float32Array(COUNT * 3)
const seek = new Float32Array(COUNT * 3)
const slotK = new Int32Array(COUNT)
const numbers = new Int32Array(COUNT)
const behind: number[] = []
const ahead: number[] = []
const occupied = new Uint8Array(COUNT + 2)
const entering = new Int32Array(COUNT)
const poleDir = new THREE.Vector3(0, -1, 0)
const lastSpiralPole = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN)
const spiralPos = new Float32Array(SPIRAL_MAX_POINTS * 3)
const spiralCol = new Float32Array(SPIRAL_MAX_POINTS * 3)
let growth = 0
let zoomVel = 0
let center = 0
let twist = 0
let nextId = COUNT + 1
let aimed = -1
let lastTime = performance.now()
let pointerDown = { x: 0, y: 0 }
let dragging = false
let lastActiveWheel = 0
let lastWheelMag = 0
let wheelDecay = 0
let lastZoom = 0
let panVx = 0
let panVy = 0
let handedOff = true
let spiralReady = false
let lastSpiralGrowth = Number.NaN
let lastSpiralTwist = Number.NaN
let lastSpiralPoints = 0

const marker = (i: number) => markers.children[i] as THREE.Sprite

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

const resetZoomWindow = () => {
  growth = 0
  zoomVel = 0
  behind.length = 0
  ahead.length = 0
  nextId = 1
  for (let i = 0; i < COUNT; i++) nextId = Math.max(nextId, numbers[i] + 1)
}

const highlightMarkers = () => {
  for (let i = 0; i < COUNT; i++) {
    marker(i).material.color.set(i === center ? 0xffc14d : i === aimed ? 0x9ad1ff : 0xffffff)
  }
  crosshair.classList.toggle("is-hot", aimed >= 0 && aimed !== center)
}

const setSeek = (index: number) => {
  const assignment = reassign(readPositions(), index)
  seek.set(assignment.targets)
  twist = assignment.twist
  center = index
  poleDir.copy(marker(index).position).normalize()
  slotK.set(assignment.ranks)
  resetZoomWindow()
  highlightMarkers()
}

const zooming = () => Math.abs(zoomVel) > sim.zoomHandoff

const setSpiral = () => {
  if (!showSpiral) return
  if (
    spiralReady &&
    growth === lastSpiralGrowth &&
    twist === lastSpiralTwist &&
    lastSpiralPole.equals(poleDir)
  ) {
    return
  }

  const points = writeOrientedSpiral(poleDir, twist, growth, spiralPos)
  if (!spiralReady) {
    spiralGeometry.setAttribute("position", new THREE.BufferAttribute(spiralPos, 3))
    spiralGeometry.setAttribute("color", new THREE.BufferAttribute(spiralCol, 3))
    spiralReady = true
  } else {
    spiralGeometry.getAttribute("position").needsUpdate = true
  }
  if (points !== lastSpiralPoints) {
    const fadeDen = Math.max(points - 1, 1)
    for (let i = 0; i < points; i++) {
      const fade = 0.28 + 0.72 * (1 - i / fadeDen)
      spiralCol[i * 3] = fade
      spiralCol[i * 3 + 1] = 0.757 * fade
      spiralCol[i * 3 + 2] = 0.302 * fade
    }
    spiralGeometry.getAttribute("color").needsUpdate = true
    lastSpiralPoints = points
  }
  spiralGeometry.setDrawRange(0, points)
  lastSpiralGrowth = growth
  lastSpiralTwist = twist
  lastSpiralPole.copy(poleDir)
}

const setNumber = (index: number, n: number) => {
  numbers[index] = n
  marker(index).material.map = badgeTexture(n)
  marker(index).material.needsUpdate = true
}

const takeId = (stack: number[]) => stack.pop() ?? nextId++

const placeOnLattice = () => {
  writeSlotTargets(slotK, growth, poleDir, twist, seek)
  for (let i = 0; i < COUNT; i++) {
    marker(i).position.set(seek[i * 3], seek[i * 3 + 1], seek[i * 3 + 2])
    velocity[i * 3] = 0
    velocity[i * 3 + 1] = 0
    velocity[i * 3 + 2] = 0
  }
}

const syncSlotsToGrowth = () => {
  const { kMin, kMax } = slotRange(growth)
  const span = kMax - kMin + 1
  occupied.fill(0, 0, span)
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
      behind.push(numbers[i])
      setNumber(i, takeId(ahead))
    } else {
      ahead.push(numbers[i])
      setNumber(i, takeId(behind))
    }
    slotK[i] = next
  }
}

const kickZoom = (impulse: number) => {
  if (impulse === 0) return
  if (!zooming() && growth === 0 && behind.length === 0 && ahead.length === 0) {
    poleDir.copy(marker(center).position).normalize()
  }
  zoomVel += impulse
}

const handoffZoom = (delayRecenter = true) => {
  if (Math.abs(zoomVel) <= 1e-8) return
  syncSlotsToGrowth()
  writeSlotTargets(slotK, growth, poleDir, twist, seek)
  writeSlotVelocities(slotK, growth, poleDir, twist, zoomVel, velocity)
  for (let i = 0; i < COUNT; i++) {
    marker(i).position.set(seek[i * 3], seek[i * 3 + 1], seek[i * 3 + 2])
  }
  zoomVel = 0
  center = polePoint()
  if (delayRecenter) lastZoom = performance.now()
  highlightMarkers()
}

const stepZoom = (dt: number) => {
  if (!zooming()) {
    if (Math.abs(zoomVel) > 1e-8) handoffZoom()
    else zoomVel = 0
    return false
  }
  growth += zoomVel * dt
  zoomVel *= Math.exp(-sim.zoomDamp * dt)
  if (!zooming()) {
    handoffZoom()
    return false
  }
  syncSlotsToGrowth()
  placeOnLattice()
  const nextCenter = polePoint()
  if (nextCenter !== center) {
    center = nextCenter
    highlightMarkers()
  }
  return true
}

const pointerNdc = (event: PointerEvent) => {
  const rect = canvas.getBoundingClientRect()
  ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  return ndc
}

const ndcToBall = (x: number, y: number, out: THREE.Vector3) => {
  const d = x * x + y * y
  if (d > 1) {
    const inv = 1 / Math.sqrt(d)
    return out.set(x * inv, y * inv, 0)
  }
  return out.set(x, y, Math.sqrt(1 - d))
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
    worldPole.copy(poleDir).normalize()
    worldPole.applyQuaternion(content.quaternion)
    viewDir.copy(camera.position).normalize()
    rotQ.setFromUnitVectors(worldPole, viewDir)
    const ang = 2 * Math.acos(Math.min(1, Math.max(-1, rotQ.w)))
    if (ang > 1e-6) axisVec.set(rotQ.x, rotQ.y, rotQ.z).setLength(ang)
    else axisVec.set(0, 0, 0)
    forceVec.copy(axisVec).multiplyScalar(k).addScaledVector(alignVel, -c)
    alignVel.addScaledVector(forceVec, dt / mass)
  }
  applySphereSpin(dt)
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

const pickIndexAt = (sx: number, sy: number, radiusPx: number) => {
  let best = -1
  let bestDist = radiusPx
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  content.updateWorldMatrix(true, true)
  for (let i = 0; i < COUNT; i++) {
    pickWorld.copy(marker(i).position).applyMatrix4(content.matrixWorld)
    if (pickWorld.dot(camera.position) <= 0) continue
    pickWorld.project(camera)
    if (pickWorld.z < -1 || pickWorld.z > 1) continue
    const x = (pickWorld.x * 0.5 + 0.5) * w
    const y = (-pickWorld.y * 0.5 + 0.5) * h
    const dist = Math.hypot(x - sx, y - sy)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

const nearestToCrosshair = () => pickIndexAt(canvas.clientWidth * 0.5, canvas.clientHeight * 0.5, Infinity)

const layout = () => {
  const scale = Math.max(0.04, 0.34 / Math.sqrt(COUNT))
  for (let i = 0; i < COUNT; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }))
    sprite.userData.index = i
    numbers[i] = i + 1
    slotK[i] = i
    sprite.material.map = badgeTexture(numbers[i])
    sprite.material.needsUpdate = true
    sprite.scale.setScalar(scale)
    const point = slotPoint(i, 0)
    sprite.position.set(point[0], point[1], point[2])
    markers.add(sprite)
  }
}

const resize = () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight, false)
}

const rotateByPointer = (event: PointerEvent) => {
  pointerNdc(event)
  ndcToBall(ndc.x, ndc.y, currHit)
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
  ndcToBall(ndc.x, ndc.y, prevHit)
  lastContentQ.copy(content.quaternion)
  canvas.setPointerCapture(event.pointerId)
})

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return
  rotateByPointer(event)
})

canvas.addEventListener("pointerup", (event) => {
  if (!dragging) return
  dragging = false
  const dragged = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5
  const nearest = nearestToCrosshair()
  if (nearest >= 0 && nearest !== center) setSeek(nearest)
  else if (!dragged) {
    const rect = canvas.getBoundingClientRect()
    const index = pickIndexAt(event.clientX - rect.left, event.clientY - rect.top, CROSSHAIR_PX)
    if (index >= 0) setSeek(index)
  }
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
  if (handedOff) return mag <= lastWheelMag * 1.2
  if (mag + 0.2 < lastWheelMag * 0.86) wheelDecay += 1
  else if (mag > lastWheelMag) wheelDecay = 0
  lastWheelMag = mag
  return wheelDecay >= 2
}

const handoffPan = () => {
  if (handedOff) return
  handedOff = true
  const mass = Math.max(0.05, sim.alignMass)
  alignVel.x = panVx / mass
  alignVel.y = panVy / mass
  panVx = 0
  panVy = 0
}

canvas.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey) {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1
      lastZoom = performance.now()
      kickZoom(-event.deltaY * unit * sim.zoom * 28)
      return
    }
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1
    const dx = event.deltaX * unit
    const dy = event.deltaY * unit
    const mag = Math.hypot(dx, dy)
    if (mag === 0) return
    const now = performance.now()
    handoffZoom(false)
    if (isOsMomentum(event, mag)) {
      lastWheelMag = mag
      handoffPan()
      return
    }
    if (handedOff) {
      alignVel.set(0, 0, 0)
      wheelDecay = 0
    }
    lastWheelMag = mag
    const dt = Math.min(0.05, Math.max(0.008, (now - lastActiveWheel) / 1000))
    lastActiveWheel = now
    handedOff = false
    rotQ.setFromAxisAngle(axisVec.set(0, 1, 0), -dx * PAN_ROTATE)
    content.quaternion.premultiply(rotQ)
    rotQ.setFromAxisAngle(axisVec.set(1, 0, 0), -dy * PAN_ROTATE)
    content.quaternion.premultiply(rotQ)
    panVx = (-dy * PAN_ROTATE) / dt
    panVy = (-dx * PAN_ROTATE) / dt
  },
  { passive: false },
)

addEventListener("resize", resize)

resize()
layout()
poleDir.copy(marker(0).position).normalize()
seek.set(readPositions())
lastContentQ.copy(content.quaternion)
highlightMarkers()
setSpiral()

renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.05, (now - lastTime) / 1000)
  lastTime = now

  const nextAimed = nearestToCrosshair()
  if (nextAimed !== aimed) {
    aimed = nextAimed
    highlightMarkers()
  }

  if (!dragging && !handedOff && now - lastActiveWheel > 80) handoffPan()
  const lastInteract = Math.max(lastZoom, lastActiveWheel)
  const settle = lastActiveWheel >= lastZoom ? 80 : 120
  if (
    !zooming() &&
    !dragging &&
    handedOff &&
    now - lastInteract > settle &&
    nextAimed >= 0 &&
    nextAimed !== center
  ) {
    setSeek(nextAimed)
  }

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

  setSpiral()
  renderer.render(scene, camera)
})
