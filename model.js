// model.js — процедурная модель правого глаза.
// Локальная система координат группы глаза: Y — оптическая ось (+Y вперёд, к роговице),
// −Z — вверх, +X — к носу. Все размеры в миллиметрах. Группа поворачивается на +90° вокруг X,
// после чего +Y локальный становится мировым +Z (к зрителю), а −Z локальный — мировым +Y (вверх).

const EyeModel = (() => {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const DEG = Math.PI / 180;

  // Базовые размеры
  const E = {
    R_sc: 11.5, R_sci: 10.7,            // склера наружная и внутренняя
    R_ch: 10.45,                         // хориоидея внутренняя
    R_ret: 10.2,                         // сетчатка внутренняя
    r_limb: 5.9, y_ora: 4.0,             // лимб, зубчатая линия
    R_ca: 7.8, c_ca: 4.69, apex: 12.49,  // роговица наружная
    R_cp: 7.0, c_cp: 4.94, apex_p: 11.94,// роговица внутренняя
    lens_eq_y: 7.4, lens_r: 4.5, lens_sa: 1.5, lens_sp: 2.5,
    pupil: 2.0,
    disc_dir: V3(Math.sin(15 * DEG), -Math.cos(15 * DEG), 0),
    UP: V3(0, 0, -1), DOWN: V3(0, 0, 1), NASAL: V3(1, 0, 0), TEMPORAL: V3(-1, 0, 0),
  };

  // Генератор случайных чисел с зерном, чтобы патология выглядела одинаково при каждом запуске
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ---------- Профили для тел вращения ----------
  // Дуга окружности с центром (cx, cy) радиуса R от угла a0 до a1 (радианы), n точек
  function arc(cx, cy, R, a0, a1, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
    return pts;
  }
  // Удлинение заднего сегмента (миопия): точки с y<0 смещаются назад
  function elongate(pts, e) {
    if (!e) return pts;
    return pts.map(([r, y]) => [r, y < 0 ? y - e * (-y / E.R_ret) : y]);
  }
  function lathe(pts, seg = 96) {
    const v = pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
    return new THREE.LatheGeometry(v, seg);
  }
  const angAt = (R, r) => Math.acos(Math.min(1, r / R)); // угол (от оси Y вперёд) на сфере радиуса R при радиусе r

  // Оболочка между двумя сферами радиусов Ro и Ri, от заднего полюса до радиуса r_end (у переднего края)
  function shellProfile(Ro, Ri, r_end, e) {
    const ao = angAt(Ro, r_end), ai = angAt(Ri, r_end);
    const pts = [];
    pts.push(...arc(0, 0, Ro, -Math.PI / 2, ao, 64));           // наружная дуга: от заднего полюса вперёд
    pts.push(...arc(0, 0, Ri, ai, -Math.PI / 2, 64));           // внутренняя дуга: назад
    pts.push(pts[0]);
    return elongate(pts, e);
  }
  // То же, но передний край задан по y (для хориоидеи и сетчатки — зубчатая линия)
  function shellProfileY(Ro, Ri, y_end, e) {
    const ao = Math.asin(y_end / Ro), ai = Math.asin(y_end / Ri);
    const pts = [];
    pts.push(...arc(0, 0, Ro, -Math.PI / 2, ao, 64));
    pts.push(...arc(0, 0, Ri, ai, -Math.PI / 2, 64));
    pts.push(pts[0]);
    return elongate(pts, e);
  }

  const geo = {};

  // limbScale — относительное увеличение роговицы (детский глаз, буфтальм): купол масштабируется вокруг вершины
  geo.sclera = (p) => lathe(shellProfile(E.R_sc, E.R_sci, E.r_limb * (p.limbScale || 1), p.elong));
  geo.choroid = (p) => lathe(shellProfileY(E.R_sci - 0.005, E.R_ch, E.y_ora, p.elong));
  geo.retina = (p) => lathe(shellProfileY(E.R_ch - 0.005, E.R_ret, E.y_ora, p.elong));

  geo.cornea = (p) => {
    const k = p.cone || 0, ks = p.limbScale || 1; // кератоконус 0..1, масштаб купола
    const bump = (r) => Math.exp(-(r / 2.2) * (r / 2.2));
    const ao = angAt(E.R_ca, E.r_limb), ai = angAt(E.R_cp, 5.5);
    const sc = ([r, y]) => [r * ks, E.apex - (E.apex - y) * ks];
    const outer = arc(0, E.c_ca, E.R_ca, ao, Math.PI / 2, 48).map(([r, y]) => [r, y + 1.3 * k * bump(r)]).map(sc);
    const inner = arc(0, E.c_cp, E.R_cp, Math.PI / 2, ai, 48).map(([r, y]) => [r, y + 1.75 * k * bump(r)]).map(sc);
    const pts = [...outer, ...inner, outer[0]];
    return lathe(pts);
  };

  // Трабекулярная сеть — клин в углу передней камеры; шлеммов канал — кольцевой сосуд рядом с ней
  geo.trabecular = () => lathe([[5.55, 9.28], [5.95, 8.95], [6.2, 8.98], [6.12, 9.18], [5.75, 9.36], [5.55, 9.28]]);
  geo.schlemm = () => lathe(arc(6.28, 9.12, 0.13, 0, Math.PI * 2, 14).concat([[6.28 + 0.13, 9.12]]), 128);
  // Задняя камера: между задней поверхностью радужки, цилиарным телом, связками и передней поверхностью хрусталика
  geo.posterior_chamber = () => {
    const a = lensArcs(1);
    const aP = Math.acos(E.pupil / a.Ra), aEq = Math.acos(4.4 / a.Ra);
    const lensFront = arc(0, a.ca, a.Ra, aP, aEq, 16); // от зрачкового края к экватору по хрусталику
    const pts = [...lensFront, [6.4, 7.86], [6.5, 8.62], [E.pupil + 0.2, 8.99], lensFront[0]];
    return lathe(pts);
  };
  // Пигментный эпителий и мембрана Бруха: тонкий тёмный слой между сетчаткой и хориоидеей
  geo.rpe = (p) => lathe(shellProfileY(E.R_ch + 0.02, E.R_ch - 0.04, E.y_ora, p.elong));

  geo.iris = (p) => {
    const rp = p.pupil || E.pupil, r1 = 6.1, b = p.bombe || 0; // b — выпячивание корня при закрытии угла
    const n = 10, front = [], back = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, r = rp + (r1 - rp) * t;
      const lift = b * Math.sin(Math.PI * Math.min(1, t * 1.15)) * 1.1;
      front.push([r, 9.45 - 0.4 * t + lift]);
      back.push([r, 9.0 - 0.4 * t + lift]);
    }
    // обход против часовой стрелки в плоскости (r, y): по задней поверхности от зрачка к корню, вверх, по передней обратно
    const pts = [...back, ...front.slice().reverse(), back[0]];
    return lathe(pts);
  };

  geo.ciliary = () => lathe([[6.2, 8.9], [6.5, 7.8], [7.0, 6.9], [9.6, 4.0], [9.92, 4.0], [8.86, 6.0], [7.1, 8.0], [5.94, 8.93], [6.2, 8.9]]);
  geo.zonule = () => lathe([[4.55, 7.3], [6.4, 7.6], [6.4, 7.85], [4.55, 7.5], [4.55, 7.3]]);

  // Хрусталик: задняя дуга от задней вершины к экватору, передняя от экватора к передней вершине
  function lensArcs(scale = 1, thick = scale) {
    const r = E.lens_r * scale, sa = E.lens_sa * thick, sp = E.lens_sp * thick;
    const Ra = (r * r + sa * sa) / (2 * sa), Rp = (r * r + sp * sp) / (2 * sp);
    const ya = E.lens_eq_y + sa, yp = E.lens_eq_y - sp;
    const ca = ya - Ra, cp = yp + Rp;
    const aEqA = Math.acos(r / Ra), aEqP = -Math.acos(r / Rp);
    return { back: arc(0, cp, Rp, -Math.PI / 2, aEqP, 40), front: arc(0, ca, Ra, aEqA, Math.PI / 2, 40), Ra, Rp, ca, cp };
  }
  geo.lens = (p) => { const a = lensArcs(1, (p && p.lensThick) || 1); return lathe([...a.back, ...a.front, a.back[0]]); };
  geo.lens_nucleus = (p) => { const t = (p && p.lensThick) || 1; const g = new THREE.SphereGeometry(1, 48, 32); g.scale(3.0, 1.35 * t, 3.0); g.translate(0, E.lens_eq_y - 0.1, 0); return g; };
  // Зонулярная (слоистая) врождённая катаракта: мутная оболочка между ядром и корой
  geo.lamellar = () => { const g = new THREE.SphereGeometry(1, 48, 32); g.scale(3.6, 1.6, 3.6); g.translate(0, E.lens_eq_y - 0.05, 0); return g; };
  // Задняя субкапсулярная бляшка: тонкая чашечка у задней капсулы радиусом rr
  geo.psc = (rr) => {
    const a = lensArcs(1);
    const aEnd = -Math.acos(Math.min(1, rr / a.Rp));
    const outer = arc(0, a.cp + 0.05, a.Rp, -Math.PI / 2, aEnd, 24);
    const inner = arc(0, a.cp + 0.05, a.Rp - 0.3, aEnd, -Math.PI / 2, 24);
    return lathe([...outer, ...inner, outer[0]]);
  };

  geo.vitreous = (p) => {
    const a = lensArcs(1);
    const yo = E.y_ora, ro = Math.sqrt(E.R_ret * E.R_ret - yo * yo);
    const pts = [];
    pts.push(...arc(0, 0, E.R_ret - 0.02, -Math.PI / 2, Math.asin(yo / E.R_ret), 64));
    pts.push([7.0, 6.9], [6.4, 7.6], [4.55, E.lens_eq_y]);
    pts.push(...a.back.slice().reverse()); // по задней поверхности хрусталика к оси
    pts.push(pts[0]);
    return lathe(elongate(pts, p.elong));
  };

  // Передняя камера: задняя стенка повторяет переднюю поверхность радужки (при бомбаже камера мельчает)
  geo.anterior_chamber = (p = {}) => {
    const a = lensArcs(1), b = p.bombe || 0, rp = p.pupil || E.pupil, r1 = 6.1;
    const aP = Math.acos(rp / a.Ra);
    const lensFront = arc(0, a.ca, a.Ra, Math.PI / 2, aP, 16);   // от оси к зрачковому краю по хрусталику
    const irisFront = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10, r = rp + (r1 - rp) * t; irisFront.push([r, 9.45 - 0.4 * t + b * Math.sin(Math.PI * Math.min(1, t * 1.15)) * 1.1]); }
    const ai = angAt(E.R_cp, 5.5);
    const corneaBack = arc(0, E.c_cp, E.R_cp, ai, Math.PI / 2, 40); // от угла к оси по задней роговице
    const pts = [...lensFront, ...irisFront, ...corneaBack, lensFront[0]];
    return lathe(pts);
  };

  // Макула — тонкое пятно на внутренней поверхности сетчатки у заднего полюса
  // Макула с фовеальной ямкой: парафовеальный валик утолщён, в центре углубление
  geo.macula = (p) => {
    const Ro = E.R_ret + 0.02, r = 1.9;
    const ao = -Math.PI / 2 + Math.asin(r / Ro);
    const pts = [...arc(0, 0, Ro, -Math.PI / 2, ao, 16)];
    for (let i = 0; i <= 24; i++) {
      const rr = r * (1 - i / 24);
      const Ri = (E.R_ret - 0.17) + 0.16 * Math.exp(-(rr / 0.5) * (rr / 0.5));
      pts.push([rr, -Math.sqrt(Math.max(0, Ri * Ri - rr * rr))]);
    }
    pts.push(pts[0]);
    return lathe(elongate(pts, p.elong), 64);
  };

  // Диск зрительного нерва в собственной системе: +Y объекта направлен наружу (вдоль оси нерва)
  geo.disc = (p) => {
    const rd = 0.9, c = p.cdr || 0.3, depth = 0.25 + 0.9 * c;
    const pts = [[0, depth], [c * rd * 0.55, depth * 0.85], [c * rd, -0.12], [rd, -0.12], [rd + 0.2, 0.15], [rd + 0.2, 0.8], [0, 0.8], [0, depth]];
    return lathe(pts, 64);
  };

  // ---------- Оболочки на сетке (веки, мышцы, отслойка) ----------
  // Строит замкнутое тело между поверхностями fOuter(u,v) и fInner(u,v).
  function shellFromGrid(fOuter, fInner, nu, nv) {
    const pos = [], idx = [];
    const push = (p) => { pos.push(p.x, p.y, p.z); return pos.length / 3 - 1; };
    const outer = [], inner = [];
    for (let i = 0; i <= nu; i++) { outer.push([]); inner.push([]); for (let j = 0; j <= nv; j++) { outer[i].push(fOuter(i / nu, j / nv)); inner[i].push(fInner(i / nu, j / nv)); } }
    const oi = outer.map(row => row.map(push));
    const ii = inner.map(row => row.map(push));
    const tri = (a, b, c, hint) => {
      const pa = V3(pos[3 * a], pos[3 * a + 1], pos[3 * a + 2]), pb = V3(pos[3 * b], pos[3 * b + 1], pos[3 * b + 2]), pc = V3(pos[3 * c], pos[3 * c + 1], pos[3 * c + 2]);
      const n = pb.clone().sub(pa).cross(pc.clone().sub(pa));
      if (n.dot(hint) >= 0) idx.push(a, b, c); else idx.push(a, c, b);
    };
    const quad = (a, b, c, d, hint) => { tri(a, b, c, hint); tri(a, c, d, hint); };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const hint = outer[i][j].clone().sub(inner[i][j]);
      quad(oi[i][j], oi[i + 1][j], oi[i + 1][j + 1], oi[i][j + 1], hint);
      quad(ii[i][j], ii[i + 1][j], ii[i + 1][j + 1], ii[i][j + 1], hint.clone().negate());
    }
    // боковые стенки с отдельными вершинами
    const side = (getO, getI, n, hintFn) => {
      const o = [], s = [];
      for (let k = 0; k <= n; k++) { o.push(push(getO(k))); s.push(push(getI(k))); }
      for (let k = 0; k < n; k++) quad(o[k], o[k + 1], s[k + 1], s[k], hintFn(k));
    };
    side(k => outer[k][0], k => inner[k][0], nu, k => outer[k][0].clone().sub(outer[k][1]));
    side(k => outer[k][nv], k => inner[k][nv], nu, k => outer[k][nv].clone().sub(outer[k][nv - 1]));
    side(k => outer[0][k], k => inner[0][k], nv, k => outer[0][k].clone().sub(outer[1][k]));
    side(k => outer[nu][k], k => inner[nu][k], nv, k => outer[nu][k].clone().sub(outer[nu - 1][k]));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Лента вдоль кривой (мышца): ширина w0→w1, толщина t, нормаль — радиальная от центра глаза
  function ribbon(points, w0, w1, t, nu = 48) {
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    const frame = (u) => {
      const c = curve.getPoint(u), tg = curve.getTangent(u).normalize();
      let n = c.clone().normalize(); n.sub(tg.clone().multiplyScalar(n.dot(tg))).normalize();
      const b = tg.clone().cross(n).normalize();
      return { c, n, b, w: w0 + (w1 - w0) * u };
    };
    const f = (sign) => (u, v) => { const F = frame(u); return F.c.clone().add(F.n.clone().multiplyScalar(sign * t / 2)).add(F.b.clone().multiplyScalar(F.w * (v - 0.5))); };
    return shellFromGrid(f(1), f(-1), nu, 6);
  }

  // Веки: оболочки между сферами R и R−t, край миндалевидной формы; drop — опущение верхнего века (птоз), мм
  function lidGeometry(upper, drop = 0) {
    const R = 13.7, t = 1.6, half = 11.2;
    const sgn = upper ? -1 : 1; // вверх = −Z
    const edge = (u) => sgn * ((upper ? 4.6 : 3.3) - (upper ? drop : 0)) * Math.pow(Math.sin(Math.PI * u), 0.85);
    const far = (u) => sgn * (3.0 + (upper ? 7.5 : 6.5) * Math.pow(Math.sin(Math.PI * u), 0.5));
    const onSphere = (Rr) => (u, v) => {
      const x = -half + 2 * half * u, z = edge(u) + (far(u) - edge(u)) * v;
      const y = Math.sqrt(Math.max(0.01, Rr * Rr - x * x - z * z));
      return V3(x, y, z);
    };
    return shellFromGrid(onSphere(R), onSphere(R - t), 40, 10);
  }

  // Точка глазного дна: u — к носу, v — вверх (мм в проекции), R — радиус; учитывает удлинение глаза
  let fundusElong = 0;
  const setFundusElong = (e) => { fundusElong = e || 0; };
  const fundus = (u, v, R) => {
    const p = V3(u, -R, -v).normalize().multiplyScalar(R);
    if (fundusElong && p.y < 0) p.y -= fundusElong * (-p.y / E.R_ret);
    return p;
  };
  // Отслоённый участок сетчатки (верхне-височный квадрант) и жидкость под ним
  function detachmentGeometries(lift) {
    // височная сторона, преимущественно нижний квадрант — попадает в горизонтальный разрез
    const u0 = -8.5, u1 = -1.0, v0 = -6.5, v1 = 3.0;
    const bump = (a, b) => Math.pow(Math.sin(Math.PI * a) * Math.sin(Math.PI * b), 0.8);
    const surf = (Rbase) => (a, b) => fundus(u0 + (u1 - u0) * a, v0 + (v1 - v0) * b, Rbase - lift * bump(a, b));
    const flap = shellFromGrid(surf(E.R_ret + 0.02), surf(E.R_ret - 0.22), 28, 24);
    const fluid = shellFromGrid((a, b) => fundus(u0 + (u1 - u0) * a, v0 + (v1 - v0) * b, E.R_ch - 0.02), surf(E.R_ret + 0.03), 28, 24);
    return { flap, fluid };
  }

  // ---------- Сосуды ----------
  function tube(points, radius, segs = 48, closed = false) {
    const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal', 0.5);
    return new THREE.TubeGeometry(curve, segs, radius, 8, closed);
  }
  function mergeGeos(list) {
    // простое объединение неиндексированных геометрий
    const parts = list.map(g => g.index ? g.toNonIndexed() : g);
    let n = 0; parts.forEach(g => n += g.attributes.position.count);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    parts.forEach(g => { pos.set(g.attributes.position.array, o * 3); if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return g;
  }

  // Сосудистое дерево сетчатки в координатах глазного дна (u — к носу, v — вверх), диск в (2.7, 0)
  const RET_TREE = {
    main: [
      [[2.7, 0], [2.3, 1.1], [1.1, 2.5], [-1.4, 3.6], [-4.4, 3.3], [-7.0, 1.8]],   // верхне-височная аркада
      [[2.7, 0], [2.3, -1.1], [1.1, -2.5], [-1.4, -3.6], [-4.4, -3.3], [-7.0, -1.8]],
      [[2.7, 0], [3.3, 1.1], [4.5, 2.7], [6.0, 4.5], [7.4, 6.2]],                  // верхне-носовая
      [[2.7, 0], [3.3, -1.1], [4.5, -2.7], [6.0, -4.5], [7.4, -6.2]],
    ],
    branch: [
      [[-1.4, 3.6], [-2.4, 5.4], [-3.6, 7.4]], [[-1.4, -3.6], [-2.4, -5.4], [-3.6, -7.4]],
      [[-4.4, 3.3], [-4.2, 1.6], [-3.0, 0.9]], [[-4.4, -3.3], [-4.2, -1.6], [-3.0, -0.9]],
      [[1.1, 2.5], [0.2, 4.6], [-0.4, 6.8]], [[1.1, -2.5], [0.2, -4.6], [-0.4, -6.8]],
      [[4.5, 2.7], [6.2, 2.2], [8.3, 1.6]], [[4.5, -2.7], [6.2, -2.2], [8.3, -1.6]],
      [[6.0, 4.5], [7.8, 4.0], [9.2, 3.2]], [[6.0, -4.5], [7.8, -4.0], [9.2, -3.2]],
    ],
  };
  function retinalTree(isVein, opts) {
    const R = E.R_ret - 0.14, dil = opts.dilate || 0, tort = opts.tortuosity || 0;
    const off = isVein ? [0.28, -0.22] : [0, 0];
    const rad = (isVein ? 0.16 : 0.12) * (1 + dil), radB = (isVein ? 0.10 : 0.075) * (1 + dil);
    const toPts = (list, k) => {
      const dense = [];
      const c2 = new THREE.CatmullRomCurve3(list.map(([u, v]) => V3(u + off[0], v + off[1], 0)), false, 'centripetal', 0.5);
      const n = 30;
      for (let i = 0; i <= n; i++) {
        const p = c2.getPoint(i / n);
        const w = tort * 0.22 * Math.sin(i * 0.85 + k) * Math.min(1, i / 4);
        dense.push(fundus(p.x + w, p.y - w * 0.6, R));
      }
      return dense;
    };
    const geos = [];
    RET_TREE.main.forEach((l, k) => geos.push(tube(toPts(l, k), rad, 40)));
    RET_TREE.branch.forEach((l, k) => geos.push(tube(toPts(l, k + 7), radB, 20)));
    return mergeGeos(geos);
  }

  // Точки на сосудистом дереве (для микроаневризм и т. п.)
  function treeSamplePoints(count, seed) {
    const r = rng(seed), pts = [];
    const all = [...RET_TREE.main, ...RET_TREE.branch];
    for (let i = 0; i < count; i++) {
      const l = all[Math.floor(r() * all.length)];
      const c2 = new THREE.CatmullRomCurve3(l.map(([u, v]) => V3(u, v, 0)));
      const p = c2.getPoint(r());
      const side = (r() - 0.5) * 0.9;
      pts.push(fundus(p.x + side, p.y + (r() - 0.5) * 0.9, E.R_ret - 0.1));
    }
    return pts;
  }

  // Ориентация цилиндра/трубки вдоль направления
  function orient(obj, dir) { obj.quaternion.setFromUnitVectors(V3(0, 1, 0), dir.clone().normalize()); }

  // ---------- Слёзоотводящие пути (правый глаз, нос = +X) ----------
  const LACRIMAL = { sac: V3(17.4, 5.4, 2.6), sacAxes: V3(2.1, 2.4, 5.6), ductEnd: V3(18.6, 2.8, 21.5), punctaUp: V3(9.6, 9.4, -1.3), punctaLow: V3(9.6, 9.4, 1.3) };
  function lacrimalDrainage() {
    const geos = [];
    const common = V3(16.2, 6.6, 0.2);
    geos.push(tube([LACRIMAL.punctaUp, V3(9.9, 9.0, -2.9), V3(12.5, 8.2, -1.6), common], 0.32, 24));
    geos.push(tube([LACRIMAL.punctaLow, V3(9.9, 9.0, 2.9), V3(12.5, 8.2, 1.8), common], 0.32, 24));
    geos.push(tube([common, V3(17.0, 6.0, 0.6), LACRIMAL.sac.clone().add(V3(0, 0, -2))], 0.4, 12));
    const sac = new THREE.SphereGeometry(1, 24, 16); sac.scale(LACRIMAL.sacAxes.x, LACRIMAL.sacAxes.y, LACRIMAL.sacAxes.z); sac.translate(LACRIMAL.sac.x, LACRIMAL.sac.y, LACRIMAL.sac.z);
    geos.push(sac);
    geos.push(tube([LACRIMAL.sac.clone().add(V3(0, 0, 4.5)), V3(17.8, 4.4, 11), V3(18.3, 3.4, 16.5), LACRIMAL.ductEnd], 1.05, 32));
    return mergeGeos(geos);
  }

  // ---------- Мышца, поднимающая верхнее веко ----------
  function levator() {
    const zinn = E.disc_dir.clone().multiplyScalar(36);
    return ribbon([V3(0, 10.4, -7.8), V3(0.5, 8.8, -12.4), V3(2.0, -2.0, -15.2), V3(6.0, -20, -11.5), zinn.clone().add(V3(1.0, 0, -5.5))], 17, 4, 1.2, 64);
  }

  // ---------- Костные стенки орбиты: воронка от края орбиты к вершине у зрительного канала ----------
  function orbitBone() {
    const rim = V3(0.5, 10.5, 0.5), apex = E.disc_dir.clone().multiplyScalar(38).add(V3(0, 0, 0.5));
    const radius = (t) => 3.2 + 18.5 * Math.pow(1 - t, 0.85);
    const surf = (dr) => (u, v) => {
      const th = 2 * Math.PI * u, c = rim.clone().lerp(apex, v), r = radius(v) + dr;
      return c.add(V3(Math.cos(th) * r * 1.12, 0, Math.sin(th) * r * 0.95));
    };
    return shellFromGrid(surf(0), surf(-1.6), 64, 24);
  }

  // ---------- Гиалоидный (клокетов) канал: от диска к задней поверхности хрусталика ----------
  function cloquet() {
    return tube([E.disc_dir.clone().multiplyScalar(E.R_ret - 0.1), V3(1.2, -5.5, 0.1), V3(0.3, 1.5, 0.05), V3(0, E.lens_eq_y - E.lens_sp - 0.05, 0)], 0.28, 32);
  }

  // ---------- Детские патологии ----------
  // Ретинобластома: гроздь узлов, растущая из сетчатки в стекловидное тело (нижне-височный квадрант)
  function retinoblastomaGeometry(size) {
    const r = rng(101), geos = [];
    const c = fundus(-3.0, -3.0, E.R_ret - 0.9 * size);
    const n = c.clone().normalize();
    for (let i = 0; i < 6; i++) {
      const off = V3((r() - 0.5) * 1.2, (r() - 0.5) * 1.2, (r() - 0.5) * 1.2).multiplyScalar(size);
      const g = new THREE.SphereGeometry(size * (0.55 + 0.45 * r()), 20, 14);
      const p = c.clone().add(off).sub(n.clone().multiplyScalar(0.2 * size * r()));
      g.translate(p.x, p.y, p.z); geos.push(g);
    }
    return mergeGeos(geos);
  }
  // Ретинопатия недоношенных: аваскулярная периферия (височная), демаркационный вал, экстраретинальные сосуды
  function ropGeometries(stage) {
    const th0 = Math.PI - 1.15, th1 = Math.PI + 1.15;                      // височный сектор (−X)
    const phiRidge = (stage >= 3 ? 84 : 92) * DEG, phiOra = 112 * DEG;    // чем тяжелее, тем ближе к центру граница
    const surf = (R) => (u, v) => sphere_pt(th0 + (th1 - th0) * u, phiRidge + (phiOra - phiRidge) * v, R);
    const zone = shellFromGrid(surf(E.R_ret - 0.03), surf(E.R_ret - 0.1), 48, 12);
    const ridgePts = [];
    for (let i = 0; i <= 40; i++) ridgePts.push(sphere_pt(th0 + (th1 - th0) * i / 40, phiRidge, E.R_ret - (stage >= 2 ? 0.28 : 0.12)));
    const ridge = tube(ridgePts, stage >= 2 ? 0.32 : 0.12, 60);
    const tuftPts = [];
    if (stage >= 3) for (let i = 0; i < 14; i++) tuftPts.push(sphere_pt(th0 + (th1 - th0) * (0.05 + 0.9 * i / 13), phiRidge - 1.5 * DEG, E.R_ret - 0.55));
    return { zone, ridge, tuftPts };
  }
  const sphere_pt = (theta, phi, R) => V3(R * Math.sin(phi) * Math.cos(theta), -R * Math.cos(phi), R * Math.sin(phi) * Math.sin(theta));

  // ---------- Сборка ----------
  // materialFactory(struct) → THREE.Material; возвращает описание мешей
  function build(materialFor, params) {
    const D = E.disc_dir;
    const meshes = {};
    const add = (id, geometry, opts = {}) => {
      const m = new THREE.Mesh(geometry, materialFor(id, opts));
      m.name = id; m.userData.id = id;
      if (opts.position) m.position.copy(opts.position);
      if (opts.dir) orient(m, opts.dir);
      if (opts.noCap) m.userData.noCap = true;
      meshes[id] = m;
      return m;
    };

    add('sclera', geo.sclera(params));
    add('choroid', geo.choroid(params));
    add('retina', geo.retina(params));
    add('macula', geo.macula(params));
    add('cornea', geo.cornea(params));
    add('iris', geo.iris(params));
    add('ciliary', geo.ciliary());
    add('zonule', geo.zonule());
    add('lens', geo.lens(params));
    add('lens_nucleus', geo.lens_nucleus(params));
    add('vitreous', geo.vitreous(params));
    add('anterior_chamber', geo.anterior_chamber(params));
    add('posterior_chamber', geo.posterior_chamber());
    add('trabecular', geo.trabecular());
    add('schlemm', geo.schlemm(), { noCap: true });
    add('rpe', geo.rpe(params));
    add('cloquet', cloquet(), { noCap: true });
    add('disc', geo.disc(params), { position: D.clone().multiplyScalar(E.R_ret + 0.02 + (params.elong || 0)), dir: D });

    // Зрительный нерв и оболочки: от склеры назад на 27 мм
    const L = 27, nerveStart = E.R_sc - 0.6 + (params.elong || 0);
    const nerve = new THREE.CylinderGeometry(1.75, 1.75, L, 32, 1, false);
    add('optic_nerve', nerve, { position: D.clone().multiplyScalar(nerveStart + L / 2), dir: D });
    const sheath = new THREE.CylinderGeometry(2.5, 2.5, L - 1, 32, 1, false);
    add('nerve_sheath', sheath, { position: D.clone().multiplyScalar(nerveStart + 1.2 + (L - 1) / 2), dir: D });

    // Мышцы
    const zinn = D.clone().multiplyScalar(36);
    const rectus = (id, m, s) => {
      const R = E.R_sc + 0.2, phi = angAt(E.R_sc, E.r_limb) + s / E.R_sc;
      const P0 = m.clone().multiplyScalar(R * Math.sin(phi)).add(V3(0, R * Math.cos(phi), 0));
      const P1 = m.clone().multiplyScalar(R * Math.sin(100 * DEG)).add(V3(0, R * Math.cos(100 * DEG), 0));
      const P2 = m.clone().multiplyScalar(9.5).add(V3(0, -14, 0));
      const P3 = zinn.clone().add(m.clone().multiplyScalar(3.2));
      add(id, ribbon([P0, P1, P2, P3], 10, 4.5, 1.4));
    };
    rectus('rectus_sup', E.UP, 7.7); rectus('rectus_inf', E.DOWN, 6.5);
    rectus('rectus_med', E.NASAL, 5.5); rectus('rectus_lat', E.TEMPORAL, 6.9);
    add('oblique_sup', ribbon([V3(-5.8, -4.0, -9.3), V3(1.5, 3.0, -11.4), V3(10.0, 9.0, -14.0), V3(9.0, -12, -11), zinn.clone().add(V3(1.5, 0, -3.0))], 6, 4, 1.3, 64));
    add('oblique_inf', ribbon([V3(-7.0, -5.3, 7.6), V3(2.0, 2.5, 11.6), V3(10.0, 7.0, 13.0)], 6, 5, 1.3, 40));

    // Придаточный аппарат и орбита
    add('lid_upper', lidGeometry(true, params.ptosis || 0));
    add('lid_lower', lidGeometry(false));
    const lac = new THREE.SphereGeometry(1, 32, 24); lac.scale(4.0, 2.2, 3.0);
    add('lacrimal', lac, { position: V3(-9.5, 3.5, -9.5) });
    add('lacrimal_drainage', lacrimalDrainage());
    add('levator', levator());
    add('orbit_bone', orbitBone());

    // ---- Сосуды ----
    const vesselOpts = { noCap: true };
    // Глазная артерия: от вершины орбиты под нервом вперёд, затем в нерв (ЦАС)
    const oa = [zinn.clone().add(V3(-1, -2, 3.2)), D.clone().multiplyScalar(30).add(V3(-1.2, 0, 3.0)), D.clone().multiplyScalar(22).add(V3(-1.5, 0, 2.6)), D.clone().multiplyScalar(14).add(V3(-1.2, 0, 2.6))];
    add('ophthalmic_artery', tube(oa, 0.55, 40), vesselOpts);
    const craPts = [D.clone().multiplyScalar(23).add(V3(-1.1, 0, 2.5)), D.clone().multiplyScalar(21.5).add(V3(-0.4, 0, 1.4)), D.clone().multiplyScalar(20).add(V3(-0.3, 0, 0.3)), D.clone().multiplyScalar(E.R_ret + 0.5).add(V3(-0.3, 0, 0.2)), D.clone().multiplyScalar(E.R_ret - 0.3).add(V3(-0.3, 0, 0.2))];
    add('cra', tube(craPts, 0.22, 40), vesselOpts);
    const crvPts = [D.clone().multiplyScalar(E.R_ret - 0.3).add(V3(0.3, 0, -0.2)), D.clone().multiplyScalar(E.R_ret + 0.5).add(V3(0.3, 0, -0.2)), D.clone().multiplyScalar(19).add(V3(0.3, 0, -0.3)), D.clone().multiplyScalar(20.5).add(V3(0.6, 0, -1.5)), D.clone().multiplyScalar(22).add(V3(1.2, 0, -3.2)), D.clone().multiplyScalar(26).add(V3(1.6, 0, -4.5))];
    add('crv', tube(crvPts, 0.28, 40), vesselOpts);
    add('retinal_arteries', retinalTree(false, {}), vesselOpts);
    add('retinal_veins', retinalTree(true, {}), vesselOpts);

    // Задние короткие цилиарные артерии: вокруг нерва в склеру
    const shortPCA = [];
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const side = V3(Math.cos(a), 0, Math.sin(a));       // перпендикуляр к D примерно (D в плоскости XY)
      const perp = side.clone().sub(D.clone().multiplyScalar(side.dot(D))).normalize();
      const p0 = D.clone().multiplyScalar(17).add(perp.clone().multiplyScalar(2.2)).add(V3(-0.8, 0, 1.5));
      const p1 = D.clone().multiplyScalar(13.5).add(perp.clone().multiplyScalar(3.2));
      const dirIn = D.clone().multiplyScalar(11.6).add(perp.clone().multiplyScalar(3.6 + (i % 2) * 1.2)).normalize();
      const p2 = dirIn.clone().multiplyScalar(E.R_sc + 0.1), p3 = dirIn.clone().multiplyScalar(E.R_ch + 0.1);
      shortPCA.push(tube([p0, p1, p2, p3], 0.13, 16));
    }
    add('pca_short', mergeGeos(shortPCA), vesselOpts);
    // Задние длинные: в горизонтальном меридиане между склерой и хориоидеей
    const longPCA = [];
    [1, -1].forEach(sx => {
      const pts = [D.clone().multiplyScalar(16).add(V3(sx * 2.5, 0, 0.8)), D.clone().multiplyScalar(12.5).add(V3(sx * 4.2, 0, 0.4))];
      const Rm = E.R_sci + 0.02;
      for (let a = -58; a <= 45; a += 12) { const t = a * DEG; pts.push(V3(sx * Rm * Math.cos(t), Rm * Math.sin(t), 0)); }
      longPCA.push(tube(pts, 0.14, 48));
    });
    add('pca_long', mergeGeos(longPCA), vesselOpts);
    // Передние цилиарные: от прямых мышц к лимбу
    const aca = [];
    const acaFor = (m, offs) => offs.forEach(o => {
      const side = V3(-m.z, 0, m.x).normalize();
      const dir = (t) => m.clone().multiplyScalar(Math.sin(t)).add(V3(0, Math.cos(t), 0)).add(side.clone().multiplyScalar(o * 0.03)).normalize();
      const pts = [dir(62 * DEG).multiplyScalar(E.R_sc + 1.1), dir(48 * DEG).multiplyScalar(E.R_sc + 0.5), dir(36 * DEG).multiplyScalar(E.R_sc + 0.05), dir(31 * DEG).multiplyScalar(E.R_sci - 0.2)];
      aca.push(tube(pts, 0.11, 16));
    });
    acaFor(E.UP, [-1, 1]); acaFor(E.DOWN, [-1, 1]); acaFor(E.NASAL, [-1, 1]); acaFor(E.TEMPORAL, [0]);
    add('aca', mergeGeos(aca), vesselOpts);
    // Вортикозные вены: 4 квадранта, выход через склеру позади экватора
    const vortex = [];
    const sovMid = V3(2.5, -12, -7.5), iovMid = V3(-2.5, -12, 8.5);
    [[1, -1], [-1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => {
      const q = V3(sx, 0, sz).normalize();
      const at = (R, y) => { const rr = Math.sqrt(R * R - y * y); return q.clone().multiplyScalar(rr).add(V3(0, y, 0)); };
      const pts = [at(E.R_ch + 0.12, 1.5), at(E.R_ch + 0.12, -1.5), at(E.R_sc + 0.2, -5.0), at(E.R_sc + 2.2, -8.5), (sz < 0 ? sovMid : iovMid).clone()];
      vortex.push(tube(pts, 0.28, 40));
    });
    add('vortex', mergeGeos(vortex), vesselOpts);
    add('sov', tube([V3(6.5, 7.0, -12.5), V3(3.5, -3, -9.5), sovMid, V3(2.0, -22, -5.5), zinn.clone().add(V3(-1.5, -1, -3.5))], 0.6, 48), vesselOpts);
    add('iov', tube([V3(-4.5, 5.0, 12.0), V3(-3.5, -4, 10.0), iovMid, V3(-1.5, -22, 6.0), zinn.clone().add(V3(-1.5, -1, 4.0))], 0.45, 48), vesselOpts);

    return meshes;
  }

  // Точки привязки подписей (локальные координаты)
  const LABELS = {
    cornea: V3(0, 12.5, -2), sclera: V3(-6, 6, -8.5), choroid: V3(-7.5, -7.3, -1.5), retina: V3(5.5, -8.4, -2.5), macula: V3(0, -10.3, -0.6), disc: V3(2.9, -10.0, 0.6),
    anterior_chamber: V3(0, 10.5, -1.5), iris: V3(-4.5, 9.4, -1.2), lens: V3(0, 7.5, -2.2), lens_nucleus: V3(0.5, 7.2, 0), ciliary: V3(7.8, 6.6, -1.3), zonule: V3(5.5, 7.6, -0.9), vitreous: V3(0, -2, -2.5),
    ophthalmic_artery: V3(4.5, -20, 3.0), cra: V3(4.6, -18.5, 0.9), retinal_arteries: V3(-4, -9.2, -3.5), pca_short: V3(6.5, -12.5, 2.5), pca_long: V3(-10.9, 0, 0), aca: V3(0, 10.3, -6.8), crv: V3(6.0, -19, -2.8), retinal_veins: V3(-4.5, -9.3, 3.6), vortex: V3(-8.5, -6, -8.5), sov: V3(2.3, -14, -7.5), iov: V3(-2.5, -14, 8.5),
    optic_nerve: V3(6.5, -25, -1), nerve_sheath: V3(8.5, -30, 2.5), lamina_cribrosa: V3(3.4, -11.6, 0.9),
    conjunctiva: V3(-8.5, 7.2, 3.5), trochlea: V3(10.8, 9.5, -14.5),
    rectus_sup: V3(0, -2, -12.6), rectus_inf: V3(0, -2, 12.6), rectus_med: V3(12.6, -2, 0), rectus_lat: V3(-12.6, -2, 0), oblique_sup: V3(4, 6, -12.5), oblique_inf: V3(4, 5, 12.5),
    lid_upper: V3(0, 8.5, -10.5), lid_lower: V3(0, 9.0, 8.5), lacrimal: V3(-9.5, 3.5, -12),
    trabecular: V3(6.3, 9.4, 1.2), schlemm: V3(-6.4, 9.2, 1.2), posterior_chamber: V3(-4.6, 8.3, 1.4), rpe: V3(7.6, -7.6, 1.2), cloquet: V3(0.5, -1.5, 0.8),
    levator: V3(1, 3, -15.5), lacrimal_drainage: V3(17.6, 5.4, 4), orbit_bone: V3(-19, -6, -10),
  };

  return { E, geo, build, LABELS, LACRIMAL, fundus, setFundusElong, rng, tube, mergeGeos, retinalTree, treeSamplePoints, detachmentGeometries, orient, shellFromGrid, lensArcs, lidGeometry, retinoblastomaGeometry, ropGeometries, sphere_pt };
})();
