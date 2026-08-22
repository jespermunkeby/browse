import * as THREE from "three"

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
}

const IMAGE_EXT = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i

export const isImagePath = (path: string, type = "") =>
  type.startsWith("image/") || IMAGE_EXT.test(path)

export const isImageFile = (file: File, path = file.name) =>
  isImagePath(path, file.type) || IMAGE_EXT.test(file.name)

export const photoFromFile = async (file: File, path = file.name): Promise<Photo> => {
  const source = await createImageBitmap(file)
  const texture = new THREE.Texture(source)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return {
    name: file.name,
    path,
    type: file.type,
    bytes: file.size,
    modified: file.lastModified,
    width: source.width,
    height: source.height,
    source,
    texture,
    aspect: source.width / Math.max(source.height, 1),
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
