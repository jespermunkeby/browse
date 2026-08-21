export const MODES = [
  { id: "simple-ed", label: "Simple 2D" },
  { id: "floyd-steinberg", label: "Floyd–Steinberg" },
  { id: "blue-noise", label: "Blue noise" },
  { id: "bayer-0", label: "Bayer 2×2" },
  { id: "bayer-1", label: "Bayer 4×4" },
  { id: "bayer-2", label: "Bayer 8×8" },
  { id: "bayer-3", label: "Bayer 16×16" },
] as const

export type ModeId = (typeof MODES)[number]["id"]

export const MAX_PALETTE = 24

export type Settings = {
  mode: ModeId
  colors: string[]
  coarseness: number
  imageArea: number
  vignetteRadius: number
  vignetteSoftness: number
  vignetteStrength: number
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "bayer-1",
  colors: ["#1a120c", "#c43b3b", "#e6c15c", "#f3ead8"],
  coarseness: 1,
  imageArea: 0.07,
  vignetteRadius: 0.42,
  vignetteSoftness: 0.62,
  vignetteStrength: 1,
}

export const formatCoarseness = (value: number) => `${value}×`

export const bayerLevelFor = (mode: ModeId): number | null => {
  if (mode === "bayer-0") return 0
  if (mode === "bayer-1") return 1
  if (mode === "bayer-2") return 2
  if (mode === "bayer-3") return 3
  return null
}

export const settingsJson = (settings: Settings) =>
  JSON.stringify(
    {
      mode: settings.mode,
      colors: settings.colors,
      coarseness: settings.coarseness,
      imageArea: settings.imageArea,
      vignetteRadius: settings.vignetteRadius,
      vignetteSoftness: settings.vignetteSoftness,
      vignetteStrength: settings.vignetteStrength,
    },
    null,
    2,
  )

export const needsErrorDiffusion = (mode: ModeId) => mode === "simple-ed" || mode === "floyd-steinberg"
