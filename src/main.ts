import "./style.css"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { badgeTexture } from "./badge.ts"
import { SPHERE_RADIUS, fibonacciSphere } from "./fibonacciSphere.ts"
import { METHODS, OPTIMAL_MAX, orientedSpiral, reassign, type Assignment, type MethodId, type Metrics } from "./assign.ts"

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!
const slider = document.querySelector<HTMLInputElement>("#count")!
const value = document.querySelector<HTMLOutputElement>("#count-value")!
const rotationSlider = document.querySelector<HTMLInputElement>("#rotation")!
const rotationValue = document.querySelector<HTMLOutputElement>("#rotation-value")!
const centerLine = document.querySelector<HTMLDivElement>("#center-line")!
const methodsBody = document.querySelector<HTMLTableSectionElement>("#methods-body")!
const methodHint = document.querySelector<HTMLParagraphElement>("#method-hint")!
const twistSlider = document.querySelector<HTMLInputElement>("#twist")!
const twistValue = document.querySelector<HTMLOutputElement>("#twist-value")!
const autoTwist = document.querySelector<HTMLInputElement>("#auto-twist")!
const playButton = document.querySelector<HTMLButtonElement>("#play")!
const resetButton = document.querySelector<HTMLButtonElement>("#reset")!

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x111111)

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
camera.position.set(0, 0, 3.2)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.enablePan = false

scene.add(new THREE.AmbientLight(0xffffff, 0.55))
const light = new THREE.DirectionalLight(0xffffff, 0.9)
light.position.set(2, 2, 3)
scene.add(light)

scene.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.85 }),
  ),
)

const content = new THREE.Group()
scene.add(content)

const markers = new THREE.Group()
content.add(markers)

const trailGeometry = new THREE.BufferGeometry()
const trailMaterial = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.85,
  depthTest: false,
  depthWrite: false,
})
const trails = new THREE.LineSegments(trailGeometry, trailMaterial)
trails.frustumCulled = false
trails.renderOrder = 1
content.add(trails)

const spiralGeometry = new THREE.BufferGeometry()
const spiralMaterial = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.95,
  depthTest: false,
  depthWrite: false,
})
const spiral = new THREE.Line(spiralGeometry, spiralMaterial)
spiral.frustumCulled = false
spiral.renderOrder = 2
spiral.visible = false
content.add(spiral)

const poleVec = new THREE.Vector3()

const pointer = new THREE.Vector2()
const pickWorld = new THREE.Vector3()
const fromVec = new THREE.Vector3()
const toVec = new THREE.Vector3()
const midVec = new THREE.Vector3()

let count = 0
let selectedMethod: MethodId = "squared"
let center: number | null = null
let snapshot: Float32Array | null = null
let results = new Map<MethodId, Assignment>()
let animation: {
  from: Float32Array
  to: Float32Array
  start: number
  duration: number
} | null = null
let pointerDown = { x: 0, y: 0 }
let syncingTwist = false
let compareTimer = 0

const markerAt = (index: number) => {
  const existing = markers.children[index] as THREE.Sprite | undefined
  if (existing) return existing

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }))
  sprite.userData.index = index
  markers.add(sprite)
  return sprite
}

const readPositions = () => {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const p = (markers.children[i] as THREE.Sprite).position
    positions[i * 3] = p.x
    positions[i * 3 + 1] = p.y
    positions[i * 3 + 2] = p.z
  }
  return positions
}

const writePositions = (positions: Float32Array) => {
  for (let i = 0; i < count; i++) {
    ;(markers.children[i] as THREE.Sprite).position.set(
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
    )
  }
}

const slerpOnSphere = (from: THREE.Vector3, to: THREE.Vector3, t: number, out: THREE.Vector3) => {
  const d = Math.min(1, Math.max(-1, from.dot(to) / (from.length() * to.length())))
  const w = Math.acos(d)
  if (w < 1e-5) return out.copy(from).lerp(to, t).setLength(SPHERE_RADIUS)
  const s = Math.sin(w)
  out.copy(from).multiplyScalar(Math.sin((1 - t) * w) / s)
  out.addScaledVector(to, Math.sin(t * w) / s)
  return out.setLength(SPHERE_RADIUS)
}

const TRAIL_SEGMENTS = 14
const TRAIL_CAP = 180

const setTrails = (from: Float32Array, to: Float32Array) => {
  const moves: { i: number; deg: number }[] = []
  for (let i = 0; i < count; i++) {
    fromVec.set(from[i * 3], from[i * 3 + 1], from[i * 3 + 2])
    toVec.set(to[i * 3], to[i * 3 + 1], to[i * 3 + 2])
    const deg = THREE.MathUtils.radToDeg(fromVec.angleTo(toVec))
    if (deg > 0.15) moves.push({ i, deg })
  }
  moves.sort((a, b) => b.deg - a.deg)
  const shown = moves.slice(0, TRAIL_CAP)
  const maxDeg = shown[0]?.deg ?? 1

  const verts = new Float32Array(shown.length * TRAIL_SEGMENTS * 2 * 3)
  const colors = new Float32Array(shown.length * TRAIL_SEGMENTS * 2 * 3)
  let w = 0

  for (const move of shown) {
    fromVec.set(from[move.i * 3], from[move.i * 3 + 1], from[move.i * 3 + 2])
    toVec.set(to[move.i * 3], to[move.i * 3 + 1], to[move.i * 3 + 2])
    const weight = 0.22 + 0.78 * (move.deg / maxDeg)
    for (let s = 0; s < TRAIL_SEGMENTS; s++) {
      slerpOnSphere(fromVec, toVec, s / TRAIL_SEGMENTS, midVec)
      verts[w] = midVec.x
      verts[w + 1] = midVec.y
      verts[w + 2] = midVec.z
      slerpOnSphere(fromVec, toVec, (s + 1) / TRAIL_SEGMENTS, midVec)
      verts[w + 3] = midVec.x
      verts[w + 4] = midVec.y
      verts[w + 5] = midVec.z
      const c0 = 0.25 + 0.75 * weight * (s / TRAIL_SEGMENTS)
      const c1 = 0.25 + 0.75 * weight * ((s + 1) / TRAIL_SEGMENTS)
      colors[w] = colors[w + 1] = colors[w + 2] = c0
      colors[w + 3] = colors[w + 4] = colors[w + 5] = c1
      w += 6
    }
  }

  trailGeometry.setAttribute("position", new THREE.BufferAttribute(verts, 3))
  trailGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
  trailGeometry.computeBoundingSphere()
}

const clearTrails = () => {
  trailGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3))
  trailGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(0), 3))
}

const setSpiral = (twistRad: number) => {
  if (center === null || !snapshot || count < 2) {
    spiral.visible = false
    return
  }

  poleVec.set(snapshot[center * 3], snapshot[center * 3 + 1], snapshot[center * 3 + 2])
  const curve = orientedSpiral(count, SPHERE_RADIUS, poleVec, twistRad)
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
  spiral.visible = true
}

const clearSpiral = () => {
  spiral.visible = false
}

const highlightCenter = () => {
  for (let i = 0; i < count; i++) {
    const marker = markers.children[i] as THREE.Sprite
    marker.material.color.set(i === center ? 0xffc14d : 0xffffff)
  }
}

const fmtDeg = (deg: number) => `${deg < 10 ? deg.toFixed(1) : Math.round(deg)}°`

const paintMethods = () => {
  for (const row of Array.from(methodsBody.querySelectorAll("tr"))) {
    const id = row.dataset.method as MethodId
    const blocked = METHODS.find((m) => m.id === id)?.heavy && count > OPTIMAL_MAX
    row.classList.toggle("active", id === selectedMethod)
    row.classList.toggle("disabled", Boolean(blocked))
    const assignment = results.get(id)
    const cells = row.querySelectorAll("td")
    if (blocked) {
      cells[1].textContent = "—"
      cells[2].textContent = "—"
      cells[3].textContent = `>${OPTIMAL_MAX}`
    } else if (assignment) {
      cells[1].textContent = fmtDeg(assignment.metrics.meanDeg)
      cells[2].textContent = fmtDeg(assignment.metrics.maxDeg)
      cells[3].textContent = String(assignment.metrics.crossings)
    } else if (center !== null && METHODS.find((m) => m.id === id)?.heavy) {
      cells[1].textContent = "…"
      cells[2].textContent = "…"
      cells[3].textContent = "…"
    } else {
      cells[1].textContent = "—"
      cells[2].textContent = "—"
      cells[3].textContent = "—"
    }
  }
  methodHint.textContent = METHODS.find((m) => m.id === selectedMethod)?.hint ?? ""
}

const showTwist = (metrics?: Metrics) => {
  if (!metrics) {
    twistValue.value = autoTwist.checked ? "auto" : `${twistSlider.value}°`
    return
  }
  syncingTwist = true
  twistSlider.value = String(Math.round(metrics.twistDeg))
  syncingTwist = false
  twistValue.value = autoTwist.checked ? `${Math.round(metrics.twistDeg)}° auto` : `${Math.round(metrics.twistDeg)}°`
}

const twistOverride = () =>
  autoTwist.checked ? undefined : THREE.MathUtils.degToRad(twistSlider.valueAsNumber)

const compute = (method: MethodId) => {
  if (!snapshot || center === null) return
  if (METHODS.find((m) => m.id === method)?.heavy && count > OPTIMAL_MAX) return
  results.set(
    method,
    reassign({
      positions: snapshot,
      count,
      center,
      method,
      radius: SPHERE_RADIUS,
      twist: twistOverride(),
    }),
  )
}

const playAssignment = (assignment: Assignment) => {
  const from = snapshot ?? readPositions()
  writePositions(from)
  setTrails(from, assignment.targets)
  setSpiral(THREE.MathUtils.degToRad(assignment.metrics.twistDeg))
  showTwist(assignment.metrics)
  animation = {
    from,
    to: assignment.targets,
    start: performance.now(),
    duration: 1100,
  }
  playButton.disabled = false
}

const currentAssignment = () =>
  results.get(selectedMethod) ?? results.get("greedy") ?? results.get("polar")

const applySelected = (animate: boolean) => {
  const assignment = currentAssignment()
  if (!assignment) return
  if (animate) playAssignment(assignment)
  else {
    writePositions(assignment.targets)
    setTrails(snapshot ?? assignment.targets, assignment.targets)
    setSpiral(THREE.MathUtils.degToRad(assignment.metrics.twistDeg))
    showTwist(assignment.metrics)
    animation = null
    playButton.disabled = false
  }
}

const fillCompare = (priority: MethodId) => {
  results.clear()
  for (const method of METHODS) {
    if (method.heavy) continue
    compute(method.id)
  }
  compute(priority)
  paintMethods()
  applySelected(true)

  window.clearTimeout(compareTimer)
  compareTimer = window.setTimeout(() => {
    for (const method of METHODS) {
      if (!method.heavy || results.has(method.id)) continue
      compute(method.id)
    }
    paintMethods()
  }, 30)
}

const selectCenter = (index: number) => {
  animation = null
  center = index
  snapshot = readPositions()
  centerLine.textContent = `${index + 1} is the new 1`
  highlightCenter()
  fillCompare(selectedMethod)
}

const layoutCanonical = (nextCount: number) => {
  const positions = fibonacciSphere(nextCount, SPHERE_RADIUS)
  const scale = Math.max(0.04, 0.34 / Math.sqrt(nextCount))

  for (let i = 0; i < nextCount; i++) {
    const marker = markerAt(i)
    marker.material.map = badgeTexture(i + 1)
    marker.material.needsUpdate = true
    marker.material.color.set(0xffffff)
    const slot = nextCount - 1 - i
    marker.position.set(positions[slot * 3], positions[slot * 3 + 1], positions[slot * 3 + 2])
    marker.scale.setScalar(scale)
    marker.visible = true
  }

  for (let i = nextCount; i < markers.children.length; i++) {
    markers.children[i].visible = false
  }
}

const setCount = (nextCount: number) => {
  count = nextCount
  center = null
  snapshot = null
  results.clear()
  animation = null
  layoutCanonical(nextCount)
  clearTrails()
  clearSpiral()
  centerLine.textContent = "No center selected"
  playButton.disabled = true
  showTwist()
  paintMethods()
  value.value = String(nextCount)
}

const setRotation = (degrees: number) => {
  content.rotation.y = THREE.MathUtils.degToRad(degrees)
  rotationValue.value = `${degrees}°`
}

const reset = () => {
  setCount(count)
}

for (const method of METHODS) {
  const row = document.createElement("tr")
  row.dataset.method = method.id
  row.innerHTML = `<td>${method.label}</td><td>—</td><td>—</td><td>—</td>`
  row.addEventListener("click", () => {
    if (method.heavy && count > OPTIMAL_MAX) return
    selectedMethod = method.id
    paintMethods()
    if (center === null) return
    if (!results.has(method.id)) compute(method.id)
    paintMethods()
    applySelected(true)
  })
  methodsBody.append(row)
}
paintMethods()

const resize = () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight, false)
}

slider.addEventListener("input", () => setCount(slider.valueAsNumber))
rotationSlider.addEventListener("input", () => setRotation(rotationSlider.valueAsNumber))
playButton.addEventListener("click", () => {
  const assignment = currentAssignment()
  if (assignment && snapshot) {
    writePositions(snapshot)
    playAssignment(assignment)
  }
})
resetButton.addEventListener("click", reset)
autoTwist.addEventListener("change", () => {
  if (center === null) {
    showTwist()
    return
  }
  fillCompare(selectedMethod)
})
twistSlider.addEventListener("input", () => {
  if (syncingTwist) return
  autoTwist.checked = false
  twistValue.value = `${twistSlider.value}°`
  if (center === null || !snapshot) return
  compute(selectedMethod)
  paintMethods()
  applySelected(false)
})
twistSlider.addEventListener("change", () => {
  if (center === null) return
  fillCompare(selectedMethod)
})

canvas.addEventListener("pointerdown", (event) => {
  pointerDown = { x: event.clientX, y: event.clientY }
})

const pickIndex = (ndc: THREE.Vector2) => {
  let best = -1
  let bestDist = 0.05
  content.updateWorldMatrix(true, true)
  for (let i = 0; i < count; i++) {
    const marker = markers.children[i] as THREE.Sprite
    if (!marker.visible) continue
    pickWorld.copy(marker.position).applyMatrix4(content.matrixWorld).project(camera)
    const dist = Math.hypot(pickWorld.x - ndc.x, pickWorld.y - ndc.y)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

canvas.addEventListener("pointerup", (event) => {
  if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return
  const rect = canvas.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  const index = pickIndex(pointer)
  if (index >= 0) selectCenter(index)
})

addEventListener("resize", resize)

resize()
setCount(slider.valueAsNumber)
setRotation(rotationSlider.valueAsNumber)

renderer.setAnimationLoop(() => {
  if (animation) {
    const t = Math.min(1, (performance.now() - animation.start) / animation.duration)
    const e = t * t * (3 - 2 * t)
    for (let i = 0; i < count; i++) {
      fromVec.set(animation.from[i * 3], animation.from[i * 3 + 1], animation.from[i * 3 + 2])
      toVec.set(animation.to[i * 3], animation.to[i * 3 + 1], animation.to[i * 3 + 2])
      slerpOnSphere(fromVec, toVec, e, midVec)
      ;(markers.children[i] as THREE.Sprite).position.copy(midVec)
    }
    if (t >= 1) animation = null
  }
  controls.update()
  renderer.render(scene, camera)
})
