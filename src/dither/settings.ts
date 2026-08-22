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
  primary: string
  secondary: string
  colors: string[]
  coarseness: number
  imageArea: number
  sphereCount: number
  vignetteRadius: number
  vignetteSoftness: number
  vignetteStrength: number
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "bayer-1",
  primary: "#1a120c",
  secondary: "#f3ead8",
  colors: ["#c43b3b", "#e6c15c"],
  coarseness: 1,
  imageArea: 0.07,
  sphereCount: 32,
  vignetteRadius: 0.42,
  vignetteSoftness: 0.62,
  vignetteStrength: 1,
}

export const paletteColors = (settings: Settings) => {
  const hexes = [settings.primary, settings.secondary, ...settings.colors]
  const unique: string[] = []
  for (const hex of hexes) if (!unique.includes(hex)) unique.push(hex)
  return unique.slice(0, MAX_PALETTE)
}

export const formatCoarseness = (value: number) => `${value}×`

export const bayerLevelFor = (mode: ModeId): number | null => {
  if (mode === "bayer-0") return 0
  if (mode === "bayer-1") return 1
  if (mode === "bayer-2") return 2
  if (mode === "bayer-3") return 3
  return null
}

export const settingsJson = (
  settings: Settings,
  extra: { projection: string; spiral: boolean; motion: Record<string, number> },
) =>
  JSON.stringify(
    {
      mode: settings.mode,
      primary: settings.primary,
      secondary: settings.secondary,
      colors: [...settings.colors],
      coarseness: settings.coarseness,
      imageArea: settings.imageArea,
      sphereCount: settings.sphereCount,
      vignetteRadius: settings.vignetteRadius,
      vignetteSoftness: settings.vignetteSoftness,
      vignetteStrength: settings.vignetteStrength,
      projection: extra.projection,
      spiral: extra.spiral,
      motion: { ...extra.motion },
    },
    null,
    2,
  )

export const needsErrorDiffusion = (mode: ModeId) => mode === "simple-ed" || mode === "floyd-steinberg"
