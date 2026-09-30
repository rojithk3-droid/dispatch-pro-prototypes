// Merged-geometry builder. Static world pieces are appended into per-chunk, per-material buffers with
// world-space box-projected UVs (so every texture tiles at real-world scale) and vertex colours for tinting.
import * as THREE from 'three';

import { HALF } from './physics.js';
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const colorCache = new Map();
export function col(hex, jitter = 0, rnd = Math.random) {
  let c = colorCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
  if (!jitter) return [c.r, c.g, c.b];
  const k = 1 + (rnd() * 2 - 1) * jitter;
  return [c.r * k, c.g * k, c.b * k];
}
export const WHITE = [1, 1, 1];

class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.v = 0; }
}

export class GeoBuilder {
  constructor(materials) {
    this.mats = materials;       // key -> material (scale in userData.scale)
    this.bufs = new Map();
    // merge into fewer, larger chunks on big maps to keep draw calls down
    this.chunk = HALF > 1000 ? 460 : 256;
    this.noChunk = null;         // optional predicate: materials merged map-wide (small, many: signs, markings)
  }

  _buf(mat, x, z) {
    const key = this.noChunk && this.noChunk(mat) ? mat + '|all' : mat + '|' + Math.floor((x + HALF) / this.chunk) + '|' + Math.floor((z + HALF) / this.chunk);
    let b = this.bufs.get(key);
    if (!b) { b = new Buf(); b.mat = mat; this.bufs.set(key, b); }
    return b;
  }

  _scale(mat) { const m = this.mats[mat]; return (m && m.userData.scale) || 3; }

  // axis-aligned box. skip: string of faces to omit, e.g. 'b' bottom, 't' top, 'xXzZ'
  box(x0, y0, z0, x1, y1, z1, mat, color = WHITE, skip = '', uvOff = 0) {
    const b = this._buf(mat, (x0 + x1) / 2, (z0 + z1) / 2);
    const s = 1 / this._scale(mat);
    const faces = [
      // [normal, 4 corners] counter-clockwise from outside
      ['X', [1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
      ['x', [-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      ['t', [0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      ['b', [0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      ['Z', [0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      ['z', [0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    ];
    for (const [f, nrm, cs] of faces) {
      if (skip.includes(f)) continue;
      const base = b.v;
      for (const q of cs) {
        b.p.push(q[0], q[1], q[2]);
        b.n.push(nrm[0], nrm[1], nrm[2]);
        let u, v;
        if (nrm[0]) { u = q[2] * s * -nrm[0]; v = q[1] * s; }
        else if (nrm[1]) { u = q[0] * s; v = q[2] * s * -nrm[1]; }
        else { u = q[0] * s * nrm[2]; v = q[1] * s; }
        b.uv.push(u + uvOff, v);
        b.c.push(color[0], color[1], color[2]);
      }
      b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      b.v += 4;
    }
  }

  // arbitrary quad (4 points, CCW from the visible side), explicit uvs optional
  quad(pts, mat, color = WHITE, uvs = null) {
    const cx = (pts[0][0] + pts[2][0]) / 2, cz = (pts[0][2] + pts[2][2]) / 2;
    const b = this._buf(mat, cx, cz);
    const a = new THREE.Vector3(...pts[0]), bb = new THREE.Vector3(...pts[1]), c = new THREE.Vector3(...pts[2]);
    const nrm = new THREE.Vector3().subVectors(bb, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const s = 1 / this._scale(mat);
    const base = b.v;
    for (let k = 0; k < 4; k++) {
      const q = pts[k];
      b.p.push(q[0], q[1], q[2]);
      b.n.push(nrm.x, nrm.y, nrm.z);
      if (uvs) b.uv.push(uvs[k][0], uvs[k][1]);
      else b.uv.push(...projUV(q[0], q[1], q[2], nrm.x, nrm.y, nrm.z, s));
      b.c.push(color[0], color[1], color[2]);
    }
    b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    b.v += 4;
  }

  // triangle
  tri(pts, mat, color = WHITE) {
    const b = this._buf(mat, pts[0][0], pts[0][2]);
    const a = new THREE.Vector3(...pts[0]), bb = new THREE.Vector3(...pts[1]), c = new THREE.Vector3(...pts[2]);
    const nrm = new THREE.Vector3().subVectors(bb, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const s = 1 / this._scale(mat);
    const base = b.v;
    for (const q of pts) {
      b.p.push(q[0], q[1], q[2]); b.n.push(nrm.x, nrm.y, nrm.z);
      b.uv.push(...projUV(q[0], q[1], q[2], nrm.x, nrm.y, nrm.z, s));
      b.c.push(color[0], color[1], color[2]);
    }
    b.i.push(base, base + 1, base + 2);
    b.v += 3;
  }

  // any three.js geometry, transformed; UVs re-projected in world space unless keepUV
  geom(g, matrix, mat, color = WHITE, keepUV = false) {
    const src = g.index ? g : g;
    const pos = src.attributes.position, nor = src.attributes.normal, uv = src.attributes.uv, vc = src.attributes.color;
    _v.set(0, 0, 0).applyMatrix4(matrix);
    const b = this._buf(mat, _v.x, _v.z);
    _m3.getNormalMatrix(matrix);
    const s = 1 / this._scale(mat);
    const base = b.v;
    for (let k = 0; k < pos.count; k++) {
      _v.fromBufferAttribute(pos, k).applyMatrix4(matrix);
      _n.fromBufferAttribute(nor, k).applyMatrix3(_m3).normalize();
      b.p.push(_v.x, _v.y, _v.z);
      b.n.push(_n.x, _n.y, _n.z);
      if (keepUV && uv) b.uv.push(uv.getX(k), uv.getY(k));
      else b.uv.push(...projUV(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z, s));
      if (vc) b.c.push(color[0] * vc.getX(k), color[1] * vc.getY(k), color[2] * vc.getZ(k));
      else b.c.push(color[0], color[1], color[2]);
    }
    if (src.index) { const ix = src.index.array; for (let k = 0; k < ix.length; k++) b.i.push(base + ix[k]); }
    else for (let k = 0; k < pos.count; k++) b.i.push(base + k);
    b.v += pos.count;
  }

  build(group, opts = {}) {
    const meshes = [];
    for (const b of this.bufs.values()) {
      if (!b.v) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      g.setIndex(b.v > 65000 ? new THREE.Uint32BufferAttribute(b.i, 1) : new THREE.Uint16BufferAttribute(b.i, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.mats[b.mat]);
      mesh.castShadow = opts.castShadow !== false && !(this.mats[b.mat] && this.mats[b.mat].userData.noShadow);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      meshes.push(mesh);
    }
    this.bufs.clear();
    return meshes;
  }
}

function projUV(x, y, z, nx, ny, nz, s) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ay >= ax && ay >= az) return [x * s, z * s];
  if (ax >= az) return [z * s * -Math.sign(nx), y * s];
  return [x * s * Math.sign(nz), y * s];
}
