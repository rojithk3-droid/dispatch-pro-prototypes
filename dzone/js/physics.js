// Collision world: terrain heightfield + axis-aligned boxes in a uniform XZ grid.
// Character controller (move-and-slide with step-up), ray casts for bullets / line-of-sight, water queries.
import { clamp, segDist } from './util.js';

// world spans [-HALF, HALF]. A live binding: set per map before a world is generated
// (512 for the stylised 1 km maps, larger for real-data maps like Koramangala).
export let HALF = 512;
export function setWorldHalf(h) { HALF = h; }
export const SURF = { concrete: 0, metal: 1, wood: 2, glass: 3, dirt: 4, flesh: 5, water: 6, foliage: 7 };

export class Physics {
  constructor(res = 384) {
    this.res = res;
    this.cellM = (HALF * 2) / res;
    this.h = new Float32Array((res + 1) * (res + 1));
    // boxes stored flat for speed: minX,minY,minZ,maxX,maxY,maxZ
    this.bx = [];
    this.surf = [];
    this.gcell = 8;
    this.gn = Math.ceil((HALF * 2) / this.gcell);
    this.grid = new Array(this.gn * this.gn);
    this.stamp = new Uint32Array(0);
    this.rayId = 1;
    this.water = [];   // {type:'sea'|'disc'|'river', ...}
    this.dynamic = []; // dynamic colliders (vehicles): {minX..maxZ, owner}
  }

  // ---------------------------------------------------------------- terrain
  hIdx(i, j) { return j * (this.res + 1) + i; }
  height(x, z) {
    const r = this.res, c = this.cellM;
    let fx = (x + HALF) / c, fz = (z + HALF) / c;
    fx = clamp(fx, 0, r - 0.0001); fz = clamp(fz, 0, r - 0.0001);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const h = this.h, w = r + 1;
    const a = h[j * w + i], b = h[j * w + i + 1], cc = h[(j + 1) * w + i], d = h[(j + 1) * w + i + 1];
    // match the triangle split used by the mesh (diagonal from (i,j+1) to (i+1,j))
    if (tx + tz <= 1) return a + (b - a) * tx + (cc - a) * tz;
    return d + (cc - d) * (1 - tx) + (b - d) * (1 - tz);
  }
  normal(x, z) {
    const e = 1.0;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    return [-hx / l, (2 * e) / l, -hz / l];
  }

  // ---------------------------------------------------------------- boxes
  addBox(x0, y0, z0, x1, y1, z1, surf = SURF.concrete) {
    if (x1 - x0 < 0.01 || y1 - y0 < 0.01 || z1 - z0 < 0.01) return -1;
    const id = this.surf.length;
    this.bx.push(x0, y0, z0, x1, y1, z1);
    this.surf.push(surf);
    const g = this.gcell, n = this.gn;
    const i0 = clamp(Math.floor((x0 + HALF) / g), 0, n - 1), i1 = clamp(Math.floor((x1 + HALF) / g), 0, n - 1);
    const j0 = clamp(Math.floor((z0 + HALF) / g), 0, n - 1), j1 = clamp(Math.floor((z1 + HALF) / g), 0, n - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i;
      (this.grid[k] || (this.grid[k] = [])).push(id);
    }
    return id;
  }
  finalize() { this.stamp = new Uint32Array(this.surf.length + 16); }

  // collect box ids overlapping an XZ rect
  query(x0, z0, x1, z1, out) {
    const g = this.gcell, n = this.gn;
    const i0 = clamp(Math.floor((x0 + HALF) / g), 0, n - 1), i1 = clamp(Math.floor((x1 + HALF) / g), 0, n - 1);
    const j0 = clamp(Math.floor((z0 + HALF) / g), 0, n - 1), j1 = clamp(Math.floor((z1 + HALF) / g), 0, n - 1);
    const rid = ++this.rayId;
    out.length = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cell = this.grid[j * n + i];
      if (!cell) continue;
      for (let q = 0; q < cell.length; q++) {
        const id = cell[q];
        if (this.stamp[id] === rid) continue;
        this.stamp[id] = rid;
        const b = id * 6;
        if (this.bx[b] < x1 && this.bx[b + 3] > x0 && this.bx[b + 2] < z1 && this.bx[b + 5] > z0) out.push(id);
      }
    }
    return out;
  }

  // highest walkable surface under a footprint at or below maxY
  support(x, z, r, maxY, tmp = this._tmp || (this._tmp = [])) {
    let best = this.height(x, z);
    const ids = this.query(x - r, z - r, x + r, z + r, tmp);
    const B = this.bx;
    for (let k = 0; k < ids.length; k++) {
      const b = ids[k] * 6;
      const top = B[b + 4];
      if (top <= maxY && top > best) best = top;
    }
    for (const d of this.dynamic) {
      if (d.minX < x + r && d.maxX > x - r && d.minZ < z + r && d.maxZ > z - r && d.maxY <= maxY && d.maxY > best) best = d.maxY;
    }
    return best;
  }

  // Move a vertical capsule (approximated by a square prism) with slide + step-up.
  // p, v: {x,y,z}. Returns {grounded, hitWall}
  moveCharacter(p, v, dt, r, h, stepH, wasGrounded) {
    const res = { grounded: false, hitWall: false, landed: 0 };
    const B = this.bx;
    const tmp = this._mtmp || (this._mtmp = []);
    const steps = Math.max(1, Math.ceil((Math.abs(v.x) + Math.abs(v.z)) * dt / 0.3));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let axis = 0; axis < 2; axis++) {
        const d = (axis === 0 ? v.x : v.z) * sdt;
        if (d === 0) continue;
        if (axis === 0) p.x += d; else p.z += d;
        const ids = this.query(p.x - r, p.z - r, p.x + r, p.z + r, tmp);
        for (let k = 0; k < ids.length; k++) {
          const b = ids[k] * 6;
          const y0 = B[b + 1], y1 = B[b + 4];
          if (y1 <= p.y + stepH || y0 >= p.y + h) continue; // steppable or above head
          if (!(B[b] < p.x + r && B[b + 3] > p.x - r && B[b + 2] < p.z + r && B[b + 5] > p.z - r)) continue;
          res.hitWall = true;
          if (axis === 0) { p.x = d > 0 ? B[b] - r - 1e-4 : B[b + 3] + r + 1e-4; }
          else { p.z = d > 0 ? B[b + 2] - r - 1e-4 : B[b + 5] + r + 1e-4; }
        }
        for (const q of this.dynamic) {
          if (q.maxY <= p.y + stepH || q.minY >= p.y + h) continue;
          if (!(q.minX < p.x + r && q.maxX > p.x - r && q.minZ < p.z + r && q.maxZ > p.z - r)) continue;
          res.hitWall = true;
          if (axis === 0) p.x = d > 0 ? q.minX - r - 1e-4 : q.maxX + r + 1e-4;
          else p.z = d > 0 ? q.minZ - r - 1e-4 : q.maxZ + r + 1e-4;
        }
      }
    }
    p.x = clamp(p.x, -HALF + 1, HALF - 1);
    p.z = clamp(p.z, -HALF + 1, HALF - 1);
    // vertical
    const ground = this.support(p.x, p.z, r * 0.7, p.y + stepH);
    const prevY = p.y;
    p.y += v.y * dt;
    // ceiling
    if (v.y > 0) {
      const ids = this.query(p.x - r * 0.7, p.z - r * 0.7, p.x + r * 0.7, p.z + r * 0.7, tmp);
      for (let k = 0; k < ids.length; k++) {
        const b = ids[k] * 6;
        if (B[b + 1] >= prevY + h - 0.05 && B[b + 1] < p.y + h) { p.y = B[b + 1] - h; v.y = 0; }
      }
    }
    if (p.y <= ground) {
      if (v.y < 0) res.landed = -v.y;
      p.y = ground; if (v.y < 0) v.y = 0; res.grounded = true;
    } else if (wasGrounded && v.y <= 0 && p.y - ground < stepH + 0.1) {
      // stick to stairs / slopes when walking down
      p.y = ground; v.y = 0; res.grounded = true;
    }
    return res;
  }

  // does a character-sized prism at p fit (for stance changes)?
  fits(x, y, z, r, h) {
    const tmp = this._ftmp || (this._ftmp = []);
    const ids = this.query(x - r, z - r, x + r, z + r, tmp);
    const B = this.bx;
    for (let k = 0; k < ids.length; k++) {
      const b = ids[k] * 6;
      if (B[b + 1] < y + h && B[b + 4] > y + 0.3) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- raycast
  // Returns {t, x,y,z, nx,ny,nz, surf, id} or null. dir must be normalised.
  raycast(ox, oy, oz, dx, dy, dz, maxT, opts = {}) {
    let best = maxT, hit = null;
    const B = this.bx;
    const g = this.gcell, n = this.gn;
    const rid = ++this.rayId;
    // 2D DDA across grid cells
    let cx = Math.floor((ox + HALF) / g), cz = Math.floor((oz + HALF) / g);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(g / dx) : Infinity, tdz = dz !== 0 ? Math.abs(g / dz) : Infinity;
    let tmx = dx !== 0 ? ((dx > 0 ? (cx + 1) * g - HALF - ox : ox - (cx * g - HALF)) / Math.abs(dx)) : Infinity;
    let tmz = dz !== 0 ? ((dz > 0 ? (cz + 1) * g - HALF - oz : oz - (cz * g - HALF)) / Math.abs(dz)) : Infinity;
    let tCell = 0;
    for (let guard = 0; guard < 600; guard++) {
      if (cx >= 0 && cz >= 0 && cx < n && cz < n) {
        const cell = this.grid[cz * n + cx];
        if (cell) {
          for (let q = 0; q < cell.length; q++) {
            const id = cell[q];
            if (this.stamp[id] === rid) continue;
            this.stamp[id] = rid;
            if (opts.ignoreGlass && this.surf[id] === SURF.glass) continue;
            const b = id * 6;
            const t = rayBox(ox, oy, oz, dx, dy, dz, B[b], B[b + 1], B[b + 2], B[b + 3], B[b + 4], B[b + 5], best);
            if (t >= 0 && t < best) { best = t; hit = { t, id, surf: this.surf[id] }; }
          }
        }
      } else if ((cx < 0 && stepX < 0) || (cz < 0 && stepZ < 0) || (cx >= n && stepX > 0) || (cz >= n && stepZ > 0)) break;
      if (tCell > best) break;
      if (tmx < tmz) { tCell = tmx; tmx += tdx; cx += stepX; } else { tCell = tmz; tmz += tdz; cz += stepZ; }
      if (tCell > best) break;
    }
    if (!opts.noDynamic) for (const q of this.dynamic) {
      if (opts.ignore && opts.ignore === q.owner) continue;
      const t = rayBox(ox, oy, oz, dx, dy, dz, q.minX, q.minY, q.minZ, q.maxX, q.maxY, q.maxZ, best);
      if (t >= 0 && t < best) { best = t; hit = { t, id: -1, surf: SURF.metal, dyn: q.owner }; }
    }
    // terrain march
    if (!opts.noTerrain) {
      const tt = this.rayTerrain(ox, oy, oz, dx, dy, dz, best);
      if (tt >= 0 && tt < best) { best = tt; hit = { t: tt, id: -2, surf: SURF.dirt }; }
    }
    if (!hit) return null;
    hit.x = ox + dx * hit.t; hit.y = oy + dy * hit.t; hit.z = oz + dz * hit.t;
    if (hit.id >= 0) {
      const b = hit.id * 6, e = 1e-3;
      hit.nx = Math.abs(hit.x - B[b]) < e ? -1 : Math.abs(hit.x - B[b + 3]) < e ? 1 : 0;
      hit.ny = Math.abs(hit.y - B[b + 1]) < e ? -1 : Math.abs(hit.y - B[b + 4]) < e ? 1 : 0;
      hit.nz = Math.abs(hit.z - B[b + 2]) < e ? -1 : Math.abs(hit.z - B[b + 5]) < e ? 1 : 0;
      if (!hit.nx && !hit.ny && !hit.nz) hit.ny = 1;
    } else if (hit.id === -2) {
      const nn = this.normal(hit.x, hit.z); hit.nx = nn[0]; hit.ny = nn[1]; hit.nz = nn[2];
    } else { hit.nx = -dx; hit.ny = -dy; hit.nz = -dz; }
    return hit;
  }

  rayTerrain(ox, oy, oz, dx, dy, dz, maxT) {
    const step = 1.5;
    let t = 0, prevT = 0;
    let prevAbove = oy - this.height(ox, oz);
    if (prevAbove < 0) return 0;
    while (t < maxT) {
      t = Math.min(t + step, maxT);
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (x < -HALF || x > HALF || z < -HALF || z > HALF) return -1;
      const above = y - this.height(x, z);
      if (above < 0) {
        // bisect
        let a = prevT, b = t;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2;
          if (oy + dy * m - this.height(ox + dx * m, oz + dz * m) < 0) b = m; else a = m;
        }
        return a;
      }
      prevT = t; prevAbove = above;
      if (t >= maxT) break;
    }
    return -1;
  }

  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.01) return true;
    return !this.raycast(ax, ay, az, dx / L, dy / L, dz / L, L - 0.3, { noDynamic: true });
  }

  // ---------------------------------------------------------------- water
  // rasterise rivers into a 4 m grid so waterLevel() is O(1)
  bakeWater() {
    const n = 256, c = (HALF * 2) / n;
    const g = new Float32Array(n * n).fill(-Infinity);
    for (const w of this.water) {
      if (w.type !== 'river') continue;
      for (let i = 0; i < w.pts.length - 1; i++) {
        const a = w.pts[i], b = w.pts[i + 1], r = w.w / 2 + 4;
        const i0 = clamp(Math.floor((Math.min(a[0], b[0]) - r + HALF) / c), 0, n - 1), i1 = clamp(Math.ceil((Math.max(a[0], b[0]) + r + HALF) / c), 0, n - 1);
        const j0 = clamp(Math.floor((Math.min(a[1], b[1]) - r + HALF) / c), 0, n - 1), j1 = clamp(Math.ceil((Math.max(a[1], b[1]) + r + HALF) / c), 0, n - 1);
        for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
          const s = segDist(-HALF + (ii + 0.5) * c, -HALF + (j + 0.5) * c, a[0], a[1], b[0], b[1]);
          if (s.d < r) { const l = a[2] + (b[2] - a[2]) * s.t; const k = j * n + ii; if (l > g[k]) g[k] = l; }
        }
      }
    }
    this.wgrid = g; this.wn = n; this.wc = c;
  }
  waterLevel(x, z) {
    let lvl = -Infinity;
    for (const w of this.water) {
      if (w.type === 'sea') {
        const v = w.axis === 'x' ? x : z;
        if (v * w.sign > w.at - 60) lvl = Math.max(lvl, 0);
      } else if (w.type === 'disc') {
        if ((x - w.x) ** 2 + (z - w.z) ** 2 < w.r * w.r) lvl = Math.max(lvl, w.level);
      }
    }
    if (this.wgrid) {
      const i = Math.floor((x + HALF) / this.wc), j = Math.floor((z + HALF) / this.wc);
      if (i >= 0 && j >= 0 && i < this.wn && j < this.wn) lvl = Math.max(lvl, this.wgrid[j * this.wn + i]);
    }
    return lvl;
  }
}

// slab test; returns entry t (0 if inside) or -1
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, maxT) {
  let tmin = 0, tmax = maxT;
  if (Math.abs(dx) < 1e-9) { if (ox < x0 || ox > x1) return -1; }
  else { let a = (x0 - ox) / dx, b = (x1 - ox) / dx; if (a > b) { const t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) return -1; }
  if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) return -1; }
  else { let a = (y0 - oy) / dy, b = (y1 - oy) / dy; if (a > b) { const t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) return -1; }
  if (Math.abs(dz) < 1e-9) { if (oz < z0 || oz > z1) return -1; }
  else { let a = (z0 - oz) / dz, b = (z1 - oz) / dz; if (a > b) { const t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) return -1; }
  return tmin;
}

// ray vs sphere; returns t or -1
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t >= 0 && t <= maxT ? t : -1;
}
