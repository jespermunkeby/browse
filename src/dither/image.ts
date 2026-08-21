export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export const parseHexColor = (hex: string): [number, number, number] => {
  const v = hex.replace("#", "")
  const n =
    v.length === 3
      ? [v[0] + v[0], v[1] + v[1], v[2] + v[2]]
      : [v.slice(0, 2), v.slice(2, 4), v.slice(4, 6)]
  return n.map((c) => parseInt(c, 16) / 255) as [number, number, number]
}

export class ColorImage {
  readonly width: number
  readonly height: number
  readonly data: Float32Array

  constructor(width: number, height: number, data?: Float32Array) {
    this.width = width
    this.height = height
    this.data = data ?? new Float32Array(width * height * 3)
  }

  static fromImageData(src: ImageData, pad: [number, number, number] = [0, 0, 0]): ColorImage {
    const out = new ColorImage(src.width, src.height)
    const px = src.data
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
      const a = px[i + 3]! / 255
      out.data[j] = (px[i]! / 255) * a + pad[0] * (1 - a)
      out.data[j + 1] = (px[i + 1]! / 255) * a + pad[1] * (1 - a)
      out.data[j + 2] = (px[i + 2]! / 255) * a + pad[2] * (1 - a)
    }
    return out
  }

  clone(): ColorImage {
    return new ColorImage(this.width, this.height, this.data.slice())
  }

  toImageData(): ImageData {
    const out = new ImageData(this.width, this.height)
    const px = out.data
    for (let i = 0, j = 0; i < this.data.length; i += 3, j += 4) {
      px[j] = Math.round(clamp01(this.data[i]!) * 255)
      px[j + 1] = Math.round(clamp01(this.data[i + 1]!) * 255)
      px[j + 2] = Math.round(clamp01(this.data[i + 2]!) * 255)
      px[j + 3] = 255
    }
    return out
  }
}
