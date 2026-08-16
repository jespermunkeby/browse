/**
 * Functionality: Jonker–Volgenant dense min-cost assignment (LAPJV).
 * Same optimum as Hungarian; different augmenting-path schedule.
 *
 * Port of the classic 1-based lap.cpp (Jonker & Volgenant, 1987/1996).
 * cost is a row-major n×n Float64Array. assign[row] = column.
 */

export type LapjvScratch = {
  x: Int32Array
  y: Int32Array
  free: Int32Array
  col: Int32Array
  matches: Int32Array
  pred: Int32Array
  d: Float64Array
  v: Float64Array
}

export const createLapjvScratch = (n: number): LapjvScratch => ({
  x: new Int32Array(n + 1),
  y: new Int32Array(n + 1),
  free: new Int32Array(n + 1),
  col: new Int32Array(n + 1),
  matches: new Int32Array(n + 1),
  pred: new Int32Array(n + 1),
  d: new Float64Array(n + 1),
  v: new Float64Array(n + 1),
})

const at = (cost: Float64Array, n: number, i: number, j: number) => cost[(i - 1) * n + (j - 1)]

export const lapjv = (cost: Float64Array, n: number, assign: Int32Array, s: LapjvScratch) => {
  if (n === 0) return 0
  if (n === 1) {
    assign[0] = 0
    return cost[0]
  }

  const { x, y, free, col, matches, pred, d, v } = s
  x.fill(0)
  y.fill(0)
  free.fill(0)
  matches.fill(0)
  v.fill(0)

  // Column reduction
  for (let j = n; j >= 1; j--) {
    let min = at(cost, n, 1, j)
    let imin = 1
    for (let i = 2; i <= n; i++) {
      const c = at(cost, n, i, j)
      if (c < min) {
        min = c
        imin = i
      }
    }
    v[j] = min
    if (++matches[imin] === 1) {
      x[imin] = j
      y[j] = imin
    } else {
      y[j] = 0
    }
  }

  // Reduction transfer
  let numfree = 0
  for (let i = 1; i <= n; i++) {
    if (matches[i] === 0) free[numfree++] = i
    else if (matches[i] === 1) {
      const j1 = x[i]
      let min = Infinity
      for (let j = 1; j <= n; j++) {
        if (j === j1) continue
        const c = at(cost, n, i, j) - v[j]
        if (c < min) min = c
      }
      v[j1] -= min
    }
  }

  // Augmenting row reduction
  for (let loopcnt = 0; loopcnt < 2; loopcnt++) {
    let k = 0
    const prvnumfree = numfree
    numfree = 0
    while (k < prvnumfree) {
      const i = free[k++]
      let umin = at(cost, n, i, 1) - v[1]
      let j1 = 1
      let usubmin = Infinity
      let j2 = 0
      for (let j = 2; j <= n; j++) {
        const h = at(cost, n, i, j) - v[j]
        if (h < usubmin) {
          if (h >= umin) {
            usubmin = h
            j2 = j
          } else {
            usubmin = umin
            umin = h
            j2 = j1
            j1 = j
          }
        }
      }
      let i0 = y[j1]
      if (umin < usubmin) v[j1] -= usubmin - umin
      else if (i0 > 0) {
        j1 = j2
        i0 = y[j1]
      }
      x[i] = j1
      y[j1] = i
      if (i0 > 0) {
        if (umin < usubmin) free[--k] = i0
        else free[numfree++] = i0
      }
    }
  }

  // Augmentation
  for (let f = 0; f < numfree; f++) {
    const freerow = free[f]
    for (let j = 1; j <= n; j++) {
      d[j] = at(cost, n, freerow, j) - v[j]
      pred[j] = freerow
      col[j] = j
    }
    let low = 1
    let up = 1
    let last = 0
    let endofpath = 0
    let unassignedfound = false
    while (!unassignedfound) {
      if (up === low) {
        last = low - 1
        let min = d[col[up++]]
        for (let k = up; k <= n; k++) {
          const j = col[k]
          const h = d[j]
          if (h <= min) {
            if (h < min) {
              up = low
              min = h
            }
            col[k] = col[up]
            col[up++] = j
          }
        }
        for (let k = low; k < up; k++) {
          if (y[col[k]] === 0) {
            endofpath = col[k]
            unassignedfound = true
            break
          }
        }
      }
      if (unassignedfound) break

      const j1 = col[low]
      low++
      const i = y[j1]
      const h = at(cost, n, i, j1) - v[j1] - d[j1]
      for (let k = up; k <= n; k++) {
        const j = col[k]
        const v2 = at(cost, n, i, j) - v[j] - h
        if (v2 < d[j]) {
          pred[j] = i
          if (v2 === d[col[low]]) {
            if (y[j] === 0) {
              endofpath = j
              unassignedfound = true
              break
            } else {
              col[k] = col[up]
              col[up++] = j
            }
          }
          d[j] = v2
        }
      }
    }

    for (let k = 1; k <= last; k++) {
      const j1 = col[k]
      v[j1] += d[j1] - d[endofpath]
    }
    let i = 0
    do {
      i = pred[endofpath]
      y[endofpath] = i
      const j1 = endofpath
      endofpath = x[i]
      x[i] = j1
    } while (i !== freerow)
  }

  let total = 0
  for (let i = 1; i <= n; i++) {
    const j = x[i]
    assign[i - 1] = j - 1
    total += at(cost, n, i, j)
  }
  return total
}
