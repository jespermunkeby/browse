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

export const PALETTE_SOURCES = [
  { id: "custom", label: "Custom" },
  { id: "image", label: "Focused image" },
] as const

export type PaletteSourceId = (typeof PALETTE_SOURCES)[number]["id"]

export const PALETTE_STRATEGIES = [
  { id: "median-cut", label: "Median cut" },
  { id: "k-means", label: "K-means" },
  { id: "dominant", label: "Dominant" },
  { id: "vivid", label: "Vivid" },
  { id: "spread", label: "Luma spread" },
] as const

export type PaletteStrategyId = (typeof PALETTE_STRATEGIES)[number]["id"]

export const MAX_PALETTE = 24
export const MIN_IMAGE_PALETTE = 2
export const DEFAULT_IMAGE_PALETTE = 5
export const MIN_FADE = 0
export const MAX_FADE = 3

export type Settings = {
  mode: ModeId
  paletteSource: PaletteSourceId
  paletteStrategy: PaletteStrategyId
  imageColorCount: number
  paletteFade: number
  primary: string
  secondary: string
  colors: string[]
  imageColors: string[]
  coarseness: number
  imageArea: number
  sphereCount: number
  focusOriginalColor: boolean
  focusUndithered: boolean
  vignetteRadius: number
  vignetteSoftness: number
  vignetteStrength: number
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "bayer-1",
  paletteSource: "image",
  paletteStrategy: "median-cut",
  imageColorCount: DEFAULT_IMAGE_PALETTE,
  paletteFade: 0.45,
  primary: "#33302e",
  secondary: "#69c846",
  colors: ["#6d7678", "#31af89", "#4d8999"],
  imageColors: [],
  coarseness: 1,
  imageArea: 0.07,
  sphereCount: 32,
  focusOriginalColor: true,
  focusUndithered: false,
  vignetteRadius: 0.42,
  vignetteSoftness: 0.62,
  vignetteStrength: 1,
}

const uniqueHexes = (hexes: string[]) => {
  const unique: string[] = []
  for (const hex of hexes) if (!unique.includes(hex)) unique.push(hex)
  return unique.slice(0, MAX_PALETTE)
}

export const paletteColors = (settings: Settings) => {
  if (settings.paletteSource === "image" && settings.imageColors.length > 0) {
    return settings.imageColors.slice(0, MAX_PALETTE)
  }
  return uniqueHexes([settings.primary, settings.secondary, ...settings.colors])
}

export const themeColors = (settings: Settings) => {
  if (settings.paletteSource !== "image" || settings.imageColors.length === 0) {
    return { primary: settings.primary, secondary: settings.secondary }
  }
  return {
    primary: settings.imageColors[0]!,
    secondary: settings.imageColors[settings.imageColors.length - 1]!,
  }
}

export const formatCoarseness = (value: number) => `${value}×`

export const formatFade = (value: number) => `${value.toFixed(2)}s`

export const clampFade = (value: number) => Math.min(MAX_FADE, Math.max(MIN_FADE, value))

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
      paletteSource: settings.paletteSource,
      paletteStrategy: settings.paletteStrategy,
      imageColorCount: settings.imageColorCount,
      paletteFade: settings.paletteFade,
      primary: settings.primary,
      secondary: settings.secondary,
      colors: [...settings.colors],
      coarseness: settings.coarseness,
      imageArea: settings.imageArea,
      sphereCount: settings.sphereCount,
      focusOriginalColor: settings.focusOriginalColor,
      focusUndithered: settings.focusUndithered,
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
