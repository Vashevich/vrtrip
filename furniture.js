// Параметрические «болванки» мебели.
// Каждая болванка строится в локальных координатах группы:
// x ∈ [-w/2, w/2], y ∈ [0, h], z ∈ [-d/2, d/2]; «лицо» мебели смотрит в +Z.
import * as THREE from 'three';

export const EDGE = new THREE.LineBasicMaterial({ color: 0x1d1d1d });
const noRay = () => {};

function std(color, extra = {}) {
  // грани чуть отодвинуты в глубину, чтобы линии рёбер не тонули в стене и в соседних деталях
  return new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...extra });
}

function addEdges(mesh, angle = 25) {
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, angle), EDGE);
  e.raycast = noRay;
  e.userData.edge = true;
  mesh.add(e);
}

// Швы в одной плоскости не рисуем: если две коробки одной группы стоят вплотную и их грани продолжают друг друга,
// линия между ними убирается. Линии на перепадах, во внутренних углах и на зазорах остаются.
function cleanSeams(group) {
  const boxes = [];
  for (const m of group.children) {
    if (!m.isMesh || m.geometry.type !== 'BoxGeometry') continue;
    const s = m.scale, q = m.quaternion, g = m.geometry.parameters;
    if (Math.abs(q.w) < 0.9999 || Math.min(s.x, s.y, s.z) <= 0) continue;
    const hs = [g.width * s.x / 2, g.height * s.y / 2, g.depth * s.z / 2], c = m.position.toArray();
    boxes.push({ m, s: s.toArray(), c, lo: c.map((v, i) => v - hs[i]), hi: c.map((v, i) => v + hs[i]) });
  }
  if (boxes.length > 1) {
    const E = 0.0008, inside = (B, b, vb, c, vc) => vb > B.lo[b] && vb < B.hi[b] && vc > B.lo[c] && vc < B.hi[c];
    for (const A of boxes) {
      const pos = [];
      let cut = false;
      for (let a = 0; a < 3; a++) {
        const b = (a + 1) % 3, c = (a + 2) % 3;
        for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
          const pb = sb > 0 ? A.hi[b] : A.lo[b], pc = sc > 0 ? A.hi[c] : A.lo[c];
          let segs = [[A.lo[a], A.hi[a]]];
          for (const B of boxes) {
            if (B === A || B.hi[a] <= A.lo[a] || B.lo[a] >= A.hi[a]) continue;
            if (inside(B, b, pb + sb * E, c, pc + sc * E)) continue;          // перепад или внутренний угол — линия нужна
            if (!inside(B, b, pb - sb * E, c, pc + sc * E) && !inside(B, b, pb + sb * E, c, pc - sc * E)) continue;
            const next = [];
            for (const [u, v] of segs) {
              if (B.lo[a] - E > u) next.push([u, Math.min(v, B.lo[a])]);
              if (B.hi[a] + E < v) next.push([Math.max(u, B.hi[a]), v]);
            }
            segs = next.filter(([u, v]) => v - u > 0.001);
            cut = true;
          }
          for (const [u, v] of segs) for (const t of [u, v]) {
            const P = [0, 0, 0];
            P[a] = (t - A.c[a]) / A.s[a]; P[b] = (pb - A.c[b]) / A.s[b]; P[c] = (pc - A.c[c]) / A.s[c];
            pos.push(...P);
          }
        }
      }
      if (!cut) continue;
      const e = A.m.children.find((o) => o.userData.edge);
      if (!e) continue;
      e.geometry.dispose();
      e.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    }
  }
  for (const m of group.children) if (m.isGroup) cleanSeams(m);
}

class Builder {
  constructor(group, color) {
    this.g = group;
    const c = new THREE.Color(color);
    this.m = std(c);
    this.m2 = std(c.clone().multiplyScalar(0.72));
    this.m3 = std(c.clone().lerp(new THREE.Color('#ffffff'), 0.5));
    this.parts = 0;
  }
  // подвижная часть (дверца, ящик): всё, что строится внутри fn, попадает в отдельную группу
  part(x, y, z, act, fn) {
    const prev = this.g, group = new THREE.Group();
    group.position.set(x, y, z);
    group.userData.act = act;
    group.userData.part = this.parts++;
    this.g = group;
    fn();
    this.g = prev;
    prev.add(group);
    return group;
  }
  finish(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    addEdges(mesh);
    this.g.add(mesh);
    return mesh;
  }
  // x, z — центр; y — низ
  box(w, h, d, x = 0, y = 0, z = 0, m = this.m) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(w, 0.004), Math.max(h, 0.004), Math.max(d, 0.004)), m);
    mesh.position.set(x, y + h / 2, z);
    return this.finish(mesh);
  }
  // «кость» между двумя точками и шар-сустав — для деревянного человечка
  seg(p, q, r, m = this.m) {
    const a = new THREE.Vector3(...p), b = new THREE.Vector3(...q), d = b.clone().sub(a), len = Math.max(d.length(), 0.004);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r, len, 20), m);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.multiplyScalar(1 / len));
    return this.finish(mesh);
  }
  ball(p, r, m = this.m2, sy = 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m);
    mesh.position.set(...p);
    mesh.scale.y = sy;
    return this.finish(mesh);
  }
  // цилиндр/конус единичного радиуса масштабируется до эллипса sx × sz
  cyl(rTop, rBot, h, x, y, z, m = this.m, sx = 1, sz = 1) {
    h = Math.max(h, 0.004);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 32), m);
    mesh.position.set(x, y + h / 2, z);
    mesh.scale.set(sx, 1, sz);
    return this.finish(mesh);
  }
}

function legs(b, w, d, h, leg, inset, m = b.m2) {
  const lx = w / 2 - inset - leg / 2, lz = d / 2 - inset - leg / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(leg, h, leg, sx * lx, 0, sz * lz, m);
  return { lx, lz };
}

// Фасады: handle 'v' — распашные дверцы, 'h' — выдвижные ящики.
function fronts(b, w, h, d, cols, rows, y0, zc, handle = 'h') {
  const cw = w / cols, rh = h / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = -w / 2 + cw * (i + 0.5), y = y0 + rh * j;
    if (handle === 'h') {
      b.part(x, y, zc, { kind: 'drawer', z0: zc, travel: Math.max(0.1, (d - 0.08) * 0.75) }, () => {
        b.box(cw - 0.006, rh - 0.006, 0.02, 0, 0.003, 0, b.m3);
        b.box(Math.min(0.16, cw * 0.4), 0.014, 0.016, 0, rh * 0.72, 0.016, b.m2);
        const dd = Math.max(0.05, d - 0.1), bw = cw - 0.05, bh = Math.max(0.02, rh - 0.06);
        b.box(bw, 0.01, dd, 0, 0.02, -dd / 2 - 0.01, b.m2);
        for (const s of [-1, 1]) b.box(0.012, bh, dd, s * (bw / 2 - 0.006), 0.03, -dd / 2 - 0.01, b.m2);
        b.box(bw - 0.024, bh, 0.012, 0, 0.03, -dd - 0.004, b.m2);
      });
    } else {
      const left = cols === 1 || i % 2 === 0, k = left ? 1 : -1, half = cw / 2 - 0.003;
      b.part(x - k * half, y, zc, { kind: 'door', sign: -k }, () => {
        b.box(cw - 0.006, rh - 0.006, 0.02, k * half, 0.003, 0, b.m3);
        b.box(0.014, Math.min(0.16, rh * 0.3), 0.016, k * (2 * half - 0.05), Math.min(rh * 0.5, 1.0), 0.016, b.m2);
      });
    }
  }
}

export function applyAct(part, t) {
  const a = part.userData.act;
  part.userData.t = t;
  if (a.kind === 'door') part.rotation.y = a.sign * t * (a.ang || 1.9);
  else if (a.kind === 'turn') part.rotation[a.axis] = a.sign * t * a.ang;      // откидные части: крышки, спинки, столешницы
  else if (a.kind === 'stretch') part.scale.z = 1 + t * (a.k - 1);              // выдвижное спальное место
  else if (a.kind === 'slide') part.position.x = a.x0 + t * a.travel;          // сдвижные полотна
  else part.position.z = a.z0 + t * a.travel;
}

// Пустой корпус из панелей: боковины, дно (высотой bot), крышка и задняя стенка.
function carcass(b, w, h, D, zc, t, bot) {
  for (const s of [-1, 1]) b.box(t, h, D, s * (w / 2 - t / 2), 0, zc);
  b.box(w - 2 * t, bot, D, 0, 0, zc);
  b.box(w - 2 * t, t, D, 0, h - t, zc);
  b.box(w - 2 * t, h - t - bot, 0.008, 0, bot, zc - D / 2 + 0.004, b.m2);
}

// Высота сиденья или спального места: по умолчанию считается от общей высоты, либо задана вручную (p.seat).
const SEAT = {
  chair: (h) => Math.min(0.45, h * 0.55), officechair: (h) => Math.min(0.48, h * 0.48), toilet: (h) => Math.min(0.42, h * 0.52),
  sofa: (h) => Math.max(0.1, Math.min(0.3, h * 0.36)) + 0.12, cornersofa: (h) => Math.min(0.28, h * 0.36) + 0.12,
  recliner: (h) => Math.min(0.3, h * 0.36) + 0.12, bed: (h) => Math.min(0.3, h * 0.35) + Math.min(0.22, h * 0.3),
};
SEAT.armchair = SEAT.sofa; SEAT.bed1 = SEAT.bed;
export function seatOf(type, h, p) {
  const fn = SEAT[type];
  if (!fn) return null;
  return p && p.seat > 0 ? Math.max(0.14, Math.min(p.seat, h - 0.06)) : fn(h);
}
// Размеры частей дивана и кресла: по умолчанию от габарита, либо заданные вручную (p.seat, p.arm, p.backd).
export function sofaDims(w, d, h, p = {}) {
  const seat = seatOf('sofa', h, p), baseH = seat - 0.12, armW = Math.min(0.18, w * 0.16);
  const backD = p.backd > 0 ? Math.max(0.06, Math.min(p.backd, d - 0.3)) : Math.min(0.22, d * 0.26);
  const armTop = p.arm > 0 ? Math.max(baseH + 0.03, Math.min(p.arm, h)) : baseH + Math.max(0.05, Math.min(h - baseH - 0.12, 0.3));
  return { seat, baseH, armW, backD, armTop, armH: armTop - baseH };
}
// Параметр части: значение из предмета (p[key]) или значение по умолчанию, всегда в допустимых пределах.
const PV = (p, key, def, lo, hi) => Math.max(lo, Math.min(p && p[key] > 0 ? p[key] : def, Math.max(lo, hi)));
// Ручки частей по типам: где стоит стрелка (в осях предмета), вдоль какой оси тянется, текущее значение и пределы.
// key 'h' и 'd' — общий размер (верх и перёд), sign −1 — стрелка наружу уменьшает значение.
const seatPart = (type, w, d, h, p, z = d * 0.15) => ({ key: 'seat', axis: 'y', pos: [0, seatOf(type, h, p), z], v: seatOf(type, h, p), lo: 0.14, hi: h - 0.06 });
const topPart = (w, d, h, lo, x = 0, z = 0) => ({ key: 'h', axis: 'y', pos: [x, h, z], v: h, lo, hi: 20 });
const barPart = (k) => (w, d, h, p) => [{ key: 'bar', axis: 'y', pos: [0, PV(p, 'bar', h * k, 0.05, h - 0.08), d / 2 - 0.03], v: PV(p, 'bar', h * k, 0.05, h - 0.08), lo: 0.05, hi: h - 0.08 }];
const shelfPart = (def, lo, hi) => (w, d, h, p) => { const v = PV(p, 'shelf', def(h), lo(h), hi(h)); return [{ key: 'shelf', axis: 'y', pos: [0, v, d / 2 - 0.02], v, lo: lo(h), hi: hi(h) }]; };
const WSHELF = [(h) => (h > 1.2 ? h - 0.36 : h / 2), () => 0.2, (h) => h - 0.12], KSHELF = [(h) => 0.1 + (h - 0.14) / 2, () => 0.16, (h) => h - 0.1];
const CSHELF = [(h) => h / 2, () => 0.08, (h) => h - 0.08], TSHELF = [(h) => h * 0.3, () => 0.04, (h) => h - 0.08];
const shelfGap = (h, p) => { const n = Math.max(1, Math.round((h - 0.02) / PV(p, 'gap', (h - 0.02) / Math.max(1, Math.round(h / 0.35)), 0.12, h - 0.02))); return { n, gap: (h - 0.02) / n }; };
export const PARTS = {
  sofa(w, d, h, p) {
    const q = sofaDims(w, d, h, p), ax = w / 2 - q.armW / 2, zc = q.backD / 2;
    return [{ key: 'seat', axis: 'y', pos: [0, q.seat, zc], v: q.seat, lo: 0.14, hi: h - 0.06 },
      { key: 'arm', axis: 'y', pos: [-ax, q.armTop, zc], v: q.armTop, lo: q.seat - 0.09, hi: h },
      { key: 'arm', axis: 'y', pos: [ax, q.armTop, zc], v: q.armTop, lo: q.seat - 0.09, hi: h },
      { key: 'backd', axis: 'z', pos: [0, (q.seat + h) / 2 + 0.06, -d / 2 + q.backD], v: q.backD, lo: 0.06, hi: d - 0.3 },
      topPart(w, d, h, Math.max(q.seat + 0.06, q.armTop), 0, -d / 2 + q.backD / 2),
      { key: 'd', axis: 'z', pos: [0, q.baseH * 0.45, d / 2], v: d, lo: q.backD + 0.3, hi: 20 }];
  },
  cornersofa: (w, d, h, p) => [seatPart('cornersofa', w, d, h, p, -d / 2 + 0.5), topPart(w, d, h, seatOf('cornersofa', h, p) + 0.06, 0, -d / 2 + 0.1)],
  recliner: (w, d, h, p) => [seatPart('recliner', w, d, h, p, 0.05), topPart(w, d, h, seatOf('recliner', h, p) + 0.06, 0, -d / 2 + 0.08)],
  chair: (w, d, h, p) => [seatPart('chair', w, d, h, p, 0), topPart(w, d, h, seatOf('chair', h, p) + 0.06, 0, -d / 2 + 0.02)],
  officechair: (w, d, h, p) => [seatPart('officechair', w, d, h, p, 0.02), topPart(w, d, h, seatOf('officechair', h, p) + 0.1, 0, -d * 0.38)],
  toilet: (w, d, h, p) => [seatPart('toilet', w, d, h, p, 0.1)],
  bed: (w, d, h, p) => [seatPart('bed', w, d, h, p, 0.2), topPart(w, d, h, seatOf('bed', h, p) + 0.06, 0, -d / 2 + 0.03)],
  stool: barPart(0.3), barstool: barPart(0.32), bench: barPart(0.35),
  bunk(w, d, h, p) {
    const up = PV(p, 'up', h * 0.62, 0.8, h - 0.45), low = PV(p, 'low', 0.25, 0.1, up - 0.55);
    return [{ key: 'low', axis: 'y', pos: [0, low + 0.26, d / 2 - 0.1], v: low, lo: 0.1, hi: up - 0.55 },
      { key: 'up', axis: 'y', pos: [0, up + 0.26, d / 2 - 0.1], v: up, lo: Math.max(0.8, low + 0.55), hi: h - 0.45 }];
  },
  table: (w, d, h, p) => { const v = PV(p, 'inset', 0.03, 0, Math.min(w, d) / 2 - 0.1); return [{ key: 'inset', axis: 'x', sign: -1, pos: [w / 2 - v - 0.025, h * 0.45, d / 2 - v - 0.025], v, lo: 0, hi: Math.min(w, d) / 2 - 0.1 }]; },
  desk: (w, d, h, p) => { const v = PV(p, 'side', 0.04, 0.0125, w / 2 - 0.2); return [{ key: 'side', axis: 'x', sign: -1, pos: [w / 2 - v, h * 0.45, d / 2 - 0.03], v, lo: 0.0125, hi: w / 2 - 0.2 }]; },
  coffeetable: shelfPart(...TSHELF), wardrobe: shelfPart(...WSHELF), kitchen: shelfPart(...KSHELF), wallcabinet: shelfPart(...CSHELF),
  shelf: (w, d, h, p) => { const g = shelfGap(h, p); return [{ key: 'gap', axis: 'y', pos: [0, g.gap, d / 2], v: g.gap, lo: 0.12, hi: h - 0.02 }]; },
  sideboard: (w, d, h, p) => { const v = PV(p, 'dr', Math.min(0.18, h * 0.22), 0.08, h * 0.5); return [{ key: 'dr', axis: 'y', sign: -1, pos: [0, h - 0.02 - v, d / 2], v, lo: 0.08, hi: h * 0.5 }]; },
  fridge: (w, d, h, p) => { const v = PV(p, 'split', h * 0.62, 0.4, h - 0.25); return [{ key: 'split', axis: 'y', pos: [0, v, d / 2], v, lo: 0.4, hi: h - 0.25 }]; },
};
PARTS.armchair = PARTS.sofa; PARTS.bed1 = PARTS.bed; PARTS.lowshelf = PARTS.shelf;
export const partsOf = (it) => (PARTS[it.type] ? PARTS[it.type](it.w, it.d, it.h, it.p || {}) : []);
function sofa(b, w, d, h, o = {}) {    // диван и кресло: сиденье выдвигается вперёд, вся глубина становится около 2 м
  const { baseH, armW, backD, armH } = sofaDims(w, d, h, o.p || {});
  b.box(w, baseH, d, 0, 0, 0, b.m2);
  b.box(w, h - baseH, backD, 0, baseH, -d / 2 + backD / 2);
  for (const s of [-1, 1]) b.box(armW, armH, d - backD, s * (w / 2 - armW / 2), baseH, backD / 2);
  const inner = w - 2 * armW, n = Math.max(1, Math.round(inner / 0.7)), cw = inner / n, sd = d - backD;
  b.part(0, 0, -d / 2 + backD, { kind: 'stretch', k: Math.max(1.2, (2 - backD) / sd) }, () => {
    b.box(inner - 0.03, baseH - 0.05, sd + 0.004, 0, 0.03, (sd + 0.004) / 2, b.m2);
    for (let i = 0; i < n; i++)
      b.box(cw - 0.012, 0.12, sd - 0.02, -inner / 2 + cw * (i + 0.5), baseH, (sd - 0.02) / 2, b.m3);
  });
}

const glassM = () => std('#bfe3f2', { transparent: true, opacity: 0.35, roughness: 0.1 });
const POT = '#b0714f';
function blob(b, x, y, z, sx, sy, sz, m = b.m, detail = 1) {   // крона, лист, подушка
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, detail), m);
  mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
  return b.finish(mesh);
}
function pot(b, w, d, ph) { b.cyl(0.5, 0.38, ph, 0, 0, 0, std(POT), w, d); }
// Рама окна или двери и створки. sections: −1 — петли слева, 1 — петли справа, 0 — глухая часть.
function sashFrame(b, w, d, h, sections, sill = true) {
  const f = 0.05, t = 0.035, sd = Math.min(d * 0.6, 0.05), n = sections.length;
  for (const s of [-1, 1]) b.box(f, h, d, s * (w / 2 - f / 2), 0, 0);
  if (sill) b.box(w - 2 * f, f, d, 0, 0, 0);
  b.box(w - 2 * f, f, d, 0, h - f, 0);
  const y0 = sill ? f : 0, sh = h - f - y0, mul = 0.04, sw = (w - 2 * f - (n - 1) * mul) / n;
  sections.forEach((s, i) => {
    const x0 = -w / 2 + f + i * (sw + mul);              // левый край секции
    if (i) b.box(mul, sh, d, x0 - mul / 2, y0, 0);
    const leaf = (cx) => {
      for (const e of [-1, 1]) b.box(t, sh, sd, cx + e * (sw / 2 - t / 2), 0, 0);
      b.box(sw - 2 * t, t, sd, cx, 0, 0);
      b.box(sw - 2 * t, t, sd, cx, sh - t, 0);
      b.box(sw - 2 * t, sh - 2 * t, 0.008, cx, t, 0, glassM());
    };
    if (!s) { const g = b.g; b.g = new THREE.Group(); b.g.position.set(x0 + sw / 2, y0, 0); leaf(0); g.add(b.g); b.g = g; return; }
    b.part(s < 0 ? x0 : x0 + sw, y0, 0, { kind: 'door', sign: s }, () => {
      leaf(-s * sw / 2);
      b.box(0.02, 0.1, 0.04, -s * (sw - t / 2), Math.min(sh / 2, 1.05) - 0.05, sd / 2 + 0.02, b.m2);   // ручка
    });
  });
}

const BUILD = {
  box(b, w, d, h) { b.box(w, h, d); },
  wall(b, w, d, h) { b.box(w, h, d); },
  rug(b, w, d, h) { b.box(w, h, d); },

  wardrobe(b, w, d, h, o = {}) {
    const D = d - 0.02, zc = -0.01, t = 0.018, sy = PV(o.p, 'shelf', WSHELF[0](h), WSHELF[1](h), WSHELF[2](h));
    carcass(b, w, h, D, zc, t, 0.05);
    b.box(w - 2 * t, t, D - 0.012, 0, sy, zc + 0.004);   // полка; в высоком шкафу под ней штанга
    if (h > 1.2 && sy > 0.6) b.box(w - 2 * t, 0.025, 0.025, 0, sy - 0.1, zc, b.m2);
    fronts(b, w, h - 0.06, d, Math.max(1, Math.round(w / 0.5)), 1, 0.05, d / 2 - 0.01, 'v');
  },
  dresser(b, w, d, h) {
    carcass(b, w, h, d - 0.02, -0.01, 0.018, 0.05);
    fronts(b, w, h - 0.06, d, w > 1.1 ? 2 : 1, Math.max(1, Math.round((h - 0.06) / 0.22)), 0.05, d / 2 - 0.01, 'h');
  },
  kitchen(b, w, d, h, o = {}) {
    const t = 0.04, H = h - t, D = d - 0.04, zc = -0.02;
    carcass(b, w, H, D, zc, 0.018, 0.1);
    b.box(w - 0.036, 0.018, D - 0.012, 0, PV(o.p, 'shelf', KSHELF[0](h), KSHELF[1](h), KSHELF[2](h)), zc + 0.004);
    fronts(b, w, h - t - 0.1, d, Math.max(1, Math.round(w / 0.6)), 1, 0.1, d / 2 - 0.03, 'v');
    b.box(w, t, d, 0, h - t, 0, b.m2);
  },
  fridge(b, w, d, h, o = {}) {
    const split = PV(o.p, 'split', h * 0.62, 0.4, h - 0.25), D = d - 0.03, zc = -0.015, t = 0.03;
    carcass(b, w, h, D, zc, t, t);
    b.box(w - 2 * t, t, D - 0.012, 0, split - t / 2, zc + 0.004);
    for (const y of [split * 0.33, split * 0.66, split + (h - split) / 2])
      b.box(w - 2 * t, 0.012, D - 0.05, 0, y, zc - 0.01, b.m3);
    const hx = w / 2 - 0.003;          // петли справа, ручки слева
    b.part(hx, 0, d / 2 - 0.015, { kind: 'door', sign: 1 }, () => {
      b.box(w - 0.006, split - 0.012, 0.03, -hx, 0.006, 0, b.m3);
      b.box(0.016, 0.3, 0.02, -2 * hx + 0.05, split - 0.4, 0.025, b.m2);
    });
    b.part(hx, split, d / 2 - 0.015, { kind: 'door', sign: 1 }, () => {
      b.box(w - 0.006, h - split - 0.012, 0.03, -hx, 0.006, 0, b.m3);
      b.box(0.016, 0.2, 0.02, -2 * hx + 0.05, 0.08, 0.025, b.m2);
    });
  },
  shelf(b, w, d, h, o = {}) {
    const t = 0.02;
    for (const s of [-1, 1]) b.box(t, h, d, s * (w / 2 - t / 2), 0, 0);
    b.box(w - 2 * t, h, 0.008, 0, 0, -d / 2 + 0.004, b.m2);
    const n = shelfGap(h, o.p).n;
    for (let i = 0; i <= n; i++) b.box(w - 2 * t, t, d - 0.008, 0, i * (h - t) / n, 0.004);
  },
  table(b, w, d, h, o = {}) {
    const t = 0.04;
    b.box(w, t, d, 0, h - t, 0);
    legs(b, w, d, h - t, 0.05, PV(o.p, 'inset', 0.03, 0, Math.min(w, d) / 2 - 0.1));
  },
  desk(b, w, d, h, o = {}) {
    const t = 0.03, sd = PV(o.p, 'side', 0.04, 0.0125, w / 2 - 0.2);
    b.box(w, t, d, 0, h - t, 0);
    for (const s of [-1, 1]) b.box(0.025, h - t, d - 0.06, s * (w / 2 - sd), 0, 0, b.m2);
    b.box(w - 2 * sd - 0.025, (h - t) * 0.4, 0.018, 0, (h - t) * 0.5, -d / 2 + 0.06, b.m2);
  },
  roundtable(b, w, d, h) {
    const t = 0.035;
    b.cyl(0.5, 0.5, t, 0, h - t, 0, b.m, w, d);
    b.cyl(0.04, 0.04, h - t - 0.03, 0, 0.03, 0, b.m2);
    b.cyl(0.5, 0.5, 0.03, 0, 0, 0, b.m2, w * 0.55, d * 0.55);
  },
  chair(b, w, d, h, o = {}) {
    const sh = seatOf('chair', h, o.p), st = 0.04, leg = 0.035;
    b.box(w, st, d, 0, sh - st, 0);
    const { lx, lz } = legs(b, w, d, sh - st, leg, 0);
    for (const s of [-1, 1]) b.box(leg, h - sh, leg, s * lx, sh, -lz, b.m2);
    b.box(w - 2 * leg, (h - sh) * 0.5, 0.02, 0, sh + (h - sh) * 0.45, -lz, b.m3);
  },
  stool(b, w, d, h, o = {}) {
    const bar = PV(o.p, 'bar', h * 0.3, 0.05, h - 0.08);
    const st = 0.03, leg = 0.035, inset = 0.02;
    b.box(w, st, d, 0, h - st, 0);
    const { lx, lz } = legs(b, w, d, h - st, leg, inset);
    for (const s of [-1, 1]) {
      b.box(2 * lx - leg, 0.02, 0.02, 0, bar, s * lz, b.m2);
      b.box(0.02, 0.02, 2 * lz - leg, s * lx, bar, 0, b.m2);
    }
  },
  sofa,
  armchair: sofa,
  cornersofa(b, w, d, h, o = {}) {
    const bh = seatOf('cornersofa', h, o.p) - 0.12, dd = Math.min(0.95, d * 0.5), cw = Math.min(0.95, w * 0.42), bk = 0.2;
    b.box(w, bh, dd, 0, 0, -d / 2 + dd / 2, b.m2);
    b.box(cw, bh, d - dd, w / 2 - cw / 2, 0, -d / 2 + dd + (d - dd) / 2, b.m2);
    b.box(w, h - bh, bk, 0, bh, -d / 2 + bk / 2);
    b.box(0.18, Math.min(0.24, h - bh), dd - bk, -w / 2 + 0.09, bh, -d / 2 + bk + (dd - bk) / 2);
    b.box(w - 0.2 - cw, 0.12, dd - bk - 0.02, -w / 2 + 0.19 + (w - 0.2 - cw) / 2, bh, -d / 2 + bk + (dd - bk) / 2, b.m3);
    b.box(cw - 0.02, 0.12, d - bk - 0.02, w / 2 - cw / 2, bh, -d / 2 + bk + (d - bk) / 2, b.m3);
  },
  bench(b, w, d, h, o = {}) {
    b.box(w, 0.04, d, 0, h - 0.04, 0);
    for (const s of [-1, 1]) b.box(0.04, h - 0.04, d - 0.04, s * (w / 2 - 0.1), 0, 0, b.m2);
    b.box(w - 0.24, 0.03, 0.03, 0, PV(o.p, 'bar', h * 0.35, 0.05, h - 0.08), 0, b.m2);
  },
  barstool(b, w, d, h, o = {}) {
    const bar = PV(o.p, 'bar', h * 0.32, 0.05, h - 0.08);
    b.cyl(0.5, 0.5, 0.04, 0, h - 0.04, 0, b.m, w, d);
    const { lx, lz } = legs(b, w, d, h - 0.04, 0.03, 0.05);
    for (const s of [-1, 1]) {
      b.box(2 * lx - 0.03, 0.02, 0.02, 0, bar, s * lz, b.m2);
      b.box(0.02, 0.02, 2 * lz - 0.03, s * lx, bar, 0, b.m2);
    }
  },
  coffeetable(b, w, d, h, o = {}) {
    b.box(w, 0.03, d, 0, h - 0.03, 0);
    legs(b, w, d, h - 0.03, 0.04, 0.02);
    b.box(w - 0.14, 0.02, d - 0.14, 0, PV(o.p, 'shelf', TSHELF[0](h), TSHELF[1](h), TSHELF[2](h)), 0, b.m3);
  },
  pouf(b, w, d, h) {
    b.cyl(0.5, 0.5, h - 0.012, 0, 0, 0, b.m, w, d);
    b.cyl(0.47, 0.5, 0.012, 0, h - 0.012, 0, b.m3, w, d);
  },
  wallshelf(b, w, d, h) {
    b.box(w, 0.03, d, 0, h - 0.03, 0);
    for (const s of [-1, 1]) b.box(0.02, h - 0.03, d * 0.7, s * (w / 2 - 0.12), 0, -d * 0.15, b.m2);
  },
  picture(b, w, d, h) {
    b.box(w, h, d, 0, 0, 0, b.m2);
    b.box(w - 0.08, h - 0.08, 0.006, 0, 0.04, d / 2, b.m3);
  },
  washer(b, w, d, h) {
    b.box(w, h, d - 0.02, 0, 0, -0.01);
    b.box(w - 0.04, 0.08, 0.012, 0, h - 0.13, d / 2 - 0.014, b.m3);
    const r = Math.min(w, h) * 0.3;
    b.part(-r, h * 0.45, d / 2 - 0.005, { kind: 'door', sign: -1, ang: 1.7 }, () => {   // люк на петле слева
      const door = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 32), std('#2b2f36', { roughness: 0.35 }));
      door.rotation.x = Math.PI / 2;
      door.scale.set(2 * r, 1, 2 * r);
      door.position.set(r, 0, 0);
      b.finish(door);
    });
  },
  bathtub(b, w, d, h) {
    b.box(w, h, d);
    b.box(w - 0.14, 0.012, d - 0.14, 0, h - 0.006, 0, std('#cfe4ee', { roughness: 0.3 }));
  },
  nightstand(b, w, d, h) { BUILD.dresser(b, w, d, h); },
  tvstand(b, w, d, h) { BUILD.dresser(b, w, d, h); },
  bed(b, w, d, h, o = {}) {
    const st = seatOf('bed', h, o.p), mh = Math.min(0.22, st * 0.45), fh = st - mh, ht = 0.06;
    b.box(w, fh, d - ht, 0, 0, ht / 2, b.m2);
    b.box(w, h, ht, 0, 0, -d / 2 + ht / 2);
    const white = std('#f4f1ea');
    b.box(w - 0.04, mh, d - ht - 0.04, 0, fh, ht / 2, white);
    const n = w > 1.2 ? 2 : 1, pw = Math.min(0.6, (w - 0.1) / n - 0.05);
    for (let i = 0; i < n; i++)
      b.box(pw, 0.1, 0.38, (i - (n - 1) / 2) * (pw + 0.08), fh + mh, -d / 2 + ht + 0.26, b.m3);
  },
  plant(b, w, d, h) {
    const ph = Math.min(0.35, h * 0.3);
    b.cyl(0.5, 0.38, ph, 0, 0, 0, std('#b0714f'), w * 0.55, d * 0.55);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), b.m);
    leaf.scale.set(w, h - ph, d);
    leaf.position.set(0, ph + (h - ph) / 2, 0);
    b.finish(leaf);
  },
  lamp(b, w, d, h) {
    const sh = Math.min(0.3, h * 0.25);
    b.cyl(0.5, 0.5, 0.03, 0, 0, 0, b.m2, w * 0.6, d * 0.6);
    b.cyl(0.012, 0.012, h - sh - 0.03, 0, 0.03, 0, b.m2);
    b.cyl(0.36, 0.5, sh, 0, h - sh, 0, std(b.m3.color, { emissive: b.m3.color, emissiveIntensity: 0.25 }), w, d);
  },
  tv(b, w, d, h) {
    b.box(w * 0.4, 0.02, d, 0, 0, 0, b.m2);
    b.box(0.06, h * 0.12, 0.04, 0, 0.02, 0, b.m2);
    b.box(w, h * 0.86, 0.04, 0, h * 0.14, 0);
    b.box(w - 0.03, h * 0.86 - 0.03, 0.004, 0, h * 0.14 + 0.015, 0.022, std('#0d1014', { roughness: 0.3 }));
  },
  door(b, w, d, h) {
    for (const s of [-1, 1]) b.box(0.05, h, d, s * (w / 2 - 0.025), 0, 0, b.m2);
    b.box(w - 0.1, 0.05, d, 0, h - 0.05, 0, b.m2);
    const lw = w - 0.1;
    b.part(-lw / 2, 0, 0, { kind: 'door', sign: -1 }, () => {
      b.box(lw, h - 0.05, 0.04, lw / 2, 0, 0, b.m3);
      b.box(0.02, 0.12, 0.09, lw - 0.08, 1.0 > h ? h / 2 : 1.0, 0, b.m2);
    });
  },
  window(b, w, d, h) { sashFrame(b, w, d, h, [-1, 1]); },
  window1(b, w, d, h) { sashFrame(b, w, d, h, [-1]); },
  window3(b, w, d, h) { sashFrame(b, w, d, h, [-1, 0, 1]); },
  balcony(b, w, d, h) { sashFrame(b, w, d, h, [-1], false); },
  panorama(b, w, d, h) {                 // глухая половина и сдвижная створка поверх неё
    const f = 0.05, t = 0.04, sw = (w - 2 * f) / 2, sh = h - 2 * f;
    for (const s of [-1, 1]) b.box(f, h, d, s * (w / 2 - f / 2), 0, 0);
    b.box(w - 2 * f, f, d, 0, 0, 0);
    b.box(w - 2 * f, f, d, 0, h - f, 0);
    const pane = (z) => {
      for (const e of [-1, 1]) b.box(t, sh, 0.03, e * (sw / 2 - t / 2), 0, z);
      b.box(sw - 2 * t, t, 0.03, 0, 0, z); b.box(sw - 2 * t, t, 0.03, 0, sh - t, z);
      b.box(sw - 2 * t, sh - 2 * t, 0.008, 0, t, z, glassM());
    };
    const g = b.g; b.g = new THREE.Group(); b.g.position.set(sw / 2, f, 0); pane(-0.018); g.add(b.g); b.g = g;
    b.part(-sw / 2, f, 0, { kind: 'slide', x0: -sw / 2, travel: sw - t }, () => {
      pane(0.018);
      b.box(0.02, 0.14, 0.03, sw / 2 - 0.06, Math.min(sh / 2, 1.0), 0.045, b.m2);
    });
  },
  roundwindow(b, w, d, h) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 10, 40), b.m);
    ring.scale.set(w - 0.07, h - 0.07, d / 0.07); ring.position.set(0, h / 2, 0);
    b.finish(ring);
    const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.008, 40), glassM());
    gl.rotation.x = Math.PI / 2; gl.scale.set(w - 0.07, 1, h - 0.07); gl.position.set(0, h / 2, 0);
    b.finish(gl);
    b.box(0.03, h - 0.08, 0.03, 0, 0.04, 0); b.box(w - 0.08, 0.03, 0.03, 0, h / 2 - 0.015, 0);
  },
  door2(b, w, d, h) {                    // две распашные створки
    for (const s of [-1, 1]) b.box(0.05, h, d, s * (w / 2 - 0.025), 0, 0, b.m2);
    b.box(w - 0.1, 0.05, d, 0, h - 0.05, 0, b.m2);
    const lw = (w - 0.1) / 2;
    for (const s of [-1, 1]) b.part(s * lw, 0, 0, { kind: 'door', sign: s }, () => {
      b.box(lw - 0.004, h - 0.05, 0.04, -s * lw / 2, 0, 0, b.m3);
      b.box(0.02, 0.12, 0.09, -s * (lw - 0.07), Math.min(1.0, h / 2), 0, b.m2);
    });
  },
  slidedoor(b, w, d, h) {                // полотно уезжает вбок вдоль стены
    for (const s of [-1, 1]) b.box(0.05, h, d, s * (w / 2 - 0.025), 0, 0, b.m2);
    b.box(w - 0.1, 0.05, d, 0, h - 0.05, 0, b.m2);
    b.box(2 * w - 0.1, 0.04, 0.03, w / 2 - 0.05, h, d / 2 + 0.015, b.m2);       // рельс
    b.part(0, 0, d / 2 + 0.025, { kind: 'slide', x0: 0, travel: w - 0.08 }, () => {
      b.box(w - 0.06, h - 0.02, 0.04, 0, 0, 0, b.m3);
      b.box(0.02, 0.3, 0.03, -(w / 2 - 0.1), Math.min(0.95, h / 2), 0.03, b.m2);
    });
  },
  opening(b, w, d, h) {                  // прямой проём без полотна
    for (const s of [-1, 1]) b.box(0.07, h, d, s * (w / 2 - 0.035), 0, 0);
    b.box(w - 0.14, 0.07, d, 0, h - 0.07, 0);
  },
  arch(b, w, d, h) {                     // портал с полукруглым верхом
    const j = 0.1, r = (w - 2 * j) / 2, sp = Math.max(0.1, h - j - r);
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(-w / 2, h); s.lineTo(w / 2, h); s.lineTo(w / 2, 0); s.lineTo(r, 0); s.lineTo(r, sp);
    s.absarc(0, sp, r, 0, Math.PI, false);
    s.lineTo(-r, 0); s.lineTo(-w / 2, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 20 });
    geo.translate(0, 0, -d / 2);
    b.finish(new THREE.Mesh(geo, b.m));
  },
  bed1(b, w, d, h, o) { BUILD.bed(b, w, d, h, o); },
  bunk(b, w, d, h, o = {}) {             // двухъярусная кровать с лестницей
    const p = 0.06, white = std('#f4f1ea'), up = PV(o.p, 'up', h * 0.62, 0.8, h - 0.45), low = PV(o.p, 'low', 0.25, 0.1, up - 0.55);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(p, h, p, sx * (w / 2 - p / 2), 0, sz * (d / 2 - p / 2), b.m2);
    for (const y of [low, up]) {
      b.box(w - 2 * p, 0.12, d - 2 * p, 0, y, 0);
      b.box(w - 2 * p - 0.04, 0.14, d - 2 * p - 0.04, 0, y + 0.12, 0, white);
      b.box(w * 0.6, 0.08, 0.34, 0, y + 0.26, -d / 2 + p + 0.24, b.m3);
      for (const sz of [-1, 1]) b.box(w - 2 * p, 0.04, 0.03, 0, y + 0.42, sz * (d / 2 - p / 2));
    }
    b.box(0.03, 0.04, d - 2 * p, -w / 2 + 0.03, up + 0.42, 0);
    for (const sz of [0.12, 0.5]) b.box(0.03, up + 0.3, 0.03, w / 2 + 0.015, 0, d / 2 - sz, b.m2);
    for (let i = 1; i <= 4; i++) b.box(0.03, 0.03, 0.38, w / 2 + 0.015, i * (up) / 4.4, d / 2 - 0.31, b.m2);
  },
  lowshelf(b, w, d, h, o) { BUILD.shelf(b, w, d, h, o); },
  lowwall(b, w, d, h) { b.box(w, h, d); },
  column(b, w, d, h) {
    b.box(w, 0.12, d, 0, 0, 0); b.box(w, 0.1, d, 0, h - 0.1, 0);
    b.cyl(0.5, 0.5, h - 0.22, 0, 0.12, 0, b.m, w * 0.8, d * 0.8);
  },
  // ── раскладная мебель ──
  sofabed(b, w, d, h) {                  // сиденье выезжает вперёд, спинка-подушка откидывается на его место
    const baseH = Math.min(0.3, h * 0.36), armW = Math.min(0.16, w * 0.12), bk = 0.08, ct = 0.16;
    const inner = w - 2 * armW, sd = d - bk - ct, bh = Math.max(0.2, Math.min(h - baseH - 0.02, 0.5));
    b.box(inner, baseH, bk + ct, 0, 0, -d / 2 + (bk + ct) / 2, b.m2);
    b.box(inner, h - baseH, bk, 0, baseH, -d / 2 + bk / 2);
    for (const s of [-1, 1]) b.box(armW, baseH + 0.26, d, s * (w / 2 - armW / 2), 0, 0);
    b.box(inner - 0.04, baseH - 0.04, sd - 0.03, 0, 0, -d / 2 + bk + ct + (sd - 0.03) / 2, b.m2);   // короб под сиденьем
    const zs = -d / 2 + bk + ct;
    b.part(0, 0, zs, { kind: 'drawer', z0: zs, travel: bh }, () => {
      b.box(inner - 0.01, baseH - 0.03, sd, 0, 0.03, sd / 2, b.m2);
      b.box(inner - 0.01, 0.14, sd, 0, baseH, sd / 2, b.m3);
    });
    b.part(0, baseH, zs, { kind: 'turn', axis: 'x', sign: 1, ang: Math.PI / 2 }, () => {
      b.box(inner - 0.01, bh, ct - 0.02, 0, 0, -ct / 2 + 0.01, b.m3);
    });
  },
  recliner(b, w, d, h, o = {}) {         // подножка поднимается, спинка откидывается
    const baseH = seatOf('recliner', h, o.p) - 0.12, armW = Math.min(0.16, w * 0.18), bk = 0.16, D = d - 0.07, zc = -0.035;
    const inner = w - 2 * armW;
    b.box(w, baseH, D, 0, 0, zc, b.m2);
    for (const s of [-1, 1]) b.box(armW, 0.26, D - bk, s * (w / 2 - armW / 2), baseH, zc + bk / 2);
    b.box(inner - 0.01, 0.12, D - bk - 0.02, 0, baseH, zc + bk / 2 - 0.01, b.m3);
    b.part(0, baseH, -d / 2 + bk, { kind: 'turn', axis: 'x', sign: -1, ang: 0.6 }, () => {
      b.box(w, h - baseH, bk, 0, 0, -bk / 2);
    });
    b.part(0, baseH - 0.01, d / 2 - 0.07, { kind: 'turn', axis: 'x', sign: -1, ang: Math.PI / 2 }, () => {
      b.box(inner - 0.02, baseH - 0.05, 0.06, 0, -(baseH - 0.05), 0.03, b.m3);
    });
  },
  officechair(b, w, d, h, o = {}) {
    const sh = seatOf('officechair', h, o.p);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2, leg = b.box(0.04, 0.03, w * 0.48, Math.sin(a) * w * 0.24, 0.04, Math.cos(a) * w * 0.24, b.m2);
      leg.rotation.y = a;
      b.cyl(0.025, 0.025, 0.04, Math.sin(a) * w * 0.46, 0, Math.cos(a) * w * 0.46, b.m2);
    }
    b.cyl(0.025, 0.025, sh - 0.12, 0, 0.06, 0, b.m2);
    b.box(w * 0.85, 0.07, d * 0.8, 0, sh - 0.07, 0.02);
    b.box(0.05, h - sh - 0.25, 0.03, 0, sh - 0.04, -d * 0.36, b.m2);
    b.box(w * 0.8, Math.min(0.5, h - sh - 0.08), 0.06, 0, h - Math.min(0.5, h - sh - 0.08), -d * 0.38, b.m3);
    for (const s of [-1, 1]) { b.box(0.04, 0.2, 0.04, s * w * 0.44, sh - 0.04, 0, b.m2); b.box(0.06, 0.03, d * 0.45, s * w * 0.44, sh + 0.16, 0.02, b.m2); }
  },
  booktable(b, w, d, h) {                // стол-книжка: крылья поднимаются по бокам
    const bw = w - 0.06, t = 0.025, fl = Math.min(h - 0.08, 0.68);
    b.box(bw, t, d, 0, h - t, 0);
    for (const s of [-1, 1]) b.box(0.02, h - t, d - 0.1, s * (bw / 2 - 0.03), 0, 0, b.m2);
    b.box(bw - 0.08, 0.3, 0.02, 0, h - t - 0.3, 0, b.m2);
    for (const s of [-1, 1]) b.part(s * bw / 2, h, 0, { kind: 'turn', axis: 'z', sign: s, ang: Math.PI / 2 }, () => {
      b.box(t, fl, d, s * t / 2, -fl, 0, b.m3);
    });
  },
  exttable(b, w, d, h) {                 // раздвижной: половины столешницы разъезжаются, под ними вставка
    const t = 0.03, ext = Math.min(0.25, w * 0.18);
    legs(b, w - 0.1, d - 0.1, h - t, 0.05, 0);
    b.box(w - 0.12, 0.08, d - 0.12, 0, h - t - 0.08, 0, b.m2);
    b.box(2 * ext + 0.02, t - 0.006, d - 0.01, 0, h - t, 0, b.m3);
    for (const s of [-1, 1]) b.part(s * w / 4, h - t, 0, { kind: 'slide', x0: s * w / 4, travel: s * ext }, () => {
      b.box(w / 2 - 0.002, t, d, 0, 0, 0);
    });
  },
  chest(b, w, d, h) {                    // сундук с откидной крышкой
    const t = 0.025, H = h - 0.04;
    b.box(w, t, d, 0, 0, 0, b.m2);
    for (const s of [-1, 1]) b.box(t, H - t, d, s * (w / 2 - t / 2), t, 0);
    for (const s of [-1, 1]) b.box(w - 2 * t, H - t, t, 0, t, s * (d / 2 - t / 2));
    b.part(0, H, -d / 2, { kind: 'turn', axis: 'x', sign: -1, ang: 1.75 }, () => {
      b.box(w + 0.01, 0.04, d + 0.01, 0, 0, d / 2, b.m3);
      b.box(0.1, 0.03, 0.015, 0, -0.02, d + 0.012, b.m2);
    });
  },
  sideboard(b, w, d, h, o = {}) {        // буфет: внизу дверцы, сверху ряд ящиков
    carcass(b, w, h, d - 0.02, -0.01, 0.018, 0.05);
    const dr = PV(o.p, 'dr', Math.min(0.18, h * 0.22), 0.08, h * 0.5), cols = Math.max(2, Math.round(w / 0.45));
    b.box(w - 0.036, 0.018, d - 0.032, 0, h - 0.02 - dr - 0.018, -0.006);
    fronts(b, w, h - 0.07 - dr, d, cols, 1, 0.05, d / 2 - 0.01, 'v');
    fronts(b, w, dr, d, cols, 1, h - 0.02 - dr, d / 2 - 0.01, 'h');
  },
  wallcabinet(b, w, d, h, o = {}) {
    carcass(b, w, h, d - 0.02, -0.01, 0.018, 0.018);
    b.box(w - 0.036, 0.018, d - 0.032, 0, PV(o.p, 'shelf', CSHELF[0](h), CSHELF[1](h), CSHELF[2](h)), -0.006);
    fronts(b, w, h - 0.02, d, Math.max(1, Math.round(w / 0.45)), 1, 0.01, d / 2 - 0.01, 'v');
  },
  // ── техника и сантехника ──
  stove(b, w, d, h) {                    // плита: дверца духовки откидывается вниз
    const D = d - 0.03, zc = -0.015, t = 0.03;
    carcass(b, w, h - 0.02, D, zc, t, 0.1);
    b.box(w - 2 * t, 0.012, D - 0.06, 0, 0.1 + (h - 0.3) / 2, zc, b.m2);
    b.box(w, 0.02, d, 0, h - 0.02, 0, std('#22262b', { roughness: 0.4 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.5, 0.5, 0.006, sx * w * 0.22, h, sz * d * 0.2, std('#0d1014'), w * 0.3, w * 0.3);
    b.box(w - 0.006, 0.12, 0.03, 0, h - 0.145, d / 2 - 0.015, b.m3);
    for (let i = 0; i < 4; i++) b.cyl(0.018, 0.018, 0.02, (i - 1.5) * w * 0.2, h - 0.095, d / 2 + 0.008, b.m2).rotation.x = Math.PI / 2;
    const dh = h - 0.26;
    b.part(0, 0.1, d / 2 - 0.015, { kind: 'turn', axis: 'x', sign: 1, ang: 1.5 }, () => {
      b.box(w - 0.006, dh, 0.03, 0, 0.004, 0, b.m3);
      b.box(w * 0.6, dh * 0.5, 0.006, 0, dh * 0.22, 0.016, std('#1a1d22', { roughness: 0.3 }));
      b.box(w * 0.7, 0.02, 0.03, 0, dh - 0.06, 0.03, b.m2);
    });
  },
  toilet(b, w, d, h, o = {}) {           // крышка поднимается
    const sh = seatOf('toilet', h, o.p), tk = Math.min(0.2, d * 0.28), white = b.m;
    b.box(w, h - sh + 0.02, tk, 0, sh - 0.02, -d / 2 + tk / 2, white);
    b.cyl(0.3, 0.22, sh * 0.55, 0, 0, 0.02, white, w * 0.9, (d - tk) * 0.9);
    b.cyl(0.5, 0.36, sh * 0.45, 0, sh * 0.55 - 0.02, tk / 2, white, w * 0.86, d - tk);
    b.part(0, sh + 0.005, -d / 2 + tk + 0.01, { kind: 'turn', axis: 'x', sign: -1, ang: 1.65 }, () => {
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.025, 28), b.m3);
      lid.scale.set(w * 0.86, 1, d - tk - 0.02); lid.position.set(0, 0.0125, (d - tk - 0.02) / 2);
      b.finish(lid);
    });
  },
  sink(b, w, d, h) {                     // раковина на тумбе с дверцами
    const t = 0.05, H = h - t;
    carcass(b, w, H, d - 0.04, -0.02, 0.018, 0.08);
    fronts(b, w, H - 0.09, d, Math.max(1, Math.round(w / 0.45)), 1, 0.08, d / 2 - 0.03, 'v');
    b.box(w, t, d, 0, H, 0, std('#f4f4f1', { roughness: 0.3 }));
    b.cyl(0.5, 0.5, 0.008, 0, h - 0.004, 0.02, std('#cfe4ee', { roughness: 0.3 }), w * 0.62, d * 0.55);
    b.cyl(0.014, 0.014, 0.16, 0, h, -d / 2 + 0.07, b.m2);
    b.box(0.024, 0.02, 0.12, 0, h + 0.14, -d / 2 + 0.12, b.m2);
  },
  shower(b, w, d, h) {                   // душевая кабина со стеклянной дверью
    b.box(w, 0.08, d, 0, 0, 0, std('#f1f1ee'));
    const p = 0.03;
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(p, h - 0.08, p, x * (w / 2 - p / 2), 0.08, z * (d / 2 - p / 2), b.m2);
    b.box(w - 2 * p, h - 0.1, 0.008, 0, 0.08, -d / 2 + p / 2, glassM());
    for (const s of [-1, 1]) b.box(0.008, h - 0.1, d - 2 * p, s * (w / 2 - p / 2), 0.08, 0, glassM());
    b.cyl(0.012, 0.012, h - 0.5, -w / 2 + 0.12, 0.3, -d / 2 + 0.08, b.m2);
    b.cyl(0.5, 0.5, 0.02, -w / 2 + 0.2, h - 0.22, -d / 2 + 0.16, b.m2, 0.2, 0.2);
    b.part(-w / 2 + p, 0.08, d / 2 - p / 2, { kind: 'door', sign: -1, ang: 1.6 }, () => {
      b.box(w - 2 * p, h - 0.1, 0.008, (w - 2 * p) / 2, 0, 0, glassM());
      b.box(0.02, 0.3, 0.03, w - 2 * p - 0.06, Math.min(1.0, h / 2), 0.02, b.m2);
    });
  },
  // ── растения и декор ──
  ficus(b, w, d, h) {
    const ph = Math.min(0.32, h * 0.2);
    pot(b, w * 0.5, d * 0.5, ph);
    b.cyl(0.02, 0.03, h * 0.5, 0, ph, 0, std('#7a5a3c'));
    const m2 = std(b.m.color.clone().multiplyScalar(0.85));
    blob(b, 0, h * 0.74, 0, w * 0.8, h * 0.5, d * 0.8);
    blob(b, -w * 0.22, h * 0.6, d * 0.12, w * 0.55, h * 0.3, d * 0.55, m2);
    blob(b, w * 0.2, h * 0.86, -d * 0.1, w * 0.5, h * 0.26, d * 0.5, m2);
  },
  palm(b, w, d, h) {
    const ph = Math.min(0.3, h * 0.18), top = h * 0.72;
    pot(b, w * 0.4, d * 0.4, ph);
    b.cyl(0.025, 0.04, top - ph, 0, ph, 0, std('#7a5a3c'));
    for (let i = 0; i < 8; i++) {                         // листья веером, концы свисают
      const a = (i / 8) * Math.PI * 2, L = w * 0.48, leaf = blob(b, Math.sin(a) * L * 0.5, top + (i % 2 ? 0.02 : h * 0.1), Math.cos(a) * L * 0.5, 0.14, 0.03, L, b.m, 0);
      leaf.rotation.order = 'YXZ';
      leaf.rotation.set(i % 2 ? 0.35 : -0.25, a, 0);
    }
    blob(b, 0, top + h * 0.12, 0, 0.1, h * 0.3, 0.1);
  },
  cactus(b, w, d, h) {
    const ph = Math.min(0.14, h * 0.25);
    pot(b, w * 0.8, d * 0.8, ph);
    blob(b, 0, ph + (h - ph) / 2, 0, w * 0.42, h - ph, d * 0.42);
    blob(b, -w * 0.3, ph + (h - ph) * 0.5, 0, w * 0.24, (h - ph) * 0.45, d * 0.24);
    blob(b, w * 0.3, ph + (h - ph) * 0.62, 0, w * 0.22, (h - ph) * 0.36, d * 0.22);
  },
  sansev(b, w, d, h) {                   // пучок высоких острых листьев
    const ph = Math.min(0.22, h * 0.28);
    pot(b, w * 0.85, d * 0.85, ph);
    const m2 = std(b.m.color.clone().multiplyScalar(0.8));
    [[0, 0, 1, 0], [-0.2, 0.1, 0.8, 0.5], [0.2, -0.08, 0.86, 1.2], [0.05, 0.2, 0.7, 2.1], [-0.1, -0.2, 0.62, 2.8], [0.24, 0.16, 0.55, 0.9]].forEach(([x, z, k, a], i) => {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 4), i % 2 ? m2 : b.m), lh = (h - ph) * k;
      leaf.scale.set(w * 0.2, lh, d * 0.06); leaf.position.set(x * w, ph + lh / 2, z * d); leaf.rotation.y = a;
      b.finish(leaf);
    });
  },
  flowers(b, w, d, h) {                  // ваза с цветами
    const vh = h * 0.45;
    b.cyl(0.3, 0.5, vh, 0, 0, 0, std('#dfe6ea', { roughness: 0.3 }), w * 0.45, d * 0.45);
    const green = std('#5f8f4e');
    [[-0.25, 0.1, 1], [0.2, 0.2, 0.9], [0, -0.22, 0.95], [0.28, -0.12, 0.8], [-0.12, -0.05, 0.86]].forEach(([x, z, k]) => {
      b.seg([0, vh * 0.8, 0], [x * w, h * k - 0.04, z * d], 0.006, green);
      blob(b, x * w, h * k - 0.04, z * d, w * 0.26, 0.08, d * 0.26, b.m, 0);
    });
  },
  roundrug(b, w, d, h) { b.cyl(0.5, 0.5, h, 0, 0, 0, b.m, w, d); },
  mirror(b, w, d, h) {
    b.box(w, h, d, 0, 0, 0, b.m2);
    b.box(w - 0.06, h - 0.06, 0.006, 0, 0.03, d / 2, std('#c9d6dc', { roughness: 0.08, metalness: 0.6 }));
  },
  // Деревянный человечек художника: яйцо-голова, грудь клином, шар-талия, таз колоколом, конечности на шарах.
  // Позы: stand — стоит (начало координат под ступнями); sit — сидит на краю, голени свисают; sitf — сидит, ноги вперёд;
  // lie — лежит на спине, головой в −Z.
  human(b, w, d, h, o = {}) {
    const k = h / 1.75, pose = o.pose || 'stand', sit = pose === 'sit' || pose === 'sitf';
    const root = b.g, fig = new THREE.Group();
    b.g = fig;
    const mj = std(b.m.color.clone().multiplyScalar(0.88));
    const V = (p) => new THREE.Vector3(p[0] * k, p[1] * k, p[2] * k);
    const ell = (p, r, m = b.m) => {                      // эллипсоид
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), m);
      mesh.position.copy(V(p)); mesh.scale.set(r[0] * k, r[1] * k, r[2] * k);
      return b.finish(mesh);
    };
    const joint = (p, r) => ell(p, [r, r, r], mj);
    const limb = (p, q, r1, r2) => {                      // конус от p (радиус r1) к q (радиус r2)
      const a = V(p), c = V(q), dir = c.clone().sub(a), len = Math.max(dir.length(), 0.004);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r2 * k, r1 * k, len, 20), b.m);
      mesh.position.copy(a).add(c).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.multiplyScalar(1 / len));
      return b.finish(mesh);
    };
    const tub = (y0, y1, rBot, rTop, sz) => {             // тело вращения, сплюснутое по глубине
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop * k, rBot * k, (y1 - y0) * k, 24), b.m);
      mesh.position.set(0, ((y0 + y1) / 2) * k, 0); mesh.scale.z = sz;
      return b.finish(mesh);
    };
    const py = sit ? 0.1 : 0.95;                          // высота тазобедренных шаров
    tub(py - 0.04, py + 0.13, 0.15, 0.1, 0.72);           // таз
    ell([0, py - 0.04, 0], [0.15, 0.06, 0.108]);
    joint([0, py + 0.17, 0], 0.072);                      // талия
    tub(py + 0.21, py + 0.5, 0.105, 0.19, 0.6);           // грудь
    ell([0, py + 0.5, 0], [0.19, 0.04, 0.114]);
    joint([0, py + 0.56, 0], 0.04);                       // шея
    ell([0, py + 0.69, 0.005], [0.083, 0.115, 0.095]);    // голова
    for (const s of [-1, 1]) {
      const sh = [s * 0.235, py + 0.46, 0];
      const el = sit ? [s * 0.25, py + 0.2, 0.04] : [s * 0.255, py + 0.19, 0];
      const wr = sit ? [s * 0.2, py + 0.08, 0.26] : [s * 0.255, py - 0.05, 0.03];
      joint(sh, 0.052); limb(sh, el, 0.046, 0.038);
      joint(el, 0.036); limb(el, wr, 0.037, 0.028);
      joint(wr, 0.027);
      if (sit) ell([wr[0], wr[1] - 0.005, wr[2] + 0.075], [0.036, 0.02, 0.08]);
      else ell([wr[0], wr[1] - 0.085, wr[2]], [0.022, 0.085, 0.038]);   // кисть-лепесток
      const x = s * 0.085, hip = [x, py - 0.05, 0];
      const kn = pose === 'stand' || pose === 'lie' ? [x, 0.51, 0] : [x, py - 0.03, 0.43];
      const an = pose === 'sit' ? [x, py - 0.45, 0.43] : pose === 'sitf' ? [x, py - 0.045, 0.84] : [x, 0.085, 0];
      joint(hip, 0.062); limb(hip, kn, 0.066, 0.05);
      joint(kn, 0.047); limb(kn, an, 0.048, 0.034);
      joint(an, 0.032);
      if (pose === 'sitf') ell([x, an[1] + 0.075, an[2] + 0.035], [0.04, 0.115, 0.03]);
      else ell([x, an[1] - 0.055, an[2] + 0.075], [0.042, 0.03, 0.12]);   // ступня
    }
    b.g = root;
    if (pose === 'lie') { fig.rotation.x = -Math.PI / 2; fig.position.set(0, 0.115 * k, 0.875 * k); }
    root.add(fig);
  },


};

// Размеры в метрах: w — ширина, d — глубина, h — высота, y — высота от пола.
export const CATALOG = [
  { type: 'stool', name: 'Табурет', w: 0.35, d: 0.35, h: 0.45, color: '#c8a27a' },
  { type: 'chair', name: 'Стул', w: 0.45, d: 0.5, h: 0.9, color: '#c8a27a' },
  { type: 'armchair', name: 'Кресло', w: 0.9, d: 0.85, h: 0.8, color: '#8c9aa8' },
  { type: 'sofa', name: 'Диван', w: 2.1, d: 0.95, h: 0.8, color: '#8c9aa8' },
  { type: 'cornersofa', name: 'Угловой диван', w: 2.6, d: 1.7, h: 0.8, color: '#8c9aa8' },
  { type: 'pouf', name: 'Пуф', w: 0.5, d: 0.5, h: 0.42, color: '#b5553c' },
  { type: 'bench', name: 'Скамья', w: 1.2, d: 0.38, h: 0.45, color: '#c8a27a' },
  { type: 'barstool', name: 'Барный стул', w: 0.38, d: 0.38, h: 0.75, color: '#c8a27a' },
  { type: 'bed', name: 'Кровать двуспальная', w: 1.6, d: 2.1, h: 0.9, color: '#b9a48c' },
  { type: 'table', name: 'Стол', w: 1.4, d: 0.8, h: 0.75, color: '#c8a27a' },
  { type: 'coffeetable', name: 'Журнальный столик', w: 1.0, d: 0.6, h: 0.42, color: '#c8a27a' },
  { type: 'roundtable', name: 'Круглый стол', w: 0.9, d: 0.9, h: 0.75, color: '#c8a27a' },
  { type: 'desk', name: 'Письменный стол', w: 1.2, d: 0.6, h: 0.75, color: '#e9e4da' },
  { type: 'wardrobe', name: 'Шкаф', w: 1.2, d: 0.6, h: 2.1, color: '#e9e4da' },
  { type: 'dresser', name: 'Комод / тумба', w: 0.8, d: 0.45, h: 0.8, color: '#e9e4da' },
  { type: 'nightstand', name: 'Прикроватная тумба', w: 0.45, d: 0.4, h: 0.5, color: '#e9e4da' },
  { type: 'shelf', name: 'Стеллаж', w: 0.8, d: 0.3, h: 1.8, color: '#c8a27a' },
  { type: 'kitchen', name: 'Кухонный модуль', w: 0.6, d: 0.6, h: 0.86, color: '#e9e4da' },
  { type: 'fridge', name: 'Холодильник', w: 0.6, d: 0.65, h: 1.9, color: '#d5d9dc' },
  { type: 'washer', name: 'Стиральная машина', w: 0.6, d: 0.55, h: 0.85, color: '#e3e5e6' },
  { type: 'bathtub', name: 'Ванна', w: 1.7, d: 0.75, h: 0.58, color: '#f1f1ee' },
  { type: 'wallshelf', name: 'Настенная полка', w: 0.9, d: 0.22, h: 0.2, y: 1.4, color: '#c8a27a' },
  { type: 'picture', name: 'Картина', w: 0.7, d: 0.03, h: 0.5, y: 1.3, color: '#3a332b' },
  { type: 'tv', name: 'Телевизор', w: 1.2, d: 0.25, h: 0.78, color: '#2b2f36' },
  { type: 'lamp', name: 'Торшер', w: 0.4, d: 0.4, h: 1.6, color: '#d8c9a0' },
  { type: 'plant', name: 'Растение', w: 0.5, d: 0.5, h: 1.1, color: '#5f8f4e' },
  { type: 'rug', name: 'Ковёр', w: 2.0, d: 1.4, h: 0.012, color: '#b5553c' },
  { type: 'box', name: 'Коробка', w: 0.6, d: 0.6, h: 0.6, color: '#f1eee8' },
  { type: 'wall', name: 'Перегородка', w: 2.0, d: 0.1, h: 2.7, color: '#f2efe9' },
  { type: 'door', name: 'Дверь', w: 0.9, d: 0.1, h: 2.05, color: '#d9c7a8' },
  { type: 'window', name: 'Окно', w: 1.4, d: 0.1, h: 1.4, y: 0.85, color: '#f5f5f2' },
  { type: 'bed1', name: 'Кровать односпальная', w: 0.9, d: 2.05, h: 0.85, color: '#b9a48c' },
  { type: 'bunk', name: 'Двухъярусная кровать', w: 0.95, d: 2.05, h: 1.7, color: '#c8a27a' },
  { type: 'lowshelf', name: 'Низкий стеллаж', w: 1.2, d: 0.32, h: 0.85, color: '#c8a27a' },
  { type: 'lowwall', name: 'Полустенка', w: 1.5, d: 0.1, h: 1.1, color: '#f2efe9' },
  { type: 'column', name: 'Колонна', w: 0.35, d: 0.35, h: 2.7, color: '#f2efe9' },
  { type: 'recliner', name: 'Кресло-реклайнер', w: 0.85, d: 0.95, h: 1.0, color: '#7a6a5a' },
  { type: 'officechair', name: 'Офисное кресло', w: 0.6, d: 0.6, h: 1.1, color: '#3a3f47' },
  { type: 'booktable', name: 'Стол-книжка', w: 0.4, d: 0.8, h: 0.75, color: '#c8a27a' },
  { type: 'exttable', name: 'Раздвижной стол', w: 1.4, d: 0.85, h: 0.75, color: '#c8a27a' },
  { type: 'chest', name: 'Сундук', w: 0.9, d: 0.45, h: 0.5, color: '#a9825a' },
  { type: 'sideboard', name: 'Буфет', w: 1.6, d: 0.45, h: 0.85, color: '#e9e4da' },
  { type: 'tvstand', name: 'ТВ-тумба', w: 1.6, d: 0.4, h: 0.45, color: '#e9e4da' },
  { type: 'wallcabinet', name: 'Навесной шкаф', w: 0.8, d: 0.32, h: 0.7, y: 1.45, color: '#e9e4da' },
  { type: 'stove', name: 'Плита с духовкой', w: 0.6, d: 0.6, h: 0.86, color: '#e3e5e6' },
  { type: 'toilet', name: 'Унитаз', w: 0.38, d: 0.68, h: 0.8, color: '#f4f4f1' },
  { type: 'sink', name: 'Раковина с тумбой', w: 0.7, d: 0.48, h: 0.85, color: '#e9e4da' },
  { type: 'shower', name: 'Душевая кабина', w: 0.9, d: 0.9, h: 2.0, color: '#d5d9dc' },
  { type: 'window1', name: 'Окно одностворчатое', w: 0.7, d: 0.1, h: 1.4, y: 0.85, color: '#f5f5f2' },
  { type: 'window3', name: 'Окно трёхстворчатое', w: 2.1, d: 0.1, h: 1.4, y: 0.85, color: '#f5f5f2' },
  { type: 'panorama', name: 'Панорамное окно', w: 2.4, d: 0.1, h: 2.2, y: 0.1, color: '#f5f5f2' },
  { type: 'roundwindow', name: 'Круглое окно', w: 0.8, d: 0.1, h: 0.8, y: 1.3, color: '#f5f5f2' },
  { type: 'balcony', name: 'Балконная дверь', w: 0.8, d: 0.1, h: 2.15, color: '#f5f5f2' },
  { type: 'door2', name: 'Двустворчатая дверь', w: 1.4, d: 0.1, h: 2.05, color: '#d9c7a8' },
  { type: 'slidedoor', name: 'Раздвижная дверь', w: 0.9, d: 0.1, h: 2.05, color: '#d9c7a8' },
  { type: 'opening', name: 'Проём', w: 1.0, d: 0.14, h: 2.1, color: '#f2efe9' },
  { type: 'arch', name: 'Арка', w: 1.2, d: 0.14, h: 2.3, color: '#f2efe9' },
  { type: 'ficus', name: 'Фикус', w: 0.8, d: 0.8, h: 1.7, color: '#5f8f4e' },
  { type: 'palm', name: 'Пальма', w: 1.3, d: 1.3, h: 1.9, color: '#4f8a52' },
  { type: 'sansev', name: 'Сансевиерия', w: 0.35, d: 0.35, h: 0.8, color: '#4e7d55' },
  { type: 'cactus', name: 'Кактус', w: 0.3, d: 0.3, h: 0.55, color: '#5f8f4e' },
  { type: 'flowers', name: 'Ваза с цветами', w: 0.3, d: 0.3, h: 0.45, color: '#b5553c' },
  { type: 'roundrug', name: 'Круглый ковёр', w: 1.6, d: 1.6, h: 0.012, color: '#8c9aa8' },
  { type: 'mirror', name: 'Зеркало', w: 0.6, d: 0.03, h: 1.5, y: 0.3, color: '#3a332b' },
  { type: 'human', name: 'Человек', w: 0.5, d: 0.3, h: 1.75, color: '#e6cfa3' },
];

export const CATS = [['all', 'Всё'], ['seat', 'Стулья'], ['table', 'Столы'], ['bed', 'Кровати'], ['store', 'Шкафы'], ['shelf', 'Полки'],
  ['tech', 'Техника'], ['plumb', 'Сантехника'], ['wall', 'Перегородки'], ['window', 'Окна'], ['door', 'Двери'], ['decor', 'Декор']];
const CAT_OF = {
  seat: ['stool', 'chair', 'barstool', 'officechair', 'bench', 'pouf', 'armchair', 'recliner', 'sofa', 'cornersofa'],
  table: ['table', 'exttable', 'booktable', 'coffeetable', 'roundtable', 'desk'],
  bed: ['bed', 'bed1', 'bunk'],
  store: ['wardrobe', 'dresser', 'nightstand', 'sideboard', 'tvstand', 'chest', 'kitchen', 'wallcabinet', 'box'],
  shelf: ['shelf', 'lowshelf', 'wallshelf'],
  tech: ['fridge', 'stove', 'washer', 'tv', 'lamp'],
  plumb: ['sink', 'bathtub', 'shower', 'toilet'],
  wall: ['wall', 'lowwall', 'column', 'opening', 'arch'],
  window: ['window', 'window1', 'window3', 'panorama', 'roundwindow'],
  door: ['door', 'door2', 'slidedoor', 'balcony'],
  decor: ['plant', 'ficus', 'palm', 'sansev', 'cactus', 'flowers', 'rug', 'roundrug', 'picture', 'mirror', 'human'],
};
// На эти предметы ничего не ставится; ковры лежат только на полу.
export const NOSUP_T = ['door2', 'slidedoor', 'balcony', 'opening', 'arch', 'window1', 'window3', 'panorama', 'roundwindow',
  'ficus', 'palm', 'sansev', 'cactus', 'flowers', 'mirror', 'shower', 'officechair', 'lowwall', 'column', 'bunk'];
export const RUGS = new Set(['rug', 'roundrug']);
// Окна, двери и проёмы — часть стены: встраиваются в поверхность комнаты и вырезают в ней отверстие.
export const EMBED_T = new Set(['window', 'window1', 'window3', 'panorama', 'roundwindow', 'balcony', 'door', 'door2', 'slidedoor', 'opening', 'arch']);
CATALOG.sort((a, b) => { const o = Object.values(CAT_OF).flat(); return o.indexOf(a.type) - o.indexOf(b.type); });
for (const d of CATALOG) d.cat = Object.keys(CAT_OF).find((k) => CAT_OF[k].includes(d.type)) || 'decor';
// У каждого раздела свой главный оттенок: по цвету сразу видно, к чему относится предмет.
export const CAT_COLOR = { seat: '#7f9bb5', table: '#c8a27a', bed: '#b48a9c', store: '#e9e4da', shelf: '#d9a441', tech: '#8f979e',
  plumb: '#9fd0d6', wall: '#c9c2b6', window: '#a8cbe0', door: '#a9745a', decor: '#5f8f4e' };
const OWN_COLOR = new Set(['human', 'rug', 'roundrug', 'picture', 'mirror', 'flowers', 'tv']);   // у этих цвет свой, по смыслу
for (const d of CATALOG) if (!OWN_COLOR.has(d.type)) d.color = CAT_COLOR[d.cat] || d.color;

export function fillBlank(group, type, w, d, h, color, open, pose, p) {
  const b = new Builder(group, color || '#f1eee8');
  (BUILD[type] || BUILD.box)(b, w, d, h, { pose, p });
  cleanSeams(group);
  for (const c of group.children)
    if (c.userData.act) applyAct(c, open && open.includes(c.userData.part) ? 1 : 0);
  return group;
}
