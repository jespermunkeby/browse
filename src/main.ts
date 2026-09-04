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
  MIN_IMAGE_PALETTE,
  MODES,
  PALETTE_SOURCES,
  PALETTE_STRATEGIES,
  clampFade,
  formatCoarseness,
  formatFade,
  settingsJson,
  themeColors,
  type ModeId,
  type PaletteSourceId,
  type PaletteStrategyId,
  type Settings,
} from "./dither/settings.ts"
import { createDitherPass } from "./dither/pass.ts"
import { extractPalette, hexToRgb, mixPalette, remapPalette, rgbToHex, type RGB } from "./dither/extract.ts"
import { disposePhoto, isImageFile, photoFromArena, photoFromFile, photoSize, type Photo } from "./photos.ts"
import { filesFromDataTransfer, filesFromList, type FolderFile } from "./folder.ts"
import { createScramble } from "./scramble.ts"
import {
  ArenaError,
  createArenaClient,
  isImageBlock,
  parseArenaTarget,
  targetFromHash,
  targetToHash,
  type ArenaBlock,
  type ArenaChannel,
  type ArenaStatus,
  type ArenaTarget,
  type Priority,
} from "./arena.ts"
import {
  MAX_SOURCE_ROWS,
  paintSourceTimer,
  paintSwatches,
  renderBlockInfo,
  renderInstructions,
  renderSources,
  updateSourceRows,
  type FocusInfo,
  type SourceState,
} from "./info.ts"

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
const blockInfoEl = document.querySelector<HTMLElement>("#blockInfo")!
const contextInfoEl = document.querySelector<HTMLElement>("#contextInfo")!
const settingsToggle = document.querySelector<HTMLButtonElement>("#settingsToggle")!
const seedForm = document.querySelector<HTMLFormElement>("#seed")!
const seedInput = document.querySelector<HTMLInputElement>("#seedInput")!
const seedHint = document.querySelector<HTMLElement>("#seedHint")!
const sourceForm = document.querySelector<HTMLFormElement>("#sourceForm")!
const sourceInput = document.querySelector<HTMLInputElement>("#sourceInput")!
const contextHoldInput = document.querySelector<HTMLInputElement>("#contextHold")!
const contextHoldVal = document.querySelector<HTMLElement>("#contextHoldVal")!
const timerRevealInput = document.querySelector<HTMLInputElement>("#timerReveal")!
const timerRevealVal = document.querySelector<HTMLElement>("#timerRevealVal")!
const hintEl = document.querySelector<HTMLElement>("#hint")!
const seedInstructions = document.querySelector<HTMLElement>("#seedInstructions")!
const statusEl = document.querySelector<HTMLElement>("#arenaStatus")!
const statusText = document.querySelector<HTMLElement>("#arenaStatusText")!
const fileInput = document.querySelector<HTMLInputElement>("#file")!
const clearImages = document.querySelector<HTMLButtonElement>("#clearImages")!
const imageCount = document.querySelector<HTMLElement>("#imageCount")!
const paletteEl = document.querySelector<HTMLElement>("#palette")!
const paletteHint = document.querySelector<HTMLElement>("#paletteHint")!
const paletteSourceSelect = document.querySelector<HTMLSelectElement>("#paletteSource")!
const imagePaletteFields = document.querySelector<HTMLElement>("#imagePaletteFields")!
const imageColorCountInput = document.querySelector<HTMLInputElement>("#imageColorCount")!
const imageColorCountVal = document.querySelector<HTMLElement>("#imageColorCountVal")!
const paletteStrategySelect = document.querySelector<HTMLSelectElement>("#paletteStrategy")!
const paletteFadeInput = document.querySelector<HTMLInputElement>("#paletteFade")!
const paletteFadeVal = document.querySelector<HTMLElement>("#paletteFadeVal")!
const primaryField = document.querySelector<HTMLElement>("#primaryField")!
const secondaryField = document.querySelector<HTMLElement>("#secondaryField")!
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
const focusOriginalColorCheck = document.querySelector<HTMLInputElement>("#focusOriginalColor")!
const focusUnditheredCheck = document.querySelector<HTMLInputElement>("#focusUndithered")!
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
  imageColors: [...DEFAULT_SETTINGS.imageColors],
}
/** Sparse pool: evicted slots become undefined so marker indices stay stable. */
const photos: (Photo | undefined)[] = []
const photoByPath = new Map<string, number>()
const imagePaletteCache = new Map<string, string[]>()
let poolCount = 0
let focusedPath: string | null = null
let lastPaletteKey = ""
let paletteLive: RGB[] = []
let paletteTarget: RGB[] = []
let paletteFrom: RGB[] = []
let paletteMix = 1

let showSpiral = false
let projection: ProjectionId = "stereo"

const formatTweak = (value: number, step: number) => value.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)

const extraJson = () => ({ projection, spiral: showSpiral, motion: { ...sim }, arena: { ...arenaPrefs } })

const motionControls = new Map<keyof typeof sim, { input: HTMLInputElement; value: HTMLElement }>()

let settingsOpen = false

const setSettingsOpen = (open: boolean) => {
  settingsOpen = open
  tweaks.hidden = !open
  contextInfoEl.hidden = open
  settingsToggle.textContent = open ? "close" : "settings"
  settingsToggle.setAttribute("aria-pressed", String(open))
}

settingsToggle.addEventListener("click", () => setSettingsOpen(!settingsOpen))

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

for (const item of PALETTE_SOURCES) {
  const el = document.createElement("option")
  el.value = item.id
  el.textContent = item.label
  paletteSourceSelect.append(el)
}
paletteSourceSelect.value = settings.paletteSource

for (const item of PALETTE_STRATEGIES) {
  const el = document.createElement("option")
  el.value = item.id
  el.textContent = item.label
  paletteStrategySelect.append(el)
}
paletteStrategySelect.value = settings.paletteStrategy
imageColorCountInput.min = String(MIN_IMAGE_PALETTE)
imageColorCountInput.max = String(MAX_PALETTE)
imageColorCountInput.value = String(settings.imageColorCount)
paletteFadeInput.value = String(settings.paletteFade)
coarsenessInput.value = String(Math.round(Math.log2(settings.coarseness)))
imageAreaInput.value = String(settings.imageArea)
sphereCountInput.min = String(MIN_COUNT)
sphereCountInput.max = String(MAX_COUNT)
sphereCountInput.value = String(settings.sphereCount)
focusOriginalColorCheck.checked = settings.focusOriginalColor
focusUnditheredCheck.checked = settings.focusUndithered
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

const themeBg = new THREE.Color(settings.primary)
const scene = new THREE.Scene()
scene.background = themeBg

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
const overlay = new THREE.Mesh(thumbGeo, ditherPass.focusMaterial)
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
const unzoomed: number[] = []
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
let growZoom = false
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

const chrome = createScramble([blockInfoEl, contextInfoEl])

// ── Are.na state ─────────────────────────────────────────────────────────
const arena = createArenaClient()
const connectionsByBlock = new Map<number, ArenaChannel[]>()
const connectionsPending = new Set<number>()
const connectionsFailed = new Map<number, "waiting" | "unavailable">()
const channelPages = new Map<string, { fetched: Set<number>; totalPages: number | null }>()
let currentTarget: ArenaTarget | null = null

/**
 * The context is the block whose connected channels feed "more of the same".
 * It lags behind the focus: it only follows once the user has been still for `arenaPrefs.holdMs`.
 */
type Context = {
  id: number
  title: string
  channels: ArenaChannel[] | null
  /** User-chosen source channel; null means "the first one that still has pages". */
  selected: string | null
  setAt: number
}
let context: Context | null = null
/** `reveal`: fraction of the hold during which the timer line is seen running out (the last part). */
const arenaPrefs = { holdMs: 2500, reveal: 0.5 }

const photoAtPath = (path: string | null) => {
  if (!path) return undefined
  const index = photoByPath.get(path)
  return index === undefined ? undefined : photos[index]
}

const focusInfo = (): FocusInfo => {
  const photo = photoAtPath(focusedPath)
  if (!photo) return { kind: "none" }
  if (photo.arena) return { kind: "arena", block: photo.arena, via: photo.via ?? null }
  return {
    kind: "local",
    meta: {
      name: photo.name,
      path: photo.path,
      type: photo.type,
      bytes: photo.bytes,
      modified: photo.modified,
      width: photo.width,
      height: photo.height,
    },
  }
}

const sourceState = (id: number): SourceState => {
  if (connectionsByBlock.has(id)) return "ready"
  if (connectionsPending.has(id)) return "pending"
  return connectionsFailed.get(id) ?? "pending"
}

/** Hex palette currently driving the dither, for the swatches. */
const paletteHex = () =>
  settings.paletteSource === "image"
    ? paletteLive.map(rgbToHex)
    : [settings.primary, settings.secondary, ...settings.colors]

const copyText = (text: string) => navigator.clipboard.writeText(text).catch(() => undefined)

const copyColor = (hex: string) => {
  void copyText(hex)
  flashStatus(`copied ${hex}`, 1600)
}

const downloadBlock = async (block: ArenaBlock, button: HTMLButtonElement) => {
  const image = block.image
  if (!image) return
  const label = button.textContent
  button.textContent = "downloading…"
  button.disabled = true
  try {
    const res = await fetch(image.src)
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = image.filename || `arena-${block.id}`
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch {
    window.open(image.src, "_blank", "noopener")
  } finally {
    button.textContent = label
    button.disabled = false
  }
}

const syncSwatches = () => paintSwatches(blockInfoEl, paletteHex(), copyColor)

const syncInfo = () => {
  const info = focusInfo()
  renderBlockInfo(blockInfoEl, info, {
    palette: paletteHex(),
    onCopyColor: copyColor,
    onDownload: (block, button) => void downloadBlock(block, button),
  })
  renderSources(contextInfoEl, {
    title: context ? context.title : null,
    state: context ? (context.id >= 0 ? sourceState(context.id) : "ready") : "unavailable",
    poolSize: poolCount,
    onSelect: (channel) => void selectChannel(channel),
    onCopyLink: () => void copyText(location.href),
    ...sourceRowsView(),
  })
  chrome.invalidate()
}

/** Per-channel local counts: how many of its photos we hold, and how many of those are not on a marker yet. */
type ChannelStats = { cached: number; unseen: number }
const channelStats = new Map<string, ChannelStats>()
const NO_STATS: ChannelStats = { cached: 0, unseen: 0 }

const recountChannels = () => {
  channelStats.clear()
  const shown = new Set<number>()
  for (let i = 0; i < COUNT; i++) shown.add(imageIds[i])
  for (let i = 0; i < photos.length; i++) {
    const slug = photos[i]?.via?.slug
    if (!slug) continue
    let s = channelStats.get(slug)
    if (!s) channelStats.set(slug, (s = { cached: 0, unseen: 0 }))
    s.cached++
    if (!shown.has(i)) s.unseen++
  }
}

const sourceRowsView = () => {
  recountChannels()
  return {
    channels: context?.channels ?? null,
    activeSlug: activeChannel()?.slug ?? null,
    metaText: (channel: ArenaChannel) => {
      const s = channelStats.get(channel.slug) ?? NO_STATS
      const { entry } = pagesFor(channel)
      const local = s.cached || entry.fetched.size ? `${s.unseen}/${s.cached}` : String(channel.counts.blocks)
      return `${channel.owner.name} · ${local}`
    },
    metaTitle: (channel: ArenaChannel) => {
      const s = channelStats.get(channel.slug) ?? NO_STATS
      const { entry } = pagesFor(channel)
      const total = entry.totalPages ?? Math.max(1, Math.ceil(channel.counts.contents / PAGE_SIZE))
      return `${s.unseen} unseen of ${s.cached} cached · pages ${entry.fetched.size}/${total}`
    },
    done: (channel: ArenaChannel) => exhausted(channel) && (channelStats.get(channel.slug)?.unseen ?? 0) === 0,
  }
}

/** Keeps the source rows' counts and active marker in step with the zoom without re-rendering the list. */
let lastRowSyncAt = 0
const ROW_SYNC_MS = 120
const syncSourceRows = (now: number) => {
  if (now - lastRowSyncAt < ROW_SYNC_MS || !context?.channels) return
  lastRowSyncAt = now
  updateSourceRows(contextInfoEl, sourceRowsView())
}

const cssRgb = (c: RGB) => `rgb(${c[0] * 255} ${c[1] * 255} ${c[2] * 255})`

const setFocusedPath = (path: string | null) => {
  if (path === focusedPath) return
  focusedPath = path
  const rebuilt = applyImagePalette()
  if (rebuilt) {
    syncPalette()
    syncDither()
  }
  syncInfo()
}

const customPaletteRgb = (): RGB[] =>
  [settings.primary, settings.secondary, ...settings.colors].map(hexToRgb)

const commitLivePalette = (rebuild: boolean) => {
  settings.imageColors = paletteLive.map(rgbToHex)
  if (rebuild) syncPalette()
  else paintImageSwatches()
  applyTheme()
  if (rebuild) ditherPass.setSettings(settings)
  if (paletteLive.length) ditherPass.setPaletteRgb(paletteLive)
  syncSwatches()
}

const paintImageSwatches = () => {
  if (settings.paletteSource !== "image") return
  const chips = paletteEl.querySelectorAll<HTMLElement>(".swatch-chip")
  if (chips.length !== paletteLive.length) {
    settings.imageColors = paletteLive.map(rgbToHex)
    syncPalette()
    return
  }
  for (const [i, c] of paletteLive.entries()) {
    const chip = chips[i]!
    chip.style.background = cssRgb(c)
    chip.title = rgbToHex(c)
  }
}

const snapPaletteTo = (next: RGB[]) => {
  paletteTarget = next.map((c) => [c[0], c[1], c[2]] as RGB)
  paletteFrom = paletteTarget.map((c) => [c[0], c[1], c[2]] as RGB)
  paletteLive = paletteTarget.map((c) => [c[0], c[1], c[2]] as RGB)
  paletteMix = 1
}

const beginPaletteFade = (next: RGB[]) => {
  if (settings.paletteFade <= 1e-3) {
    snapPaletteTo(next)
    return
  }
  if (!paletteLive.length) paletteLive = remapPalette(customPaletteRgb(), next.length)
  else if (paletteLive.length !== next.length) paletteLive = remapPalette(paletteLive, next.length)
  paletteFrom = paletteLive.map((c) => [c[0], c[1], c[2]] as RGB)
  paletteTarget = next.map((c) => [c[0], c[1], c[2]] as RGB)
  paletteLive = paletteFrom.map((c) => [c[0], c[1], c[2]] as RGB)
  paletteMix = 0
}

const applyImagePalette = (force = false) => {
  if (settings.paletteSource !== "image") {
    paletteLive = []
    paletteTarget = []
    paletteFrom = []
    paletteMix = 1
    lastPaletteKey = ""
    return false
  }
  const photo = photoAtPath(focusedPath)
  const key = `${photo?.path ?? ""}:${settings.paletteStrategy}:${settings.imageColorCount}`
  if (!force && key === lastPaletteKey && (photo || settings.imageColors.length > 0)) return false
  lastPaletteKey = key
  if (!photo) return false
  let colors = imagePaletteCache.get(key)
  if (!colors) {
    colors = extractPalette(photo.source, settings.imageColorCount, settings.paletteStrategy)
    imagePaletteCache.set(key, colors)
  }
  const next = colors.map(hexToRgb)
  const same =
    next.length === paletteTarget.length &&
    next.every((c, i) => {
      const t = paletteTarget[i]!
      return c[0] === t[0] && c[1] === t[1] && c[2] === t[2]
    })
  if (same && paletteMix >= 1 && paletteLive.length === next.length) return false
  const prevLen = settings.imageColors.length
  beginPaletteFade(next)
  settings.imageColors = paletteLive.map(rgbToHex)
  return paletteMix >= 1 || settings.imageColors.length !== prevLen
}

const stepImagePalette = (dt: number) => {
  if (settings.paletteSource !== "image" || paletteTarget.length === 0 || paletteMix >= 1) return
  const tau = settings.paletteFade
  paletteMix = tau <= 1e-3 ? 1 : Math.min(1, paletteMix + dt / tau)
  paletteLive = mixPalette(paletteFrom, paletteTarget, paletteMix)
  commitLivePalette(false)
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

const colorReveal = (photo: Photo, sx: number, sy: number) => {
  const rest = thumbSize(photo)
  const restLen = Math.hypot(rest.w, rest.h)
  const focusLen = restLen * FOCUS_SCALE
  const curLen = Math.hypot(sx, sy)
  const span = focusLen - restLen
  if (span <= 1e-8) return curLen > restLen * 1.02 ? 1 : 0
  const t = (curLen - restLen) / span
  return Math.min(1, Math.max(0, t / 0.55))
}

const hideOverlay = () => {
  overlay.visible = false
  ditherPass.setFocusOverlay(null, 0, true, true)
}

const syncOverlay = (
  photo: Photo,
  x: number,
  y: number,
  sx: number,
  sy: number,
  opacity: number,
  inspect: boolean,
) => {
  overlay.visible = opacity > 0.001
  overlay.position.set(x, y, 0)
  overlay.scale.set(sx, sy, 1)
  ditherPass.setFocusOverlay(
    photo.texture,
    opacity,
    inspect || settings.focusOriginalColor,
    inspect || settings.focusUndithered,
  )
}

const present = () => {
  ditherPass.render(scene, camera, settings)
  if (!overlay.visible) return
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

/** How long a marker must sit on the back hemisphere before its image is swapped for an unseen one. */
const SWAP_HIDDEN_MS = 350
const hiddenSince = new Float64Array(MAX_COUNT)

/** Pan = explore: a marker that has drifted out of view quietly picks up a random cached image. */
const maybeSwapHidden = (i: number, now: number) => {
  if (i === center || zooming(now) || ahead.length === 0) return
  if (hiddenSince[i] === 0) {
    hiddenSince[i] = now
    return
  }
  if (!Number.isFinite(hiddenSince[i]!) || now - hiddenSince[i]! < SWAP_HIDDEN_MS) return
  const pick = Math.floor(Math.random() * ahead.length)
  const next = ahead[pick]!
  if (!photos[next]) {
    ahead.splice(pick, 1)
    return
  }
  imageIds[i] = next
  hiddenSince[i] = Number.POSITIVE_INFINITY
  restockQueues()
}

const projectThumbs = (dt: number, now: number) => {
  stepFocusScale(dt)
  let inspectShown = false
  let overlayPhoto: Photo | undefined
  let overlayInspect = false
  let overlayX = 0
  let overlayY = 0
  let overlaySx = 0
  let overlaySy = 0
  let overlayOp = 0
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
      if (!inspecting) maybeSwapHidden(i, now)
      mesh.visible = false
      continue
    }
    hiddenSince[i] = 0
    photo.shownAt = now
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
    const reveal = colorReveal(photo, sx, sy)
    const focusLook = settings.focusOriginalColor || settings.focusUndithered
    if (inspecting || (!overlayPhoto && i === center && reveal > 0.001 && focusLook)) {
      overlayPhoto = photo
      overlayInspect = inspecting
      overlayX = x
      overlayY = y
      overlaySx = sx
      overlaySy = sy
      overlayOp = reveal
    }
  }
  if (inspectPhoto >= 0 && !inspectShown) {
    inspectOpen = false
    inspectPhoto = -1
    inspectSeeded = false
  }
  if (overlayPhoto) syncOverlay(overlayPhoto, overlayX, overlayY, overlaySx, overlaySy, overlayOp, overlayInspect)
  else hideOverlay()
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

/**
 * Queues:
 *  - `ahead`: unseen pool, sorted so the most recently related photos pop first (zoom = more of the same);
 *  - `behind`: photos that slid out the back while zooming in (come back when zooming out);
 *  - `unzoomed`: photos that vanished from the centre while zooming out (come back when zooming in).
 * The two session stacks make zoom reversible until the session ends (pan or context switch).
 */
const pruneStack = (stack: number[], used: Set<number>) => {
  let w = 0
  for (const i of stack) if (photos[i] && !used.has(i)) stack[w++] = i
  stack.length = w
}

const restockQueues = () => {
  ahead.length = 0
  const used = new Set<number>()
  for (let i = 0; i < COUNT; i++) used.add(imageIds[i])
  pruneStack(behind, used)
  pruneStack(unzoomed, used)
  for (const i of behind) used.add(i)
  for (const i of unzoomed) used.add(i)
  for (let i = 0; i < photos.length; i++) if (photos[i] && !used.has(i)) ahead.push(i)
  ahead.sort((a, b) => photos[a]!.related - photos[b]!.related)
}

const zoomSessionActive = () => behind.length > 0 || unzoomed.length > 0

const endZoomSession = () => {
  if (!zoomSessionActive()) return
  behind.length = 0
  unzoomed.length = 0
  restockQueues()
}

/** Next photo when a slot opens at the centre (zooming in): first what we just zoomed away from. */
const takeForward = () => {
  if (unzoomed.length) return unzoomed.pop()!
  if (ahead.length) return ahead.pop()!
  return 0
}

/** Next photo when a slot opens at the back (zooming out): first what slid out earlier. */
const takeBackward = () => {
  if (behind.length) return behind.pop()!
  if (ahead.length) return ahead.shift()!
  return 0
}

/** Re-anchors the zoom window on the new centre; the zoom session (behind/unzoomed) survives a re-focus. */
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

const copyTriple = (src: Float32Array, from: number, dst: Float32Array, to: number) => {
  const a = from * 3
  const b = to * 3
  dst[b] = src[a]!
  dst[b + 1] = src[a + 1]!
  dst[b + 2] = src[a + 2]!
}

const liveCap = () => Math.min(MAX_COUNT, poolCount)

const syncSphereCount = () => {
  if (COUNT < MIN_COUNT) return
  settings.sphereCount = COUNT
  sphereCountInput.value = String(COUNT)
  sphereCountVal.textContent = String(COUNT)
}

const dropPoint = (i: number) => {
  const last = COUNT - 1
  thumbs[last]!.visible = false
  if (i !== last) {
    imageIds[i] = imageIds[last]!
    slotK[i] = slotK[last]!
    remapped[i] = remapped[last]!
    focusMul[i] = focusMul[last]!
    copyTriple(velocity, last, velocity, i)
    copyTriple(seek, last, seek, i)
    copyTriple(prevLattice, last, prevLattice, i)
    marker(i).position.copy(marker(last).position)
  }
  markers.remove(marker(last))
  setCount(last)
}

const addPoint = (k: number, photoIndex: number) => {
  const i = COUNT
  if (i >= MAX_COUNT) return
  setCount(i + 1)
  const node = new THREE.Object3D()
  node.userData.index = i
  imageIds[i] = photoIndex
  slotK[i] = k
  remapped[i] = 1
  focusMul[i] = 1
  if (i === 0) {
    const point = slotPoint(k, growth)
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
}

const remapWindow = (kMin: number, kMax: number) => {
  const span = kMax - kMin + 1
  occupied.fill(0, 0, span)
  for (let i = 0; i < COUNT; i++) {
    const k = slotK[i]!
    if (k >= kMin && k <= kMax) occupied[k - kMin] = 1
  }
  let enteringN = 0
  for (let k = kMin; k <= kMax; k++) if (!occupied[k - kMin]) entering[enteringN++] = k
  for (let i = 0; i < COUNT; i++) {
    if (slotK[i]! >= kMin && slotK[i]! <= kMax) continue
    if (enteringN === 0) continue
    const next = entering[--enteringN]!
    if (slotK[i]! > kMax) {
      behind.push(imageIds[i]!)
      imageIds[i] = takeForward()
    } else {
      unzoomed.push(imageIds[i]!)
      imageIds[i] = takeBackward()
    }
    slotK[i] = next
    remapped[i] = 1
  }
}

const growWindow = (kMin: number, kMax: number) => {
  let i = 0
  while (i < COUNT) {
    const k = slotK[i]!
    if (k >= kMin && k <= kMax) {
      i++
      continue
    }
    if (k > kMax) behind.push(imageIds[i]!)
    else unzoomed.push(imageIds[i]!)
    dropPoint(i)
  }
  const span = kMax - kMin + 1
  occupied.fill(0, 0, span)
  for (let j = 0; j < COUNT; j++) occupied[slotK[j]! - kMin] = 1
  for (let k = kMin; k <= kMax; k++) {
    if (occupied[k - kMin] || COUNT >= liveCap()) continue
    addPoint(k, takeForward())
  }
}

const syncSlotsToGrowth = () => {
  remapped.fill(0)
  const kMin = slotRange(growth).kMin
  const cap = liveCap()
  if (growZoom && COUNT > 0 && cap >= MIN_COUNT) {
    let heldMax = kMin - 1
    for (let i = 0; i < COUNT; i++) if (slotK[i]! > heldMax) heldMax = slotK[i]!
    const desired = heldMax - kMin + 1
    if (desired >= MIN_COUNT && desired <= cap) {
      growWindow(kMin, kMin + desired - 1)
      if (COUNT !== settings.sphereCount) {
        syncSphereCount()
        lastSpiralGrowth = Number.NaN
      }
      return
    }
  }
  const { kMax } = slotRange(growth)
  remapWindow(kMin, kMax)
}

const kickZoom = (impulse: number, grow = false) => {
  if (impulse === 0 || inspectOpen || COUNT === 0) return
  noteInteraction()
  panSincePx = 0
  panned = false
  if (!zooming()) {
    captureLattice()
    focusCandidate = center
  }
  growZoom = grow
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

let panSincePx = 0
/** Set by a real pan: the context follows the focus as soon as it settles, skipping the hold. */
let panned = false
const panByPixels = (dx: number, dy: number) => {
  if (dx === 0 && dy === 0) return
  noteInteraction()
  // A real pan (not click jitter) ends the zoom session at once: what slid away is no longer coming back.
  panSincePx += Math.hypot(dx, dy)
  if (panSincePx > 6) {
    panSincePx = 0
    panned = true
    endZoomSession()
  }
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

  // While seeking a chosen centre (click, zoom handoff), never retarget to whatever drifts past the middle.
  if (seeking) return
  const candidate = aimed >= 0 ? aimed : center

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
    // The centre thumb is drawn on top; a hit inside it wins outright, even if a neighbour is nearer.
    if (i === center && Number.isFinite(extraPx) && dx <= sw * 0.5 && dy <= sh * 0.5) return i
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
  const live: number[] = []
  for (let i = 0; i < photos.length && live.length < COUNT; i++) if (photos[i]) live.push(i)
  for (let i = 0; i < COUNT; i++) {
    const node = new THREE.Object3D()
    node.userData.index = i
    imageIds[i] = live[i] ?? 0
    slotK[i] = i
    const point = slotPoint(i, 0)
    node.position.set(point[0], point[1], point[2])
    markers.add(node)
  }
}

const syncSeedForm = () => {
  seedForm.hidden = poolCount > 0 || seedBusy
  document.body.classList.toggle("is-empty", poolCount === 0)
}

const updateImageUi = () => {
  const n = poolCount
  imageCount.textContent = n === 0 ? "No images" : n === 1 ? "1 image" : `${n} images`
  clearImages.disabled = n === 0
  syncSeedForm()
  syncInfo()
}

const rebuildPoints = (n: number) => {
  setCount(n)
  clearMarkers()
  velocity.fill(0)
  seek.fill(0)
  behind.length = 0
  unzoomed.length = 0
  ahead.length = 0
  growth = 0
  zoomVel = 0
  growZoom = false
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
  imageColorCountVal.textContent = String(settings.imageColorCount)
  paletteFadeVal.textContent = formatFade(settings.paletteFade)
}

/**
 * The favicon is the logo mark filled with the current primary colour, on a transparent background.
 * `public/favicon.svg` is the static default; once the mark is loaded the tab icon follows the theme.
 */
const faviconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
const LOGO_FILL = "#231f20"
let logoMarkup: string | null = null
let faviconHex = ""
let faviconTimer = 0

const syncFavicon = (primaryHex: string) => {
  if (!faviconLink || !logoMarkup || primaryHex === faviconHex) return
  faviconHex = primaryHex
  if (faviconTimer) return
  // Palette fades call applyTheme every frame; a tab icon only needs to catch up now and then.
  faviconTimer = window.setTimeout(() => {
    faviconTimer = 0
    const svg = logoMarkup!.replaceAll(LOGO_FILL, faviconHex)
    faviconLink.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
  }, 300)
}

void fetch("/logo.svg")
  .then((res) => (res.ok ? res.text() : null))
  .then((text) => {
    if (!text) return
    logoMarkup = text
    applyTheme()
  })
  .catch(() => undefined)

const applyTheme = () => {
  if (settings.paletteSource === "image" && paletteLive.length) {
    const primary = paletteLive[0]!
    const secondary = paletteLive[paletteLive.length - 1]!
    document.documentElement.style.setProperty("--primary", cssRgb(primary))
    document.documentElement.style.setProperty("--secondary", cssRgb(secondary))
    themeBg.setRGB(primary[0], primary[1], primary[2])
    renderer.setClearColor(themeBg, 1)
    scene.background = themeBg
    syncFavicon(rgbToHex(primary))
    return
  }
  const theme = themeColors(settings)
  document.documentElement.style.setProperty("--primary", theme.primary)
  document.documentElement.style.setProperty("--secondary", theme.secondary)
  themeBg.set(theme.primary)
  renderer.setClearColor(themeBg, 1)
  scene.background = themeBg
  syncFavicon(theme.primary)
}

const syncDither = () => {
  updateSettingLabels()
  applyTheme()
  ditherPass.setSettings(settings)
  if (settings.paletteSource === "image" && paletteLive.length) ditherPass.setPaletteRgb(paletteLive)
  syncSwatches()
}

const extraColorCap = Math.max(0, MAX_PALETTE - 2)

const syncPalette = () => {
  const fromImage = settings.paletteSource === "image"
  paletteSourceSelect.value = settings.paletteSource
  paletteStrategySelect.value = settings.paletteStrategy
  imagePaletteFields.hidden = !fromImage
  primaryField.hidden = fromImage
  secondaryField.hidden = fromImage
  addColor.hidden = fromImage
  primaryColor.value = settings.primary
  secondaryColor.value = settings.secondary
  paletteEl.replaceChildren()
  if (fromImage) {
    const empty = settings.imageColors.length === 0
    paletteHint.hidden = !empty
    paletteHint.textContent = "Focus an image to sample its palette"
    for (const hex of settings.imageColors) {
      const chip = document.createElement("div")
      chip.className = "swatch-chip"
      chip.style.background = hex
      chip.title = hex
      paletteEl.append(chip)
    }
    updateSettingLabels()
    return
  }
  paletteHint.hidden = true
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
paletteSourceSelect.addEventListener("change", () => {
  settings.paletteSource = paletteSourceSelect.value as PaletteSourceId
  lastPaletteKey = ""
  applyImagePalette(true)
  syncPalette()
  syncDither()
})
paletteStrategySelect.addEventListener("change", () => {
  settings.paletteStrategy = paletteStrategySelect.value as PaletteStrategyId
  applyImagePalette(true)
  syncPalette()
  syncDither()
})
imageColorCountInput.addEventListener("input", () => {
  settings.imageColorCount = Math.min(
    MAX_PALETTE,
    Math.max(MIN_IMAGE_PALETTE, Math.round(Number(imageColorCountInput.value))),
  )
  applyImagePalette(true)
  syncPalette()
  syncDither()
})
paletteFadeInput.addEventListener("input", () => {
  settings.paletteFade = clampFade(Number(paletteFadeInput.value))
  updateSettingLabels()
  if (settings.paletteFade <= 1e-3 && paletteTarget.length) {
    snapPaletteTo(paletteTarget)
    commitLivePalette(true)
  }
})
coarsenessInput.addEventListener("input", () => {
  settings.coarseness = 2 ** Number(coarsenessInput.value)
  syncDither()
})
imageAreaInput.addEventListener("input", () => {
  settings.imageArea = Number(imageAreaInput.value)
  updateSettingLabels()
})
focusOriginalColorCheck.addEventListener("change", () => {
  settings.focusOriginalColor = focusOriginalColorCheck.checked
})
focusUnditheredCheck.addEventListener("change", () => {
  settings.focusUndithered = focusUnditheredCheck.checked
})
sphereCountInput.addEventListener("input", () => {
  settings.sphereCount = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(Number(sphereCountInput.value))))
  updateSettingLabels()
  if (poolCount) rebuildPoints(Math.min(poolCount, settings.sphereCount))
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

const HOLD_MIN_MS = 500
const HOLD_MAX_MS = 8000

const syncHoldUi = () => {
  contextHoldInput.value = String(arenaPrefs.holdMs / 1000)
  contextHoldVal.textContent = `${(arenaPrefs.holdMs / 1000).toFixed(2).replace(/\.?0+$/, "")}s`
}

const setHoldMs = (ms: number) => {
  if (!Number.isFinite(ms)) return
  arenaPrefs.holdMs = Math.min(HOLD_MAX_MS, Math.max(HOLD_MIN_MS, Math.round(ms)))
  syncHoldUi()
}

const syncRevealUi = () => {
  timerRevealInput.value = String(arenaPrefs.reveal)
  timerRevealVal.textContent = `${Math.round(arenaPrefs.reveal * 100)}%`
}

const setReveal = (fraction: number) => {
  if (!Number.isFinite(fraction)) return
  arenaPrefs.reveal = Math.min(1, Math.max(0.1, Math.round(fraction * 20) / 20))
  syncRevealUi()
}

contextHoldInput.addEventListener("input", () => setHoldMs(Number(contextHoldInput.value) * 1000))
timerRevealInput.addEventListener("input", () => setReveal(Number(timerRevealInput.value)))
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
  if (typeof o.paletteSource === "string" && PALETTE_SOURCES.some((item) => item.id === o.paletteSource)) {
    settings.paletteSource = o.paletteSource as PaletteSourceId
    paletteSourceSelect.value = settings.paletteSource
  }
  if (typeof o.paletteStrategy === "string" && PALETTE_STRATEGIES.some((item) => item.id === o.paletteStrategy)) {
    settings.paletteStrategy = o.paletteStrategy as PaletteStrategyId
    paletteStrategySelect.value = settings.paletteStrategy
  }
  if (typeof o.imageColorCount === "number") {
    settings.imageColorCount = Math.min(MAX_PALETTE, Math.max(MIN_IMAGE_PALETTE, Math.round(o.imageColorCount)))
    imageColorCountInput.value = String(settings.imageColorCount)
  }
  if (typeof o.paletteFade === "number" && o.paletteFade >= 0) {
    settings.paletteFade = clampFade(o.paletteFade)
    paletteFadeInput.value = String(settings.paletteFade)
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
  if (typeof o.focusOriginalColor === "boolean") {
    settings.focusOriginalColor = o.focusOriginalColor
    focusOriginalColorCheck.checked = settings.focusOriginalColor
  }
  if (typeof o.focusUndithered === "boolean") {
    settings.focusUndithered = o.focusUndithered
    focusUnditheredCheck.checked = settings.focusUndithered
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
  if (o.arena && typeof o.arena === "object") {
    const incoming = o.arena as Record<string, unknown>
    if (typeof incoming.holdMs === "number") setHoldMs(incoming.holdMs)
    if (typeof incoming.reveal === "number") setReveal(incoming.reveal)
  }
  lastPaletteKey = ""
  applyImagePalette(true)
  syncPalette()
  syncDither()
  if (poolCount && typeof o.sphereCount === "number") {
    rebuildPoints(Math.min(poolCount, settings.sphereCount))
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
  for (const photo of photos) if (photo) disposePhoto(photo)
  photos.length = 0
  poolCount = 0
  photoByPath.clear()
  imagePaletteCache.clear()
  connectionsByBlock.clear()
  connectionsPending.clear()
  connectionsFailed.clear()
  channelPages.clear()
  context = null
  hiddenSince.fill(0)
  lastPaletteKey = ""
  paletteLive = []
  paletteTarget = []
  paletteFrom = []
  paletteMix = 1
  const hadImageColors = settings.imageColors.length > 0
  settings.imageColors = []
  focusedPath = null
  inspectOpen = false
  inspectPhoto = -1
  inspectSeeded = false
  hideOverlay()
  if (hadImageColors) {
    syncPalette()
    syncDither()
  }
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

// ── Pool ─────────────────────────────────────────────────────────────────
/** Upper bound on decoded images kept in memory (~2 MB of GPU memory each at 800 px). */
const POOL_MAX = 240

const onMarker = (photoIndex: number) => {
  for (let i = 0; i < COUNT; i++) if (imageIds[i] === photoIndex) return true
  return false
}

const evictIfNeeded = () => {
  if (poolCount <= POOL_MAX) return
  const candidates: number[] = []
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]
    if (!photo || onMarker(i) || photo.path === focusedPath || i === inspectPhoto) continue
    candidates.push(i)
  }
  const score = (i: number) => Math.max(photos[i]!.shownAt, photos[i]!.related)
  candidates.sort((a, b) => score(a) - score(b))
  for (const i of candidates.slice(0, poolCount - POOL_MAX)) {
    const photo = photos[i]!
    disposePhoto(photo)
    photoByPath.delete(photo.path)
    photos[i] = undefined
    poolCount--
  }
}

const pushPhoto = (photo: Photo) => {
  const index = photos.length
  photoByPath.set(photo.path, index)
  photos.push(photo)
  poolCount++
  if (COUNT < settings.sphereCount) spawnPoint(index)
  else restockQueues()
  evictIfNeeded()
  return index
}

const firstPhotoPath = () => {
  for (const photo of photos) if (photo) return photo.path
  return null
}

const addFolder = async (files: FolderFile[]) => {
  if (!files.length) return
  const images = shuffle(files.filter((item) => isImageFile(item.file, item.path)))
  if (!images.length) return
  resetLibrary()
  rebuildPoints(0)
  setTarget(null)
  setLoading(0, images.length)
  for (const [i, { file, path }] of images.entries()) {
    try {
      pushPhoto(await photoFromFile(file, path))
    } catch {
      /* skip undecodable files */
    }
    setLoading(i + 1, images.length)
    imageCount.textContent = `${poolCount} image${poolCount === 1 ? "" : "s"}`
  }
  setLoading(images.length, images.length)
  updateImageUi()
  setFocusedPath(firstPhotoPath())
}

// ── Are.na ───────────────────────────────────────────────────────────────
/** Contents pages are mixed media (roughly half images), so pull generously; still one request. */
const PAGE_SIZE = 60
/** Channels this small rarely add anything new; skip them when auto-selecting a source. */
const MIN_CHANNEL_BLOCKS = 4
const IMAGE_CONCURRENCY = 4
/** Pull the next page when fewer than this many unseen photos from the current context remain. */
const REFILL_BELOW = 16
const REFILL_GAP_MS = 2500
const REFILL_RETRY_MS = 8000
/** A seed may spend up to this many pulls filling the sphere, never dipping below this many free requests. */
const SEED_MAX_PULLS = 4
const SEED_KEEP_FREE = 12

let seedBusy = false
let pulling = false
let lastPullAt = Number.NEGATIVE_INFINITY
let lastInteractionAt = 0

/** Any pan or zoom: postpones the context switch and dismisses the first-run hint. */
const noteInteraction = (now = performance.now()) => {
  lastInteractionAt = now
  dismissHint()
}

/** Pointer over the source list (reading, clicking): the hold timer waits. Keyboard tabbing does not pause it. */
let listEngaged = false
contextInfoEl.addEventListener("pointerenter", () => (listEngaged = true))
contextInfoEl.addEventListener("pointerdown", () => (listEngaged = true))
contextInfoEl.addEventListener("pointerleave", () => (listEngaged = false))
contextInfoEl.addEventListener("pointercancel", () => (listEngaged = false))

const setTarget = (target: ArenaTarget | null) => {
  currentTarget = target
  const hash = target ? targetToHash(target) : ""
  if (location.hash !== hash) history.replaceState(null, "", `${location.pathname}${location.search}${hash}`)
}

/**
 * Decodes image blocks into the pool. Blocks already cached are only re-stamped.
 * Returns the pool indices that were added or touched, in order.
 */
const addBlocks = async (blocks: ArenaBlock[], via: ArenaChannel | null, contextId: number | null) => {
  const stamp = performance.now()
  const touched: number[] = []
  const fresh: ArenaBlock[] = []
  const seen = new Set<number>()
  for (const block of blocks) {
    if (!isImageBlock(block) || seen.has(block.id)) continue
    seen.add(block.id)
    const existing = photoByPath.get(`arena/${block.id}`)
    if (existing !== undefined && photos[existing]) {
      if (contextId !== null) {
        photos[existing]!.related = stamp
        photos[existing]!.context = contextId
      }
      touched.push(existing)
      continue
    }
    fresh.push(block)
  }
  let cursor = 0
  const worker = async () => {
    while (cursor < fresh.length) {
      const block = fresh[cursor++]!
      try {
        const photo = await photoFromArena(block, via)
        if (contextId !== null) {
          photo.related = stamp
          photo.context = contextId
        }
        touched.push(pushPhoto(photo))
        imageCount.textContent = `${poolCount} image${poolCount === 1 ? "" : "s"}`
        syncSeedForm()
      } catch {
        /* skip undecodable or missing images */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, fresh.length) }, worker))
  if (contextId !== null) restockQueues()
  if (fresh.length) updateImageUi()
  return touched
}

const ensureConnections = async (id: number, priority: Priority) => {
  const cached = connectionsByBlock.get(id)
  if (cached) return cached
  connectionsPending.add(id)
  connectionsFailed.delete(id)
  syncInfo()
  try {
    const page = await arena.blockConnections(id, priority)
    connectionsByBlock.set(id, page.data)
    if (context?.id === id) context.channels = page.data
    return page.data
  } catch (e) {
    const kind = e instanceof ArenaError ? e.kind : "offline"
    connectionsFailed.set(id, kind === "limited" || kind === "budget" ? "waiting" : "unavailable")
    throw e
  } finally {
    connectionsPending.delete(id)
    syncInfo()
  }
}

const pagesFor = (channel: ArenaChannel) => {
  const entry = channelPages.get(channel.slug) ?? { fetched: new Set<number>(), totalPages: null }
  channelPages.set(channel.slug, entry)
  const total = entry.totalPages ?? Math.max(1, Math.ceil(channel.counts.contents / PAGE_SIZE))
  const open: number[] = []
  for (let p = 1; p <= total; p++) if (!entry.fetched.has(p)) open.push(p)
  return { entry, open }
}

const exhausted = (channel: ArenaChannel) => pagesFor(channel).open.length === 0

/**
 * The channel currently feeding the pool: the user's pick while it has pages left,
 * otherwise the next one down the list (wrapping), skipping tiny and exhausted channels.
 */
const activeChannel = (): ArenaChannel | null => {
  const channels = context?.channels
  if (!channels?.length) return null
  const start = Math.max(
    0,
    channels.findIndex((c) => c.slug === context!.selected),
  )
  for (let step = 0; step < channels.length; step++) {
    const c = channels[(start + step) % channels.length]!
    if (exhausted(c)) continue
    if (step > 0 && c.counts.blocks < MIN_CHANNEL_BLOCKS) continue
    return c
  }
  return null
}

/** Fetches the next unseen page (in channel order) from a channel into the pool. */
const pullChannel = async (channel: ArenaChannel, priority: Priority, contextId: number | null) => {
  const { entry, open } = pagesFor(channel)
  const target = open[0]
  if (target === undefined) return []
  const result = await arena.channelContents(channel.slug, target, PAGE_SIZE, priority)
  entry.fetched.add(target)
  entry.totalPages = result.meta.total_pages
  return addBlocks(result.data, channel, contextId)
}

/** Pulls one page from the active source channel of the current context. */
const pullNext = async (priority: Priority) => {
  const ctx = context
  const channel = activeChannel()
  if (!ctx || !channel || pulling) return []
  pulling = true
  lastPullAt = performance.now()
  try {
    const touched = await pullChannel(channel, priority, ctx.id)
    return touched
  } finally {
    pulling = false
    syncInfo()
  }
}

const unseenInContext = () => {
  const id = context?.id
  if (id === undefined) return 0
  let n = 0
  for (const i of ahead) if (photos[i]?.context === id) n++
  return n
}

const setContext = (id: number, title: string, channels: ArenaChannel[] | null) => {
  context = { id, title, channels, selected: null, setAt: performance.now() }
  syncInfo()
}

/** Makes `block` the context and loads its connections (the list scrambles in as it arrives). */
const adoptContext = async (block: ArenaBlock, priority: Priority) => {
  setContext(block.id, block.title?.trim() || "untitled", connectionsByBlock.get(block.id) ?? null)
  const channels = await ensureConnections(block.id, priority)
  if (context?.id === block.id) context.channels = channels
  syncInfo()
}

/**
 * Runs every frame. Two jobs:
 *  1. once the user has been still for the hold time, let the context follow the focus;
 *  2. keep a small buffer of unseen photos from the context so zooming always has material.
 */
const stepContext = (now: number) => {
  if (seedBusy || COUNT === 0) return
  syncSourceRows(now)
  const locked = seeking && handedOff && !zooming(now) && !dragging && !inspectOpen
  const photo = photos[imageIds[center]]
  const block = photo?.arena

  // A switch is pending when the focus has left the context and the user has moved since it was set.
  const pending = !!block && context?.id !== block.id && lastInteractionAt > (context?.setAt ?? -1)
  // Reading or clicking the list holds the timer at full; it resumes once the pointer leaves.
  if (pending && listEngaged) lastInteractionAt = now
  const hold = arenaPrefs.holdMs
  const still = now - lastInteractionAt
  const hidden = hold * (1 - arenaPrefs.reveal)
  // The hold only applies to zooming; after a pan the context follows the moment the focus settles.
  const due = panned ? !listEngaged : still >= hold
  paintSourceTimer(contextInfoEl, !pending ? 1 : panned ? 0 : 1 - (still - hidden) / Math.max(1, hold - hidden))

  if (pending && locked && due && arena.budget("background") > 0) {
    panned = false
    endZoomSession()
    void adoptContext(block, "background").catch(() => undefined)
  }

  // Connections failed earlier (budget/offline): retry now and then.
  if (
    context &&
    context.id >= 0 &&
    !context.channels &&
    !connectionsPending.has(context.id) &&
    now - context.setAt >= REFILL_RETRY_MS &&
    arena.budget("background") > 0
  ) {
    context.setAt = now
    void ensureConnections(context.id, "background").catch(() => undefined)
  }

  if (!context?.channels || pulling) return
  if (unseenInContext() >= REFILL_BELOW) return
  const gap = now - lastPullAt
  if (gap < REFILL_GAP_MS) return
  if (arena.budget("background") <= 0) return
  if (!activeChannel()) return
  void pullNext("background").catch(() => {
    lastPullAt = now + REFILL_RETRY_MS - REFILL_GAP_MS
  })
}

/** Clicking a channel in the list makes it the source; pulls right away if the buffer is thin. */
const selectChannel = async (channel: ArenaChannel) => {
  if (!context || seedBusy) return
  context.selected = channel.slug
  syncInfo()
  if (exhausted(channel)) return
  if (unseenInContext() >= REFILL_BELOW && activeChannel()?.slug === channel.slug) return
  try {
    await pullNext("user")
  } catch (e) {
    flashStatus(describeError(e))
  }
}

/** Tab moves the source selection down (or up) the list, skipping channels with nothing left. */
const cycleChannel = (dir: 1 | -1) => {
  const channels = context?.channels
  if (!channels?.length || !context) return
  const listed = channels.slice(0, MAX_SOURCE_ROWS)
  const current = activeChannel()?.slug ?? null
  const start = Math.max(0, listed.findIndex((c) => c.slug === current))
  const usable = (c: ArenaChannel) => !exhausted(c) || (channelStats.get(c.slug)?.unseen ?? 0) > 0
  for (let step = 1; step <= listed.length; step++) {
    const c = listed[(start + dir * step + listed.length * step) % listed.length]!
    if (!usable(c)) continue
    noteInteraction()
    void selectChannel(c)
    return
  }
}

/** One key press zooms about this many lattice slots (an impulse decays as growth/zoomDamp). */
const KEY_ZOOM_SLOTS = 8

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)

addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
  if (COUNT === 0 || seedBusy) return
  const onControl =
    event.target instanceof HTMLElement &&
    (event.target.matches("button, a, [role=button]") && !event.target.matches(".info-channel"))
  switch (event.key) {
    case "Tab":
      if (!context?.channels?.length) return
      event.preventDefault()
      cycleChannel(event.shiftKey ? -1 : 1)
      return
    case "Enter":
      if (onControl) return
      event.preventDefault()
      kickZoom(KEY_ZOOM_SLOTS * sim.zoomDamp)
      return
    case "Backspace":
      if (onControl) return
      event.preventDefault()
      kickZoom(-KEY_ZOOM_SLOTS * sim.zoomDamp)
      return
    case "Escape":
      if (inspectOpen) closeInspect()
      return
  }
})

const describeError = (e: unknown) => {
  if (!(e instanceof ArenaError)) return "something went wrong"
  switch (e.kind) {
    case "limited":
    case "budget": {
      const secs = Math.ceil((arena.status().retryAt - Date.now()) / 1000)
      return secs > 0 ? `are.na is cooling down, try again in ${secs}s` : "are.na is cooling down, try again shortly"
    }
    case "offline":
      return "can't reach are.na"
    case "http":
      return e.status === 404 ? "couldn't find that on are.na" : `are.na said ${e.status}`
  }
}

const seed = async (target: ArenaTarget) => {
  if (seedBusy) return
  seedBusy = true
  seedHint.classList.remove("is-error")
  seedHint.textContent = "asking are.na…"
  syncSeedForm()
  setLoading(0, -1)
  try {
    if (target.kind === "block") {
      const block = await arena.block(target.id, "user")
      resetLibrary()
      rebuildPoints(0)
      setTarget(target)
      if (isImageBlock(block)) {
        const [seedIndex] = await addBlocks([block], null, null)
        if (seedIndex !== undefined) focusPhoto(seedIndex)
      }
      try {
        await adoptContext(block, "user")
      } catch (e) {
        if (poolCount === 0) throw e
      }
      // Pull down the source list, one page at a time, until the sphere is populated.
      for (let attempt = 0; attempt < SEED_MAX_PULLS && poolCount < settings.sphereCount; attempt++) {
        if (!activeChannel()) break
        try {
          await pullNext("user")
        } catch (e) {
          if (poolCount === 0) throw e
          break
        }
        if (arena.budget("user") <= SEED_KEEP_FREE) break
      }
      if (!focusedPath) setFocusedPath(firstPhotoPath())
    } else {
      const channel = await arena.channel(target.slug, "user")
      resetLibrary()
      rebuildPoints(0)
      setTarget(target)
      setContext(-1, channel.title, [channel])
      await pullNext("user")
      setFocusedPath(firstPhotoPath())
    }
    if (poolCount === 0) {
      seedHint.classList.add("is-error")
      seedHint.textContent = "no images reachable from there, try another link"
    } else {
      seedHint.textContent = "a block, or a channel"
      showHint()
    }
  } catch (e) {
    seedHint.classList.add("is-error")
    seedHint.textContent = describeError(e)
  } finally {
    seedBusy = false
    setLoading(0, 0)
    updateImageUi()
  }
}

// ── First-run hint ───────────────────────────────────────────────────────
let hintShown = false
let hintTimer = 0

const showHint = () => {
  if (hintShown) return
  hintShown = true
  renderInstructions(hintEl)
  hintEl.hidden = false
  hintEl.classList.remove("is-fading")
  window.clearTimeout(hintTimer)
  hintTimer = window.setTimeout(dismissHint, 9000)
}

const dismissHint = () => {
  if (hintEl.hidden || hintEl.classList.contains("is-fading")) return
  hintEl.classList.add("is-fading")
  window.clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => {
    hintEl.hidden = true
  }, 1000)
}

renderInstructions(seedInstructions)

const seedFromText = (text: string) => {
  const target = parseArenaTarget(text)
  if (!target) {
    seedHint.classList.add("is-error")
    seedHint.textContent = "that doesn't look like an are.na block or channel link"
    return false
  }
  void seed(target)
  return true
}

seedForm.addEventListener("submit", (e) => {
  e.preventDefault()
  if (seedFromText(seedInput.value)) seedInput.value = ""
})

sourceForm.addEventListener("submit", (e) => {
  e.preventDefault()
  if (seedFromText(sourceInput.value)) sourceInput.value = ""
})

addEventListener("hashchange", () => {
  const target = targetFromHash(location.hash)
  if (!target) return
  if (!currentTarget || targetToHash(currentTarget) !== targetToHash(target)) void seed(target)
})

// ── Status indicator ─────────────────────────────────────────────────────
let statusFlash = ""
let statusFlashUntil = 0
let lastStatus: ArenaStatus = arena.status()

const paintStatus = () => {
  const s = lastStatus
  const now = Date.now()
  statusEl.dataset.state = s.state
  if (statusFlash && now < statusFlashUntil) {
    statusText.textContent = statusFlash
    return
  }
  statusFlash = ""
  switch (s.state) {
    case "idle":
      statusText.textContent = `are.na  ${s.used}/${s.limit}`
      break
    case "fetching":
      statusText.textContent = `are.na  fetching  ${s.used}/${s.limit}`
      break
    case "limited": {
      const secs = Math.max(1, Math.ceil((s.retryAt - now) / 1000))
      statusText.textContent = `are.na  cooling down ${secs}s  ·  browsing cache`
      break
    }
    case "offline":
      statusText.textContent = "are.na  offline  ·  browsing cache"
      break
  }
}

const flashStatus = (text: string, ms = 2600) => {
  statusFlash = text
  statusFlashUntil = Date.now() + ms
  paintStatus()
}

arena.onStatus((s) => {
  lastStatus = s
  paintStatus()
})
window.setInterval(() => {
  lastStatus = arena.status()
  paintStatus()
}, 1000)

const clearAllImages = () => {
  resetLibrary()
  rebuildPoints(0)
  setTarget(null)
  seedHint.classList.remove("is-error")
  seedHint.textContent = "a block, or a channel"
}

fileInput.addEventListener("change", () => {
  void addFolder(filesFromList(fileInput.files ?? []))
  fileInput.value = ""
})
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
  const files = filesFromList(e.clipboardData?.files ?? [])
  if (files.length) {
    void addFolder(files)
    return
  }
  const text = e.clipboardData?.getData("text/plain") ?? ""
  const target = parseArenaTarget(text)
  if (!target) return
  e.preventDefault()
  if (e.target === seedInput) seedInput.value = ""
  if (e.target === sourceInput) sourceInput.value = ""
  void seed(target)
})

const resize = () => {
  const cssW = innerWidth
  const cssH = innerHeight
  const view = viewPanel.getBoundingClientRect()
  // On a stacked (phone) layout the sphere shares the screen with the panels above and below it:
  // shrink it toward the free band, but never below ~78% of the width so thumbs stay legible.
  const stacked = view.width >= cssW - 1 && view.height < cssH - 1
  const band = stacked ? Math.max(view.height * 1.1, cssW * 0.78) : Number.POSITIVE_INFINITY
  const side = Math.max(1, Math.min(cssW, cssH, band))
  const worldPerPx = (2 * FRAME) / side
  camera.left = -cssW * 0.5 * worldPerPx
  camera.right = cssW * 0.5 * worldPerPx
  camera.top = cssH * 0.5 * worldPerPx
  camera.bottom = -cssH * 0.5 * worldPerPx
  camera.updateProjectionMatrix()
  ditherPass.resize(cssW, cssH)
  diskPx = 1 / worldPerPx
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
let pinchGrow = false
let didPinch = false

const pinchPoints = () => [...pointers.values()]

const pinchGap = () => {
  const pts = pinchPoints()
  const n = pts.length
  if (n < 2) return 0
  let max = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y)
      if (d > max) max = d
    }
  }
  return max
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
  pinchGrow = pointers.size >= 3
  pinchDist = pinchGap()
  lastPinch = performance.now()
})

canvas.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pinching && pointers.size >= 2) {
    const grow = pointers.size >= 3 || event.shiftKey
    if (grow !== pinchGrow) {
      pinchGrow = grow
      pinchDist = pinchGap()
      lastPinch = performance.now()
      return
    }
    lastPinch = performance.now()
    const next = pinchGap()
    if (pinchDist > 1) kickZoom((next - pinchDist) * sim.zoom * PINCH_ZOOM, pinchGrow)
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
    pinchGrow = false
    return
  }
  pointers.delete(event.pointerId)
  if (pointers.size >= 2) {
    pinchGrow = pointers.size >= 3
    pinchDist = pinchGap()
    return
  }
  if (pointers.size === 1) {
    pinching = false
    pinchGrow = false
    pinchDist = 0
    dragging = false
    return
  }
  pinching = false
  pinchGrow = false
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
    pinchGrow = false
    didPinch = false
  }
})

canvas.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false })
canvas.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false })

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
      kickZoom(-dy * sim.zoom * 28, event.shiftKey)
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

syncHoldUi()
syncRevealUi()
syncPalette()
syncDither()
updateImageUi()
resize()
lastContentQ.copy(content.quaternion)
{
  const initial = targetFromHash(location.hash)
  if (initial) void seed(initial)
  else seedInput.focus({ preventScroll: true })
}

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
    stepImagePalette(dt)
    chrome.step(now, dt)
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
  projectThumbs(dt, now)
  {
    const photo = COUNT > 0 ? photos[imageIds[center]] : undefined
    setFocusedPath(photo?.path ?? focusedPath)
  }
  stepContext(now)
  stepImagePalette(dt)
  chrome.step(now, dt)
  present()
})
