import * as THREE from "three"

export type Photo = {
  name: string
  source: ImageBitmap
  texture: THREE.Texture
  aspect: number
}

export const photoFromFile = async (file: File): Promise<Photo> => {
  const source = await createImageBitmap(file)
  const texture = new THREE.Texture(source)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return { name: file.name, source, texture, aspect: source.width / Math.max(source.height, 1) }
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
