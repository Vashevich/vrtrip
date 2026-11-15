// Гамбол, как в Rhino (из Табуретки): в одном месте стрелки перемещения, квадратики для двух осей,
// точка-центр, кубики растяжения и дуги поворота. Всё постоянного размера на экране.
// Модуль ничего не знает о приложении: он рисует ручки, находит ручку под лучом и считает,
// насколько её протянули. Что делать с этим числом, решает приложение.
import * as THREE from 'three';

export const HCOL = { x: 0xa61e1e, z: 0x2e9e4f, y: 0x1f6feb };
const HOT = 0x1b1a18;                    // ручка под курсором — чёрная, размер прежний
const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();

export function axisParam(ray, a0, u) {  // ближайшая к лучу точка на оси через a0 (u — единичный вектор)
  const w = a0.clone().sub(ray.origin), b = u.dot(ray.direction), den = 1 - b * b;
  if (den < 1e-4) return null;
  const s = (b * ray.direction.dot(w) - u.dot(w)) / den;
  return Math.abs(s) < 1e4 ? s : null;
}
export function planeHit(ray, C, N) {    // точка, где луч пересекает плоскость через C с нормалью N
  const den = ray.direction.dot(N);
  if (Math.abs(den) < 1e-4) return null;
  const t = C.clone().sub(ray.origin).dot(N) / den;
  return t > 0 ? ray.origin.clone().addScaledVector(ray.direction, t) : null;
}

export class Gumball {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.handles = []; this.arrows = []; this.hot = null; this.drag = null;
    this.size = 0.06;                    // доля высоты видимой области на расстоянии гамбола
    this.opts = null;
  }
  // opts: { move, planes, hub, rot: ['x','y','z'], scale, params: [{ key, axis, pos:[x,y,z], v, lo, hi, sign }] }
  // params — ручки частей болванки (второй клик по предмету); позиции в осях гамбола от его центра, в метрах.
  build(opts) {
    const keep = this.drag;              // перестройка во время протяжки (ручки частей едут за деталью) протяжку не прерывает
    this.clear();
    this.drag = keep;
    this.opts = opts;
    const hold = this.group;
    const part = (col, rx = 0, rz = 0) => {
      const a = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: col, depthTest: false, depthWrite: false, transparent: true });
      a.rotation.set(rx, 0, rz);
      a.userData = { mat: m, col };
      hold.add(a); this.arrows.push(a);
      return a;
    };
    const put = (a, geo, ro = 12) => { const q = new THREE.Mesh(geo, a.userData.mat); q.renderOrder = ro; q.raycast = () => {}; a.add(q); return q; };
    const grip = (a, pos, data, at = a) => { const pk = new THREE.Object3D(); pk.position.set(...pos); pk.userData = { ...data, arrow: a }; at.add(pk); this.handles.push(pk); };
    if (opts.params) {                   // ручки частей: синяя (или цвета оси) двусторонняя стрелка в точке части
      for (const ph of opts.params) {
        const a = part(HCOL[ph.axis]), g = new THREE.Group();
        g.userData.mat = a.userData.mat;
        put(g, new THREE.CylinderGeometry(0.22, 0.22, 2.2, 10));
        put(g, new THREE.ConeGeometry(0.7, 1.3, 14).translate(0, 1.75, 0));
        put(g, new THREE.ConeGeometry(0.7, 1.3, 14).rotateX(Math.PI).translate(0, -1.75, 0));
        if (ph.axis === 'z') g.rotation.x = Math.PI / 2; else if (ph.axis === 'x') g.rotation.z = Math.PI / 2;
        a.add(g);
        a.userData.anchor = new THREE.Vector3(...ph.pos);
        grip(a, [0, 0, 0], { kind: 'param', ph }, a);
        for (const t of [-1.7, 1.7]) grip(a, ph.axis === 'y' ? [0, t, 0] : ph.axis === 'x' ? [t, 0, 0] : [0, 0, t], { kind: 'param', ph }, a);
      }
      this.group.visible = true;
      return;
    }
    if (opts.move) for (const [axis, rx, rz] of [['x', 0, -Math.PI / 2], ['y', 0, 0], ['z', Math.PI / 2, 0]]) {
      const ar = part(HCOL[axis], rx, rz);          // стрелка: перемещение вдоль оси; хвост назад той же длины и толщины
      put(ar, new THREE.CylinderGeometry(0.018, 0.018, 2.72, 8));
      put(ar, new THREE.ConeGeometry(0.075, 0.24, 16).translate(0, 1.48, 0));
      for (const t of [-1.3, -1.12, 1.12, 1.3, 1.5]) grip(ar, [0, t, 0], { kind: 'move', axis });
      if (!opts.scale) continue;
      for (const sign of [1, -1]) {                 // кубики с обеих сторон: тянуть эту сторону, противоположная стоит
        const sc = part(HCOL[axis], rx, rz);
        put(sc, new THREE.BoxGeometry(0.12, 0.12, 0.12).translate(0, sign * 1.95, 0), 13);
        grip(sc, [0, sign * 1.95, 0], { kind: 'scale', axis, sign });
      }
    }
    if (opts.hub) {                                 // точка в центре: перемещение по горизонтали
      const hub = part(0xffc21a);
      put(hub, new THREE.SphereGeometry(0.085, 18, 12), 14);
      grip(hub, [0, 0, 0], { kind: 'hub' });
    }
    if (opts.planes) {                              // квадратики у центра: перемещение сразу по двум осям, заливка — переход цветов осей
      const S = 0.42, planes = { y: ['x', 'z', (a, b) => [a, 0, b]], z: ['x', 'y', (a, b) => [a, b, 0]], x: ['z', 'y', (a, b) => [0, b, a]] };
      for (const axis of ['y', 'z', 'x']) {
        const [ua, ub, at] = planes[axis], pl = part(0xffffff), flip = new THREE.Group();
        pl.userData.mat.vertexColors = true; pl.userData.mat.side = THREE.DoubleSide;
        pl.add(flip); flip.userData.mat = pl.userData.mat; pl.userData.flip = flip; pl.userData.axis = axis;
        const ca = new THREE.Color(HCOL[ua]), cb = new THREE.Color(HCOL[ub]), mix = ca.clone().lerp(cb, 0.5);
        const geo = new THREE.BufferGeometry().setFromPoints([[0, 0], [S, 0], [S, S], [0, 0], [S, S], [0, S]].map(([a, b]) => new THREE.Vector3(...at(a, b))));
        geo.setAttribute('color', new THREE.Float32BufferAttribute([mix, ca, mix, mix, mix, cb].flatMap((c) => [c.r, c.g, c.b]), 3));
        put(flip, geo, 11);
        for (const [a, b] of [[0.5, 0.5], [0.3, 0.7], [0.7, 0.3], [0.75, 0.75]]) grip(pl, at(a * S, b * S), { kind: 'plane', axis }, flip);
      }
    }
    if (opts.rot?.length) {                         // дуги поворота цветом своей оси; переходят в четверть, обращённую к зрителю
      const R = 0.88, arcGeo = () => new THREE.TorusGeometry(R, 0.022, 8, 28, Math.PI / 2);
      const arcs = { y: [() => arcGeo().rotateX(Math.PI / 2), (c, sn) => [c, 0, sn]], x: [() => arcGeo().rotateY(-Math.PI / 2), (c, sn) => [0, sn, c]], z: [arcGeo, (c, sn) => [c, sn, 0]] };
      for (const axis of opts.rot) {
        const arc = part(HCOL[axis]), flip = new THREE.Group();
        arc.userData.mat.side = THREE.DoubleSide;
        arc.add(flip); flip.userData.mat = arc.userData.mat; arc.userData.flip = flip; arc.userData.axis = axis;
        put(flip, arcs[axis][0]());
        for (const a of [20, 30, 40, 50, 60, 70]) {
          const r = THREE.MathUtils.degToRad(a);
          grip(arc, arcs[axis][1](R * Math.cos(r), R * Math.sin(r)), { kind: 'rot', axis }, flip);
        }
      }
    }
    this.group.visible = true;
  }
  clear() {
    this.setHot(null);
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => { o.geometry?.dispose(); if (o.material && !Array.isArray(o.material)) o.material.dispose(); });
    }
    this.handles = []; this.arrows = []; this.opts = null; this.drag = null;
    this.group.visible = false;
  }
  setPose(pos, quat) { this.group.position.copy(pos); this.group.quaternion.copy(quat); this.group.updateMatrixWorld(true); }
  axis(name) { return new THREE.Vector3(name === 'x' ? 1 : 0, name === 'y' ? 1 : 0, name === 'z' ? 1 : 0).applyQuaternion(this.group.quaternion).normalize(); }
  // каждый кадр: постоянный размер на экране и дуги лицом к зрителю
  update(camera) {
    if (!this.group.visible) return;
    const vh = (o) => {
      o.getWorldPosition(_v); camera.getWorldPosition(_c);
      if (camera.isOrthographicCamera) return (camera.top - camera.bottom) / camera.zoom;
      return _v.distanceTo(_c) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    };
    camera.getWorldPosition(_c);
    for (const a of this.arrows) {
      if (a.userData.anchor) { a.position.copy(a.userData.anchor); a.scale.setScalar(1); a.updateWorldMatrix(true, false); a.scale.setScalar(0.009 * vh(a)); continue; }
      a.scale.setScalar(this.size * vh(this.group));
      if (!a.userData.flip) continue;
      a.updateWorldMatrix(true, false);
      const p = a.worldToLocal(_v.copy(_c)), sx = p.x < 0 ? -1 : 1, sy = p.y < 0 ? -1 : 1, sz = p.z < 0 ? -1 : 1, ax = a.userData.axis;
      a.userData.flip.scale.set(ax === 'x' ? 1 : sx, ax === 'y' ? 1 : sy, ax === 'z' ? 1 : sz);
    }
    this.group.updateMatrixWorld(true);
  }
  // ручка под лучом (мировые координаты): ближайшая точка захвата в пределах своей «зоны»
  pick(ray) {
    if (!this.group.visible) return null;
    let best = null, bd = Infinity;
    for (const h of this.handles) {
      const a = h.userData.arrow, rad = a.userData.anchor ? a.scale.x * 2 : a.scale.x * 0.11;
      h.getWorldPosition(_v);
      const d = ray.distanceToPoint(_v), lim = rad * 2.4;
      if (d < lim && d < bd) { bd = d; best = h; }
    }
    return best;
  }
  setHot(h) {
    const t = h ? h.userData.arrow : null;
    if (t === this.hot) return;
    if (this.hot?.userData.mat) this.hot.userData.mat.color.set(this.hot.userData.col);
    this.hot = t;
    if (t?.userData.mat && !t.userData.mat.vertexColors) t.userData.mat.color.set(HOT);
    else if (t?.userData.mat) t.userData.mat.color.set(0x9a9a9a);   // квадратик с переходом цветов — темнеет
  }
  // начать перетаскивание ручкой h лучом ray. Возвращает описание или null.
  begin(h, ray) {
    const u = h.userData, C = this.group.position.clone();
    let d = null;
    if (u.kind === 'move' || u.kind === 'scale') { const dir = this.axis(u.axis); d = { dir, a0: C, s0: axisParam(ray, C, dir) }; }
    else if (u.kind === 'param') {
      const dir = this.axis(u.ph.axis), a0 = this.group.localToWorld(new THREE.Vector3(...u.ph.pos));
      d = { dir, a0, s0: axisParam(ray, a0, dir) };
    } else if (u.kind === 'plane' || u.kind === 'hub') {
      const N = u.kind === 'hub' ? new THREE.Vector3(0, 1, 0) : this.axis(u.axis);
      d = { N, C, p0: planeHit(ray, C, N) };
      if (!d.p0) return null;
    } else if (u.kind === 'rot') {
      const A = this.axis(u.axis), U = new THREE.Vector3().crossVectors(A, Math.abs(A.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
      d = { A, C, U, V: new THREE.Vector3().crossVectors(A, U) };
      d.a0 = this.angle(ray, d);
      if (d.a0 === null) return null;
    }
    if (!d) return null;
    Object.assign(d, { kind: u.kind, axis: u.axis, sign: u.sign, ph: u.ph, handle: h });
    this.drag = d;
    return d;
  }
  angle(ray, d) {
    const p = planeHit(ray, d.C, d.A);
    if (!p) return null;
    p.sub(d.C);
    return Math.atan2(p.dot(d.V), p.dot(d.U));
  }
  // текущее значение протяжки от начала: { delta: Vector3 } (move, plane, hub), { angle } (rot), { dl } (scale, param)
  // step — шаг в метрах, rotStep — шаг поворота в радианах (0 — без шага)
  value(ray, { step = 0.01, rotStep = Math.PI / 12 } = {}) {
    const d = this.drag; if (!d) return null;
    const sn = (v) => (step > 0 ? Math.round(v / step) * step : v);
    if (d.kind === 'move' || d.kind === 'scale' || d.kind === 'param') {
      const s = axisParam(ray, d.a0, d.dir);
      if (s === null) return null;
      if (d.s0 === null) { d.s0 = s; return null; }
      const dl = sn(s - d.s0);
      return d.kind === 'move' ? { delta: d.dir.clone().multiplyScalar(dl) } : { dl };
    }
    if (d.kind === 'plane' || d.kind === 'hub') {
      const p = planeHit(ray, d.C, d.N);
      if (!p) return null;
      const dv = p.sub(d.p0);
      if (d.kind === 'hub') return { delta: new THREE.Vector3(sn(dv.x), 0, sn(dv.z)) };
      const [ua, ub] = { y: ['x', 'z'], z: ['x', 'y'], x: ['z', 'y'] }[d.axis], A = this.axis(ua), B = this.axis(ub);
      return { delta: A.multiplyScalar(sn(dv.dot(A))).add(B.multiplyScalar(sn(dv.dot(B)))) };
    }
    if (d.kind === 'rot') {
      const a = this.angle(ray, d);
      if (a === null) return null;
      let da = a - d.a0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (d.turns === undefined) d.turns = 0, d.prev = da;
      if (da - d.prev > Math.PI) d.turns--; else if (da - d.prev < -Math.PI) d.turns++;   // больше полуоборота — без скачка
      d.prev = da;
      const ang = da + d.turns * 2 * Math.PI;
      return { angle: rotStep > 0 ? Math.round(ang / rotStep) * rotStep : ang, axisW: d.A, pivot: d.C };
    }
    return null;
  }
  end() { const d = this.drag; this.drag = null; return d; }
}
