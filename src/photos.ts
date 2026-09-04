import * as THREE from "three"
import type { ArenaBlock, ArenaChannel } from "./arena.ts"

export type Photo = {
  name: string
  path: string
  type: string
  bytes: number
  modified: number
  width: number
  height: number
  source: ImageBitmap
  texture: THREE.Texture
  aspect: number
  /** Present when the photo came from Are.na. */
  arena?: ArenaBlock
  /** Channel this photo was pulled through (null for the seed block). */
  via?: ArenaChannel | null
  /** Bumped whenever this photo is related to the current focus; higher = taken first on zoom. */
  related: number
  /** Block id of the context this photo was pulled for (undefined for seeds and local files). */
  context?: number
  /** Last time the photo was on a visible marker; used for eviction. */
  shownAt: number
}

export const arenaPath = (id: number) => `arena/${id}`

const IMAGE_EXT = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i

export const isImagePath = (path: string, type = "") =>
  type.startsWith("image/") || IMAGE_EXT.test(path)

export const isImageFile = (file: File, path = file.name) =>
  isImagePath(path, file.type) || IMAGE_EXT.test(file.name)

const textureFor = (source: ImageBitmap) => {
  const texture = new THREE.Texture(source)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export const photoFromFile = async (file: File, path = file.name): Promise<Photo> => {
  const source = await createImageBitmap(file)
  return {
    name: file.name,
    path,
    type: file.type,
    bytes: file.size,
    modified: file.lastModified,
    width: source.width,
    height: source.height,
    source,
    texture: textureFor(source),
    aspect: source.width / Math.max(source.height, 1),
    related: 0,
    shownAt: 0,
  }
}

/**
 * Loads the 800px rendition; the CDN sends CORS headers so the bitmap is untainted.
 * Image bytes never count against the Are.na API budget.
 */
export const photoFromArena = async (block: ArenaBlock, via: ArenaChannel | null): Promise<Photo> => {
  const image = block.image
  if (!image) throw new Error("block has no image")
  const res = await fetch(image.small.src_2x)
  if (!res.ok) throw new Error(`image ${res.status}`)
  const blob = await res.blob()
  const source = await createImageBitmap(blob)
  return {
    name: block.title?.trim() || image.filename,
    path: arenaPath(block.id),
    type: image.content_type,
    bytes: image.file_size,
    modified: new Date(block.created_at).getTime(),
    width: image.width,
    height: image.height,
    source,
    texture: textureFor(source),
    aspect: image.width / Math.max(image.height, 1),
    arena: block,
    via,
    related: 0,
    shownAt: 0,
  }
}

export const disposePhoto = (photo: Photo) => {
  photo.texture.dispose()
  photo.source.close()
}

export const photoSize = (aspect: number, area: number) => {
  const a = Math.max(1e-6, area)
  const r = Math.max(1e-6, aspect)
  return { w: Math.sqrt(a * r), h: Math.sqrt(a / r) }
}
