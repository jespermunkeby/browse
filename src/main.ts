import "./style.css"
import * as THREE from "three"
import {
  COUNT,
  MAX_COUNT,
  MIN_COUNT,
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
import { disposePhoto, isImageFile, isImagePath, photoFromFile, photoSize, type Photo } from "./photos.ts"
import {
  filesFromDataTransfer,
  filesFromList,
  findFile,
  renderTree,
  treeFromFiles,
  type FolderFile,
  type TreeNode,
} from "./folder.ts"
import { renderMeta, type MetaSource } from "./meta.ts"
import { fetchDemoFile, loadDemoIndex } from "./defaultFolder.ts"

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
  inspectSpring: 0.45,
  inspectDamping: 0.6,
  inspectMass: 1,
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
  { key: "inspectSpring", label: "Inspect spring", min: 0, max: 1.5, step: 0.05 },
  { key: "inspectDamping", label: "Inspect damping", min: 0.05, max: 1.4, step: 0.05 },
  { key: "inspectMass", label: "Inspect mass", min: 0.2, max: 4, step: 0.1 },
  { key: "zoom", label: "Zoom speed", min: 0.002, max: 0.05, step: 0.002 },
  { key: "zoomDamp", label: "Zoom damp", min: 0.4, max: 10, step: 0.2 },
  { key: "zoomHandoff", label: "Zoom handoff", min: 0, max: 10, step: 0.1 },
]

const PICK_PAD = 4
const PAN_ROTATE = 0.0048
const PAN_HANDOFF_MS = 140
const PAN_VEL_SMOOTH = 0.38
const FOCUS_STABLE_MS = 160
const ZOOM_LOCK_MS = 260
const PAN_CLASSIFY_MS = 70
const FRAME = 1.12

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!
const tweaks = document.querySelector<HTMLElement>("#tweaks")!
const motion = document.querySelector<HTMLElement>("#motion")!
const viewPanel = document.querySelector<HTMLElement>("#viewPanel")!
const treeEl = document.querySelector<HTMLElement>("#tree")!
const metaEl = document.querySelector<HTMLElement>("#meta")!
const dataTab = document.querySelector<HTMLButtonElement>("#dataTab")!
const settingsTab = document.querySelector<HTMLButtonElement>("#settingsTab")!
const fileInput = document.querySelector<HTMLInputElement>("#file")!
const addMore = document.querySelector<HTMLButtonElement>("#addMore")!
const clearImages = document.querySelector<HTMLButtonElement>("#clearImages")!
const imageCount = document.querySelector<HTMLElement>("#imageCount")!
const paletteEl = document.querySelector<HTMLElement>("#palette")!
const primaryColor = document.querySelector<HTMLInputElement>("#primaryColor")!
const secondaryColor = document.querySelector<HTMLInputElement>("#secondaryColor")!
const addColor = document.querySelector<HTMLButtonElement>("#addColor")!
const modeSelect = document.querySelector<HTMLSelectElement>("#mode")!
const coarsenessInput = document.querySelector<HTMLInputElement>("#coarseness")!
const coarsenessVal = document.querySelector<HTMLElement>("#coarsenessVal")!
const copySettings = document.querySelector<HTMLButtonElement>("#copySettings")!
const pasteSettings = document.querySelector<HTMLButtonElement>("#pasteSettings")!
const projectionSelect = document.querySelector<HTMLSelectElement>("#projection")!
const spiralCheck = document.querySelector<HTMLInputElement>("#spiral")!
const imageAreaInput = document.querySelector<HTMLInputElement>("#imageArea")!
const areaVal = document.querySelector<HTMLElement>("#areaVal")!
const sphereCountInput = document.querySelector<HTMLInputElement>("#sphereCount")!
const sphereCountVal = document.querySelector<HTMLElement>("#sphereCountVal")!
const loadingEl = document.querySelector<HTMLElement>("#loading")!
const loadingText = document.querySelector<HTMLElement>("#loadingText")!
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
const photoByPath = new Map<string, number>()
let folderTree: TreeNode | null = null
let focusedPath: string | null = null
let focusedNode: TreeNode | null = null

let showSpiral = false
let projection: ProjectionId = "stereo"

const formatTweak = (value: number, step: number) => value.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)

const extraJson = () => ({ projection, spiral: showSpiral, motion: { ...sim } })

const motionControls = new Map<keyof typeof sim, { input: HTMLInputElement; value: HTMLElement }>()

const setPane = (pane: "data" | "settings") => {
  const settingsOpen = pane === "settings"
  tweaks.hidden = !settingsOpen
  metaEl.hidden = settingsOpen
  dataTab.classList.toggle("is-active", !settingsOpen)
  settingsTab.classList.toggle("is-active", settingsOpen)
  dataTab.setAttribute("aria-selected", String(!settingsOpen))
  settingsTab.setAttribute("aria-selected", String(settingsOpen))
}

dataTab.addEventListener("click", () => setPane("data"))
settingsTab.addEventListener("click", () => setPane("settings"))

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
sphereCountInput.min = String(MIN_COUNT)
sphereCountInput.max = String(MAX_COUNT)
sphereCountInput.value = String(settings.sphereCount)
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
  motionControls.set(field.key, { input, value })
  label.append(Object.assign(document.createElement("span"), { textContent: field.label }), value, input)
  motion.append(label)
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.setClearColor(settings.primary, 1)

const scene = new THREE.Scene()
scene.background = new THREE.Color(settings.primary)

const camera = new THREE.OrthographicCamera(-FRAME, FRAME, FRAME, -FRAME, -10, 10)
camera.position.set(0, 0, 5)

const ditherPass = createDitherPass(renderer)

const content = new THREE.Group()
scene.add(content)

const markers = new THREE.Group()
content.add(markers)

const thumbGeo = new THREE.PlaneGeometry(1, 1)
{
  const uv = thumbGeo.attributes.uv!
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i)!)
}
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

const overlayScene = new THREE.Scene()
const overlay = new THREE.Mesh(
  thumbGeo,
  new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }),
)
overlay.frustumCulled = false
overlay.visible = false
overlayScene.add(overlay)

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
const plane = new THREE.Vector2()
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
const focusMul = new Float32Array(MAX_COUNT).fill(1)
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
let lastPan = { x: 0, y: 0 }
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
let inspectOpen = false
let inspectPhoto = -1
let inspectSeeded = false
const inspectPos = new THREE.Vector2()
const inspectScale = new THREE.Vector2()
const inspectPosVel = new THREE.Vector2()
const inspectScaleVel = new THREE.Vector2()
const inspectTargetPos = new THREE.Vector2()
const inspectTargetScale = new THREE.Vector2()
const viewRect = { x: 0, y: 0, w: 2, h: 2 }

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

const FOCUS_SCALE = 2
const FOCUS_POP = 26

const thumbSize = (photo: Photo, focused = false) => {
  const size = photoSize(photo.aspect, settings.imageArea)
  if (!focused) return size
  return { w: size.w * FOCUS_SCALE, h: size.h * FOCUS_SCALE }
}

const stepFocusScale = (dt: number) => {
  const ease = 1 - Math.exp(-FOCUS_POP * dt)
  const locked = seeking && handedOff
  for (let i = 0; i < MAX_COUNT; i++) {
    const target = i < COUNT && i === center && locked ? FOCUS_SCALE : 1
    focusMul[i] += (target - focusMul[i]!) * ease
  }
}

const fileMeta = (node: TreeNode): MetaSource | null => {
  if (node.kind !== "file" || !node.file) return null
  const photoIndex = photoByPath.get(node.path)
  const photo = photoIndex === undefined ? undefined : photos[photoIndex]
  return {
    name: node.name,
    path: node.path,
    kind: photo ? "image" : "file",
    type: node.file.type,
    bytes: node.file.size,
    modified: node.file.lastModified,
    width: photo?.width,
    height: photo?.height,
  }
}

const photoMeta = (photo: Photo): MetaSource => ({
  name: photo.name,
  path: photo.path,
  kind: "image",
  type: photo.type,
  bytes: photo.bytes,
  modified: photo.modified,
  width: photo.width,
  height: photo.height,
})

const syncTree = () => renderTree(folderTree, treeEl, focusedPath, (node) => setFocusFromTree(node))

const syncMeta = () => {
  if (focusedNode) {
    renderMeta(metaEl, fileMeta(focusedNode))
    return
  }
  if (focusedPath) {
    const photoIndex = photoByPath.get(focusedPath)
    const photo = photoIndex === undefined ? undefined : photos[photoIndex]
    renderMeta(metaEl, photo ? photoMeta(photo) : null)
    return
  }
  renderMeta(metaEl, null)
}

const setFocusedPath = (path: string | null) => {
  const nextNode = path ? findFile(folderTree, path) : null
  if (path === focusedPath && nextNode === focusedNode) return
  focusedPath = path
  focusedNode = nextNode
  syncTree()
  syncMeta()
}

const markerForPhoto = (photoIndex: number) => {
  for (let i = 0; i < COUNT; i++) if (imageIds[i] === photoIndex) return i
  return -1
}

const focusPhoto = (photoIndex: number) => {
  let index = markerForPhoto(photoIndex)
  if (index < 0 && COUNT > 0) {
    imageIds[center] = photoIndex
    restockQueues()
    index = center
  }
  if (index >= 0) setSeek(index)
  setFocusedPath(photos[photoIndex]?.path ?? null)
}

const setFocusFromTree = (node: TreeNode) => {
  if (node.kind !== "file") return
  const photoIndex = photoByPath.get(node.path)
  if (photoIndex !== undefined) {
    if (inspectOpen) closeInspect()
    focusPhoto(photoIndex)
    return
  }
  setFocusedPath(node.path)
}

const closeInspect = () => {
  inspectOpen = false
}

const openInspect = (index: number) => {
  const photoIndex = imageIds[index]
  const mesh = thumbs[index]!
  inspectPhoto = photoIndex
  inspectOpen = true
  inspectSeeded = true
  inspectPos.set(mesh.position.x, mesh.position.y)
  inspectScale.set(mesh.scale.x, mesh.scale.y)
  inspectPosVel.set(0, 0)
  inspectScaleVel.set(0, 0)
  setFocusedPath(photos[photoIndex]?.path ?? null)
}

const inspectFit = (aspect: number) => {
  const pad = 0.04 * Math.min(viewRect.w, viewRect.h)
  const availW = Math.max(1e-4, viewRect.w - 2 * pad)
  const availH = Math.max(1e-4, viewRect.h - 2 * pad)
  const r = Math.max(1e-6, aspect)
  if (r > availW / availH) return { w: availW, h: availW / r }
  return { w: availH * r, h: availH }
}

const springInspect = (dt: number, tx: number, ty: number, tw: number, th: number) => {
  inspectTargetPos.set(tx, ty)
  inspectTargetScale.set(tw, th)
  const k = sim.inspectSpring * 36
  if (k <= 0) {
    inspectPos.copy(inspectTargetPos)
    inspectScale.copy(inspectTargetScale)
    inspectPosVel.set(0, 0)
    inspectScaleVel.set(0, 0)
    return
  }
  const mass = Math.max(0.05, sim.inspectMass)
  const c = 2 * sim.inspectDamping * Math.sqrt(k * mass)
  const step = (pos: THREE.Vector2, vel: THREE.Vector2, target: THREE.Vector2) => {
    forceVec.set(target.x - pos.x, target.y - pos.y, 0)
    forceVec.multiplyScalar(k)
    forceVec.x -= vel.x * c
    forceVec.y -= vel.y * c
    vel.x += (forceVec.x * dt) / mass
    vel.y += (forceVec.y * dt) / mass
    pos.x += vel.x * dt
    pos.y += vel.y * dt
  }
  step(inspectPos, inspectPosVel, inspectTargetPos)
  step(inspectScale, inspectScaleVel, inspectTargetScale)
}

const inspectReveal = (photo: Photo) => {
  const rest = thumbSize(photo, true)
  const fill = inspectFit(photo.aspect)
  const restLen = Math.hypot(rest.w, rest.h)
  const fillLen = Math.hypot(fill.w, fill.h)
  const curLen = Math.hypot(inspectScale.x, inspectScale.y)
  const span = fillLen - restLen
  if (span <= 1e-8) return inspectOpen ? 1 : 0
  return Math.min(1, Math.max(0, (curLen - restLen) / span))
}

const hideOverlay = () => {
  overlay.visible = false
  overlay.material.opacity = 0
}

const syncOverlay = (photo: Photo, x: number, y: number, sx: number, sy: number) => {
  overlay.visible = true
  overlay.position.set(x, y, 0)
  overlay.scale.set(sx, sy, 1)
  overlay.material.opacity = inspectReveal(photo)
  if (overlay.material.map !== photo.texture) {
    overlay.material.map = photo.texture
    overlay.material.needsUpdate = true
  }
}

const present = () => {
  ditherPass.render(scene, camera, settings)
  if (!overlay.visible || overlay.material.opacity <= 0) return
  const prev = renderer.autoClear
  renderer.autoClear = false
  renderer.render(overlayScene, camera)
  renderer.autoClear = prev
}

const inspectSettled = () =>
  inspectPos.distanceToSquared(inspectTargetPos) < 1e-6 &&
  inspectScale.distanceToSquared(inspectTargetScale) < 1e-6 &&
  inspectPosVel.lengthSq() < 1e-5 &&
  inspectScaleVel.lengthSq() < 1e-5

const projectThumbs = (dt: number) => {
  stepFocusScale(dt)
  let inspectShown = false
  for (let i = 0; i < MAX_COUNT; i++) {
    const mesh = thumbs[i]!
    if (i >= COUNT) {
      mesh.visible = false
      continue
    }
    const photo = photos[imageIds[i]]
    const inspecting = inspectPhoto >= 0 && imageIds[i] === inspectPhoto
    const front = !!photo && projectPoint(marker(i).position, pickWorld)
    if (!photo || (!front && !(inspecting && inspectOpen))) {
      if (inspecting && !inspectOpen) {
        inspectPhoto = -1
        inspectSeeded = false
      }
      mesh.visible = false
      continue
    }
    const { w, h } = thumbSize(photo)
    const mul = focusMul[i]!
    let x = front ? pickWorld.x : inspectPos.x
    let y = front ? pickWorld.y : inspectPos.y
    let sx = w * mul
    let sy = h * mul
    if (inspecting) {
      inspectShown = true
      if (!inspectSeeded) {
        inspectPos.set(x, y)
        inspectScale.set(sx, sy)
        inspectPosVel.set(0, 0)
        inspectScaleVel.set(0, 0)
        inspectSeeded = true
      }
      if (inspectOpen) {
        const fit = inspectFit(photo.aspect)
        springInspect(dt, viewRect.x, viewRect.y, fit.w, fit.h)
      } else {
        springInspect(dt, x, y, sx, sy)
        if (inspectSettled()) {
          inspectPhoto = -1
          inspectSeeded = false
        }
      }
      x = inspectPos.x
      y = inspectPos.y
      sx = inspectScale.x
      sy = inspectScale.y
      mesh.renderOrder = 10
      syncOverlay(photo, x, y, sx, sy)
    } else {
      mesh.renderOrder = i === center ? 6 : 3
    }
    mesh.visible = true
    mesh.position.set(x, y, 0)
    mesh.scale.set(sx, sy, 1)
    if (mesh.material.map !== photo.texture) {
      mesh.material.map = photo.texture
      mesh.material.needsUpdate = true
    }
  }
  if (inspectPhoto >= 0 && !inspectShown) {
    inspectOpen = false
    inspectPhoto = -1
    inspectSeeded = false
    hideOverlay()
  } else if (inspectPhoto < 0) {
    hideOverlay()
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
  if (inspectOpen && inspectPhoto !== imageIds[index]) closeInspect()
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
  setFocusedPath(photos[imageIds[index]]?.path ?? null)
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
  if (impulse === 0 || inspectOpen || COUNT === 0) return
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

const panByPixels = (dx: number, dy: number) => {
  if (dx === 0 && dy === 0) return
  rotQ.setFromAxisAngle(axisVec.set(0, 1, 0), -dx * PAN_ROTATE)
  content.quaternion.premultiply(rotQ)
  rotQ.setFromAxisAngle(axisVec.set(1, 0, 0), -dy * PAN_ROTATE)
  content.quaternion.premultiply(rotQ)
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
  if (inspectOpen || inspectPhoto >= 0 || zooming() || dragging || !handedOff) {
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
    const mul = focusMul[i]!
    const sw = w * mul
    const sh = h * mul
    const dx = Math.abs(pickWorld.x - plane.x)
    const dy = Math.abs(pickWorld.y - plane.y)
    if (dx > sw * 0.5 + extra || dy > sh * 0.5 + extra) continue
    const dist = Math.hypot(dx / sw, dy / sh)
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
  imageCount.textContent = n === 0 ? "No images" : n === 1 ? "1 image" : `${n} images`
  clearImages.disabled = n === 0 && !folderTree
  syncTree()
  syncMeta()
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
  inspectOpen = false
  inspectPhoto = -1
  inspectSeeded = false
  hideOverlay()
  focusMul.fill(1)
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
  sphereCountVal.textContent = String(settings.sphereCount)
  vigRadiusVal.textContent = settings.vignetteRadius.toFixed(2)
  vigSoftVal.textContent = settings.vignetteSoftness.toFixed(2)
  vigStrVal.textContent = settings.vignetteStrength.toFixed(2)
}

const applyTheme = () => {
  document.documentElement.style.setProperty("--primary", settings.primary)
  document.documentElement.style.setProperty("--secondary", settings.secondary)
  renderer.setClearColor(settings.primary, 1)
  scene.background = new THREE.Color(settings.primary)
}

const syncDither = () => {
  updateSettingLabels()
  applyTheme()
  ditherPass.setSettings(settings)
}

const extraColorCap = Math.max(0, MAX_PALETTE - 2)

const syncPalette = () => {
  primaryColor.value = settings.primary
  secondaryColor.value = settings.secondary
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
    remove.disabled = settings.colors.length <= 0
    remove.addEventListener("click", (e) => {
      e.preventDefault()
      if (settings.colors.length <= 0) return
      settings.colors.splice(i, 1)
      syncPalette()
      syncDither()
    })
    label.append(input, remove)
    paletteEl.append(label)
  }
  addColor.disabled = settings.colors.length >= extraColorCap
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
sphereCountInput.addEventListener("input", () => {
  settings.sphereCount = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(Number(sphereCountInput.value))))
  updateSettingLabels()
  if (photos.length) rebuildPoints(Math.min(photos.length, settings.sphereCount))
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
  if (settings.colors.length >= extraColorCap) return
  settings.colors.push("#6b8f71")
  syncPalette()
  syncDither()
})
primaryColor.addEventListener("input", () => {
  settings.primary = primaryColor.value
  syncDither()
})
secondaryColor.addEventListener("input", () => {
  settings.secondary = secondaryColor.value
  applyTheme()
  ditherPass.setSettings(settings)
})

const asHex = (value: unknown) => (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null)

const applySnapshot = (raw: unknown) => {
  if (!raw || typeof raw !== "object") return false
  const o = raw as Record<string, unknown>
  if (typeof o.mode === "string" && MODES.some((item) => item.id === o.mode)) {
    settings.mode = o.mode as ModeId
    modeSelect.value = settings.mode
  }
  const primary = asHex(o.primary)
  if (primary) settings.primary = primary
  const secondary = asHex(o.secondary)
  if (secondary) settings.secondary = secondary
  if (Array.isArray(o.colors)) {
    const next = o.colors.map(asHex).filter((hex): hex is string => hex !== null)
    if (next.length) settings.colors = next.slice(0, extraColorCap)
  }
  if (typeof o.coarseness === "number" && o.coarseness > 0) {
    settings.coarseness = 2 ** Math.round(Math.log2(o.coarseness))
    coarsenessInput.value = String(Math.round(Math.log2(settings.coarseness)))
  }
  if (typeof o.imageArea === "number") {
    settings.imageArea = o.imageArea
    imageAreaInput.value = String(settings.imageArea)
  }
  if (typeof o.sphereCount === "number") {
    settings.sphereCount = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(o.sphereCount)))
    sphereCountInput.value = String(settings.sphereCount)
  }
  if (typeof o.vignetteRadius === "number") {
    settings.vignetteRadius = o.vignetteRadius
    vignetteRadiusInput.value = String(settings.vignetteRadius)
  }
  if (typeof o.vignetteSoftness === "number") {
    settings.vignetteSoftness = o.vignetteSoftness
    vignetteSoftnessInput.value = String(settings.vignetteSoftness)
  }
  if (typeof o.vignetteStrength === "number") {
    settings.vignetteStrength = o.vignetteStrength
    vignetteStrengthInput.value = String(settings.vignetteStrength)
  }
  if (typeof o.projection === "string" && projections.some((item) => item.id === o.projection)) {
    projection = o.projection as ProjectionId
    projectionSelect.value = projection
  }
  if (typeof o.spiral === "boolean") {
    showSpiral = o.spiral
    spiralCheck.checked = showSpiral
    spiral.visible = showSpiral
    if (showSpiral) setSpiral()
  }
  if (o.motion && typeof o.motion === "object") {
    const incoming = o.motion as Record<string, unknown>
    for (const field of tweakFields) {
      const n = Number(incoming[field.key])
      if (!Number.isFinite(n)) continue
      sim[field.key] = n
      const ctrl = motionControls.get(field.key)
      if (!ctrl) continue
      ctrl.input.value = String(sim[field.key])
      ctrl.value.textContent = formatTweak(sim[field.key], field.step)
    }
  }
  syncPalette()
  syncDither()
  if (photos.length && typeof o.sphereCount === "number") {
    rebuildPoints(Math.min(photos.length, settings.sphereCount))
  }
  return true
}

copySettings.addEventListener("click", async () => {
  await navigator.clipboard.writeText(settingsJson(settings, extraJson()))
  copySettings.textContent = "Copied"
  window.setTimeout(() => {
    copySettings.textContent = "Copy JSON"
  }, 1200)
})

pasteSettings.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText()
    const ok = applySnapshot(JSON.parse(text))
    pasteSettings.textContent = ok ? "Pasted" : "Invalid"
  } catch {
    pasteSettings.textContent = "Invalid"
  }
  window.setTimeout(() => {
    pasteSettings.textContent = "Paste JSON"
  }, 1200)
})

const resetLibrary = () => {
  for (const photo of photos) disposePhoto(photo)
  photos.length = 0
  photoByPath.clear()
  focusedPath = null
  focusedNode = null
  inspectOpen = false
  inspectPhoto = -1
  inspectSeeded = false
  hideOverlay()
}

const shuffle = <T>(items: T[]) => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = items[i]!
    items[i] = items[j]!
    items[j] = a
  }
  return items
}

const retargetSlots = () => {
  for (let i = 0; i < COUNT; i++) {
    slotK[i] = i
    const point = slotPoint(i, growth)
    seek[i * 3] = point[0]
    seek[i * 3 + 1] = point[1]
    seek[i * 3 + 2] = point[2]
  }
}

const spawnPoint = (photoIndex: number) => {
  const i = COUNT
  setCount(COUNT + 1)
  const node = new THREE.Object3D()
  node.userData.index = i
  imageIds[i] = photoIndex
  slotK[i] = i
  if (i === 0) {
    const point = slotPoint(0, 0)
    node.position.set(point[0], point[1], point[2])
    poleDir.copy(node.position).normalize()
    writeLatticePose(poleDir, twist, poseNow)
    poseVel.set(0, 0, 0)
    lastContentQ.copy(content.quaternion)
    center = 0
    focusCandidate = 0
    seeking = true
  } else {
    node.position.copy(marker(0).position)
  }
  markers.add(node)
  velocity[i * 3] = 0
  velocity[i * 3 + 1] = 0
  velocity[i * 3 + 2] = 0
  retargetSlots()
  prevLattice.set(seek)
  restockQueues()
}

const LOAD_BAR = 14
const LOAD_SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
let loadDone = 0
let loadTotal = 0
let loadSpin = 0
let lastLoadSpin = 0

const paintLoading = () => {
  const active = loadTotal < 0 || (loadTotal > 0 && loadDone < loadTotal)
  loadingEl.hidden = !active
  if (!active) return
  if (loadTotal < 0) {
    loadingText.textContent = `  ${LOAD_SPIN[loadSpin]}\n  loading`
    return
  }
  const filled = Math.round((loadDone / loadTotal) * LOAD_BAR)
  loadingText.textContent = `  ${LOAD_SPIN[loadSpin]} ${"█".repeat(filled)}${"░".repeat(LOAD_BAR - filled)}\n  loading ${loadDone}/${loadTotal}`
}

const setLoading = (done: number, total: number) => {
  loadDone = done
  loadTotal = total
  paintLoading()
}

const takePhoto = async (file: File, path: string) => {
  const photo = await photoFromFile(file, path)
  photoByPath.set(path, photos.length)
  photos.push(photo)
  if (COUNT < settings.sphereCount) spawnPoint(photos.length - 1)
  else restockQueues()
}

const addFolder = async (files: FolderFile[]) => {
  if (!files.length) return
  resetLibrary()
  folderTree = treeFromFiles(files)
  rebuildPoints(0)
  const images = shuffle(files.filter((item) => isImageFile(item.file, item.path)))
  setLoading(0, images.length)
  for (const [i, { file, path }] of images.entries()) {
    try {
      await takePhoto(file, path)
    } catch {
      /* skip undecodable files */
    }
    setLoading(i + 1, images.length)
    imageCount.textContent = `${photos.length} image${photos.length === 1 ? "" : "s"}`
  }
  setLoading(images.length, images.length)
  updateImageUi()
  setFocusedPath(photos[0]?.path ?? null)
}

const loadDemo = async () => {
  setLoading(0, -1)
  const index = await loadDemoIndex()
  const entries = shuffle(index.filter((entry) => isImagePath(entry.path, entry.type)))
  if (!entries.length) {
    setLoading(0, 0)
    return
  }
  resetLibrary()
  folderTree = treeFromFiles(
    entries.map((entry) => ({
      file: new File([], entry.path.split("/").pop() ?? "file", {
        type: entry.type,
        lastModified: entry.modified,
      }),
      path: entry.path,
    })),
  )
  rebuildPoints(0)
  setLoading(0, entries.length)
  const loaded: FolderFile[] = []
  for (const [i, entry] of entries.entries()) {
    try {
      const item = await fetchDemoFile(entry)
      if (item) {
        await takePhoto(item.file, item.path)
        loaded.push(item)
      }
    } catch {
      /* skip missing or undecodable files */
    }
    setLoading(i + 1, entries.length)
    imageCount.textContent = `${photos.length} image${photos.length === 1 ? "" : "s"}`
  }
  if (loaded.length) folderTree = treeFromFiles(loaded)
  setLoading(entries.length, entries.length)
  updateImageUi()
  setFocusedPath(photos[0]?.path ?? null)
}

const clearAllImages = () => {
  resetLibrary()
  folderTree = null
  rebuildPoints(0)
}

fileInput.addEventListener("change", () => {
  void addFolder(filesFromList(fileInput.files ?? []))
  fileInput.value = ""
})
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
  if (!e.dataTransfer) return
  void filesFromDataTransfer(e.dataTransfer).then(addFolder)
})
document.addEventListener("paste", (e) => {
  void addFolder(filesFromList(e.clipboardData?.files ?? []))
})

const resize = () => {
  const cssW = innerWidth
  const cssH = innerHeight
  const side = Math.max(1, Math.min(cssW, cssH))
  const worldPerPx = (2 * FRAME) / side
  camera.left = -cssW * 0.5 * worldPerPx
  camera.right = cssW * 0.5 * worldPerPx
  camera.top = cssH * 0.5 * worldPerPx
  camera.bottom = -cssH * 0.5 * worldPerPx
  camera.updateProjectionMatrix()
  ditherPass.resize(cssW, cssH)
  diskPx = 1 / worldPerPx
  const view = viewPanel.getBoundingClientRect()
  const canvasRect = canvas.getBoundingClientRect()
  screenToPlane(view.left + view.width * 0.5 - canvasRect.left, view.top + view.height * 0.5 - canvasRect.top, plane)
  viewRect.x = plane.x
  viewRect.y = plane.y
  viewRect.w = view.width * worldPerPx
  viewRect.h = view.height * worldPerPx
}

const PINCH_ZOOM = 12

const pointers = new Map<number, { x: number; y: number }>()
let pinchDist = 0
let pinching = false
let didPinch = false

const pinchPoints = () => [...pointers.values()]

const pinchGap = () => {
  const pts = pinchPoints()
  if (pts.length < 2) return 0
  return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
}

const beginPanFrom = (x: number, y: number) => {
  pointerDown = { x, y }
  lastPan = { x, y }
  dragging = true
  lastContentQ.copy(content.quaternion)
}

canvas.addEventListener("pointerdown", (event) => {
  if (inspectOpen) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  canvas.setPointerCapture(event.pointerId)
  if (pointers.size === 1) {
    pinching = false
    beginPanFrom(event.clientX, event.clientY)
    return
  }
  dragging = false
  pinching = true
  didPinch = true
  seeking = false
  alignVel.set(0, 0, 0)
  pinchDist = pinchGap()
  lastPinch = performance.now()
})

canvas.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pinching && pointers.size >= 2) {
    lastPinch = performance.now()
    const next = pinchGap()
    if (pinchDist > 1) kickZoom((next - pinchDist) * sim.zoom * PINCH_ZOOM)
    pinchDist = next
    seeking = false
    return
  }
  if (!dragging || pinching || pointers.size !== 1 || pinchLive()) return
  const dx = event.clientX - lastPan.x
  const dy = event.clientY - lastPan.y
  lastPan = { x: event.clientX, y: event.clientY }
  if (seeking && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) seeking = false
  panByPixels(-dx, -dy)
})

canvas.addEventListener("pointerup", (event) => {
  if (inspectOpen) {
    closeInspect()
    pointers.clear()
    dragging = false
    pinching = false
    return
  }
  pointers.delete(event.pointerId)
  if (pointers.size >= 2) {
    pinchDist = pinchGap()
    return
  }
  if (pointers.size === 1) {
    pinching = false
    pinchDist = 0
    dragging = false
    return
  }
  pinching = false
  pinchDist = 0
  if (!dragging) {
    didPinch = false
    return
  }
  dragging = false
  const dragged = didPinch || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5
  didPinch = false
  if (!dragged) {
    const rect = canvas.getBoundingClientRect()
    const index = pickIndexAt(event.clientX - rect.left, event.clientY - rect.top, PICK_PAD)
    if (index >= 0) {
      if (index === center) openInspect(index)
      else setSeek(index)
    }
    return
  }
  seeking = false
  handedOff = true
})

canvas.addEventListener("pointercancel", (event) => {
  pointers.delete(event.pointerId)
  if (pointers.size === 0) {
    dragging = false
    pinching = false
    didPinch = false
  }
})

canvas.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false })

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
    if (COUNT === 0 || inspectOpen) return
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
    panByPixels(dx, dy)
  },
  { passive: false },
)

const ignoreGesture = (event: Event) => event.preventDefault()
canvas.addEventListener("gesturestart", ignoreGesture)
canvas.addEventListener("gesturechange", ignoreGesture)
canvas.addEventListener("gestureend", ignoreGesture)

addEventListener("resize", resize)
new ResizeObserver(resize).observe(viewPanel)

syncPalette()
syncDither()
updateImageUi()
resize()
lastContentQ.copy(content.quaternion)
void loadDemo()

renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.05, (now - lastTime) / 1000)
  lastTime = now

  if (!loadingEl.hidden && now - lastLoadSpin > 80) {
    lastLoadSpin = now
    loadSpin = (loadSpin + 1) % LOAD_SPIN.length
    paintLoading()
  }

  if (COUNT === 0) {
    present()
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
  projectThumbs(dt)
  if (!(focusedNode && !photoByPath.has(focusedNode.path))) {
    const photo = COUNT > 0 ? photos[imageIds[center]] : undefined
    setFocusedPath(photo?.path ?? focusedPath)
  }
  present()
})
