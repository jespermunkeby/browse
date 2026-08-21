import * as THREE from "three"
import { applyCircularVignette, applyDither, bayerSize, generateBayer } from "./dither.ts"
import { blueNoiseMap } from "./blueNoise.ts"
import { ColorImage } from "./image.ts"
import { MAX_PALETTE, bayerLevelFor, needsErrorDiffusion, type Settings } from "./settings.ts"

const MAX_SIZE = 1024

const vert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const frag = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tThreshold;
uniform vec2 uResolution;
uniform float uCoarseness;
uniform vec3 uPalette[${MAX_PALETTE}];
uniform int uPaletteSize;
uniform float uSpread;
uniform float uThresholdSize;
uniform float uVignetteRadius;
uniform float uVignetteSoftness;
uniform float uVignetteStrength;

vec3 nearest(vec3 c) {
  vec3 best = uPalette[0];
  float bestD = 1.0e20;
  for (int i = 0; i < ${MAX_PALETTE}; i++) {
    if (i >= uPaletteSize) break;
    vec3 d = c - uPalette[i];
    float dist = dot(d, d);
    if (dist < bestD) {
      bestD = dist;
      best = uPalette[i];
    }
  }
  return best;
}

void main() {
  float coarse = max(uCoarseness, 1.0);
  vec2 pixel = floor(vUv * uResolution / coarse);
  vec2 sampleUV = (pixel + 0.5) * coarse / uResolution;
  vec3 color = texture2D(tScene, sampleUV).rgb;

  vec2 p = sampleUV * 2.0 - 1.0;
  float r = length(p);
  float outer = uVignetteRadius + max(0.0001, uVignetteSoftness);
  float t = smoothstep(uVignetteRadius, outer, r);
  color *= 1.0 - t * uVignetteStrength;

  vec2 tUV = (mod(pixel, uThresholdSize) + 0.5) / uThresholdSize;
  float thresh = texture2D(tThreshold, tUV).r;
  color += (thresh - 0.5) * uSpread;
  gl_FragColor = vec4(nearest(color), 1.0);
}
`

const floatMap = (data: Float32Array, size: number) => {
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.FloatType)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.needsUpdate = true
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

const bayerMaps = [0, 1, 2, 3].map((level) => floatMap(generateBayer(level), bayerSize(level)))
const blueMap = floatMap(blueNoiseMap(64), 64)

export const createDitherPass = (renderer: THREE.WebGLRenderer) => {
  const sceneTarget = new THREE.WebGLRenderTarget(256, 256, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    type: THREE.UnsignedByteType,
  })
  sceneTarget.texture.colorSpace = THREE.SRGBColorSpace

  const palette = Array.from({ length: MAX_PALETTE }, () => new THREE.Vector3())
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: sceneTarget.texture },
      tThreshold: { value: bayerMaps[1] },
      uResolution: { value: new THREE.Vector2(256, 256) },
      uCoarseness: { value: 1 },
      uPalette: { value: palette },
      uPaletteSize: { value: 4 },
      uSpread: { value: 1 / 3 },
      uThresholdSize: { value: 4 },
      uVignetteRadius: { value: 0.42 },
      uVignetteSoftness: { value: 0.62 },
      uVignetteStrength: { value: 1 },
    },
    vertexShader: vert,
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

  const cpuCanvas = document.createElement("canvas")
  cpuCanvas.width = 1
  cpuCanvas.height = 1
  const cpuCtx = cpuCanvas.getContext("2d")!
  const cpuTexture = new THREE.CanvasTexture(cpuCanvas)
  cpuTexture.magFilter = THREE.NearestFilter
  cpuTexture.minFilter = THREE.NearestFilter
  cpuTexture.generateMipmaps = false
  cpuTexture.colorSpace = THREE.SRGBColorSpace

  const cpuMaterial = new THREE.MeshBasicMaterial({
    map: cpuTexture,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

  const quad = new THREE.Mesh<THREE.PlaneGeometry, THREE.Material>(new THREE.PlaneGeometry(2, 2), material)
  const blitScene = new THREE.Scene()
  const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  blitScene.add(quad)

  let size = 256
  let pixels = new Uint8Array(size * size * 4)
  const scratchColor = new THREE.Color()

  const resize = (css: number) => {
    const next = Math.max(1, Math.min(MAX_SIZE, Math.round(css)))
    if (next === size) {
      renderer.setSize(size, size, false)
      return size
    }
    size = next
    sceneTarget.setSize(size, size)
    material.uniforms.uResolution.value.set(size, size)
    pixels = new Uint8Array(size * size * 4)
    renderer.setSize(size, size, false)
    return size
  }

  const setSettings = (settings: Settings) => {
    const colors = settings.colors.slice(0, MAX_PALETTE)
    material.uniforms.uPaletteSize.value = colors.length
    material.uniforms.uSpread.value = colors.length > 1 ? 1 / (colors.length - 1) : 0.5
    for (let i = 0; i < MAX_PALETTE; i++) {
      scratchColor.set(colors[Math.min(i, colors.length - 1)] ?? "#000000")
      palette[i]!.set(scratchColor.r, scratchColor.g, scratchColor.b)
    }
    material.uniforms.uCoarseness.value = Math.max(1, settings.coarseness)
    material.uniforms.uVignetteRadius.value = settings.vignetteRadius
    material.uniforms.uVignetteSoftness.value = settings.vignetteSoftness
    material.uniforms.uVignetteStrength.value = settings.vignetteStrength

    const bayerLevel = bayerLevelFor(settings.mode)
    if (bayerLevel !== null) {
      material.uniforms.tThreshold.value = bayerMaps[bayerLevel]
      material.uniforms.uThresholdSize.value = bayerSize(bayerLevel)
    } else {
      material.uniforms.tThreshold.value = blueMap
      material.uniforms.uThresholdSize.value = 64
    }
  }

  const ditherCpu = (settings: Settings) => {
    renderer.readRenderTargetPixels(sceneTarget, 0, 0, size, size, pixels)
    const image = new ImageData(size, size)
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size * 4
      const dst = y * size * 4
      image.data.set(pixels.subarray(src, src + size * 4), dst)
    }
    const color = ColorImage.fromImageData(image, [0, 0, 0])
    applyCircularVignette(color, settings.vignetteRadius, settings.vignetteSoftness, settings.vignetteStrength)
    const dithered = applyDither(color, settings).toImageData()
    if (cpuCanvas.width !== size || cpuCanvas.height !== size) {
      cpuCanvas.width = size
      cpuCanvas.height = size
    }
    cpuCtx.putImageData(dithered, 0, 0)
    cpuTexture.needsUpdate = true
  }

  const render = (scene: THREE.Scene, camera: THREE.Camera, settings: Settings) => {
    renderer.setRenderTarget(sceneTarget)
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
    if (needsErrorDiffusion(settings.mode)) {
      ditherCpu(settings)
      quad.material = cpuMaterial
    } else {
      quad.material = material
    }
    renderer.render(blitScene, blitCam)
  }

  const dispose = () => {
    sceneTarget.dispose()
    material.dispose()
    cpuMaterial.dispose()
    cpuTexture.dispose()
    quad.geometry.dispose()
  }

  return { resize, setSettings, render, dispose }
}
