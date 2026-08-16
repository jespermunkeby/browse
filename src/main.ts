import "./style.css"
import * as THREE from "three"
import { badgeTexture } from "./badge.ts"
import { SPHERE_RADIUS, fibonacciSphere } from "./fibonacciSphere.ts"
import { COUNT, orientedSpiral, reassign } from "./assign.ts"

const sim = {
  spring: 0.55,
  damping: 0.45,
  spin: 0.85,
  alignSpring: 0.22,
  alignDamping: 0.85,
  alignMass: 1,
}

const tweakFields: { key: keyof typeof sim; label: string; min: number; max: number; step: number }[] = [
  { key: "spring", label: "Spring", min: 0, max: 1.5, step: 0.05 },
  { key: "damping", label: "Damping", min: 0.05, max: 1.4, step: 0.05 },
  { key: "spin", label: "Spin", min: 0, max: 2, step: 0.05 },
  { key: "alignSpring", label: "Align spring", min: 0, max: 1.5, step: 0.05 },
  { key: "alignDamping", label: "Align damping", min: 0.05, max: 1.4, step: 0.05 },
  { key: "alignMass", label: "Align mass", min: 0.2, max: 4, step: 0.1 },
]

const CROSSHAIR_PX = 14

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!
const crosshair = document.querySelector<HTMLElement>(".crosshair")!
const tweaks = document.querySelector<HTMLElement>("#tweaks")!

let showSpiral = true

const formatTweak = (value: number, step: number) => value.toFixed(step < 0.1 ? 2 : 1)

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

const velocity = new Float32Array(COUNT * 3)
const seek = new Float32Array(COUNT * 3)
let center = 0
let twist = 0
let aimed = -1
let lastTime = performance.now()
let pointerDown = { x: 0, y: 0 }
let dragging = false

const readPositions = () => {
  const positions = new Float32Array(COUNT * 3)
  for (let i = 0; i < COUNT; i++) {
    const p = (markers.children[i] as THREE.Sprite).position
    positions[i * 3] = p.x
    positions[i * 3 + 1] = p.y
    positions[i * 3 + 2] = p.z
  }
  return positions
}

const setSeek = (index: number) => {
  const assignment = reassign(readPositions(), COUNT, index, SPHERE_RADIUS)
  seek.set(assignment.targets)
  twist = assignment.twist
  center = index
  highlightMarkers()
}

const highlightMarkers = () => {
  for (let i = 0; i < COUNT; i++) {
    const marker = markers.children[i] as THREE.Sprite
    marker.material.color.set(i === center ? 0xffc14d : i === aimed ? 0x9ad1ff : 0xffffff)
  }
  crosshair.classList.toggle("is-hot", aimed >= 0 && aimed !== center)
}

const setSpiral = () => {
  if (!showSpiral) return
  const pole = (markers.children[center] as THREE.Sprite).position
  const curve = orientedSpiral(COUNT, SPHERE_RADIUS, pole, twist)
  const points = curve.length / 3
  const colors = new Float32Array(points * 3)
  for (let i = 0; i < points; i++) {
    const fade = 0.28 + 0.72 * (1 - i / (points - 1))
    colors[i * 3] = fade
    colors[i * 3 + 1] = 0.757 * fade
    colors[i * 3 + 2] = 0.302 * fade
  }
  spiralGeometry.setAttribute("position", new THREE.BufferAttribute(curve, 3))
  spiralGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
  spiralGeometry.computeBoundingSphere()
}

const pointerNdc = (event: PointerEvent) => {
  const rect = canvas.getBoundingClientRect()
  ndc.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  )
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
    const pos = (markers.children[i] as THREE.Sprite).position
    velVec.crossVectors(forceVec, pos)
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
    worldPole.copy((markers.children[center] as THREE.Sprite).position).normalize()
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
  const steps = Math.max(1, Math.ceil(dt / 0.008))
  const h = dt / steps

  for (let i = 0; i < COUNT; i++) {
    const pos = (markers.children[i] as THREE.Sprite).position
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
    const marker = markers.children[i] as THREE.Sprite
    pickWorld.copy(marker.position).applyMatrix4(content.matrixWorld)
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

const nearestToCrosshair = () =>
  pickIndexAt(canvas.clientWidth * 0.5, canvas.clientHeight * 0.5, Infinity)

const layout = () => {
  const slots = fibonacciSphere(COUNT, SPHERE_RADIUS)
  const scale = Math.max(0.04, 0.34 / Math.sqrt(COUNT))
  for (let i = 0; i < COUNT; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }))
    sprite.userData.index = i
    sprite.material.map = badgeTexture(i + 1)
    sprite.material.needsUpdate = true
    sprite.scale.setScalar(scale)
    const slot = COUNT - 1 - i
    sprite.position.set(slots[slot * 3], slots[slot * 3 + 1], slots[slot * 3 + 2])
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

addEventListener("resize", resize)

resize()
layout()
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

  if (nextAimed >= 0 && nextAimed !== center) setSeek(nextAimed)

  if (dragging) {
    const ang = readContentDelta()
    if (dt > 1e-5 && ang > 1e-6 && omega.lengthSq() > 1e-12) alignVel.copy(omega).setLength(ang / dt)
    else alignVel.set(0, 0, 0)
    kickPointsFromSpin(ang)
  } else {
    autoAlign(dt)
  }

  stepPhysics(dt)
  setSpiral()
  renderer.render(scene, camera)
})
