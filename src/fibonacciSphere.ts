export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export const SPHERE_RADIUS = 1.03

/** Number 1 sits at the south pole (last Fibonacci slot). */
export const slotForNumber = (n: number, count: number) => count - n

export const fibonacciPoint = (index: number, count: number, radius = 1) => {
  const y = 1 - ((index + 0.5) / count) * 2
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = GOLDEN_ANGLE * index
  return [Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius] as const
}

export const fibonacciSphere = (count: number, radius = 1) => {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) positions.set(fibonacciPoint(i, count, radius), i * 3)
  return positions
}
