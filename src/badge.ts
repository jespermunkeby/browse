import * as THREE from "three"

const cache = new Map<number, THREE.CanvasTexture>()

export const badgeTexture = (n: number) => {
  const cached = cache.get(n)
  if (cached) return cached

  const size = 64
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size

  const ctx = canvas.getContext("2d")!
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
  ctx.fillStyle = "#fff"
  ctx.fill()

  ctx.fillStyle = "#111"
  ctx.font = `600 ${n < 100 ? 28 : n < 1000 ? 22 : 18}px system-ui, sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(String(n), size / 2, size / 2 + 1)

  const texture = new THREE.CanvasTexture(canvas)
  cache.set(n, texture)
  return texture
}
