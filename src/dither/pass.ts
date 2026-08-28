import * as THREE from "three"
import { applyCircularVignette, applyDither, bayerSize, generateBayer } from "./dither.ts"
import { blueNoiseMap } from "./blueNoise.ts"
import { ColorImage, parseHexColor } from "./image.ts"
import { MAX_PALETTE, bayerLevelFor, needsErrorDiffusion, paletteColors, themeColors, type Settings } from "./settings.ts"

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
uniform vec3 uBackground;
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
  float square = min(uResolution.x, uResolution.y);
  p.x *= uResolution.x / square;
  p.y *= uResolution.y / square;
  float r = length(p);
  float outer = uVignetteRadius + max(0.0001, uVignetteSoftness);
  float t = smoothstep(uVignetteRadius, outer, r);
  color = mix(color, uBackground, t * uVignetteStrength);

  vec2 tUV = (mod(pixel, uThresholdSize) + 0.5) / uThresholdSize;
  float thresh = texture2D(tThreshold, tUV).r;
  color += (thresh - 0.5) * uSpread;
  gl_FragColor = vec4(nearest(color), 1.0);
}
`

const focusFrag = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tMap;
uniform sampler2D tThreshold;
uniform vec2 uResolution;
uniform float uCoarseness;
uniform vec3 uPalette[${MAX_PALETTE}];
uniform int uPaletteSize;
uniform float uSpread;
uniform float uThresholdSize;
uniform float uQuantize;
uniform float uDither;
uniform float uOpacity;

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
  vec4 tex = texture2D(tMap, vUv);
  vec3 color = tex.rgb;
  float coarse = max(uCoarseness, 1.0);
  vec2 pixel = floor(gl_FragCoord.xy / coarse);
  if (uDither > 0.5) {
    vec2 tUV = (mod(pixel, uThresholdSize) + 0.5) / uThresholdSize;
    float thresh = texture2D(tThreshold, tUV).r;
    color += (thresh - 0.5) * uSpread;
  }
  if (uQuantize > 0.5) color = nearest(color);
  else color = clamp(color, 0.0, 1.0);
  gl_FragColor = vec4(color, tex.a * uOpacity);
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
      uBackground: { value: new THREE.Vector3() },
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

  const focusMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tMap: { value: null },
      tThreshold: material.uniforms.tThreshold,
      uResolution: material.uniforms.uResolution,
      uCoarseness: material.uniforms.uCoarseness,
      uPalette: material.uniforms.uPalette,
      uPaletteSize: material.uniforms.uPaletteSize,
      uSpread: material.uniforms.uSpread,
      uThresholdSize: material.uniforms.uThresholdSize,
      uQuantize: { value: 0 },
      uDither: { value: 0 },
      uOpacity: { value: 0 },
    },
    vertexShader: vert,
    fragmentShader: focusFrag,
    transparent: true,
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

  let width = 256
  let height = 256
  let pixels = new Uint8Array(width * height * 4)
  const scratchColor = new THREE.Color()

  const resize = (cssW: number, cssH: number) => {
    const scale = Math.min(1, MAX_SIZE / Math.max(cssW, cssH, 1))
    const nextW = Math.max(1, Math.round(cssW * scale))
    const nextH = Math.max(1, Math.round(cssH * scale))
    if (nextW === width && nextH === height) {
      renderer.setSize(width, height, false)
      return
    }
    width = nextW
    height = nextH
    sceneTarget.setSize(width, height)
    material.uniforms.uResolution.value.set(width, height)
    pixels = new Uint8Array(width * height * 4)
    renderer.setSize(width, height, false)
  }

  const setSettings = (settings: Settings) => {
    const colors = paletteColors(settings)
    material.uniforms.uPaletteSize.value = colors.length
    material.uniforms.uSpread.value = colors.length > 1 ? 1 / (colors.length - 1) : 0.5
    for (let i = 0; i < MAX_PALETTE; i++) {
      scratchColor.set(colors[Math.min(i, colors.length - 1)] ?? "#000000")
      palette[i]!.set(scratchColor.r, scratchColor.g, scratchColor.b)
    }
    scratchColor.set(themeColors(settings).primary)
    material.uniforms.uBackground.value.set(scratchColor.r, scratchColor.g, scratchColor.b)
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

  const setPaletteRgb = (colors: [number, number, number][]) => {
    const n = Math.max(0, Math.min(MAX_PALETTE, colors.length))
    material.uniforms.uPaletteSize.value = n
    material.uniforms.uSpread.value = n > 1 ? 1 / (n - 1) : 0.5
    for (let i = 0; i < MAX_PALETTE; i++) {
      const c = colors[Math.min(i, Math.max(0, n - 1))] ?? [0, 0, 0]
      palette[i]!.set(c[0], c[1], c[2])
    }
    if (n > 0) material.uniforms.uBackground.value.set(colors[0]![0], colors[0]![1], colors[0]![2])
  }

  const ditherCpu = (settings: Settings) => {
    renderer.readRenderTargetPixels(sceneTarget, 0, 0, width, height, pixels)
    const image = new ImageData(width, height)
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4
      const dst = y * width * 4
      image.data.set(pixels.subarray(src, src + width * 4), dst)
    }
    const background = parseHexColor(themeColors(settings).primary)
    const color = ColorImage.fromImageData(image, background)
    applyCircularVignette(
      color,
      settings.vignetteRadius,
      settings.vignetteSoftness,
      settings.vignetteStrength,
      background,
    )
    const dithered = applyDither(color, settings).toImageData()
    if (cpuCanvas.width !== width || cpuCanvas.height !== height) {
      cpuCanvas.width = width
      cpuCanvas.height = height
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

  const setFocusOverlay = (
    map: THREE.Texture | null,
    opacity: number,
    originalColor: boolean,
    undithered: boolean,
  ) => {
    focusMaterial.uniforms.tMap.value = map
    focusMaterial.uniforms.uOpacity.value = opacity
    focusMaterial.uniforms.uQuantize.value = originalColor ? 0 : 1
    focusMaterial.uniforms.uDither.value = undithered ? 0 : 1
  }

  const dispose = () => {
    sceneTarget.dispose()
    material.dispose()
    focusMaterial.dispose()
    cpuMaterial.dispose()
    cpuTexture.dispose()
    quad.geometry.dispose()
  }

  return { resize, setSettings, setPaletteRgb, setFocusOverlay, focusMaterial, render, dispose }
}
