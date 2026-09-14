// app.js — сцена, разрез, слои, подписи, состояния (взрослые и детские), возраст, подлёт камеры, «вид пациента».
(() => {
  const $ = (s) => document.querySelector(s);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const DEG = Math.PI / 180;
  const E = EyeModel.E;
  const byId = {}; STRUCTURES.forEach(s => byId[s.id] = s);
  const condById = {};
  CONDITIONS.forEach(c => {
    const v = CONDITION_VIEWS[c.id] || {}, ch = (typeof CONDITION_CHANGES !== 'undefined' && CONDITION_CHANGES[c.id]) || {};
    Object.assign(c, v, ch);
    const types = new Set([...Object.keys(v.byType || {}), ...Object.keys(ch.byType || {})]);
    if (types.size) { c.byType = {}; types.forEach(t => c.byType[t] = Object.assign({}, (v.byType || {})[t], (ch.byType || {})[t])); }
    c.group = c.group || 'adult'; condById[c.id] = c;
  });
  const isGlobe = (def) => ['shell', 'inner'].includes(def.group) || ['retinal_arteries', 'retinal_veins'].includes(def.id);

  // ---------- Тема ----------
  const isDark = () => {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true; if (t === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  };

  // ---------- Сцена ----------
  const view = $('#view');
  const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, preserveDrawingBuffer: true });
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  view.insertBefore(renderer.domElement, view.firstChild);
  const labelRenderer = new THREE.CSS2DRenderer({ element: $('#labels') });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.3, 500);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.1; controls.minDistance = 4; controls.maxDistance = 220;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5262, 0.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.85); keyLight.position.set(0.4, 0.6, 1); camera.add(keyLight); scene.add(camera);
  const backLight = new THREE.DirectionalLight(0xffffff, 0.3); backLight.position.set(-20, 30, -40); scene.add(backLight);

  // Группы: eyeGroup — локальная система модели (Y вперёд), внутри неё globeLocal — глазное яблоко (вращается при косоглазии,
  // масштабируется при буфтальме); detailGroup — меши из Blender в мировой системе, внутри globeWorld — то же для яблока.
  const eyeGroup = new THREE.Group(); eyeGroup.rotation.x = Math.PI / 2; scene.add(eyeGroup);
  const globeLocal = new THREE.Group(); eyeGroup.add(globeLocal);
  const detailGroup = new THREE.Group(); scene.add(detailGroup);
  const globeWorld = new THREE.Group(); detailGroup.add(globeWorld);
  const ghostGroup = new THREE.Group(); ghostGroup.rotation.x = Math.PI / 2; scene.add(ghostGroup);
  const toWorld = (v) => eyeGroup.localToWorld(v.clone());

  // ---------- Плоскость разреза и заглушки ----------
  const clipPlane = new THREE.Plane(V3(0, -1, 0), 0);
  const NO_CLIP = 1000;
  const clip = { on: true, axis: 'h', offset: 0, flip: false };
  const AXES = { h: V3(0, 1, 0), v: V3(1, 0, 0), f: V3(0, 0, 1) };
  function updateClipPlane() {
    const base = AXES[clip.axis].clone();
    const n = base.clone().multiplyScalar(clip.flip ? 1 : -1);
    if (clip.on) clipPlane.setFromNormalAndCoplanarPoint(n, base.multiplyScalar(clip.offset));
    else { clipPlane.normal.copy(n); clipPlane.constant = NO_CLIP; }
    caps.forEach(c => c.visible = clip.on && (!c.userData.owner || S[c.userData.owner].visible));
    const chk = $('#clipOn'); if (chk.checked !== clip.on) chk.checked = clip.on;
    $('#clipAxis').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.axis === clip.axis));
    const sl = $('#clipOffset'); if (parseFloat(sl.value) !== clip.offset) sl.value = clip.offset;
  }

  const S = {};
  const caps = [];
  let orderCounter = 10;

  function baseMaterial(def, opts) {
    const glassy = ['cornea', 'lens', 'vitreous', 'anterior_chamber', 'posterior_chamber', 'lens_nucleus', 'zonule', 'nerve_sheath', 'cloquet', 'conjunctiva', 'orbit_bone'].includes(def.id);
    return new THREE.MeshStandardMaterial({
      color: def.color, roughness: glassy ? 0.18 : 0.62, metalness: 0,
      transparent: def.opacity < 1, opacity: def.opacity,
      side: opts.noCap ? THREE.DoubleSide : THREE.FrontSide, clippingPlanes: [clipPlane],
    });
  }
  function makeStencil(mesh, order) {
    const base = { depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, transparent: true, clippingPlanes: [clipPlane] };
    const m0 = new THREE.MeshBasicMaterial(Object.assign({}, base, { side: THREE.BackSide, stencilFail: THREE.IncrementWrapStencilOp, stencilZFail: THREE.IncrementWrapStencilOp, stencilZPass: THREE.IncrementWrapStencilOp }));
    const m1 = new THREE.MeshBasicMaterial(Object.assign({}, base, { side: THREE.FrontSide, stencilFail: THREE.DecrementWrapStencilOp, stencilZFail: THREE.DecrementWrapStencilOp, stencilZPass: THREE.DecrementWrapStencilOp }));
    const a = new THREE.Mesh(mesh.geometry, m0); a.renderOrder = order; a.userData.stencil = true;
    const b = new THREE.Mesh(mesh.geometry, m1); b.renderOrder = order; b.userData.stencil = true;
    mesh.add(a); mesh.add(b);
    return [a, b];
  }
  function makeCap(def, order) {
    const col = new THREE.Color(def.color).multiplyScalar(0.82);
    const m = new THREE.MeshStandardMaterial({
      color: col, roughness: 0.75, metalness: 0, side: THREE.DoubleSide,
      transparent: true, opacity: def.opacity < 1 ? Math.min(1, def.opacity + 0.12) : 1, depthWrite: def.opacity >= 0.5,
      stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
    });
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), m);
    cap.renderOrder = order; cap.onAfterRender = () => renderer.clearStencil(); cap.userData.cap = true;
    scene.add(cap); caps.push(cap);
    return cap;
  }

  const params = { elong: 0, cone: 0, cdr: 0.3, bombe: 0, pupil: E.pupil, limbScale: 1, lensThick: 1, ptosis: 0, physHyper: 0, atrophy: 0 };
  const meshes = EyeModel.build((id, opts) => baseMaterial(byId[id], opts), params);
  const structureMeshes = [];
  STRUCTURES.forEach(def => {
    const id = def.id;
    let mesh = meshes[id];
    if (!mesh) {
      const noCap = def.group === 'vessels';
      mesh = new THREE.Mesh(new THREE.BufferGeometry(), baseMaterial(def, { noCap }));
      mesh.name = id; mesh.userData.id = id; if (noCap) mesh.userData.noCap = true;
    }
    (isGlobe(def) ? globeLocal : eyeGroup).add(mesh);
    const entry = { def, mesh, detail: null, useDetail: true, visible: true, stencils: [], cap: null, order: -1, baseOpacity: def.opacity };
    if (!mesh.userData.noCap) {
      entry.order = orderCounter; orderCounter += 2;
      entry.stencils = makeStencil(mesh, entry.order);
      entry.cap = makeCap(def, entry.order + 1);
      entry.cap.userData.owner = id;
    }
    if (def.opacity < 1) mesh.renderOrder = 1000;
    S[id] = entry; structureMeshes.push(mesh);
  });
  function setGeometry(id, g) {
    const e = S[id]; if (!e) return;
    const old = e.mesh.geometry; e.mesh.geometry = g; e.stencils.forEach(s => s.geometry = g); old.dispose();
  }

  // Детализированные меши из Blender
  function refreshVisibility(e) {
    const useD = !!e.detail && e.useDetail;
    e.mesh.visible = e.visible && !useD;
    if (e.detail) e.detail.visible = e.visible && useD;
    if (e.cap) e.cap.visible = e.visible && clip.on;
  }
  function setDetailUse(id, use) { const e = S[id]; if (!e || e.useDetail === use) return; e.useDetail = use; refreshVisibility(e); }
  function attachDetail(id, geometry) {
    const e = S[id]; if (!e) return;
    const m = new THREE.Mesh(geometry, e.mesh.material);
    m.name = id; m.userData.id = id; m.userData.noCap = e.mesh.userData.noCap; m.renderOrder = e.mesh.renderOrder;
    (isGlobe(e.def) ? globeWorld : detailGroup).add(m);
    if (!m.userData.noCap) makeStencil(m, e.order);
    e.detail = m; structureMeshes.push(m);
    refreshVisibility(e);
  }
  function loadDetail() {
    if (!window.EYE_GLB_B64 || !THREE.GLTFLoader) return;
    try {
      const bin = Uint8Array.from(atob(window.EYE_GLB_B64), c => c.charCodeAt(0)).buffer;
      new THREE.GLTFLoader().parse(bin, '', (gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const found = [];
        gltf.scene.traverse(o => { if (o.isMesh && byId[o.name]) { o.geometry.applyMatrix4(o.matrixWorld); attachDetail(o.name, o.geometry); found.push(o.name); } });
        console.info('Детализация загружена: ' + found.join(', '));
        applyConditions(); syncLayerUI();
      }, (err) => console.warn('Не удалось разобрать модель glTF', err));
    } catch (err) { console.warn('Ошибка загрузки детализации', err); }
  }

  // ---------- Подписи ----------
  const labels = {};
  Object.keys(EyeModel.LABELS).forEach(id => {
    if (!byId[id]) return;
    const div = document.createElement('div'); div.className = 'label'; div.textContent = byId[id].name.replace(/\s*\(.*\)/, '');
    div.addEventListener('click', (e) => { e.stopPropagation(); select(id); });
    const obj = new THREE.CSS2DObject(div); obj.position.copy(EyeModel.LABELS[id]);
    (isGlobe(byId[id]) ? globeLocal : eyeGroup).add(obj); labels[id] = obj;
  });
  const ui = { labels: true, rays: false, fly: true };
  const labelGroups = { shell: true, inner: true, vessels: false, nerves: true, muscles: false, adnexa: false, orbit: false };
  const tmpV = new THREE.Vector3();
  function updateLabels() {
    eyeGroup.updateMatrixWorld(true);
    const F = focusSet();
    Object.keys(labels).forEach(id => {
      const o = labels[id], vis = S[id].visible;
      let ok = ui.labels && vis && (labelGroups[S[id].def.group] || id === selectedId);
      if (F && id !== selectedId) ok = false; // в режиме проблемы вместо подписей работают выносные плашки
      if (ok) {
        const base = EyeModel.LABELS[id];
        o.position.copy(base);
        if (clip.on) {
          tmpV.copy(toWorld(base));
          const d = clipPlane.distanceToPoint(tmpV);
          if (d < -0.3) { tmpV.addScaledVector(clipPlane.normal, -2 * d); o.position.copy(eyeGroup.worldToLocal(tmpV)); }
        }
      }
      o.visible = ok; o.element.style.display = ok ? '' : 'none';
    });
  }
  // Маркер текущей проблемы
  const markerDiv = document.createElement('div'); markerDiv.className = 'marker';
  const markerObj = new THREE.CSS2DObject(markerDiv); markerObj.visible = false; eyeGroup.add(markerObj);

  // ---------- Ход лучей ----------
  const raysGroup = new THREE.Group(); eyeGroup.add(raysGroup); raysGroup.visible = false;
  const rayMat = new THREE.LineBasicMaterial({ color: 0xffc83d });
  const focusDot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc83d }));
  raysGroup.add(focusDot);
  const rayLines = [];
  for (let i = 0; i < 7; i++) { const l = new THREE.Line(new THREE.BufferGeometry(), rayMat); raysGroup.add(l); rayLines.push(l); }
  function updateRays() {
    const yF = -E.R_ret - (cond.ametropia.on ? 0 : params.physHyper * 0.35), yRet = -E.R_ret - params.elong;
    focusDot.position.set(0, yF, 0);
    rayLines.forEach((line, i) => {
      const x = -3.6 + i * 1.2;
      const yc = E.c_ca + Math.sqrt(Math.max(0, E.R_ca * E.R_ca - x * x));
      const a = EyeModel.lensArcs(1, params.lensThick);
      const xl = x * 0.86, yl = a.ca + Math.sqrt(Math.max(0, a.Ra * a.Ra - xl * xl));
      const jitter = params.cone * (i % 2 ? 0.6 : -0.6) * Math.abs(x) * 0.3;
      const t = (yRet - yl) / (yF - yl);
      const xe = xl + (0 + jitter - xl) * t;
      line.geometry.dispose(); line.geometry = new THREE.BufferGeometry().setFromPoints([V3(x, 34, 0), V3(x, yc, 0), V3(xl, yl, 0), V3(xe, yRet, 0)]);
    });
  }
  // Зрительная ось глаза и линия фиксации (для косоглазия)
  const gazeGroup = new THREE.Group(); gazeGroup.visible = false; eyeGroup.add(gazeGroup);
  const fixLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V3(0, -10.2, 0), V3(0, 44, 0)]), new THREE.LineBasicMaterial({ color: 0x7a8a99 }));
  const fixTarget = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc83d }));
  fixTarget.position.set(0, 44, 0); gazeGroup.add(fixLine); gazeGroup.add(fixTarget);
  const visualAxis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V3(0, -10.2, 0), V3(0, 44, 0)]), new THREE.LineBasicMaterial({ color: 0xd8342a }));
  visualAxis.visible = false; globeLocal.add(visualAxis);

  // ---------- Контур взрослого глаза (для сравнения с детским) ----------
  const ghostMat = new THREE.MeshStandardMaterial({ color: 0x6fb6cc, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [clipPlane], roughness: 0.4 });
  const ghostSclera = new THREE.Mesh(EyeModel.geo.sclera({}), ghostMat), ghostCornea = new THREE.Mesh(EyeModel.geo.cornea({}), ghostMat);
  ghostSclera.renderOrder = 1100; ghostCornea.renderOrder = 1100; ghostGroup.add(ghostSclera); ghostGroup.add(ghostCornea); ghostGroup.visible = false;

  // ---------- Патологические меши ----------
  const patho = {};
  const pmat = (color, opacity, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0, transparent: opacity < 1, opacity, clippingPlanes: [clipPlane], side: THREE.DoubleSide }, extra));
  function addPatho(id, geometry, material, count, parent = globeLocal) {
    const m = count ? new THREE.InstancedMesh(geometry, material, count) : new THREE.Mesh(geometry, material);
    m.visible = false; m.renderOrder = 1200; m.userData.patho = id; parent.add(m); patho[id] = m; return m;
  }
  addPatho('spokes', new THREE.BoxGeometry(2.7, 0.7, 0.55), pmat(0xf1e9d2, 0.8), 18);
  addPatho('psc', EyeModel.geo.psc(1.5), pmat(0xd9cfa8, 0.8));
  addPatho('lamellar', EyeModel.geo.lamellar(), pmat(0xece8dc, 0.85));
  addPatho('flap', new THREE.BufferGeometry(), pmat(0xe6c3b4, 0.95, { roughness: 0.4 }));
  addPatho('fluid', new THREE.BufferGeometry(), pmat(0xd8c98c, 0.5));
  addPatho('drusen', new THREE.SphereGeometry(0.11, 10, 8), pmat(0xf2d25a, 1), 80);
  addPatho('cnv', new THREE.BufferGeometry(), pmat(0xa8262a, 1));
  addPatho('cnvBlood', new THREE.CircleGeometry(1, 24), pmat(0x8f1c1c, 0.85), 1);
  addPatho('microan', new THREE.SphereGeometry(0.075, 8, 6), pmat(0xb01e1e, 1), 60);
  addPatho('dotHem', new THREE.CircleGeometry(0.34, 16), pmat(0x8f1c1c, 0.9), 24);
  addPatho('exudate', new THREE.CircleGeometry(0.16, 10), pmat(0xf5e27a, 1), 50);
  addPatho('nvd', new THREE.BufferGeometry(), pmat(0xb02a2a, 1));
  addPatho('flameHem', new THREE.CircleGeometry(0.4, 16), pmat(0x6e1010, 0.92), 110);
  // детские
  addPatho('rbMass', new THREE.BufferGeometry(), pmat(0xf3efd8, 1, { roughness: 0.45 }));
  addPatho('rbCalc', new THREE.SphereGeometry(0.11, 8, 6), pmat(0xffffff, 1), 24);
  addPatho('rbSeeds', new THREE.SphereGeometry(0.16, 8, 6), pmat(0xf3efd8, 0.95), 40);
  addPatho('traction', new THREE.BufferGeometry(), pmat(0xd9d2c4, 0.85));
  addPatho('ropZone', new THREE.BufferGeometry(), pmat(0xe9e2d6, 0.9));
  addPatho('ropRidge', new THREE.BufferGeometry(), pmat(0xd88a7a, 1));
  addPatho('ropTufts', new THREE.SphereGeometry(0.16, 8, 6), pmat(0xb32a2a, 1), 14);
  const leuko = addPatho('leukocoria', new THREE.CircleGeometry(E.pupil, 32), pmat(0xf7f3e2, 0.97, { emissive: 0x3a3a2a }));
  leuko.quaternion.setFromUnitVectors(V3(0, 0, 1), V3(0, 1, 0)); leuko.position.set(0, 8.97, 0);
  const sacGeo = new THREE.SphereGeometry(1, 20, 14); sacGeo.scale(EyeModel.LACRIMAL.sacAxes.x, EyeModel.LACRIMAL.sacAxes.y, EyeModel.LACRIMAL.sacAxes.z);
  addPatho('nldSac', sacGeo, pmat(0x6a8fbf, 0.95), 0, eyeGroup).position.copy(EyeModel.LACRIMAL.sac);
  addPatho('nldPlug', new THREE.SphereGeometry(1.3, 16, 12), pmat(0xb02020, 1), 0, eyeGroup).position.copy(EyeModel.LACRIMAL.ductEnd);
  const tearGeo = new THREE.SphereGeometry(1, 16, 12); tearGeo.scale(2.6, 0.9, 1.1);
  addPatho('tearLake', tearGeo, pmat(0xa9d1f0, 0.55), 0, eyeGroup).position.set(9.0, 9.9, 1.9);

  const fundus = EyeModel.fundus;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  function placeOnFundus(inst, i, u, v, R, sx, sy, rot) {
    _p.copy(fundus(u, v, R));
    const n = _p.clone().normalize();
    _q.setFromUnitVectors(V3(0, 0, 1), n.clone().negate());
    if (rot) _q.multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), rot));
    _s.set(sx, sy, 1); _m.compose(_p, _q, _s); inst.setMatrixAt(i, _m);
  }
  function placeSphere(inst, i, p, s) { _q.identity(); _s.set(s, s, s); _m.compose(p, _q, _s); inst.setMatrixAt(i, _m); }
  function commit(inst, count) { inst.count = count; inst.instanceMatrix.needsUpdate = true; inst.visible = count > 0; }
  function discPoints(n, cu, cv, r, seed) { const R = EyeModel.rng(seed), out = []; for (let i = 0; i < n; i++) { const a = R() * Math.PI * 2, d = r * Math.sqrt(R()); out.push([cu + d * Math.cos(a), cv + d * Math.sin(a), R()]); } return out; }
  const PTS = {
    drusen: discPoints(80, 0, 0, 2.3, 11), microan: EyeModel.treeSamplePoints(60, 21), dotHem: discPoints(24, 1.0, 0, 6.5, 31),
    exudate: discPoints(90, -0.6, 0.3, 2.4, 41).filter(p => Math.hypot(p[0] + 0.6, p[1] - 0.3) > 0.9).slice(0, 50), flame: discPoints(110, 1.2, 0, 8.2, 51),
    calc: discPoints(24, 0, 0, 1, 61), seeds: discPoints(40, 0, 0, 1, 71),
  };
  function tangleGeometry(cu, cv, radiusMm, R, seed, n, tubeR) {
    const rnd = EyeModel.rng(seed), geos = [];
    for (let k = 0; k < n; k++) {
      const pts = []; let u = cu + (rnd() - 0.5) * radiusMm, v = cv + (rnd() - 0.5) * radiusMm;
      for (let i = 0; i < 6; i++) { pts.push(fundus(u, v, R + (rnd() - 0.5) * 0.12)); u += (rnd() - 0.5) * radiusMm * 0.6; v += (rnd() - 0.5) * radiusMm * 0.6; }
      geos.push(EyeModel.tube(pts, tubeR, 24));
    }
    return EyeModel.mergeGeos(geos);
  }

  // ---------- Состояние ----------
  const cond = {};
  CONDITIONS.forEach(c => {
    const st = { on: false };
    if (c.options) st[c.options.id] = c.options.values[0].id;
    c.params.forEach(p => st[p.id] = p.def);
    cond[c.id] = st;
  });
  const age = { idx: AGE_STOPS.length - 1 };
  const stop = () => AGE_STOPS[age.idx];
  const isChild = () => age.idx < AGE_STOPS.length - 1;

  const focus = { cond: null };
  const GHOST = 0.1;
  function focusSet() {
    if (!focus.cond || !cond[focus.cond] || !cond[focus.cond].on) return null;
    return new Set(conditionView(condById[focus.cond]).affects);
  }
  function nextEnabledCond(except) {
    const list = CONDITIONS.map(c => c.id).filter(id => id !== except && cond[id].on);
    return list.length ? list[list.length - 1] : null;
  }
  const pulse = { until: 0 };
  function setFocus(id, opts = {}) {
    focus.cond = id;
    const on = !!id && cond[id].on;
    if (on) {
      const c = condById[id];
      conditionView(c).affects.forEach(a => setVisible(a, true));
      (c.show || []).forEach(a => setVisible(a, true)); // структуры для контекста, без подсветки
      if (c.group === 'child' && !isChild() && !opts.keepAge) setAgeByYears(c.typicalAge || 3);
      if (ui.fly && !opts.noFly) flyToCondition(id);
      pulse.until = performance.now() + 2600;
      // после подлёта проигрываем переход от нормы к выбранной степени, чтобы изменение было видно в движении
      if (opts.demo) setTimeout(() => { if (cond[id].on && focus.cond === id) demo(id); }, ui.fly && !opts.noFly ? 950 : 150);
    }
    document.querySelectorAll('.cond').forEach(b => b.classList.toggle('focus', on && b.dataset.cond === id));
    applyOpacity(); updateLabels(); updateMarker();
  }
  function conditionView(c) {
    let v = c; if (c.byType && cond[c.id][c.options.id] && c.byType[cond[c.id][c.options.id]]) v = Object.assign({}, c, c.byType[cond[c.id][c.options.id]]);
    return v;
  }
  function updateMarker() {
    const on = focus.cond && cond[focus.cond].on;
    const v = on ? conditionView(condById[focus.cond]) : null;
    markerObj.visible = !!(v && v.marker);
    markerDiv.style.display = markerObj.visible ? '' : 'none';
    if (v && v.marker) {
      markerObj.position.set(...v.marker); if (focus.cond === 'ametropia') markerObj.position.y -= params.elong;
      const c = condById[focus.cond], p = c.params[0];
      markerDiv.textContent = (v.short || c.name) + (p ? ' · ' + fmt(cond[c.id][p.id], p) : '');
    }
  }

  // ---------- Полёт камеры ----------
  let flight = null;
  function flyTo(pos, target, ms = 900) {
    const p0 = camera.position.clone(), t0 = controls.target.clone();
    const p1 = V3(...pos), t1 = V3(...target);
    const start = performance.now(); controls.enabled = false;
    flight = () => {
      const k = Math.min(1, (performance.now() - start) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      camera.position.lerpVectors(p0, p1, e); controls.target.lerpVectors(t0, t1, e); controls.update();
      if (k >= 1) { flight = null; controls.enabled = true; updateLabels(); }
    };
  }
  function flyToCondition(id) {
    const v = conditionView(condById[id]); if (!v.pos) return;
    if (v.clip) { Object.assign(clip, { flip: false }, v.clip); updateClipPlane(); }
    if (v.rays) { ui.rays = true; $('#raysOn').checked = true; raysGroup.visible = true; }
    const sc = globeScale();
    const t = V3(...v.target).multiplyScalar(sc), p = V3(...v.pos).sub(V3(...v.target)).multiplyScalar(sc).add(t);
    flyTo(p.toArray(), t.toArray());
    $('#views').querySelectorAll('button').forEach(x => x.classList.remove('on'));
  }
  function globeScale() { return eyeGroup.scale.x * globeLocal.scale.x; }

  // ---------- Возраст ----------
  function ageParams() {
    const st = stop(), s = st.al / 24;
    return { s, limb: (st.cornea / 11.8) / s, lensThick: 1 + 0.24 * Math.pow(Math.max(0, 1 - st.years / 18), 1.3), pupil: st.pupil, hyper: st.refraction };
  }
  function setAgeByYears(y) {
    let best = 0; AGE_STOPS.forEach((s, i) => { if (Math.abs(s.years - y) < Math.abs(AGE_STOPS[best].years - y)) best = i; });
    age.idx = best; $('#age').value = best; applyConditions();
  }
  function renderAgeInfo() {
    const st = stop(), a = ageParams();
    const refr = st.refraction > 0 ? `физиологическая дальнозоркость +${st.refraction.toFixed(1)} дптр` : 'рефракция около 0';
    $('#ageInfo').innerHTML = `<b>${st.label[0].toUpperCase() + st.label.slice(1)}</b> · длина оси ${st.al.toFixed(1)} мм · роговица ${st.cornea.toFixed(1)} мм · зрачок ${(st.pupil * 2).toFixed(1)} мм · ${refr}` +
      (st.note ? `<div class="agenote">${st.note}${isChild() ? ' Полупрозрачный контур — взрослый глаз для сравнения.' : ''}</div>` : '');
    $('#ageScale').textContent = isChild() ? `Масштаб глаза ${(a.s * 100).toFixed(0)} % от взрослого` : '';
  }

  const lensBase = new THREE.Color(byId.lens.color), lensYellow = new THREE.Color(0xd8b25a), lensWhite = new THREE.Color(0xe9e6dc);
  const nucBase = new THREE.Color(byId.lens_nucleus.color), nucBrown = new THREE.Color(0x8f6a2e);
  const nerveBase = new THREE.Color(byId.optic_nerve.color), nervePale = new THREE.Color(0xd6d6d0);
  const macBase = new THREE.Color(byId.macula.color), macEdema = new THREE.Color(0xb35a3a), macPale = new THREE.Color(0xd9b48f);
  const crvBase = new THREE.Color(byId.crv.color), crvDark = new THREE.Color(0x2a2470);
  const corneaBase = new THREE.Color(byId.cornea.color), corneaHaze = new THREE.Color(0xb9c4cc);
  let lastGeoKey = '', lastVeinKey = '', lastDetachKey = '', lastRbKey = '', lastRopKey = '';

  function applyConditions() {
    const c = cond;
    const ap = ageParams();
    // --- геометрические параметры ---
    const cg = c.congenital_glaucoma.on ? c.congenital_glaucoma.severity / 100 : 0;
    params.elong = c.ametropia.on ? -c.ametropia.diopters * 0.35 : 0;
    params.cone = c.keratoconus.on ? c.keratoconus.severity / 100 : 0;
    params.cdr = c.glaucoma.on ? c.glaucoma.cdr : (cg ? 0.3 + 0.55 * cg : 0.3);
    params.bombe = (c.glaucoma.on && c.glaucoma.type === 'closed') ? 0.55 : 0;
    params.pupil = ap.pupil;
    params.limbScale = ap.limb * (1 + 0.3 * cg);
    params.lensThick = ap.lensThick;
    params.ptosis = c.ptosis.on ? c.ptosis.drop : 0;
    params.physHyper = ap.hyper;
    params.atrophy = c.glaucoma.on ? Math.min(1, (c.glaucoma.cdr - 0.3) / 0.65) : cg * 0.6; // истончение зрительного нерва
    // масштаб: возраст — весь глаз с орбитой, буфтальм — только яблоко
    eyeGroup.scale.setScalar(ap.s); detailGroup.scale.setScalar(ap.s);
    const g = 1 + 0.22 * cg; globeLocal.scale.setScalar(g); globeWorld.scale.setScalar(g);
    ghostGroup.visible = isChild() || params.elong !== 0; // контур нормального глаза для сравнения
    // косоглазие: поворот яблока вокруг вертикальной оси; медиальная и латеральная мышцы напрягаются/растягиваются
    const angle = c.strabismus.on ? c.strabismus.angle * DEG : 0;
    globeLocal.rotation.z = -angle; globeWorld.rotation.y = angle;
    gazeGroup.visible = c.strabismus.on; visualAxis.visible = c.strabismus.on;
    const sk = c.strabismus.on ? c.strabismus.angle / 30 : 0;
    const tight = new THREE.Color(0x7e1f1e), slack = new THREE.Color(0xdcaaa6);
    S.rectus_med.mesh.material.color.setHex(byId.rectus_med.color).lerp(sk > 0 ? tight : slack, Math.abs(sk));
    S.rectus_lat.mesh.material.color.setHex(byId.rectus_lat.color).lerp(sk > 0 ? slack : tight, Math.abs(sk));
    [S.rectus_med, S.rectus_lat].forEach(e => e.cap.material.color.copy(e.mesh.material.color).multiplyScalar(0.85));
    // птоз: леватор бледнеет
    S.levator.mesh.material.color.setHex(byId.levator.color).lerp(new THREE.Color(0xe0c2bd), Math.min(1, params.ptosis / 7));
    S.levator.cap.material.color.copy(S.levator.mesh.material.color).multiplyScalar(0.85);
    // где детализация не может деформироваться — процедурная форма
    ['choroid', 'retina'].forEach(id => setDetailUse(id, params.elong === 0));
    setDetailUse('sclera', params.elong === 0 && Math.abs(params.limbScale - 1) < 1e-3);
    setDetailUse('iris', params.bombe === 0 && Math.abs(params.pupil - E.pupil) < 1e-3);
    setDetailUse('lid_upper', params.ptosis === 0);
    setDetailUse('optic_nerve', params.elong === 0 && params.atrophy === 0);
    setDetailUse('nerve_sheath', params.elong === 0);
    const key = [params.elong, params.cone, params.cdr, params.bombe, params.pupil, params.limbScale, params.lensThick, params.ptosis, params.atrophy].join('|');
    if (key !== lastGeoKey) {
      const prev = lastGeoKey.split('|');
      const elongChanged = prev[0] !== String(params.elong);
      lastGeoKey = key;
      EyeModel.setFundusElong(params.elong);
      if (elongChanged) { lastVeinKey = ''; lastDetachKey = ''; lastRbKey = ''; lastRopKey = ''; }
      setGeometry('sclera', EyeModel.geo.sclera(params));
      setGeometry('choroid', EyeModel.geo.choroid(params));
      setGeometry('retina', EyeModel.geo.retina(params));
      setGeometry('rpe', EyeModel.geo.rpe(params));
      setGeometry('vitreous', EyeModel.geo.vitreous(params));
      setGeometry('macula', EyeModel.geo.macula(params));
      setGeometry('cornea', EyeModel.geo.cornea(params));
      setGeometry('iris', EyeModel.geo.iris(params));
      setGeometry('anterior_chamber', EyeModel.geo.anterior_chamber(params));
      setGeometry('lens', EyeModel.geo.lens(params));
      setGeometry('lens_nucleus', EyeModel.geo.lens_nucleus(params));
      setGeometry('disc', EyeModel.geo.disc(params));
      setGeometry('lid_upper', EyeModel.lidGeometry(true, params.ptosis));
      setGeometry('optic_nerve', EyeModel.geo.optic_nerve(params));
      setGeometry('nerve_sheath', EyeModel.geo.nerve_sheath(params));
      S.disc.mesh.position.copy(E.disc_dir).multiplyScalar(E.R_ret + 0.02 + params.elong);
      updateRays();
    }
    // --- глаукома и врождённая глаукома ---
    const gk = c.glaucoma.on ? Math.min(1, (c.glaucoma.cdr - 0.3) / 0.65) : cg * 0.6;
    const kIop = c.glaucoma.on ? Math.max(0, Math.min(1, (c.glaucoma.iop - 21) / 24)) : 0;
    const closed = c.glaucoma.on && c.glaucoma.type === 'closed';
    const attack = closed ? Math.max(0, Math.min(1, (c.glaucoma.iop - 28) / 15)) : 0; // острый приступ
    S.optic_nerve.mesh.material.color.copy(nerveBase).lerp(nervePale, Math.min(1, gk * 1.1));
    S.disc.mesh.material.color.setHex(byId.disc.color).lerp(new THREE.Color(0xf5e2cf), gk * 0.7);
    // трабекула и шлеммов канал засоряются с ростом ВГД (открытоугольная форма), недоразвиты при врождённой глаукоме
    S.trabecular.mesh.material.color.setHex(byId.trabecular.color).lerp(new THREE.Color(0x7f5b3c), closed ? 0 : kIop).lerp(new THREE.Color(0x9aa0a8), cg);
    S.trabecular.cap.material.color.copy(S.trabecular.mesh.material.color).multiplyScalar(0.85);
    S.schlemm.mesh.material.color.setHex(byId.schlemm.color).lerp(new THREE.Color(0x24285a), closed ? 0 : kIop);
    // решётчатая пластинка прогибается назад под давлением
    if (S.lamina_cribrosa.detail) S.lamina_cribrosa.detail.position.set(0.259, 0, -0.966).multiplyScalar(0.5 * Math.max(kIop, gk * 0.6));
    // роговица отекает при врождённой глаукоме и остром приступе; склера краснеет при приступе
    const haze = Math.max(cg * 0.9, attack * 0.8);
    const corneaM = S.cornea.mesh.material;
    corneaM.color.copy(corneaBase).lerp(corneaHaze, haze);
    S.cornea.baseOpacity = byId.cornea.opacity + 0.5 * haze;
    S.sclera.mesh.material.color.setHex(byId.sclera.color).lerp(new THREE.Color(0xefcfc8), attack);
    S.sclera.cap.material.color.copy(S.sclera.mesh.material.color).multiplyScalar(0.85);

    // --- катаракта взрослая и врождённая ---
    const cat = c.cataract.on ? c.cataract.severity / 100 : 0, ct = c.cataract.type;
    const cc = c.congenital_cataract.on ? c.congenital_cataract.severity / 100 : 0, cct = c.congenital_cataract.type;
    const lensM = S.lens.mesh.material, nucM = S.lens_nucleus.mesh.material;
    lensM.color.copy(lensBase).lerp(lensYellow, cat * (ct === 'nuclear' ? 0.9 : 0.35));
    if (cc && cct === 'total') lensM.color.lerp(lensWhite, cc);
    S.lens.baseOpacity = byId.lens.opacity + 0.42 * cat * (ct === 'nuclear' ? 1 : 0.5) + (cct === 'total' ? 0.58 * cc : 0.15 * cc);
    S.lens.cap.material.color.copy(lensM.color).multiplyScalar(0.85);
    const nucK = cat * (ct === 'nuclear' ? 1 : 0.2) + (cct === 'nuclear' ? cc : 0);
    nucM.color.copy(nucBase).lerp(cct === 'nuclear' && cc ? lensWhite : nucBrown, Math.min(1, nucK));
    S.lens_nucleus.baseOpacity = byId.lens_nucleus.opacity + 0.88 * Math.min(1, cat * (ct === 'nuclear' ? 1 : 0.12) + (cct === 'nuclear' ? cc : 0));
    S.lens_nucleus.cap.material.color.copy(nucM.color).multiplyScalar(0.85);
    patho.lamellar.visible = cct === 'lamellar' && cc > 0; patho.lamellar.material.opacity = 0.25 + 0.7 * cc;
    const spokes = patho.spokes, nSp = ct === 'cortical' ? Math.round(cat * 18) : 0;
    if (nSp) {
      const rnd = EyeModel.rng(7);
      for (let i = 0; i < nSp; i++) {
        const a = rnd() * Math.PI * 2, len = 0.6 + 0.4 * cat;
        _p.set(Math.cos(a) * (4.5 - 1.35 * len), E.lens_eq_y + (rnd() - 0.5) * 0.6, Math.sin(a) * (4.5 - 1.35 * len));
        _q.setFromAxisAngle(V3(0, 1, 0), -a); _s.set(len, 1, 1); _m.compose(_p, _q, _s); spokes.setMatrixAt(i, _m);
      }
      spokes.material.opacity = 0.35 + 0.6 * cat;
    }
    commit(spokes, nSp);
    const pscOn = ct === 'psc' && cat > 0;
    if (pscOn) { patho.psc.geometry.dispose(); patho.psc.geometry = EyeModel.geo.psc(0.7 + 2.4 * cat); patho.psc.material.opacity = 0.3 + 0.7 * cat; }
    patho.psc.visible = pscOn;

    // --- ретинобластома ---
    const rb = c.retinoblastoma.on ? c.retinoblastoma.severity / 100 : 0;
    const rbk = rb.toFixed(2);
    if (rbk !== lastRbKey) { lastRbKey = rbk; if (rb > 0) { patho.rbMass.geometry.dispose(); patho.rbMass.geometry = EyeModel.retinoblastomaGeometry(0.5 + 2.2 * rb); } }
    patho.rbMass.visible = rb > 0;
    const nCalc = rb > 0.2 ? Math.min(Math.round(rb * 24), PTS.calc.length) : 0;
    if (nCalc) { const size = 0.5 + 2.2 * rb, cc0 = fundus(-3, -3, E.R_ret - 0.9 * size); for (let i = 0; i < nCalc; i++) { const p = PTS.calc[i]; placeSphere(patho.rbCalc, i, cc0.clone().add(V3((p[0]) * size * 0.9, (p[1]) * size * 0.9, (p[2] - 0.5) * size * 1.2)), 0.6 + p[2]); } }
    commit(patho.rbCalc, nCalc);
    // отсевы опухоли в стекловидное тело при большом размере
    const nSeed = rb > 0.5 ? Math.min(Math.round((rb - 0.5) * 40), PTS.seeds.length) : 0;
    if (nSeed) { const size = 0.5 + 2.2 * rb, c0 = fundus(-3, -3, E.R_ret - 0.9 * size); for (let i = 0; i < nSeed; i++) { const p = PTS.seeds[i]; placeSphere(patho.rbSeeds, i, c0.clone().multiplyScalar(0.85 - 0.55 * p[2]).add(V3(p[0] * 3, p[1] * 3, (p[2] - 0.5) * 4)), 0.5 + p[2]); } }
    commit(patho.rbSeeds, nSeed);
    // лейкокория: белый зрачок при плотной катаракте или крупной опухоли
    patho.leukocoria.visible = (cc > 0.5 && cct !== 'nuclear') || rb > 0.35;
    patho.leukocoria.material.opacity = Math.min(0.97, 0.5 + Math.max(cc, rb) * 0.5);

    // --- ретинопатия недоношенных ---
    const ropStage = c.rop.on ? c.rop.stage : 0;
    if (String(ropStage) !== lastRopKey) {
      lastRopKey = String(ropStage);
      if (ropStage) {
        const g2 = EyeModel.ropGeometries(ropStage);
        patho.ropZone.geometry.dispose(); patho.ropZone.geometry = g2.zone;
        patho.ropRidge.geometry.dispose(); patho.ropRidge.geometry = g2.ridge;
        patho.ropRidge.material.color.setHex(ropStage >= 2 ? 0xd88a7a : 0xe8e0d0);
        g2.tuftPts.forEach((p, i) => placeSphere(patho.ropTufts, i, p, 1)); commit(patho.ropTufts, g2.tuftPts.length);
      } else commit(patho.ropTufts, 0);
    }
    patho.ropZone.visible = ropStage > 0; patho.ropRidge.visible = ropStage > 0;

    // --- отслойка (взрослая и как стадии 4–5 РН) ---
    const det = c.detachment.on ? c.detachment.extent / 100 : 0;
    const lift = Math.max(det > 0 ? 0.4 + 3.0 * det : 0, ropStage >= 4 ? (ropStage === 4 ? 2.2 : 3.6) : 0);
    const dk = lift.toFixed(2);
    if (dk !== lastDetachKey) {
      lastDetachKey = dk;
      if (lift > 0) {
        const g3 = EyeModel.detachmentGeometries(lift); patho.flap.geometry.dispose(); patho.flap.geometry = g3.flap; patho.fluid.geometry.dispose(); patho.fluid.geometry = g3.fluid;
        // витреоретинальные тяжи от лоскута в стекловидное тело
        const top = fundus(-4.75, -1.75, E.R_ret - lift - 0.15);
        patho.traction.geometry.dispose();
        patho.traction.geometry = EyeModel.mergeGeos([0.7, -0.6].map(o => EyeModel.tube([top.clone().add(V3(o, 0, o * 0.4)), top.clone().multiplyScalar(0.62).add(V3(o * 1.5, 1.5, 0)), V3(0.6 + o, -1.0, 0.4)], 0.07, 20)));
      }
    }
    patho.flap.visible = lift > 0; patho.fluid.visible = lift > 0; patho.traction.visible = lift > 0.9;

    // --- ВМД ---
    const amd = c.amd.on ? c.amd.severity / 100 : 0, wet = c.amd.type === 'wet';
    const nDr = Math.min(Math.round(amd * (wet ? 30 : 80)), PTS.drusen.length, patho.drusen.instanceMatrix.count);
    for (let i = 0; i < nDr; i++) { const p = PTS.drusen[i]; placeSphere(patho.drusen, i, fundus(p[0], p[1], E.R_ret - 0.03), 0.6 + p[2] * 0.9); }
    commit(patho.drusen, nDr);
    if (wet && amd > 0) {
      patho.cnv.geometry.dispose(); patho.cnv.geometry = tangleGeometry(0.2, -0.1, 1.2 + 1.6 * amd, E.R_ret + 0.08, 5, 4 + Math.round(amd * 6), 0.06);
      placeOnFundus(patho.cnvBlood, 0, 0.4, -0.3, E.R_ret - 0.06, 0.5 + 1.6 * amd, 0.4 + 1.2 * amd, 0.4); commit(patho.cnvBlood, 1);
      patho.cnv.visible = true;
    } else { patho.cnv.visible = false; commit(patho.cnvBlood, 0); }

    // --- диабетическая ретинопатия ---
    const dr = c.diabetic.on ? c.diabetic.severity / 100 : 0;
    const cap = (inst, pts, n) => Math.min(n, pts.length, inst.instanceMatrix.count);
    const nMa = cap(patho.microan, PTS.microan, Math.round(dr * 60)), nDh = cap(patho.dotHem, PTS.dotHem, Math.round(Math.max(0, dr - 0.2) * 30)), nEx = cap(patho.exudate, PTS.exudate, Math.round(Math.max(0, dr - 0.3) * 70));
    for (let i = 0; i < nMa; i++) placeSphere(patho.microan, i, PTS.microan[i], 1);
    commit(patho.microan, nMa);
    for (let i = 0; i < nDh; i++) { const p = PTS.dotHem[i]; placeOnFundus(patho.dotHem, i, p[0], p[1], E.R_ret - 0.05, 0.6 + p[2] * 0.8, 0.5 + p[2] * 0.6, p[2] * 3); }
    commit(patho.dotHem, nDh);
    for (let i = 0; i < nEx; i++) { const p = PTS.exudate[i]; placeOnFundus(patho.exudate, i, p[0], p[1], E.R_ret - 0.04, 0.7 + p[2] * 0.8, 0.7 + p[2] * 0.8, 0); }
    commit(patho.exudate, nEx);
    if (dr > 0.7) { patho.nvd.geometry.dispose(); patho.nvd.geometry = tangleGeometry(2.7, 0.2, 1.4 + (dr - 0.7) * 5, E.R_ret - 0.2, 9, 6, 0.05); patho.nvd.visible = true; } else patho.nvd.visible = false;
    // кровь в стекловидном теле при тяжёлой стадии
    const vh = Math.max(0, (dr - 0.85) / 0.15);
    S.vitreous.mesh.material.color.setHex(byId.vitreous.color).lerp(new THREE.Color(0x8a2a2a), vh);
    S.vitreous.baseOpacity = byId.vitreous.opacity + 0.35 * vh;
    S.vitreous.cap.material.color.copy(S.vitreous.mesh.material.color).multiplyScalar(0.85);

    // --- сосуды сетчатки: тромбоз ЦВС, диабет, плюс-болезнь при РН ---
    const crvo = c.crvo.on ? c.crvo.severity / 100 : 0;
    const ropK = ropStage >= 2 ? ropStage / 5 : 0;
    const vDil = Math.max(1.4 * crvo, dr > 0.5 ? 0.5 * dr : 0, 0.3 * ropK), vTort = Math.max(crvo, 0.4 * ropK);
    const aDil = 0.2 * ropK, aTort = 0.35 * ropK;
    const vk = [vDil.toFixed(2), vTort.toFixed(2), aDil.toFixed(2), aTort.toFixed(2)].join('|');
    if (vk !== lastVeinKey) {
      lastVeinKey = vk;
      setGeometry('retinal_veins', EyeModel.retinalTree(true, { dilate: vDil, tortuosity: vTort }));
      setGeometry('retinal_arteries', EyeModel.retinalTree(false, { dilate: aDil, tortuosity: aTort }));
    }
    setDetailUse('retinal_veins', params.elong === 0 && vDil === 0 && vTort === 0);
    setDetailUse('retinal_arteries', params.elong === 0 && aDil === 0 && aTort === 0);
    S.crv.mesh.material.color.copy(crvBase).lerp(crvDark, crvo);
    S.retinal_veins.mesh.material.color.setHex(byId.retinal_veins.color).lerp(crvDark, crvo * 0.8);
    const nFl = Math.min(Math.round(crvo * 80), PTS.flame.length, patho.flameHem.instanceMatrix.count);
    for (let i = 0; i < nFl; i++) { const p = PTS.flame[i]; const ang = Math.atan2(p[1], p[0] - 2.7); placeOnFundus(patho.flameHem, i, p[0], p[1], E.R_ret - 0.05, 0.35 + p[2] * 0.5, 1.2 + p[2] * 1.4, ang); }
    commit(patho.flameHem, nFl);

    // --- макула: отёк при диабете/тромбозе/влажной ВМД; бледность при амблиопии условна ---
    const edema = Math.min(1, (dr > 0.4 ? dr * 0.8 : 0) + crvo * 0.9 + (wet ? amd : 0));
    const amb = c.amblyopia.on ? c.amblyopia.severity / 100 : 0;
    const atrophy = (!wet && amd > 0.5) ? (amd - 0.5) * 2 : 0; // географическая атрофия при сухой ВМД
    S.macula.mesh.material.color.copy(macBase).lerp(macEdema, edema).lerp(new THREE.Color(0xe8d9c2), atrophy).lerp(macPale, amb * 0.8);
    S.macula.cap.material.color.copy(S.macula.mesh.material.color).multiplyScalar(0.85);

    // --- непроходимость носослёзного канала ---
    const nld = c.nld_obstruction.on ? c.nld_obstruction.severity / 100 : 0;
    patho.nldSac.visible = nld > 0; patho.nldSac.scale.setScalar(1.05 + 0.7 * nld);
    patho.nldPlug.visible = nld > 0; patho.tearLake.visible = nld > 0; patho.tearLake.scale.setScalar(0.5 + nld);

    applyOpacity();
    renderPatientView();
    renderConditionNotes();
    renderAgeInfo();
    updateMarker();
    $('#parents').hidden = !(isChild() || CONDITIONS.some(x => x.group === 'child' && cond[x.id].on));
  }

  // ---------- Вид пациента ----------
  const pvCanvas = $('#pvCanvas'), pvGhost = $('#pvGhost');
  function drawScene(ctx, w, h) {
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62); sky.addColorStop(0, '#5fa8ea'); sky.addColorStop(1, '#cfe6fb');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd94a'; ctx.beginPath(); ctx.arc(w * 0.84, h * 0.17, h * 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7fbf5a'; ctx.fillRect(0, h * 0.62, w, h * 0.38);
    ctx.fillStyle = '#6f6f6f'; ctx.beginPath(); ctx.moveTo(w * 0.42, h); ctx.lineTo(w * 0.58, h); ctx.lineTo(w * 0.53, h * 0.62); ctx.lineTo(w * 0.47, h * 0.62); ctx.fill();
    ctx.fillStyle = '#e9d7b8'; ctx.fillRect(w * 0.08, h * 0.42, w * 0.2, h * 0.24);
    ctx.fillStyle = '#b1483a'; ctx.beginPath(); ctx.moveTo(w * 0.06, h * 0.42); ctx.lineTo(w * 0.18, h * 0.28); ctx.lineTo(w * 0.30, h * 0.42); ctx.fill();
    ctx.fillStyle = '#5b6f94'; ctx.fillRect(w * 0.11, h * 0.47, w * 0.05, h * 0.07); ctx.fillRect(w * 0.20, h * 0.47, w * 0.05, h * 0.07);
    ctx.fillStyle = '#6b4a2e'; ctx.fillRect(w * 0.155, h * 0.55, w * 0.045, h * 0.11);
    ctx.fillStyle = '#7b5230'; ctx.fillRect(w * 0.72, h * 0.5, w * 0.03, h * 0.17);
    ctx.fillStyle = '#3e9448'; ctx.beginPath(); ctx.arc(w * 0.735, h * 0.44, h * 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(w * 0.36, h * 0.12, w * 0.28, h * 0.46);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.strokeRect(w * 0.36, h * 0.12, w * 0.28, h * 0.46);
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const rows = [['Ш Б', 0.14], ['М Н К', 0.095], ['Ы М Б Ш', 0.07], ['Б Ы Н К М', 0.052], ['И Н Ш М К Б', 0.04]];
    let y = h * 0.2;
    rows.forEach(([t, s]) => { ctx.font = `bold ${Math.round(h * s)}px Arial`; ctx.fillText(t, w * 0.5, y); y += h * (s + 0.035); });
  }
  drawScene(pvCanvas.getContext('2d'), pvCanvas.width, pvCanvas.height);
  drawScene(pvGhost.getContext('2d'), pvGhost.width, pvGhost.height);

  function renderPatientView() {
    const c = cond;
    const cat = c.cataract.on ? c.cataract.severity / 100 : 0, ct = c.cataract.type;
    const cc = c.congenital_cataract.on ? c.congenital_cataract.severity / 100 : 0;
    const D = c.ametropia.on ? Math.abs(c.ametropia.diopters) : 0;
    const cone = c.keratoconus.on ? c.keratoconus.severity / 100 : 0;
    const gk = c.glaucoma.on ? Math.min(1, (c.glaucoma.cdr - 0.3) / 0.65) : 0;
    const cg = c.congenital_glaucoma.on ? c.congenital_glaucoma.severity / 100 : 0;
    const det = c.detachment.on ? c.detachment.extent / 100 : 0;
    const amd = c.amd.on ? c.amd.severity / 100 : 0, wet = c.amd.type === 'wet';
    const dr = c.diabetic.on ? c.diabetic.severity / 100 : 0;
    const crvo = c.crvo.on ? c.crvo.severity / 100 : 0;
    const rb = c.retinoblastoma.on ? c.retinoblastoma.severity / 100 : 0;
    const rop = c.rop.on ? c.rop.stage : 0;
    const strab = c.strabismus.on ? Math.abs(c.strabismus.angle) / 30 : 0;
    const pt = c.ptosis.on ? c.ptosis.drop / 7 : 0;
    const nld = c.nld_obstruction.on ? c.nld_obstruction.severity / 100 : 0;
    const amb = c.amblyopia.on ? c.amblyopia.severity / 100 : 0;

    const blur = cat * (ct === 'psc' ? 6 : ct === 'nuclear' ? 5 : 3.5) + cc * 7 + D * 0.55 + cone * 3 + crvo * 3 + dr * 1.8 + (wet ? amd * 1.5 : 0) + cg * 3 + nld * 1.2 + amb * 5 + (rop >= 4 ? 4 : 0);
    const sepia = ct === 'nuclear' ? cat * 0.85 : cat * 0.2;
    const contrast = 1 - 0.45 * cat - 0.25 * crvo - 0.15 * dr - 0.4 * cc - 0.25 * cg - 0.3 * amb;
    const bright = 1 + 0.35 * cat * (ct === 'psc' ? 1 : ct === 'cortical' ? 0.6 : 0.25) + 0.3 * cc + 0.2 * cg;
    const sat = 1 - 0.5 * amb;
    pvCanvas.style.filter = `blur(${blur.toFixed(1)}px) sepia(${sepia.toFixed(2)}) contrast(${Math.max(0.2, contrast).toFixed(2)}) brightness(${bright.toFixed(2)}) saturate(${sat.toFixed(2)})`;
    const ghost = cone * 0.6 + (ct === 'cortical' ? cat * 0.35 : 0) + strab * 0.55;
    pvGhost.style.opacity = ghost.toFixed(2);
    pvGhost.style.transform = `translate(${(cone * 10 + (ct === 'cortical' ? cat * 5 : 0) + strab * 60).toFixed(1)}px, ${(cone * 5).toFixed(1)}px)`;
    pvGhost.style.filter = pvCanvas.style.filter;
    const glare = Math.max(cat * (ct === 'psc' ? 1 : 0.7), cg * 0.9);
    $('#ovGlare').style.background = glare > 0 ? `radial-gradient(circle at 84% 17%, rgba(255,255,255,${(0.9 * glare).toFixed(2)}) 0, rgba(255,255,230,${(0.5 * glare).toFixed(2)}) ${Math.round(8 + 30 * glare)}%, transparent ${Math.round(20 + 60 * glare)}%)` : 'none';
    let scot = '';
    if (amd > 0) scot = `radial-gradient(circle at 50% 46%, rgba(35,25,25,${(0.95 * amd).toFixed(2)}) 0, rgba(35,25,25,${(0.7 * amd).toFixed(2)}) ${Math.round(4 + 14 * amd)}%, transparent ${Math.round(12 + 26 * amd)}%)`;
    if (rb > 0) scot = (scot ? scot + ',' : '') + `radial-gradient(circle at 62% 68%, rgba(30,30,30,${(0.9 * rb).toFixed(2)}) 0, transparent ${Math.round(8 + 30 * rb)}%)`;
    $('#ovScotoma').style.background = scot || 'none';
    const vig = Math.max(gk, rop && rop < 4 ? 0.25 * rop : 0);
    $('#ovVignette').style.background = vig > 0 ? `radial-gradient(ellipse at 50% 50%, transparent ${Math.round(55 - 50 * vig)}%, rgba(0,0,0,${(0.95 * Math.min(1, vig + 0.2)).toFixed(2)}) ${Math.round(75 - 45 * vig)}%)` : 'none';
    let curtain = det > 0 ? `linear-gradient(to bottom right, rgba(20,15,15,0.96) ${Math.round(det * 40)}%, rgba(20,15,15,0.4) ${Math.round(det * 40 + 6)}%, transparent ${Math.round(det * 40 + 16)}%)` : '';
    if (pt > 0) curtain = (curtain ? curtain + ',' : '') + `linear-gradient(to bottom, rgba(40,25,20,0.97) ${Math.round(pt * 55)}%, rgba(40,25,20,0.5) ${Math.round(pt * 55 + 5)}%, transparent ${Math.round(pt * 55 + 12)}%)`;
    $('#ovCurtain').style.background = curtain || 'none';
    const fl = $('#ovFloaters'); fl.innerHTML = '';
    const nF = Math.round(dr * 8 + crvo * 10 + (wet ? amd * 3 : 0));
    const rnd = EyeModel.rng(77);
    for (let i = 0; i < nF; i++) {
      const d = document.createElement('div'); const sz = 6 + rnd() * 26;
      d.style.cssText = `position:absolute;left:${(rnd() * 90).toFixed(0)}%;top:${(rnd() * 85).toFixed(0)}%;width:${sz.toFixed(0)}px;height:${(sz * (0.5 + rnd() * 0.5)).toFixed(0)}px;border-radius:50%;background:rgba(${crvo > dr ? '90,10,10' : '30,20,20'},${(0.45 + rnd() * 0.4).toFixed(2)});filter:blur(${(1 + rnd() * 2).toFixed(1)}px)`;
      fl.appendChild(d);
    }
    const notes = [];
    if (cat) notes.push(ct === 'nuclear' ? 'Катаракта: туман, желтизна, ослепление от света.' : ct === 'cortical' ? 'Катаракта: блики и двоение от периферических помутнений.' : 'Катаракта: резкое ухудшение при ярком свете и вблизи.');
    if (cc) notes.push('Врождённая катаракта: ребёнок видит только свет и тени, зрительная кора не развивается.');
    if (D) notes.push(c.ametropia.diopters < 0 ? 'Близорукость без очков: вдаль размыто.' : 'Дальнозоркость без очков: нечётко и утомительно.');
    if (cone) notes.push('Кератоконус: двоение и искажения.');
    if (gk) notes.push('Глаукома: выпадение периферии поля зрения.');
    if (cg) notes.push('Врождённая глаукома: туман из-за отёка роговицы, ореолы и светобоязнь.');
    if (det) notes.push('Отслойка: тёмная «занавеска» с одной стороны.');
    if (amd) notes.push('ВМД: пятно в центре поля зрения, искажение линий.');
    if (dr) notes.push('Диабет: плавающие пятна, снижение чёткости.');
    if (crvo) notes.push('Тромбоз ЦВС: пелена и пятна на одном глазу.');
    if (rb) notes.push('Ретинобластома: тёмное пятно в поле зрения; ребёнок жалоб не предъявляет.');
    if (rop) notes.push(rop >= 4 ? 'РН: отслойка, зрение резко снижено.' : 'РН: периферия без сосудов, центральное зрение пока сохранно.');
    if (strab) notes.push('Косоглазие: двойное изображение, которое мозг ребёнка со временем подавляет.');
    if (pt) notes.push('Птоз: веко закрывает верхнюю часть поля зрения.');
    if (nld) notes.push('Слезостояние: картинка «плывёт» от избытка слезы.');
    if (amb) notes.push('Амблиопия: этот глаз видит размыто и блёкло даже в очках.');
    $('#pvNote').textContent = notes.length ? notes.join(' ') : 'Норма: чёткое изображение по всему полю.';
  }

  // ---------- Панель слоёв ----------
  const groupOpacity = {}; GROUPS.forEach(g => groupOpacity[g.id] = 1);
  let selectedId = null;
  function buildLayers() {
    const root = $('#layers'); root.innerHTML = '';
    GROUPS.forEach(g => {
      const box = document.createElement('div'); box.className = 'group'; box.dataset.group = g.id;
      const head = document.createElement('div'); head.className = 'group-head';
      head.innerHTML = `<input type="checkbox" class="gchk" title="Показать/скрыть группу"><span class="name" title="${g.hint}">${g.name}</span><button class="lbl ${labelGroups[g.id] ? 'on' : ''}" title="Подписи этой группы">Аа</button><input type="range" class="gop" min="0.05" max="1" step="0.05" value="1" title="Прозрачность группы"><span class="tw">▾</span>`;
      head.querySelector('.lbl').addEventListener('click', (e) => { labelGroups[g.id] = !labelGroups[g.id]; e.target.classList.toggle('on', labelGroups[g.id]); updateLabels(); });
      const body = document.createElement('div'); body.className = 'group-body';
      STRUCTURES.filter(s => s.group === g.id).forEach(s => {
        const row = document.createElement('div'); row.className = 'row'; row.dataset.id = s.id;
        const sub = s.sub === 'artery' ? '<small> · артерия</small>' : s.sub === 'vein' ? '<small> · вена</small>' : '';
        row.innerHTML = `<input type="checkbox" class="schk" checked><span class="dot" style="background:#${s.color.toString(16).padStart(6, '0')}"></span><span class="nm">${s.name}${sub}</span><button class="iso" title="Показать только это">◎</button>`;
        row.querySelector('.schk').addEventListener('change', (e) => setVisible(s.id, e.target.checked));
        row.querySelector('.nm').addEventListener('click', () => select(s.id));
        row.querySelector('.iso').addEventListener('click', () => isolate(s.id));
        body.appendChild(row);
      });
      head.querySelector('.gchk').addEventListener('change', (e) => STRUCTURES.filter(s => s.group === g.id).forEach(s => setVisible(s.id, e.target.checked)));
      head.querySelector('.gop').addEventListener('input', (e) => { groupOpacity[g.id] = parseFloat(e.target.value); applyOpacity(); });
      head.querySelector('.name').addEventListener('click', () => box.classList.toggle('collapsed'));
      head.querySelector('.tw').addEventListener('click', () => box.classList.toggle('collapsed'));
      box.appendChild(head); box.appendChild(body); root.appendChild(box);
    });
    syncLayerUI();
  }
  function setVisible(id, v) { const e = S[id]; if (!e) return; e.visible = v; refreshVisibility(e); syncLayerUI(); }
  function syncLayerUI() {
    GROUPS.forEach(g => {
      const ids = STRUCTURES.filter(s => s.group === g.id).map(s => s.id);
      const n = ids.filter(id => S[id].visible).length;
      const chk = document.querySelector(`.group[data-group="${g.id}"] .gchk`);
      if (chk) { chk.checked = n === ids.length; chk.indeterminate = n > 0 && n < ids.length; }
    });
    document.querySelectorAll('.row').forEach(r => { r.querySelector('.schk').checked = S[r.dataset.id].visible; r.classList.toggle('sel', r.dataset.id === selectedId); });
    updateLabels();
  }
  function applyOpacity() {
    const F = focusSet();
    STRUCTURES.forEach(s => {
      const e = S[s.id];
      let op = Math.min(1, e.baseOpacity) * groupOpacity[s.group];
      let emissive = 0;
      if (F) {
        if (F.has(s.id)) { op = Math.min(1, Math.max(op, e.baseOpacity < 1 ? e.baseOpacity + 0.3 : 1)); emissive = 0x1c1c1c; }
        else op = Math.min(op, GHOST);
      }
      if (s.id === selectedId) emissive = 0x3a3a3a;
      const m = e.mesh.material;
      m.opacity = op; m.transparent = op < 1; m.depthWrite = op >= 0.5; m.emissive.setHex(emissive); m.needsUpdate = true;
      e.mesh.renderOrder = m.transparent ? 1000 : 0;
      if (e.detail) e.detail.renderOrder = e.mesh.renderOrder;
      if (e.cap) { const cm = e.cap.material; cm.opacity = op < 1 ? Math.min(1, op + 0.12) : 1; cm.depthWrite = op >= 0.5; cm.emissive.setHex(emissive); }
    });
  }
  function isolate(id) { STRUCTURES.forEach(s => setVisible(s.id, s.id === id)); select(id); }
  $('#allOn').addEventListener('click', () => STRUCTURES.forEach(s => setVisible(s.id, true)));
  $('#coreOnly').addEventListener('click', () => STRUCTURES.forEach(s => setVisible(s.id, ['shell', 'inner'].includes(s.group))));

  // ---------- Выбор и карточка ----------
  function select(id) {
    selectedId = id;
    const e = S[id]; if (!e) return;
    applyOpacity();
    Object.keys(labels).forEach(k => labels[k].element.classList.toggle('sel', k === id));
    const d = e.def, g = GROUPS.find(x => x.id === d.group);
    const links = d.links.filter(l => condById[l]).map(l => `<button data-cond="${l}">${condById[l].name.replace(/\s*\(.*\)/, '')}</button>`).join('');
    $('#info').innerHTML = `<h2>${d.name}</h2><div class="latin">${d.latin} · ${g.name}</div>
      <p>${d.desc}</p>
      <h4>Функция</h4><p>${d.func}</p>
      ${d.norm ? `<h4>Норма</h4><p>${d.norm}</p>` : ''}
      <h4>Что может пойти не так</h4><p>${d.problems}</p>
      ${links ? `<div class="links">${links}</div>` : ''}`;
    $('#info').querySelectorAll('[data-cond]').forEach(b => b.addEventListener('click', () => enableCondition(b.dataset.cond)));
    syncLayerUI();
    if (isMobile()) { $('#right').classList.add('open'); $('#left').classList.remove('open'); syncMobileBar(); }
  }

  const raycaster = new THREE.Raycaster();
  let downPos = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(m, camera);
    const hits = raycaster.intersectObjects(structureMeshes.filter(o => o.visible), false).filter(h => !clip.on || clipPlane.distanceToPoint(h.point) >= 0);
    if (!hits.length) return;
    const opaque = hits.find(h => h.object.material.opacity >= 0.5);
    select((opaque || hits[0]).object.userData.id);
  });

  // ---------- Панель состояний ----------
  function buildConditions() {
    const root = $('#condList'); root.innerHTML = '';
    [['adult', 'Взрослый глаз'], ['child', 'Детский глаз']].forEach(([grp, title]) => {
      const h = document.createElement('div'); h.className = 'sub-title'; h.textContent = title; root.appendChild(h);
      CONDITIONS.filter(c => c.group === grp).forEach(c => {
        const box = document.createElement('div'); box.className = 'cond'; box.dataset.cond = c.id;
        const head = document.createElement('div'); head.className = 'cond-head';
        head.innerHTML = `<input type="checkbox" class="con"><span class="name">${c.name}</span><button class="fly" title="Подлететь к проблеме">➜</button>`;
        const body = document.createElement('div'); body.className = 'cond-body';
        let html = '';
        if (c.options) html += `<label>${c.options.label}</label><select class="copt">${c.options.values.map(v => `<option value="${v.id}">${v.label}</option>`).join('')}</select>`;
        c.params.forEach(p => { html += `<label>${p.label}<span class="val" data-p="${p.id}"></span></label><input type="range" class="cp" data-p="${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.def}">`; });
        html += `<div class="tools"><button class="btn demo" title="Плавно показать переход от нормы к выбранной степени">Показать изменение</button></div>`;
        html += `<div class="chips"></div><div class="changes"></div><p class="note"></p><p>${c.desc}</p><p class="sym"><b>Жалобы:</b> ${c.symptoms}</p>`;
        if (c.signs) html += `<p class="sym parents"><b>Родителям:</b> ${c.signs}</p>`;
        body.innerHTML = html;
        head.querySelector('.con').addEventListener('change', (e) => {
          cond[c.id].on = e.target.checked; box.classList.toggle('on', e.target.checked); applyConditions();
          setFocus(e.target.checked ? c.id : (focus.cond === c.id ? nextEnabledCond(c.id) : focus.cond), { demo: e.target.checked });
        });
        head.querySelector('.name').addEventListener('click', () => {
          const chk = head.querySelector('.con');
          if (chk.checked && focus.cond !== c.id) { setFocus(c.id); return; }
          chk.checked = !chk.checked; chk.dispatchEvent(new Event('change'));
        });
        head.querySelector('.fly').addEventListener('click', (e) => { e.stopPropagation(); if (!cond[c.id].on) { const chk = head.querySelector('.con'); chk.checked = true; chk.dispatchEvent(new Event('change')); } else { setFocus(c.id); } });
        const sel = body.querySelector('.copt'); if (sel) sel.addEventListener('change', (e) => { cond[c.id][c.options.id] = e.target.value; applyConditions(); setFocus(c.id, { noFly: false }); });
        body.querySelectorAll('.cp').forEach(inp => inp.addEventListener('input', (e) => {
          cond[c.id][inp.dataset.p] = parseFloat(e.target.value); applyConditions();
          if (focus.cond !== c.id) setFocus(c.id, { noFly: true });
          pulse.until = performance.now() + 900; // короткая подсветка того, что меняется
        }));
        body.querySelector('.demo').addEventListener('click', () => demo(c.id));
        body.addEventListener('click', (e) => { const b = e.target.closest('.chips button'); if (b) select(b.dataset.s); });
        box.appendChild(head); box.appendChild(body); root.appendChild(box);
      });
    });
    renderConditionNotes();
  }
  function fmt(v, p) { return (p.step < 1 ? v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : Math.round(v)) + p.unit; }
  function renderConditionNotes() {
    CONDITIONS.forEach(c => {
      const box = document.querySelector(`.cond[data-cond="${c.id}"]`); if (!box) return;
      // список затронутого и пояснения «что меняется» зависят от формы болезни
      const cv = conditionView(c), ck = c.id + '|' + (c.options ? cond[c.id][c.options.id] : '');
      if (box.dataset.ck !== ck) {
        box.dataset.ck = ck;
        const name = (a) => byId[a].name.replace(/\s*\(.*\)/, '');
        box.querySelector('.chips').innerHTML = '<span>Затронуто:</span>' + cv.affects.filter(a => byId[a]).map(a => `<button data-s="${a}" title="Показать описание">${name(a)}</button>`).join('');
        const ch = cv.changes || {};
        const items = cv.affects.filter(a => byId[a] && ch[a]).map(a => `<li><b>${name(a)}</b> — ${ch[a]}</li>`);
        if (ch._note) items.push(`<li class="n">${ch._note}</li>`);
        box.querySelector('.changes').innerHTML = items.length ? `<div class="chg-title">Что меняется</div><ul class="chg">${items.join('')}</ul>` : '';
      }
      c.params.forEach(p => { const v = cond[c.id][p.id]; const el = box.querySelector(`.val[data-p="${p.id}"]`); if (el) el.textContent = fmt(v, p); const inp = box.querySelector(`.cp[data-p="${p.id}"]`); if (inp && parseFloat(inp.value) !== v) inp.value = v; });
      const note = box.querySelector('.note');
      if (c.typeNotes) note.textContent = c.typeNotes[cond[c.id][c.options.id]] || '';
      else if (c.id === 'glaucoma') note.textContent = cond.glaucoma.iop > 21 ? `ВГД ${cond.glaucoma.iop} мм рт. ст. — выше нормы (10–21).` : `ВГД ${cond.glaucoma.iop} мм рт. ст. — в пределах нормы; возможна глаукома нормального давления.`;
      else if (c.id === 'congenital_glaucoma') note.textContent = `ВГД ${cond.congenital_glaucoma.iop} мм рт. ст.; роговица увеличена примерно до ${(stop().cornea * (1 + 0.3 * cond.congenital_glaucoma.severity / 100)).toFixed(1)} мм, глаз растянут.`;
      else if (c.id === 'ametropia') { const d = cond.ametropia.diopters; note.textContent = d === 0 ? 'Эмметропия: фокус на сетчатке.' : d < 0 ? `Миопия ${d} дптр: глаз длиннее нормы примерно на ${(-d * 0.35).toFixed(1)} мм, фокус перед сетчаткой.` : `Гиперметропия +${d} дптр: глаз короче нормы примерно на ${(d * 0.35).toFixed(1)} мм, фокус за сетчаткой.`; }
      else if (c.id === 'strabismus') { const a = cond.strabismus.angle; note.textContent = a === 0 ? 'Оси параллельны.' : a > 0 ? `Сходящееся косоглазие (эзотропия) ${a}°: глаз отклонён к носу, красная ось — куда смотрит косящий глаз, серая — куда должен.` : `Расходящееся косоглазие (экзотропия) ${-a}°: глаз отклонён к виску.`; }
      else if (c.id === 'rop') note.textContent = ['', 'Стадия 1: тонкая демаркационная линия между сосудистой и бессосудистой сетчаткой.', 'Стадия 2: линия превращается в вал.', 'Стадия 3: на валу растут патологические сосуды — порог для лечения (лазер, анти-VEGF).', 'Стадия 4: частичная тракционная отслойка сетчатки.', 'Стадия 5: тотальная отслойка, «воронка».'][cond.rop.stage] || '';
      else if (c.id === 'ptosis') { const d = cond.ptosis.drop; note.textContent = d >= 4.6 ? `Край века ниже центра зрачка на ${(d - 4.6).toFixed(1)} мм: зрачок перекрыт, риск амблиопии.` : `Край века на ${(4.6 - d).toFixed(1)} мм выше центра зрачка.`; }
      else note.textContent = '';
    });
  }
  function enableCondition(id) {
    const box = document.querySelector(`.cond[data-cond="${id}"]`); if (!box) return;
    const chk = box.querySelector('.con');
    if (!chk.checked) { chk.checked = true; chk.dispatchEvent(new Event('change')); } else setFocus(id);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (isMobile()) { $('#right').classList.add('open'); $('#left').classList.remove('open'); syncMobileBar(); }
  }
  // Плавный переход от нормы к выбранной степени
  let demoTimer = null;
  function demo(id) {
    const c = condById[id], p = c.params[0]; if (!p) return;
    if (!cond[id].on) { const chk = document.querySelector(`.cond[data-cond="${id}"] .con`); chk.checked = true; chk.dispatchEvent(new Event('change')); }
    const end = cond[id][p.id];
    const start = p.id === 'cdr' ? 0.3 : p.id === 'stage' ? 1 : p.min > 0 ? p.min : 0;
    if (demoTimer) cancelAnimationFrame(demoTimer);
    const t0 = performance.now(), ms = 1800;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      let v = start + (end - start) * e; v = Math.round(v / p.step) * p.step;
      cond[id][p.id] = k >= 1 ? end : v; applyConditions();
      if (k < 1) demoTimer = requestAnimationFrame(step); else demoTimer = null;
    };
    cond[id][p.id] = start; applyConditions(); demoTimer = requestAnimationFrame(step);
  }

  // ---------- Памятка для родителей ----------
  function buildParents() {
    const root = $('#parentList'); root.innerHTML = '';
    PARENT_SIGNS.forEach(s => {
      const li = document.createElement('li'); if (s.urgent) li.className = 'urgent';
      li.innerHTML = `<span>${s.sign}</span><span class="links">${s.conds.filter(id => condById[id]).map(id => `<button data-cond="${id}">${(condById[id].short || condById[id].name).replace(/\s*\(.*\)/, '')}</button>`).join('')}</span>`;
      li.querySelectorAll('button').forEach(b => b.addEventListener('click', () => enableCondition(b.dataset.cond)));
      root.appendChild(li);
    });
  }

  // ---------- Управление ----------
  $('#clipOn').addEventListener('change', (e) => { clip.on = e.target.checked; updateClipPlane(); updateLabels(); });
  function cameraToCutSide() {
    if (!clip.on) return;
    const d = clipPlane.distanceToPoint(camera.position);
    if (d > 0) { camera.position.addScaledVector(clipPlane.normal, -2 * d); const dt = clipPlane.distanceToPoint(controls.target); controls.target.addScaledVector(clipPlane.normal, -2 * dt); controls.update(); }
    updateLabels();
  }
  $('#clipAxis').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { clip.axis = b.dataset.axis; updateClipPlane(); cameraToCutSide(); }));
  $('#clipOffset').addEventListener('input', (e) => { clip.offset = parseFloat(e.target.value); updateClipPlane(); updateLabels(); });
  $('#clipFlip').addEventListener('click', () => { clip.flip = !clip.flip; updateClipPlane(); cameraToCutSide(); });
  $('#labelsOn').addEventListener('change', (e) => { ui.labels = e.target.checked; updateLabels(); });
  $('#raysOn').addEventListener('change', (e) => { ui.rays = e.target.checked; raysGroup.visible = ui.rays; });
  $('#flyOn').addEventListener('change', (e) => { ui.fly = e.target.checked; });
  $('#age').addEventListener('input', (e) => { age.idx = parseInt(e.target.value, 10); applyConditions(); });
  const VIEWS = { iso: [[23, 11, 30], [0, -2.5, -1]], front: [[0, 2, 44], [0, 0, 2]], side: [[-46, 4, 3], [0, 0, -5]], top: [[1.5, 46, 1.5], [0, 0, -3]] };
  let currentView = 'iso';
  function setView(name) {
    const v = VIEWS[name]; currentView = name;
    controls.target.set(...v[1]);
    const k = camera.aspect < 1 ? Math.min(2.2, 1 / camera.aspect) : 1;
    camera.position.set(...v[0]).sub(controls.target).multiplyScalar(k).add(controls.target);
    controls.update();
    $('#views').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.view === name));
    $('#axisHint').style.display = (name === 'front' || name === 'top') ? '' : 'none';
    $('#axisHint').textContent = name === 'front' ? 'Нос → справа · Висок ← слева' : 'Вид сверху: роговица внизу экрана, нос справа';
  }
  $('#views').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#snap').addEventListener('click', () => { render(); const a = document.createElement('a'); a.download = 'глаз-3d.png'; a.href = renderer.domElement.toDataURL('image/png'); a.click(); });
  const isMobile = () => window.innerWidth <= 980;
  function syncMobileBar() {
    $('#toggleLeft').classList.toggle('on', $('#left').classList.contains('open'));
    $('#toggleRight').classList.toggle('on', $('#right').classList.contains('open'));
    $('#toggleCtl').classList.toggle('on', document.querySelector('header').classList.contains('ctl-open'));
  }
  $('#toggleLeft').addEventListener('click', () => { $('#left').classList.toggle('open'); $('#right').classList.remove('open'); syncMobileBar(); });
  $('#toggleRight').addEventListener('click', () => { $('#right').classList.toggle('open'); $('#left').classList.remove('open'); syncMobileBar(); });
  $('#toggleCtl').addEventListener('click', () => { document.querySelector('header').classList.toggle('ctl-open'); syncMobileBar(); });
  renderer.domElement.addEventListener('pointerdown', () => {
    if (!isMobile()) return;
    if ($('#left').classList.contains('open') || $('#right').classList.contains('open')) { $('#left').classList.remove('open'); $('#right').classList.remove('open'); syncMobileBar(); }
  });

  // ---------- Выносные подписи затронутых структур: плашка сбоку, линия к структуре, пульсирующая точка ----------
  const calloutSvg = $('#callouts'), calloutBoxesEl = $('#calloutBoxes');
  const calloutEls = {};
  const svgEl = (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag);
  function updateCallouts() {
    const F = focusSet();
    const c = F ? condById[focus.cond] : null, v = c ? conditionView(c) : null, ch = (v && v.changes) || {};
    const ids = F ? v.affects.filter(id => byId[id] && S[id].visible && labels[id]) : [];
    Object.keys(calloutEls).forEach(id => { if (!ids.includes(id)) { const e = calloutEls[id]; e.box.remove(); e.path.remove(); e.dot.remove(); e.ring.remove(); delete calloutEls[id]; } });
    if (!ids.length) return;
    const w = view.clientWidth, h = view.clientHeight, bw = isMobile() ? 150 : 210, margin = 10, top = 14, gap = 6;
    const items = ids.map(id => { labels[id].getWorldPosition(tmpV); const s = tmpV.clone().project(camera); return { id, ax: (s.x + 1) / 2 * w, ay: (1 - s.y) / 2 * h, behind: s.z > 1 }; });
    items.forEach(it => {
      if (calloutEls[it.id]) return;
      const box = document.createElement('div'); box.className = 'callout';
      box.innerHTML = `<b>${byId[it.id].name.replace(/\s*\(.*\)/, '')}</b><span>${ch[it.id] || ''}</span>`;
      box.addEventListener('click', () => select(it.id));
      calloutBoxesEl.appendChild(box);
      const path = svgEl('path'), dot = svgEl('circle'), ring = svgEl('circle');
      dot.setAttribute('class', 'dot'); dot.setAttribute('r', 4); ring.setAttribute('class', 'ring'); ring.setAttribute('r', 6);
      calloutSvg.appendChild(path); calloutSvg.appendChild(ring); calloutSvg.appendChild(dot);
      calloutEls[it.id] = { box, path, dot, ring };
    });
    // раскладка по двум колонкам, ближе к своей структуре, без наложений
    let left = items.filter(i => i.ax < w / 2).sort((a, b) => a.ay - b.ay), right = items.filter(i => i.ax >= w / 2).sort((a, b) => a.ay - b.ay);
    const cap = Math.max(2, Math.floor((h - top) / 54));
    while (left.length > cap && right.length < cap) right.push(left.pop());
    while (right.length > cap && left.length < cap) left.push(right.pop());
    const place = (col, x) => {
      let y = top;
      col.forEach(it => { const box = calloutEls[it.id].box; const bh = box.offsetHeight || 44; let by = Math.max(y, it.ay - bh / 2); if (by + bh > h - 8) by = Math.max(top, h - 8 - bh); box.style.left = x + 'px'; box.style.top = by + 'px'; it.bx = x; it.by = by; it.bh = bh; y = by + bh + gap; });
    };
    place(left, margin); place(right, w - margin - bw);
    items.forEach(it => {
      const e = calloutEls[it.id]; e.box.classList.toggle('behind', it.behind);
      const leftSide = it.bx < w / 2, fromX = leftSide ? it.bx + bw : it.bx, fromY = it.by + Math.min(it.bh / 2, 16), midX = leftSide ? fromX + 14 : fromX - 14;
      const ax = Math.max(2, Math.min(w - 2, it.ax)), ay = Math.max(2, Math.min(h - 2, it.ay));
      e.path.setAttribute('d', it.behind ? '' : `M${fromX.toFixed(1)},${fromY.toFixed(1)} L${midX.toFixed(1)},${fromY.toFixed(1)} L${ax.toFixed(1)},${ay.toFixed(1)}`);
      [e.dot, e.ring].forEach(el => { el.setAttribute('cx', ax.toFixed(1)); el.setAttribute('cy', ay.toFixed(1)); el.style.display = it.behind ? 'none' : ''; });
    });
  }

  const GROUP_PRIO = { shell: 0, inner: 1, nerves: 2, vessels: 3, muscles: 4, adnexa: 5, orbit: 6 };
  let declutterTick = 0;
  function declutterLabels() {
    if ((declutterTick++ % 5) !== 0) return;
    const items = Object.keys(labels).filter(id => labels[id].visible && labels[id].element.style.display !== 'none')
      .map(id => ({ id, el: labels[id].element, p: (id === selectedId ? -10 : 0) + GROUP_PRIO[S[id].def.group] })).sort((a, b) => a.p - b.p);
    const kept = [];
    if (markerObj.visible) kept.push(markerDiv.getBoundingClientRect());
    Object.values(calloutEls).forEach(e => { if (!e.box.classList.contains('behind')) kept.push(e.box.getBoundingClientRect()); });
    items.forEach(it => {
      const r = it.el.getBoundingClientRect();
      const hit = kept.some(k => !(r.right < k.left || r.left > k.right || r.bottom < k.top || r.top > k.bottom));
      it.el.style.visibility = hit ? 'hidden' : '';
      if (!hit) kept.push(r);
    });
  }

  // ---------- Размер и тема ----------
  let lastPortrait = null;
  function resize() {
    const w = view.clientWidth, h = view.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h); labelRenderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    const portrait = w < h;
    if (lastPortrait !== null && portrait !== lastPortrait) setView(currentView);
    lastPortrait = portrait;
  }
  new ResizeObserver(resize).observe(view);
  function applyTheme() { scene.background = new THREE.Color(isDark() ? 0x161a22 : 0xe3e7ed); }
  applyTheme();
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- Цикл ----------
  const capPos = new THREE.Vector3();
  let pulseWasOn = false;
  function render() {
    if (flight) flight(); else controls.update();
    if (clip.on) { clipPlane.coplanarPoint(capPos); const look = capPos.clone().sub(clipPlane.normal); caps.forEach(c => { c.position.copy(capPos); c.lookAt(look); }); }
    // пульсация затронутых структур после включения проблемы
    const now = performance.now();
    if (now < pulse.until) {
      const F = focusSet();
      if (F) { const k = 0.5 + 0.5 * Math.sin(now / 130); F.forEach(id => { const e = S[id]; if (!e) return; e.mesh.material.emissive.setRGB(0.22 + 0.38 * k, 0.1 + 0.16 * k, 0.02); if (e.cap) e.cap.material.emissive.copy(e.mesh.material.emissive); }); }
      markerDiv.classList.toggle('pulse', true); pulseWasOn = true;
    } else if (pulseWasOn) { pulseWasOn = false; markerDiv.classList.remove('pulse'); applyOpacity(); }
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    declutterLabels();
    updateCallouts();
  }
  function loop() { render(); requestAnimationFrame(loop); }

  // ---------- Старт ----------
  buildLayers();
  buildConditions();
  buildParents();
  STRUCTURES.filter(s => ['adnexa', 'muscles', 'orbit'].includes(s.group) || ['cloquet', 'posterior_chamber'].includes(s.id)).forEach(s => setVisible(s.id, false));
  applyOpacity();
  updateClipPlane();
  applyConditions();
  loadDetail();
  resize();
  setView('iso');
  controls.addEventListener('change', updateLabels);
  updateLabels();
  loop();

  // Внешний API (отладка и встраивание через WebView2)
  window.Eye3D = {
    setView, select, setVisible, isolate,
    setClip: (o) => { Object.assign(clip, o); updateClipPlane(); updateLabels(); },
    setCondition: (id, values) => {
      if (!cond[id]) return; Object.assign(cond[id], values);
      const box = document.querySelector(`.cond[data-cond="${id}"]`);
      if (box) { box.querySelector('.con').checked = !!cond[id].on; box.classList.toggle('on', !!cond[id].on);
        const sel = box.querySelector('.copt'); const c = condById[id]; if (sel && c.options) sel.value = cond[id][c.options.id]; }
      applyConditions();
      if (values.on) setFocus(id, { demo: !!values.demo }); else if (values.on === false && focus.cond === id) setFocus(nextEnabledCond(id));
    },
    setFocus, flyToCondition, demo, setAge: (years) => setAgeByYears(years), setAgeIndex: (i) => { age.idx = i; $('#age').value = i; applyConditions(); },
    setFly: (on) => { ui.fly = !!on; $('#flyOn').checked = ui.fly; },
    getState: () => ({ clip: Object.assign({}, clip), age: stop(), conditions: JSON.parse(JSON.stringify(cond)), visible: Object.fromEntries(STRUCTURES.map(s => [s.id, S[s.id].visible])) }),
    camera, controls, scene,
  };
})();
