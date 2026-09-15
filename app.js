// app.js — сцена, разрез, слои, подписи, состояния (взрослые и детские), возраст, подлёт камеры, «вид пациента», панель показа, сценарий показа.
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

  // ---------- Конфигурация: что включено (config.js, поверх него переопределения из localStorage) ----------
  const CFG_DEFAULT = { features: { age: true, childConditions: true, parents: true, treatments: true, callouts: true, normGhost: true, elements: true, changes: true, patientView: true, rays: true, fly: true, labels: true, layersPanel: true, scenario: true }, hideConditions: [], hideStructures: [], hideGroups: [], show: { context: 0.15, highlight: 0.7, pvAuto: true }, scenarios: [] };
  const FEATURE_NAMES = { age: 'Возраст пациента', childConditions: 'Детские проблемы', parents: 'Памятка для родителей', treatments: 'После лечения (операции)', callouts: 'Выносные подписи', normGhost: 'Контур нормы', elements: 'Элементы патологии', changes: 'Блок «Что меняется»', patientView: '«Как видит пациент»', rays: 'Ход лучей', fly: 'Автоподлёт камеры', labels: 'Подписи структур', layersPanel: 'Панель слоёв', scenario: 'Сценарий показа' };
  function loadConfig() {
    const c = JSON.parse(JSON.stringify(CFG_DEFAULT));
    const merge = (src) => { if (!src) return; if (src.features) Object.assign(c.features, src.features); ['hideConditions', 'hideStructures', 'hideGroups', 'scenarios'].forEach(k => { if (Array.isArray(src[k])) c[k] = src[k].slice(); }); if (src.show) Object.assign(c.show, src.show); };
    merge(window.EYE_CONFIG);
    try { merge(JSON.parse(localStorage.getItem('eye3d.config') || 'null')); } catch (e) { /* хранилище недоступно */ }
    return c;
  }
  const cfg = loadConfig(), FT = cfg.features;
  // Настройки показа: прозрачность остального, сила подсветки, окно пациента при показе изменения. Меняются на лету, хранятся в браузере.
  const show = Object.assign({ context: 0.15, highlight: 0.7, pvAuto: true }, cfg.show, { pvFloat: false });
  try { Object.assign(show, JSON.parse(localStorage.getItem('eye3d.show') || '{}'), { pvFloat: false }); } catch (e) { /* хранилище недоступно */ }
  const saveShow = () => { try { localStorage.setItem('eye3d.show', JSON.stringify({ context: show.context, highlight: show.highlight, pvAuto: show.pvAuto })); } catch (e) { /* нет хранилища */ } };
  const condEnabled = (c) => !cfg.hideConditions.includes(c.id) && (FT.childConditions || c.group !== 'child');
  const structHidden = (id) => cfg.hideStructures.includes(id) || cfg.hideGroups.includes((byId[id] || {}).group);

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

  const params = { elong: 0, cone: 0, cdr: 0.3, bombe: 0, pupil: E.pupil, limbScale: 1, lensThick: 1, ptosis: 0, physHyper: 0, atrophy: 0, astig: 0, astigAxis: 0, cyl: 0, ablation: 0, corrected: false };
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
    const entry = { def, mesh, detail: null, useDetail: true, visible: true, focusHidden: false, surgHidden: false, stencils: [], cap: null, order: -1, baseOpacity: def.opacity };
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
    const useD = !!e.detail && e.useDetail, shown = e.visible && !e.focusHidden && !e.surgHidden;
    e.mesh.visible = shown && !useD;
    if (e.detail) e.detail.visible = shown && useD;
    if (e.cap) e.cap.visible = shown && clip.on;
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
  const ui = { labels: FT.labels, rays: false, fly: FT.fly };
  const labelGroups = { shell: true, inner: true, vessels: false, nerves: true, muscles: false, adnexa: false, orbit: false };
  const tmpV = new THREE.Vector3();
  function updateLabels() {
    eyeGroup.updateMatrixWorld(true);
    const F = focusSet();
    Object.keys(labels).forEach(id => {
      const o = labels[id], vis = S[id].visible;
      let ok = ui.labels && vis && (labelGroups[S[id].def.group] || id === selectedId);
      if (F && id !== selectedId && (FT.callouts || !F.has(id))) ok = false; // в режиме проблемы вместо подписей работают выносные плашки
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
  const rayLines = [], rayLinesV = [];
  const rayMatV = new THREE.LineBasicMaterial({ color: 0xff9a3d });
  for (let i = 0; i < 7; i++) { const l = new THREE.Line(new THREE.BufferGeometry(), rayMat); raysGroup.add(l); rayLines.push(l); }
  for (let i = 0; i < 7; i++) { const l = new THREE.Line(new THREE.BufferGeometry(), rayMatV); l.visible = false; raysGroup.add(l); rayLinesV.push(l); }
  const focusDotV = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff9a3d })); focusDotV.visible = false; raysGroup.add(focusDotV);
  function updateRays() {
    const yRet = -E.R_ret - params.elong;
    const yF = params.corrected ? yRet : -E.R_ret - (cond.ametropia.on || cond.child_myopia.on ? 0 : params.physHyper * 0.35);
    const yF2 = params.corrected ? yRet : yF + params.cyl * 0.35; // при астигматизме второй меридиан фокусируется раньше: две фокальные линии
    focusDot.position.set(0, yF, 0); focusDotV.position.set(0, yF2, 0); focusDotV.visible = params.cyl > 0;
    const a = EyeModel.lensArcs(1, params.lensThick);
    const build = (line, x, focusY, horizontal) => {
      const yc = E.c_ca + Math.sqrt(Math.max(0, E.R_ca * E.R_ca - x * x));
      const xl = x * 0.86, yl = a.ca + Math.sqrt(Math.max(0, a.Ra * a.Ra - xl * xl));
      const jitter = params.cone * (Math.round(x) % 2 ? 0.6 : -0.6) * Math.abs(x) * 0.3;
      const t = (yRet - yl) / (focusY - yl);
      const xe = xl + (0 + jitter - xl) * t;
      const P = horizontal ? (px, py) => V3(px, py, 0) : (px, py) => V3(0, py, px);
      line.geometry.dispose(); line.geometry = new THREE.BufferGeometry().setFromPoints([P(x, 34), P(x, yc), P(xl, yl), P(xe, yRet)]);
    };
    rayLines.forEach((line, i) => build(line, -3.6 + i * 1.2, yF, true));
    rayLinesV.forEach((line, i) => { line.visible = params.cyl > 0; if (line.visible) build(line, -3.6 + i * 1.2, yF2, false); });
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

  const pathoMeshes = Object.values(patho);
  // Точка привязки для плашки элемента патологии
  function pathoAnchor(id) {
    const m = patho[id]; if (!m || !m.visible) return null;
    if (m.isInstancedMesh) { if (!m.count) return null; const mat = new THREE.Matrix4(); m.getMatrixAt(0, mat); return m.localToWorld(new THREE.Vector3().setFromMatrixPosition(mat)); }
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    if (!m.geometry.boundingSphere || !isFinite(m.geometry.boundingSphere.radius)) return null;
    return m.localToWorld(m.geometry.boundingSphere.center.clone());
  }

  // ---------- Контур нормы: голубая копия структуры в нормальной форме рядом с изменённой ----------
  const normGroup = new THREE.Group(); eyeGroup.add(normGroup);
  const normMat = new THREE.MeshStandardMaterial({ color: 0x1fb6ff, emissive: 0x0b4d6e, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [clipPlane], roughness: 0.4 });
  const normGhosts = {};
  const NORM_DEPS = { sclera: ['elong', 'limbScale', 'angle', 'g'], cornea: ['cone', 'limbScale', 'angle', 'g', 'astig', 'ablation'], choroid: ['elong', 'g'], retina: ['elong', 'g'], vitreous: ['elong'], macula: ['elong'], iris: ['bombe', 'angle'], anterior_chamber: ['bombe'], disc: ['cdr', 'elong'], optic_nerve: ['atrophy', 'elong'], lid_upper: ['ptosis'] };
  const NORM_BUILD = { sclera: p => EyeModel.geo.sclera(p), cornea: p => EyeModel.geo.cornea(p), choroid: p => EyeModel.geo.choroid(p), retina: p => EyeModel.geo.retina(p), vitreous: p => EyeModel.geo.vitreous(p), macula: p => EyeModel.geo.macula(p), iris: p => EyeModel.geo.iris(p), anterior_chamber: p => EyeModel.geo.anterior_chamber(p), disc: p => EyeModel.geo.disc(p), optic_nerve: p => EyeModel.geo.optic_nerve(p), lid_upper: () => EyeModel.lidGeometry(true, 0) };
  let normKey = '';
  function updateNormGhosts(ap, extra) {
    const np = { elong: 0, cone: 0, cdr: 0.3, bombe: 0, pupil: ap.pupil, limbScale: ap.limb, lensThick: ap.lensThick, ptosis: 0, atrophy: 0, angle: 0, g: 1, astig: 0, astigAxis: 0, ablation: 0 };
    const cur = Object.assign({}, params, extra);
    const changed = FT.normGhost ? Object.keys(NORM_DEPS).filter(id => S[id] && S[id].visible && NORM_DEPS[id].some(k => Math.abs((cur[k] || 0) - (np[k] || 0)) > 1e-6)) : [];
    const key = changed.join(',') + '|' + JSON.stringify(np);
    if (key !== normKey) {
      normKey = key;
      Object.keys(normGhosts).forEach(id => { if (!changed.includes(id)) { normGroup.remove(normGhosts[id]); normGhosts[id].geometry.dispose(); delete normGhosts[id]; } });
      changed.forEach(id => {
        const g = NORM_BUILD[id](np);
        if (normGhosts[id]) { normGhosts[id].geometry.dispose(); normGhosts[id].geometry = g; }
        else { const m = new THREE.Mesh(g, normMat); m.renderOrder = 1300; m.userData.normGhost = id; normGroup.add(m); normGhosts[id] = m; }
        if (id === 'disc') { normGhosts[id].position.copy(E.disc_dir).multiplyScalar(E.R_ret + 0.02); normGhosts[id].quaternion.copy(S.disc.mesh.quaternion); }
      });
    }
    $('#normLegend').hidden = !changed.length && !(focusSet() && (CONDITION_ELEMENTS[focus.cond] || []).length);
  }

  const fundus = EyeModel.fundus;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

  // ---------- Хирургические элементы (схематично) ----------
  const surg = {};
  const smat = (color, opacity, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.4, metalness: 0.1, transparent: opacity < 1, opacity, clippingPlanes: [clipPlane], side: THREE.DoubleSide }, extra));
  function addSurg(id, geometry, material, parent = globeLocal, count) {
    const m = count ? new THREE.InstancedMesh(geometry, material, count) : new THREE.Mesh(geometry, material);
    m.visible = false; m.renderOrder = 1250; m.userData.surg = id; parent.add(m); surg[id] = m; return m;
  }
  const iolG = EyeModel.SURG.iol();
  addSurg('iol', iolG.optic, smat(0xeaf6ff, 0.55, { roughness: 0.1 }));
  addSurg('iolHaptics', iolG.haptics, smat(0x9fc4ff, 1));
  addSurg('icl', EyeModel.SURG.icl(), smat(0xcfe6ff, 0.5, { roughness: 0.1 }));
  addSurg('spectacle', EyeModel.SURG.spectacle(), smat(0xbfe0ff, 0.3, { roughness: 0.05 }), eyeGroup);
  addSurg('buckle', EyeModel.SURG.buckle(), smat(0xd9d2c4, 1));
  addSurg('bleb', EyeModel.SURG.bleb(), smat(0xe6f2f8, 0.6, { roughness: 0.2 }));
  addSurg('shunt', EyeModel.SURG.shunt(), smat(0xf2f2f2, 1));
  addSurg('iridotomy', EyeModel.SURG.iridotomy(), smat(0x111111, 1));
  addSurg('graft', EyeModel.SURG.graft(), smat(0x1b1b3a, 1));
  addSurg('icrs', EyeModel.SURG.icrs(), smat(0xd0e8ff, 0.9, { roughness: 0.1 }));
  const syr = EyeModel.SURG.syringe();
  addSurg('syringeNeedle', syr.needle, smat(0xc9c9c9, 1, { metalness: 0.6, roughness: 0.3 }), eyeGroup);
  addSurg('syringe', syr.body, smat(0xf7f7f7, 0.9), eyeGroup);
  addSurg('probe', EyeModel.SURG.probe(), smat(0xc0c0c0, 1, { metalness: 0.6, roughness: 0.3 }), eyeGroup);
  addSurg('gasBubble', EyeModel.SURG.gasBubble(), smat(0xdff2ff, 0.45, { roughness: 0.05 }));
  addSurg('laserSpots', new THREE.CircleGeometry(0.26, 12), smat(0xe9dcc0, 1), globeLocal, 420);
  addSurg('sltSpots', new THREE.SphereGeometry(0.12, 8, 6), smat(0xfff2b0, 1, { emissive: 0x554400 }), globeLocal, 48);
  addSurg('sutures', new THREE.SphereGeometry(0.22, 8, 6), smat(0x2a2a4a, 1), globeLocal, 3);
  addSurg('suturesLid', new THREE.SphereGeometry(0.22, 8, 6), smat(0x2a2a4a, 1), eyeGroup, 3);
  const surgMeshes = Object.values(surg);
  function placeSpots(inst, pts) {
    const n = Math.min(pts.length, inst.instanceMatrix.count);
    for (let i = 0; i < n; i++) { const p = pts[i], nrm = p.clone().normalize(); _q.setFromUnitVectors(V3(0, 0, 1), nrm.negate()); _s.set(1, 1, 1); _m.compose(p, _q, _s); inst.setMatrixAt(i, _m); }
    inst.count = n; inst.instanceMatrix.needsUpdate = true; inst.visible = n > 0;
  }
  function placeSpheres(inst, pts) { pts.forEach((p, i) => { _q.identity(); _s.set(1, 1, 1); _m.compose(p, _q, _s); inst.setMatrixAt(i, _m); }); inst.count = pts.length; inst.instanceMatrix.needsUpdate = true; }
  placeSpheres(surg.sltSpots, EyeModel.SURG.sltSpots());
  placeSpheres(surg.sutures, EyeModel.SURG.suturePoints('strab'));
  placeSpheres(surg.suturesLid, EyeModel.SURG.suturePoints('ptosis'));
  // Лечение: выбранный вариант по каждому состоянию
  const treat = {}; CONDITIONS.forEach(c => treat[c.id] = { id: null, last: null });
  function activeTreatment(condId) {
    const t = treat[condId]; if (!t || !cond[condId].on || !t.id) return null;
    const tr = (TREATMENTS[condId] || []).find(x => x.id === t.id); if (!tr) return null;
    const c = condById[condId];
    if (tr.forType && c.options && cond[condId][c.options.id] !== tr.forType) return null;
    return tr;
  }
  const TX = (id) => (activeTreatment(id) || {}).effects || {};
  const TREAT_VIEWS = {
    bleb: { pos: [-6, 24, 26], target: [0, 6, 6] }, shunt: { pos: [-30, 20, 22], target: [-4, 1, 2] }, buckle: { pos: [-34, 10, 14], target: [0, 0, -2], clip: { on: true, axis: 'h', offset: 0, flip: false } },
    syringe: { pos: [-32, 26, 20], target: [-6, 4, -2], clip: { on: false } }, probe: { pos: [26, 16, 42], target: [15, -3, 6], clip: { on: false } }, spectacle: { pos: [-38, 10, 30], target: [0, 0, 12], clip: { on: false } },
    graft: { pos: [-16, 12, 28], target: [0, 0, 10], clip: { on: false } }, icrs: { pos: [-16, 12, 28], target: [0, 0, 10], clip: { on: false } }, gasBubble: { pos: [-32, 12, 6], target: [0, 0, -2], clip: { on: true, axis: 'h', offset: 0, flip: false } },
    iridotomy: { pos: [-8, 18, 24], target: [0, 4, 8], clip: { on: false } }, sltSpots: { pos: [-14, 9, 17], target: [5.6, 0, 9], clip: { on: true, axis: 'h', offset: 0, flip: false } },
    sutures: { pos: [-8, 22, 30], target: [8, 0, 6], clip: { on: false } }, icl: { pos: [7, 12, 26], target: [0, -0.5, 7.5], clip: { on: true, axis: 'h', offset: 0, flip: false } },
    laserSpots: { pos: [0.5, 0, 6], target: [0.3, 0, -10], clip: { on: false } },
  };
  function surgAnchor(el) {
    const id = el === 'sutures' ? (surg.suturesLid.visible ? 'suturesLid' : 'sutures') : el;
    const m = surg[id];
    if (!m) { const lab = labels[el === 'cxl' ? 'cornea' : 'sclera']; return lab ? lab.getWorldPosition(new THREE.Vector3()) : null; }
    if (!m.visible) return null;
    if (m.isInstancedMesh) { if (!m.count) return null; const mat = new THREE.Matrix4(); m.getMatrixAt(Math.floor(m.count / 2), mat); return m.localToWorld(new THREE.Vector3().setFromMatrixPosition(mat)); }
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    return m.localToWorld(m.geometry.boundingSphere.center.clone());
  }
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
  let demoUntil = 0, pvAutoPinned = false, quietUI = false; // усиленная подсветка на время анимации; окно пациента, открытое автоматически; без открытия панелей на телефоне
  function setFocus(id, opts = {}) {
    focus.cond = id;
    const on = !!id && cond[id].on;
    if (on) {
      const c = condById[id];
      conditionView(c).affects.forEach(a => setVisible(a, true));
      (c.show || []).forEach(a => setVisible(a, true)); // структуры для контекста, без подсветки
      if (c.group === 'child' && !isChild() && !opts.keepAge) setAgeByYears(c.typicalAge || 3);
      const grp = (c.groups || [c.group]).includes(isChild() ? 'child' : 'adult') ? (isChild() ? 'child' : 'adult') : c.group;
      const wrap = document.querySelector(`.cond-group[data-grp="${grp}"]`); if (wrap) wrap.classList.remove('collapsed');
      if (ui.fly && !opts.noFly) flyToCondition(id);
      pulse.until = performance.now() + 2600;
      // после подлёта проигрываем переход от нормы к выбранной степени, чтобы изменение было видно в движении
      if (opts.demo) setTimeout(() => { if (cond[id].on && focus.cond === id) demo(id); }, ui.fly && !opts.noFly ? 950 : 150);
    }
    document.querySelectorAll('.cond').forEach(b => b.classList.toggle('focus', on && b.dataset.cond === id));
    if (!on && pvAutoPinned) setPvFloat(false);
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
      markerObj.position.set(...v.marker); if (focus.cond === 'ametropia' || focus.cond === 'child_myopia') markerObj.position.y -= params.elong;
      const c = condById[focus.cond], p = c.params[0], tr = activeTreatment(c.id);
      markerDiv.textContent = (v.short || c.name) + (p ? ' · ' + fmt(cond[c.id][p.id], p) : '') + (tr ? ' · после лечения' : '');
      markerDiv.classList.toggle('post', !!tr);
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
    age.idx = best; $('#age').value = best; applyConditions(); syncCondGroups();
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
    const tx = {}; CONDITIONS.forEach(x => tx[x.id] = TX(x.id)); // эффекты выбранного лечения
    // --- геометрические параметры ---
    const cg = c.congenital_glaucoma.on ? c.congenital_glaucoma.severity / 100 : 0;
    params.elong = (c.ametropia.on ? -c.ametropia.diopters * 0.35 : 0) + (c.child_myopia.on ? -c.child_myopia.diopters * 0.35 : 0);
    params.cone = (c.keratoconus.on ? c.keratoconus.severity / 100 : 0) * (tx.keratoconus.coneScale !== undefined ? tx.keratoconus.coneScale : 1);
    params.cdr = c.glaucoma.on ? c.glaucoma.cdr : (cg ? 0.3 + 0.55 * cg : 0.3);
    params.bombe = (c.glaucoma.on && c.glaucoma.type === 'closed' && !tx.glaucoma.bombeZero) ? 0.55 : 0;
    params.pupil = ap.pupil * (tx.child_myopia.pupilWide ? 1.3 : 1); // атропин 0,01 % слегка расширяет зрачок
    params.limbScale = ap.limb * (1 + 0.3 * cg);
    params.lensThick = ap.lensThick;
    params.ptosis = c.ptosis.on ? c.ptosis.drop * (1 - (tx.ptosis.dropFix || 0)) : 0;
    params.physHyper = ap.hyper;
    params.atrophy = c.glaucoma.on ? Math.min(1, (c.glaucoma.cdr - 0.3) / 0.65) : cg * 0.6; // истончение зрительного нерва
    params.cyl = c.astigmatism.on ? c.astigmatism.cyl : 0;
    params.astig = tx.astigmatism.astigZero ? 0 : params.cyl * 0.06; params.astigAxis = c.astigmatism.on ? c.astigmatism.axis : 0; // преувеличено ради наглядности
    params.ablation = (tx.ametropia.ablation ? -c.ametropia.diopters * 0.03 : 0) + (tx.child_myopia.okFlat ? -c.child_myopia.diopters * 0.03 : 0); // лазерная коррекция или ночные линзы: уплощение центра (преувеличено)
    params.corrected = !!(tx.ametropia.corrected || tx.astigmatism.corrected || tx.child_myopia.corrected);
    // ИОЛ вместо хрусталика; витрэктомия убирает стекловидное тело
    const iolOn = !!(tx.cataract.iol || tx.congenital_cataract.iol || tx.ametropia.iol || tx.astigmatism.iol);
    [S.lens, S.lens_nucleus].forEach(e => { if (e.surgHidden !== iolOn) { e.surgHidden = iolOn; refreshVisibility(e); } });
    const vitGone = !!(tx.detachment.vitreousGone || tx.diabetic.vitreousGone);
    if (S.vitreous.surgHidden !== vitGone) { S.vitreous.surgHidden = vitGone; refreshVisibility(S.vitreous); }
    surg.iol.visible = iolOn; surg.iolHaptics.visible = iolOn;
    surg.icl.visible = !!tx.ametropia.icl; surg.spectacle.visible = !!(tx.astigmatism.spectacle || tx.child_myopia.spectacle);
    surg.bleb.visible = !!tx.glaucoma.bleb; surg.shunt.visible = !!tx.glaucoma.shunt; surg.iridotomy.visible = !!tx.glaucoma.iridotomy; surg.sltSpots.visible = !!tx.glaucoma.sltSpots;
    surg.graft.visible = !!tx.keratoconus.graft; surg.icrs.visible = !!tx.keratoconus.icrs;
    const syrOn = !!(tx.amd.syringe || tx.diabetic.syringe || tx.crvo.syringe || tx.rop.syringe);
    surg.syringe.visible = syrOn; surg.syringeNeedle.visible = syrOn;
    surg.probe.visible = !!tx.nld_obstruction.probe; surg.gasBubble.visible = !!tx.detachment.gas; surg.buckle.visible = !!tx.detachment.buckle;
    surg.sutures.visible = tx.strabismus.sutures === 'strab'; surg.suturesLid.visible = tx.ptosis.sutures === 'ptosis';
    // масштаб: возраст — весь глаз с орбитой, буфтальм — только яблоко
    eyeGroup.scale.setScalar(ap.s); detailGroup.scale.setScalar(ap.s);
    const g = 1 + 0.22 * cg; globeLocal.scale.setScalar(g); globeWorld.scale.setScalar(g);
    ghostGroup.visible = isChild(); // контур взрослого глаза для сравнения с детским
    // косоглазие: поворот яблока вокруг вертикальной оси; медиальная и латеральная мышцы напрягаются/растягиваются
    const angle = c.strabismus.on && !tx.strabismus.angleZero ? c.strabismus.angle * DEG : 0;
    globeLocal.rotation.z = -angle; globeWorld.rotation.y = angle;
    gazeGroup.visible = c.strabismus.on; visualAxis.visible = c.strabismus.on;
    const sk = c.strabismus.on && !tx.strabismus.angleZero ? c.strabismus.angle / 30 : 0;
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
    const key = [params.elong, params.cone, params.cdr, params.bombe, params.pupil, params.limbScale, params.lensThick, params.ptosis, params.atrophy, params.astig, params.astigAxis, params.ablation, params.corrected].join('|');
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
    const iopFixed = !!tx.glaucoma.iopNormal, cgT = cg * (1 - (tx.congenital_glaucoma.hazeReduce || 0));
    const kIop = c.glaucoma.on && !iopFixed ? Math.max(0, Math.min(1, (c.glaucoma.iop - 21) / 24)) : 0;
    const closed = c.glaucoma.on && c.glaucoma.type === 'closed';
    const attack = closed && !iopFixed ? Math.max(0, Math.min(1, (c.glaucoma.iop - 28) / 15)) : 0; // острый приступ
    S.optic_nerve.mesh.material.color.copy(nerveBase).lerp(nervePale, Math.min(1, gk * 1.1));
    S.disc.mesh.material.color.setHex(byId.disc.color).lerp(new THREE.Color(0xf5e2cf), gk * 0.7);
    // трабекула и шлеммов канал засоряются с ростом ВГД (открытоугольная форма), недоразвиты при врождённой глаукоме
    S.trabecular.mesh.material.color.setHex(byId.trabecular.color).lerp(new THREE.Color(0x7f5b3c), closed ? 0 : kIop).lerp(new THREE.Color(0x9aa0a8), cgT);
    S.trabecular.cap.material.color.copy(S.trabecular.mesh.material.color).multiplyScalar(0.85);
    S.schlemm.mesh.material.color.setHex(byId.schlemm.color).lerp(new THREE.Color(0x24285a), closed ? 0 : kIop);
    // решётчатая пластинка прогибается назад под давлением
    if (S.lamina_cribrosa.detail) S.lamina_cribrosa.detail.position.set(0.259, 0, -0.966).multiplyScalar(0.5 * Math.max(kIop, iopFixed ? 0 : gk * 0.6));
    // роговица отекает при врождённой глаукоме и остром приступе; склера краснеет при приступе; кросслинкинг подкрашивает строму
    const haze = Math.max(cgT * 0.9, attack * 0.8);
    const corneaM = S.cornea.mesh.material;
    corneaM.color.copy(corneaBase).lerp(corneaHaze, haze).lerp(new THREE.Color(0xd4ecb8), tx.keratoconus.cxl ? 0.45 : 0);
    S.cornea.baseOpacity = byId.cornea.opacity + 0.5 * haze;
    S.sclera.mesh.material.color.setHex(byId.sclera.color).lerp(new THREE.Color(0xefcfc8), attack);
    S.sclera.cap.material.color.copy(S.sclera.mesh.material.color).multiplyScalar(0.85);

    // --- катаракта взрослая и врождённая ---
    const cat = c.cataract.on && !tx.cataract.iol ? c.cataract.severity / 100 : 0, ct = c.cataract.type;
    const cc = c.congenital_cataract.on && !tx.congenital_cataract.iol ? c.congenital_cataract.severity / 100 : 0, cct = c.congenital_cataract.type;
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
    const rb = c.retinoblastoma.on ? c.retinoblastoma.severity / 100 : 0, rbShrink = tx.retinoblastoma.tumorShrink || 1;
    const rbk = rb.toFixed(2) + '|' + rbShrink;
    if (rbk !== lastRbKey) { lastRbKey = rbk; if (rb > 0) { patho.rbMass.geometry.dispose(); patho.rbMass.geometry = EyeModel.retinoblastomaGeometry((0.5 + 2.2 * rb) * rbShrink); } }
    patho.rbMass.visible = rb > 0; patho.rbMass.material.color.setHex(rbShrink < 1 ? 0xd9d4c4 : 0xf3efd8);
    const nCalc = rb > 0.2 ? Math.min(Math.round(rb * 24), PTS.calc.length) : 0;
    if (nCalc) { const size = (0.5 + 2.2 * rb) * rbShrink, cc0 = fundus(-3, -3, E.R_ret - 0.9 * size); for (let i = 0; i < nCalc; i++) { const p = PTS.calc[i]; placeSphere(patho.rbCalc, i, cc0.clone().add(V3((p[0]) * size * 0.9, (p[1]) * size * 0.9, (p[2] - 0.5) * size * 1.2)), 0.6 + p[2]); } }
    commit(patho.rbCalc, nCalc);
    // отсевы опухоли в стекловидное тело при большом размере
    const nSeed = rb > 0.5 && !tx.retinoblastoma.seedsGone ? Math.min(Math.round((rb - 0.5) * 40), PTS.seeds.length) : 0;
    if (nSeed) { const size = 0.5 + 2.2 * rb, c0 = fundus(-3, -3, E.R_ret - 0.9 * size); for (let i = 0; i < nSeed; i++) { const p = PTS.seeds[i]; placeSphere(patho.rbSeeds, i, c0.clone().multiplyScalar(0.85 - 0.55 * p[2]).add(V3(p[0] * 3, p[1] * 3, (p[2] - 0.5) * 4)), 0.5 + p[2]); } }
    commit(patho.rbSeeds, nSeed);
    // лейкокория: белый зрачок при плотной катаракте или крупной опухоли
    patho.leukocoria.visible = (cc > 0.5 && cct !== 'nuclear') || (rb > 0.35 && rbShrink === 1);
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
    const ropTreated = !!tx.rop.ropRegress;
    patho.ropZone.visible = ropStage > 0; patho.ropRidge.visible = ropStage > 0 && !ropTreated;
    if (ropTreated) commit(patho.ropTufts, 0);

    // --- отслойка (взрослая и как стадии 4–5 РН) ---
    const det = c.detachment.on && !tx.detachment.reattach ? c.detachment.extent / 100 : 0;
    const lift = Math.max(det > 0 ? 0.4 + 3.0 * det : 0, ropStage >= 4 && !ropTreated ? (ropStage === 4 ? 2.2 : 3.6) : 0);
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
    if (wet && amd > 0 && !tx.amd.cnvGone) {
      patho.cnv.geometry.dispose(); patho.cnv.geometry = tangleGeometry(0.2, -0.1, 1.2 + 1.6 * amd, E.R_ret + 0.08, 5, 4 + Math.round(amd * 6), 0.06);
      placeOnFundus(patho.cnvBlood, 0, 0.4, -0.3, E.R_ret - 0.06, 0.5 + 1.6 * amd, 0.4 + 1.2 * amd, 0.4); commit(patho.cnvBlood, 1);
      patho.cnv.visible = true;
    } else { patho.cnv.visible = false; commit(patho.cnvBlood, 0); }

    // --- диабетическая ретинопатия ---
    const dr = c.diabetic.on ? c.diabetic.severity / 100 : 0, drHem = 1 - (tx.diabetic.hemReduce || 0);
    const cap = (inst, pts, n) => Math.min(n, pts.length, inst.instanceMatrix.count);
    const nMa = cap(patho.microan, PTS.microan, Math.round(dr * 60 * drHem)), nDh = cap(patho.dotHem, PTS.dotHem, Math.round(Math.max(0, dr - 0.2) * 30 * drHem)), nEx = cap(patho.exudate, PTS.exudate, Math.round(Math.max(0, dr - 0.3) * 70 * drHem));
    for (let i = 0; i < nMa; i++) placeSphere(patho.microan, i, PTS.microan[i], 1);
    commit(patho.microan, nMa);
    for (let i = 0; i < nDh; i++) { const p = PTS.dotHem[i]; placeOnFundus(patho.dotHem, i, p[0], p[1], E.R_ret - 0.05, 0.6 + p[2] * 0.8, 0.5 + p[2] * 0.6, p[2] * 3); }
    commit(patho.dotHem, nDh);
    for (let i = 0; i < nEx; i++) { const p = PTS.exudate[i]; placeOnFundus(patho.exudate, i, p[0], p[1], E.R_ret - 0.04, 0.7 + p[2] * 0.8, 0.7 + p[2] * 0.8, 0); }
    commit(patho.exudate, nEx);
    if (dr > 0.7 && !tx.diabetic.nvdGone) { patho.nvd.geometry.dispose(); patho.nvd.geometry = tangleGeometry(2.7, 0.2, 1.4 + (dr - 0.7) * 5, E.R_ret - 0.2, 9, 6, 0.05); patho.nvd.visible = true; } else patho.nvd.visible = false;
    // кровь в стекловидном теле при тяжёлой стадии
    const vh = tx.diabetic.vhGone ? 0 : Math.max(0, (dr - 0.85) / 0.15);
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
    const nFl = Math.min(Math.round(crvo * 80 * (1 - (tx.crvo.hemReduce || 0))), PTS.flame.length, patho.flameHem.instanceMatrix.count);
    for (let i = 0; i < nFl; i++) { const p = PTS.flame[i]; const ang = Math.atan2(p[1], p[0] - 2.7); placeOnFundus(patho.flameHem, i, p[0], p[1], E.R_ret - 0.05, 0.35 + p[2] * 0.5, 1.2 + p[2] * 1.4, ang); }
    commit(patho.flameHem, nFl);

    // --- макула: отёк при диабете/тромбозе/влажной ВМД; бледность при амблиопии условна ---
    const edema = Math.min(1, (dr > 0.4 && !tx.diabetic.edemaGone ? dr * 0.8 : 0) + (tx.crvo.edemaGone ? 0 : crvo * 0.9) + (wet && !tx.amd.edemaGone ? amd : 0));
    const amb = c.amblyopia.on ? c.amblyopia.severity / 100 : 0;
    const atrophy = (!wet && amd > 0.5) ? (amd - 0.5) * 2 : 0; // географическая атрофия при сухой ВМД
    S.macula.mesh.material.color.copy(macBase).lerp(macEdema, edema).lerp(new THREE.Color(0xe8d9c2), atrophy).lerp(macPale, amb * 0.8);
    S.macula.cap.material.color.copy(S.macula.mesh.material.color).multiplyScalar(0.85);

    // --- непроходимость носослёзного канала ---
    const nldOpen = tx.nld_obstruction.nldOpen || 0;
    const nld = c.nld_obstruction.on ? c.nld_obstruction.severity / 100 * (1 - nldOpen) : 0;
    patho.nldSac.visible = nld > 0; patho.nldSac.scale.setScalar(1.05 + 0.7 * nld);
    patho.nldPlug.visible = nld > 0 && nldOpen < 1; patho.nldPlug.scale.setScalar(1 - 0.6 * nldOpen);
    patho.tearLake.visible = nld > 0; patho.tearLake.scale.setScalar(0.5 + nld);

    // --- лазерные коагуляты: панретинальные, кольцо вокруг разрыва или аваскулярная зона при РН ---
    if (tx.diabetic.prp || tx.crvo.prp) placeSpots(surg.laserSpots, EyeModel.SURG.prpPoints());
    else if (tx.detachment.laserRing) placeSpots(surg.laserSpots, EyeModel.SURG.ringPoints());
    else if (tx.rop.ropLaser && ropStage) placeSpots(surg.laserSpots, EyeModel.SURG.ropPoints(ropStage));
    else surg.laserSpots.visible = false;

    updateNormGhosts(ap, { angle: c.strabismus.on && !tx.strabismus.angleZero ? c.strabismus.angle : 0, g });
    applyOpacity();
    renderPatientView();
    renderConditionNotes();
    renderAgeInfo();
    updateMarker();
    $('#parents').hidden = !FT.parents || !(isChild() || CONDITIONS.some(x => x.group === 'child' && cond[x.id].on));
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
    const rel = (id) => 1 - (((activeTreatment(id) || {}).effects || {}).relief || 0); // насколько лечение снимает жалобы
    const cat = (c.cataract.on ? c.cataract.severity / 100 : 0) * rel('cataract'), ct = c.cataract.type;
    const cc = (c.congenital_cataract.on ? c.congenital_cataract.severity / 100 : 0) * rel('congenital_cataract');
    const D = (c.ametropia.on ? Math.abs(c.ametropia.diopters) : 0) * rel('ametropia') + (c.child_myopia.on ? -c.child_myopia.diopters : 0) * rel('child_myopia');
    const cone = (c.keratoconus.on ? c.keratoconus.severity / 100 : 0) * rel('keratoconus');
    const gk = c.glaucoma.on ? Math.min(1, (c.glaucoma.cdr - 0.3) / 0.65) : 0; // выпавшее поле зрения при глаукоме не возвращается
    const cg = (c.congenital_glaucoma.on ? c.congenital_glaucoma.severity / 100 : 0) * rel('congenital_glaucoma');
    const det = (c.detachment.on ? c.detachment.extent / 100 : 0) * rel('detachment');
    const amd = (c.amd.on ? c.amd.severity / 100 : 0) * rel('amd'), wet = c.amd.type === 'wet';
    const dr = (c.diabetic.on ? c.diabetic.severity / 100 : 0) * rel('diabetic');
    const crvo = (c.crvo.on ? c.crvo.severity / 100 : 0) * rel('crvo');
    const rb = (c.retinoblastoma.on ? c.retinoblastoma.severity / 100 : 0) * rel('retinoblastoma');
    const rop = c.rop.on ? Math.round(c.rop.stage * rel('rop')) : 0;
    const strab = (c.strabismus.on ? Math.abs(c.strabismus.angle) / 30 : 0) * rel('strabismus');
    const ast = (c.astigmatism.on ? c.astigmatism.cyl / 6 : 0) * rel('astigmatism'), astAx = c.astigmatism.on ? c.astigmatism.axis * Math.PI / 180 : 0;
    const pt = (c.ptosis.on ? c.ptosis.drop / 7 : 0) * rel('ptosis');
    const nld = (c.nld_obstruction.on ? c.nld_obstruction.severity / 100 : 0) * rel('nld_obstruction');
    const amb = (c.amblyopia.on ? c.amblyopia.severity / 100 : 0) * rel('amblyopia');

    const blur = cat * (ct === 'psc' ? 6 : ct === 'nuclear' ? 5 : 3.5) + cc * 7 + D * 0.55 + cone * 3 + crvo * 3 + dr * 1.8 + (wet ? amd * 1.5 : 0) + cg * 3 + nld * 1.2 + amb * 5 + (rop >= 4 ? 4 : 0);
    const sepia = ct === 'nuclear' ? cat * 0.85 : cat * 0.2;
    const contrast = 1 - 0.45 * cat - 0.25 * crvo - 0.15 * dr - 0.4 * cc - 0.25 * cg - 0.3 * amb;
    const bright = 1 + 0.35 * cat * (ct === 'psc' ? 1 : ct === 'cortical' ? 0.6 : 0.25) + 0.3 * cc + 0.2 * cg;
    const sat = 1 - 0.5 * amb;
    pvCanvas.style.filter = `blur(${blur.toFixed(1)}px) sepia(${sepia.toFixed(2)}) contrast(${Math.max(0.2, contrast).toFixed(2)}) brightness(${bright.toFixed(2)}) saturate(${sat.toFixed(2)})`;
    const ghost = cone * 0.6 + (ct === 'cortical' ? cat * 0.35 : 0) + strab * 0.55 + ast * 0.7;
    pvGhost.style.opacity = ghost.toFixed(2);
    // при астигматизме изображение «тянется» вдоль слабого меридиана
    pvGhost.style.transform = `translate(${(cone * 10 + (ct === 'cortical' ? cat * 5 : 0) + strab * 60 + ast * 9 * Math.cos(astAx)).toFixed(1)}px, ${(cone * 5 - ast * 9 * Math.sin(astAx)).toFixed(1)}px)`;
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
    if (c.ametropia.on && c.ametropia.diopters !== 0 && rel('ametropia') > 0) notes.push(c.ametropia.diopters < 0 ? 'Близорукость без очков: вдаль размыто.' : 'Дальнозоркость без очков: нечётко и утомительно.');
    if (c.child_myopia.on && c.child_myopia.diopters < 0 && rel('child_myopia') > 0) notes.push('Близорукость у ребёнка: доска и лица вдали размыты, книга вблизи чёткая.');
    if (cone) notes.push('Кератоконус: двоение и искажения.');
    if (ast) notes.push('Астигматизм: линии одного направления размыты, буквы «тянутся» в сторону.');
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
    const treated = CONDITIONS.filter(x => activeTreatment(x.id)).map(x => activeTreatment(x.id).name);
    if (treated.length) notes.push('После лечения (' + treated.join(', ') + ').');
    $('#pvNote').textContent = notes.length ? notes.join(' ') : 'Норма: чёткое изображение по всему полю.';
  }

  // ---------- Панель слоёв ----------
  const groupOpacity = {}; GROUPS.forEach(g => groupOpacity[g.id] = 1);
  let selectedId = null;
  function buildLayers() {
    const root = $('#layers'); root.innerHTML = '';
    GROUPS.filter(g => !cfg.hideGroups.includes(g.id)).forEach(g => {
      const box = document.createElement('div'); box.className = 'group'; box.dataset.group = g.id;
      const head = document.createElement('div'); head.className = 'group-head';
      head.innerHTML = `<input type="checkbox" class="gchk" title="Показать/скрыть группу"><span class="name" title="${g.hint}">${g.name}</span><button class="lbl ${labelGroups[g.id] ? 'on' : ''}" title="Подписи этой группы">Аа</button><input type="range" class="gop" min="0.05" max="1" step="0.05" value="1" title="Прозрачность группы"><span class="tw">▾</span>`;
      head.querySelector('.lbl').addEventListener('click', (e) => { labelGroups[g.id] = !labelGroups[g.id]; e.target.classList.toggle('on', labelGroups[g.id]); updateLabels(); });
      const body = document.createElement('div'); body.className = 'group-body';
      STRUCTURES.filter(s => s.group === g.id && !structHidden(s.id)).forEach(s => {
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
  function setVisible(id, v) { const e = S[id]; if (!e) return; e.visible = v && !structHidden(id); refreshVisibility(e); syncLayerUI(); }
  function syncLayerUI() {
    GROUPS.forEach(g => {
      const ids = STRUCTURES.filter(s => s.group === g.id && !structHidden(s.id)).map(s => s.id);
      const n = ids.filter(id => S[id].visible).length;
      const chk = document.querySelector(`.group[data-group="${g.id}"] .gchk`);
      if (chk) { chk.checked = n === ids.length; chk.indeterminate = n > 0 && n < ids.length; }
    });
    document.querySelectorAll('.row').forEach(r => { r.querySelector('.schk').checked = S[r.dataset.id].visible; r.classList.toggle('sel', r.dataset.id === selectedId); });
    updateLabels();
  }
  // В режиме проблемы: затронутое ярко, несколько соседних структур бледно для ориентира, остальные слои скрыты
  const DEFAULT_CONTEXT = ['sclera', 'cornea', 'retina', 'iris'];
  const focusEmissive = () => new THREE.Color(0x3a2208).multiplyScalar(0.6 + 1.3 * show.highlight).getHex(); // тёплая подсветка затронутого, сила по ползунку
  function applyOpacity() {
    const F = focusSet();
    const ctx = F ? new Set(conditionView(condById[focus.cond]).context || DEFAULT_CONTEXT) : null;
    STRUCTURES.forEach(s => {
      const e = S[s.id];
      let op = Math.min(1, e.baseOpacity) * groupOpacity[s.group];
      let emissive = 0, hide = false;
      if (F) {
        if (F.has(s.id)) { op = Math.min(1, Math.max(op, e.baseOpacity < 1 ? e.baseOpacity + 0.3 + 0.5 * show.highlight : 1)); emissive = focusEmissive(); }
        else if (ctx.has(s.id) || s.id === selectedId) { const co = s.id === selectedId ? Math.max(show.context, 0.3) : show.context; if (co < 0.01) hide = true; else op = Math.min(op, co); }
        else hide = true;
      }
      if (e.focusHidden !== hide) { e.focusHidden = hide; refreshVisibility(e); }
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
    if (isMobile() && !quietUI) { $('#right').classList.add('open'); $('#left').classList.remove('open'); syncMobileBar(); }
  }

  const raycaster = new THREE.Raycaster();
  let downPos = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(m, camera);
    const visibleCut = (h) => !clip.on || clipPlane.distanceToPoint(h.point) >= 0;
    const hits = raycaster.intersectObjects(structureMeshes.filter(o => o.visible), false).filter(visibleCut);
    const phits = raycaster.intersectObjects(pathoMeshes.filter(o => o.visible), false).filter(visibleCut);
    const shits = raycaster.intersectObjects(surgMeshes.filter(o => o.visible), false).filter(visibleCut);
    const opaque = hits.find(h => h.object.material.opacity >= 0.5);
    const firstOpaqueDist = opaque ? opaque.distance : Infinity;
    if (shits.length && shits[0].distance <= firstOpaqueDist + 0.05 && (!phits.length || shits[0].distance <= phits[0].distance)) { const id = shits[0].object.userData.surg; showSurgCard(id.startsWith('iol') ? 'iol' : id.startsWith('syringe') ? 'syringe' : id === 'suturesLid' ? 'sutures' : id); return; }
    if (phits.length && phits[0].distance <= firstOpaqueDist + 0.05) { showPathoCard(phits[0].object.userData.patho); return; }
    if (!hits.length) return;
    select((opaque || hits[0]).object.userData.id);
  });
  // Карточка элемента патологии (друзы, лоскут, слёзный мешок и т. п.)
  function showPathoCard(id) {
    const info = PATHO_INFO[id]; if (!info) return;
    const owner = Object.keys(CONDITION_ELEMENTS).find(k => CONDITION_ELEMENTS[k].includes(id) && cond[k].on) || Object.keys(CONDITION_ELEMENTS).find(k => CONDITION_ELEMENTS[k].includes(id));
    const oc = owner && condById[owner];
    $('#info').innerHTML = `<h2>${info.name}</h2><div class="latin">элемент патологии${oc ? ' · ' + oc.name.replace(/\s*\(.*\)/, '') : ''}</div><p>${info.desc}</p>` +
      (oc ? `<div class="links"><button data-cond="${owner}">${(oc.short || oc.name).replace(/\s*\(.*\)/, '')}</button></div>` : '');
    $('#info').querySelectorAll('[data-cond]').forEach(b => b.addEventListener('click', () => enableCondition(b.dataset.cond)));
    if (isMobile()) { $('#right').classList.add('open'); $('#left').classList.remove('open'); syncMobileBar(); }
  }

  // ---------- Панель состояний ----------
  function buildConditions() {
    const root = $('#condList'); root.innerHTML = '';
    [['adult', 'Взрослый глаз'], ['child', 'Детский глаз']].forEach(([grp, title]) => {
      if (grp === 'child' && !FT.childConditions) return;
      const list = CONDITIONS.filter(c => condEnabled(c) && (c.groups || [c.group]).includes(grp));
      if (!list.length) return;
      const wrap = document.createElement('div'); wrap.className = 'cond-group'; wrap.dataset.grp = grp;
      const h = document.createElement('div'); h.className = 'sub-title';
      h.innerHTML = `<span>${title} <span class="cnt">(${list.length})</span></span><span class="tw">▾</span>`;
      h.addEventListener('click', () => wrap.classList.toggle('collapsed'));
      const gbody = document.createElement('div'); gbody.className = 'cond-group-body';
      wrap.appendChild(h); wrap.appendChild(gbody); root.appendChild(wrap);
      list.forEach(c => {
        const box = document.createElement('div'); box.className = 'cond'; box.dataset.cond = c.id;
        const head = document.createElement('div'); head.className = 'cond-head';
        head.innerHTML = `<input type="checkbox" class="con"><span class="name">${c.name}</span><button class="fly" title="Подлететь к проблеме">➜</button>`;
        const body = document.createElement('div'); body.className = 'cond-body';
        let html = '';
        if (c.options) html += `<label>${c.options.label}</label><select class="copt">${c.options.values.map(v => `<option value="${v.id}">${v.label}</option>`).join('')}</select>`;
        c.params.forEach(p => { html += `<label>${p.label}<span class="val" data-p="${p.id}"></span></label><input type="range" class="cp" data-p="${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.def}">`; });
        const hasTreat = FT.treatments && (TREATMENTS[c.id] || []).length;
        if (hasTreat) html += `<label>После лечения</label><select class="ctreat"></select>`;
        html += `<div class="tools"><button class="btn demo" title="Плавно показать переход от нормы к выбранной степени">Показать изменение</button>${hasTreat ? '<button class="btn ba" title="Переключить между состоянием до и после лечения">До / после</button>' : ''}</div><p class="treat"></p>`;
        html += `<div class="chips"></div>`;
        const els = FT.elements ? (CONDITION_ELEMENTS[c.id] || []).filter(e => PATHO_INFO[e]) : [];
        if (els.length) html += `<div class="elems"><span>Элементы патологии:</span>${els.map(e => `<button data-e="${e}" title="Описание">${PATHO_INFO[e].name}</button>`).join('')}</div>`;
        html += `${FT.changes ? '<div class="changes"></div>' : ''}<p class="note"></p><p>${c.desc}</p><p class="sym"><b>Жалобы:</b> ${c.symptoms}</p>`;
        if (c.signs) html += `<p class="sym parents"><b>Родителям:</b> ${c.signs}</p>`;
        body.innerHTML = html;
        head.querySelector('.con').addEventListener('change', (e) => {
          cond[c.id].on = e.target.checked; syncCondBoxes(c.id); applyConditions();
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
        const tsel = body.querySelector('.ctreat');
        if (tsel) tsel.addEventListener('change', (e) => selectTreatment(c.id, e.target.value || null));
        const ba = body.querySelector('.ba');
        if (ba) ba.addEventListener('click', () => {
          const t = treat[c.id];
          if (t.id) selectTreatment(c.id, null);
          else { const list = (TREATMENTS[c.id] || []).filter(x => !x.forType || !c.options || cond[c.id][c.options.id] === x.forType); selectTreatment(c.id, t.last && list.find(x => x.id === t.last) ? t.last : (list[0] && list[0].id)); }
        });
        body.addEventListener('click', (e) => { const b = e.target.closest('.chips button'); if (b) select(b.dataset.s); const eb = e.target.closest('.elems button'); if (eb) showPathoCard(eb.dataset.e); });
        box.appendChild(head); box.appendChild(body); gbody.appendChild(box);
      });
    });
    renderConditionNotes();
    syncCondGroups();
  }
  // Выбор лечения: перестраивает модель на состояние «после», подлетает к хирургическому элементу
  function selectTreatment(condId, tId) {
    const t = treat[condId]; t.id = tId || null; if (tId) t.last = tId;
    if (tId && !cond[condId].on) { const chk = visibleBox(condId).querySelector('.con'); chk.checked = true; chk.dispatchEvent(new Event('change')); }
    applyConditions();
    if (focus.cond !== condId) setFocus(condId, { noFly: true });
    const tr = activeTreatment(condId);
    if (tr && ui.fly) { const el = (tr.elements || []).find(e => TREAT_VIEWS[e]); if (el) { const v = TREAT_VIEWS[el]; if (v.clip) { Object.assign(clip, { flip: false }, v.clip); updateClipPlane(); } const sc = globeScale(); const tg = V3(...v.target).multiplyScalar(sc), p = V3(...v.pos).sub(V3(...v.target)).multiplyScalar(sc).add(tg); flyTo(p.toArray(), tg.toArray()); } }
    pulse.until = performance.now() + 1800;
    updateMarker(); updateLabels();
  }
  function showSurgCard(el) {
    const info = SURG_INFO[el]; if (!info) return;
    const owner = focus.cond && activeTreatment(focus.cond) && (activeTreatment(focus.cond).elements || []).includes(el) ? focus.cond : null;
    const tr = owner && activeTreatment(owner);
    $('#info').innerHTML = `<h2>${info.name}</h2><div class="latin">хирургический элемент${tr ? ' · ' + tr.name : ''}</div><p>${info.desc}</p>` + (tr ? `<h4>Результат</h4><p>${tr.result}</p>` : '');
    if (isMobile()) { $('#right').classList.add('open'); $('#left').classList.remove('open'); syncMobileBar(); }
  }
  // Одна проблема может стоять в обеих группах — состояние одно, блоки синхронизируются
  const boxesOf = (id) => [...document.querySelectorAll(`.cond[data-cond="${id}"]`)];
  function syncCondBoxes(id) { boxesOf(id).forEach(b => { b.querySelector('.con').checked = !!cond[id].on; b.classList.toggle('on', !!cond[id].on); }); }
  // Блок проблемы в раскрытой группе, иначе первый
  const visibleBox = (id) => boxesOf(id).find(b => !b.closest('.cond-group').classList.contains('collapsed')) || boxesOf(id)[0];
  // Группа проблем другого возраста сворачивается; развернуть можно вручную щелчком по заголовку
  function syncCondGroups() {
    document.querySelectorAll('.cond-group').forEach(w => w.classList.toggle('collapsed', (w.dataset.grp === 'child') !== isChild()));
  }
  function fmt(v, p) { return (p.step < 1 ? v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : Math.round(v)) + p.unit; }
  function renderConditionNotes() {
    CONDITIONS.forEach(c => boxesOf(c.id).forEach(box => {
      // список затронутого и пояснения «что меняется» зависят от формы болезни
      const cv = conditionView(c), ck = c.id + '|' + (c.options ? cond[c.id][c.options.id] : '');
      if (box.dataset.ck !== ck) {
        box.dataset.ck = ck;
        const name = (a) => byId[a].name.replace(/\s*\(.*\)/, '');
        box.querySelector('.chips').innerHTML = '<span>Затронуто:</span>' + cv.affects.filter(a => byId[a]).map(a => `<button data-s="${a}" title="Показать описание">${name(a)}</button>`).join('');
        const ch = cv.changes || {}, chEl = box.querySelector('.changes');
        if (chEl) {
          const items = cv.affects.filter(a => byId[a] && ch[a]).map(a => `<li><b>${name(a)}</b> — ${ch[a]}</li>`);
          if (ch._note) items.push(`<li class="n">${ch._note}</li>`);
          chEl.innerHTML = items.length ? `<div class="chg-title">Что меняется</div><ul class="chg">${items.join('')}</ul>` : '';
        }
      }
      c.params.forEach(p => { const v = cond[c.id][p.id]; const el = box.querySelector(`.val[data-p="${p.id}"]`); if (el) el.textContent = fmt(v, p); const inp = box.querySelector(`.cp[data-p="${p.id}"]`); if (inp && parseFloat(inp.value) !== v) inp.value = v; });
      // варианты лечения для текущей формы болезни и описание выбранного
      const tsel = box.querySelector('.ctreat');
      if (tsel) {
        const list = (TREATMENTS[c.id] || []).filter(x => !x.forType || !c.options || cond[c.id][c.options.id] === x.forType);
        const want = '<option value="">нет — текущее состояние</option>' + list.map(x => `<option value="${x.id}">${x.name}</option>`).join('');
        if (tsel.dataset.opts !== want) { tsel.dataset.opts = want; tsel.innerHTML = want; }
        const cur = treat[c.id].id && list.find(x => x.id === treat[c.id].id) ? treat[c.id].id : '';
        if (tsel.value !== cur) tsel.value = cur;
        const tr = activeTreatment(c.id), tp = box.querySelector('.treat');
        tp.innerHTML = tr ? `<b>${tr.name}</b><br>${tr.desc}<br><b>Результат:</b> ${tr.result}` : '';
        tp.hidden = !tr;
        const ba = box.querySelector('.ba'); if (ba) ba.classList.toggle('on', !!tr);
      }
      const note = box.querySelector('.note');
      if (c.typeNotes) note.textContent = c.typeNotes[cond[c.id][c.options.id]] || '';
      else if (c.id === 'glaucoma') note.textContent = cond.glaucoma.iop > 21 ? `ВГД ${cond.glaucoma.iop} мм рт. ст. — выше нормы (10–21).` : `ВГД ${cond.glaucoma.iop} мм рт. ст. — в пределах нормы; возможна глаукома нормального давления.`;
      else if (c.id === 'congenital_glaucoma') note.textContent = `ВГД ${cond.congenital_glaucoma.iop} мм рт. ст.; роговица увеличена примерно до ${(stop().cornea * (1 + 0.3 * cond.congenital_glaucoma.severity / 100)).toFixed(1)} мм, глаз растянут.`;
      else if (c.id === 'ametropia') { const d = cond.ametropia.diopters; note.textContent = d === 0 ? 'Эмметропия: фокус на сетчатке.' : d < 0 ? `Миопия ${d} дптр: глаз длиннее нормы примерно на ${(-d * 0.35).toFixed(1)} мм, фокус перед сетчаткой.` : `Гиперметропия +${d} дптр: глаз короче нормы примерно на ${(d * 0.35).toFixed(1)} мм, фокус за сетчаткой.`; }
      else if (c.id === 'child_myopia') { const v = cond.child_myopia, slow = TX('child_myopia').slow || 0, yrs = Math.max(0, 18 - stop().years), fut = v.diopters - v.progress * (1 - slow) * yrs, fmtD = (x) => x.toFixed(2).replace(/\.?0+$/, ''); note.textContent = v.diopters === 0 ? 'Пока эмметропия: фокус на сетчатке.' : `Миопия ${v.diopters} дптр: глаз длиннее нормы для возраста примерно на ${(-v.diopters * 0.35).toFixed(1)} мм, фокус перед сетчаткой. При ${v.progress} дптр/год${slow ? ` (лечение замедляет рост на ${Math.round(slow * 100)} %)` : ''}${yrs ? ` к 18 годам около ${fmtD(fut)} дптр${fut <= -6 ? ' — высокая близорукость, растянутая сетчатка требует осмотров' : ''}` : ' у взрослого рост обычно остановлен'}.`; }
      else if (c.id === 'strabismus') { const a = cond.strabismus.angle; note.textContent = a === 0 ? 'Оси параллельны.' : a > 0 ? `Сходящееся косоглазие (эзотропия) ${a}°: глаз отклонён к носу, красная ось — куда смотрит косящий глаз, серая — куда должен.` : `Расходящееся косоглазие (экзотропия) ${-a}°: глаз отклонён к виску.`; }
      else if (c.id === 'rop') note.textContent = ['', 'Стадия 1: тонкая демаркационная линия между сосудистой и бессосудистой сетчаткой.', 'Стадия 2: линия превращается в вал.', 'Стадия 3: на валу растут патологические сосуды — порог для лечения (лазер, анти-VEGF).', 'Стадия 4: частичная тракционная отслойка сетчатки.', 'Стадия 5: тотальная отслойка, «воронка».'][cond.rop.stage] || '';
      else if (c.id === 'ptosis') { const d = cond.ptosis.drop; note.textContent = d >= 4.6 ? `Край века ниже центра зрачка на ${(d - 4.6).toFixed(1)} мм: зрачок перекрыт, риск амблиопии.` : `Край века на ${(4.6 - d).toFixed(1)} мм выше центра зрачка.`; }
      else if (c.id === 'astigmatism') { const v = cond.astigmatism; note.textContent = v.cyl === 0 ? 'Роговица сферична, один фокус.' : `Цилиндр ${v.cyl} дптр, сильный меридиан ${v.axis}°: фокальные линии разнесены примерно на ${(v.cyl * 0.35).toFixed(1)} мм${v.cyl >= 1.5 ? '; у ребёнка старше 3 лет это показание к очкам' : ''}.`; }
      else note.textContent = '';
    }));
  }
  function enableCondition(id) {
    const box = visibleBox(id); if (!box) return;
    const chk = box.querySelector('.con');
    if (!chk.checked) { chk.checked = true; chk.dispatchEvent(new Event('change')); } else setFocus(id);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (isMobile()) { $('#right').classList.add('open'); $('#left').classList.remove('open'); syncMobileBar(); }
  }
  // Плавный переход от нормы к выбранной степени
  let demoTimer = null;
  function demo(id) {
    const c = condById[id], p = c.params[0]; if (!p) return;
    if (!cond[id].on) { const chk = visibleBox(id).querySelector('.con'); chk.checked = true; chk.dispatchEvent(new Event('change')); }
    const end = cond[id][p.id];
    const start = p.id === 'cdr' ? 0.3 : p.id === 'stage' ? 1 : p.min > 0 ? p.min : 0;
    if (demoTimer) cancelAnimationFrame(demoTimer);
    const t0 = performance.now(), ms = 1800;
    pulse.until = Math.max(pulse.until, t0 + ms + 500); demoUntil = t0 + ms + 500; // подсветка держится всю анимацию и усилена
    if (show.pvAuto && FT.patientView && !show.pvFloat) setPvFloat(true, true); // окно пациента поверх модели, чтобы не прокручивать панель
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      let v = start + (end - start) * e; v = Math.round(v / p.step) * p.step;
      cond[id][p.id] = k >= 1 ? end : v; applyConditions();
      if (k < 1) demoTimer = requestAnimationFrame(step); else demoTimer = null;
    };
    cond[id][p.id] = start; applyConditions(); demoTimer = requestAnimationFrame(step);
  }

  // ---------- Настройки: что показывать (хранится в браузере, применяется после перезагрузки) ----------
  function buildSettings() {
    $('#settingsToggle').addEventListener('click', () => $('#settingsSec').classList.toggle('collapsed'));
    const chk = (id, label, on, cls) => `<label><input type="checkbox" class="${cls}" data-id="${id}" ${on ? 'checked' : ''}> ${label}</label>`;
    $('#setFeatures').innerHTML = Object.keys(FEATURE_NAMES).map(k => chk(k, FEATURE_NAMES[k], FT[k], 'sf')).join('');
    $('#setConds').innerHTML = CONDITIONS.map(c => chk(c.id, c.name.replace(/\s*\(.*\)/, ''), !cfg.hideConditions.includes(c.id), 'sc')).join('');
    $('#setGroups').innerHTML = GROUPS.map(g => chk(g.id, g.name, !cfg.hideGroups.includes(g.id), 'sg')).join('');
    $('#setApply').addEventListener('click', () => {
      const out = { features: {}, hideConditions: [], hideGroups: [], hideStructures: cfg.hideStructures };
      document.querySelectorAll('#setFeatures .sf').forEach(i => out.features[i.dataset.id] = i.checked);
      document.querySelectorAll('#setConds .sc').forEach(i => { if (!i.checked) out.hideConditions.push(i.dataset.id); });
      document.querySelectorAll('#setGroups .sg').forEach(i => { if (!i.checked) out.hideGroups.push(i.dataset.id); });
      try { localStorage.setItem('eye3d.config', JSON.stringify(out)); } catch (e) { alert('Браузер не даёт сохранить настройки'); return; }
      location.reload();
    });
    $('#setReset').addEventListener('click', () => { try { localStorage.removeItem('eye3d.config'); } catch (e) {} location.reload(); });
  }
  function applyConfigToLayout() {
    $('#ageSec').hidden = !FT.age;
    $('#patient').hidden = !FT.patientView;
    $('#scenarioSec').hidden = !FT.scenario;
    $('#raysOn').closest('label').hidden = !FT.rays;
    $('#labelsOn').checked = FT.labels; $('#flyOn').checked = FT.fly;
    if (!FT.layersPanel) { $('#app').classList.add('no-left'); $('#toggleLeft').hidden = true; }
    STRUCTURES.filter(s => structHidden(s.id)).forEach(s => setVisible(s.id, false));
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
  $('#age').addEventListener('input', (e) => { age.idx = parseInt(e.target.value, 10); applyConditions(); syncCondGroups(); });
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
    const F = FT.callouts ? focusSet() : null;
    const c = F ? condById[focus.cond] : null, v = c ? conditionView(c) : null, ch = (v && v.changes) || {};
    const w = view.clientWidth, h = view.clientHeight, bw = isMobile() ? 150 : 210, margin = 10, top = 14, gap = 6;
    const project = (p) => { const s = p.clone().project(camera); return { ax: (s.x + 1) / 2 * w, ay: (1 - s.y) / 2 * h, behind: s.z > 1 }; };
    // затронутые структуры + видимые элементы патологии текущей проблемы
    const items = [];
    if (F) {
      v.affects.filter(id => byId[id] && S[id].visible && labels[id]).forEach(id => { labels[id].getWorldPosition(tmpV); items.push(Object.assign({ id, key: id, kind: 's', name: byId[id].name.replace(/\s*\(.*\)/, ''), text: ch[id] || '' }, project(tmpV))); });
      if (FT.elements) (CONDITION_ELEMENTS[focus.cond] || []).forEach(id => { const a = PATHO_INFO[id] && pathoAnchor(id); if (a) items.push(Object.assign({ id, key: 'el:' + id, kind: 'p', name: PATHO_INFO[id].name, text: PATHO_INFO[id].desc.split('. ')[0] + '.' }, project(a))); });
      const tr = activeTreatment(focus.cond);
      if (tr) (tr.elements || []).forEach(el => { const a = SURG_INFO[el] && surgAnchor(el); if (a) items.push(Object.assign({ id: el, key: 'sg:' + el, kind: 'g', name: SURG_INFO[el].name, text: SURG_INFO[el].desc.split('. ')[0] + '.' }, project(a))); });
    }
    const keys = items.map(i => i.key);
    Object.keys(calloutEls).forEach(k => { if (!keys.includes(k)) { const e = calloutEls[k]; e.box.remove(); e.path.remove(); e.dot.remove(); e.ring.remove(); delete calloutEls[k]; } });
    if (!items.length) return;
    items.forEach(it => {
      if (calloutEls[it.key]) return;
      const kindCls = it.kind === 'p' ? ' patho' : it.kind === 'g' ? ' surg' : '';
      const box = document.createElement('div'); box.className = 'callout' + kindCls;
      box.innerHTML = `<b>${it.name}</b><span>${it.text}</span>`;
      box.addEventListener('click', () => it.kind === 'p' ? showPathoCard(it.id) : it.kind === 'g' ? showSurgCard(it.id) : select(it.id));
      calloutBoxesEl.appendChild(box);
      const path = svgEl('path'), dot = svgEl('circle'), ring = svgEl('circle');
      const cls = kindCls;
      path.setAttribute('class', cls.trim()); dot.setAttribute('class', 'dot' + cls); dot.setAttribute('r', 4); ring.setAttribute('class', 'ring' + cls); ring.setAttribute('r', 6);
      calloutSvg.appendChild(path); calloutSvg.appendChild(ring); calloutSvg.appendChild(dot);
      calloutEls[it.key] = { box, path, dot, ring };
    });
    // раскладка по двум колонкам, ближе к своей структуре, без наложений
    let left = items.filter(i => i.ax < w / 2).sort((a, b) => a.ay - b.ay), right = items.filter(i => i.ax >= w / 2).sort((a, b) => a.ay - b.ay);
    const cap = Math.max(2, Math.floor((h - top) / 54));
    while (left.length > cap && right.length < cap) right.push(left.pop());
    while (right.length > cap && left.length < cap) left.push(right.pop());
    const place = (col, x) => {
      let y = top;
      col.forEach(it => { const box = calloutEls[it.key].box; const bh = box.offsetHeight || 44; let by = Math.max(y, it.ay - bh / 2); if (by + bh > h - 8) by = Math.max(top, h - 8 - bh); box.style.left = x + 'px'; box.style.top = by + 'px'; it.bx = x; it.by = by; it.bh = bh; y = by + bh + gap; });
    };
    place(left, margin); place(right, w - margin - bw);
    items.forEach(it => {
      const e = calloutEls[it.key]; e.box.classList.toggle('behind', it.behind);
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
      if (F) { const amp = (0.6 + 0.9 * show.highlight) * (now < demoUntil ? 1.35 : 1), k = 0.5 + 0.5 * Math.sin(now / 130); F.forEach(id => { const e = S[id]; if (!e) return; e.mesh.material.emissive.setRGB((0.22 + 0.38 * k) * amp, (0.1 + 0.16 * k) * amp, 0.02 * amp); if (e.cap) e.cap.material.emissive.copy(e.mesh.material.emissive); }); }
      markerDiv.classList.toggle('pulse', true); pulseWasOn = true;
    } else if (pulseWasOn) { pulseWasOn = false; markerDiv.classList.remove('pulse'); applyOpacity(); }
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    declutterLabels();
    updateCallouts();
  }
  function loop() { render(); requestAnimationFrame(loop); }

  // ---------- Панель показа поверх сцены: прозрачность остального, подсветка, окно «Как видит пациент» ----------
  const pvFloatEl = $('#pvFloat'), pvHome = $('#patient');
  function setPvFloat(on, auto) {
    on = !!on && FT.patientView;
    if (show.pvFloat !== on) {
      show.pvFloat = on;
      const dst = on ? pvFloatEl.querySelector('.pvf-body') : pvHome;
      dst.appendChild($('#pv')); dst.appendChild($('#pvNote'));
      pvFloatEl.hidden = !on; $('#pvAway').hidden = !on;
      $('#pvPin').classList.toggle('on', on);
    }
    pvAutoPinned = on && !!auto;
  }
  function buildShowBar() {
    const ctx = $('#ctxOp'), hl = $('#hl');
    const sync = () => { ctx.value = Math.round((1 - show.context) * 100); $('#ctxOpVal').textContent = ctx.value + ' %'; hl.value = Math.round(show.highlight * 100); $('#hlVal').textContent = hl.value + ' %'; $('#pvAuto').checked = !!show.pvAuto; };
    sync();
    ctx.addEventListener('input', () => { show.context = (100 - ctx.value) / 100; sync(); saveShow(); applyOpacity(); });
    hl.addEventListener('input', () => { show.highlight = hl.value / 100; sync(); saveShow(); applyOpacity(); pulse.until = performance.now() + 700; });
    $('#pvAuto').addEventListener('change', (e) => { show.pvAuto = e.target.checked; saveShow(); });
    $('#pvPin').addEventListener('click', () => setPvFloat(!show.pvFloat));
    $('#pvPin2').addEventListener('click', () => setPvFloat(true));
    $('#pvUnpin').addEventListener('click', () => setPvFloat(false));
    $('#showbarToggle').addEventListener('click', () => $('#showbar').classList.toggle(isMobile() ? 'open' : 'collapsed')); // на телефоне свёрнута по умолчанию
    if (!FT.patientView) { $('#pvPin').hidden = true; $('#pvAuto').closest('label').hidden = true; }
    // окно пациента можно перетащить за заголовок
    const head = pvFloatEl.querySelector('.pvf-head'); let drag = null;
    head.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; const r = pvFloatEl.getBoundingClientRect(), vr = view.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, vr }; head.setPointerCapture(e.pointerId); });
    head.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const x = Math.max(0, Math.min(drag.vr.width - pvFloatEl.offsetWidth, e.clientX - drag.vr.left - drag.dx)), y = Math.max(0, Math.min(drag.vr.height - pvFloatEl.offsetHeight, e.clientY - drag.vr.top - drag.dy));
      Object.assign(pvFloatEl.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    });
    head.addEventListener('pointerup', () => { drag = null; });
    head.addEventListener('pointercancel', () => { drag = null; });
  }

  // ---------- Сценарий показа: цепочка сохранённых состояний модели, проигрывается кнопками «Далее»/«Назад» ----------
  const SC_KEY = 'eye3d.scenarios';
  let scenarios = [], scCur = 0, scEditIdx = -1, play = null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  function loadScenarios() {
    let list = null;
    try { list = JSON.parse(localStorage.getItem(SC_KEY) || 'null'); } catch (e) { /* хранилище недоступно */ }
    if (!Array.isArray(list) || !list.length) list = JSON.parse(JSON.stringify(cfg.scenarios || []));
    if (!list.length) list = [{ name: 'Сценарий 1', steps: [], locked: false }];
    scenarios = list.map(s => ({ name: String(s.name || 'Сценарий'), steps: Array.isArray(s.steps) ? s.steps.filter(x => x && typeof x === 'object') : [], locked: !!s.locked }));
    scCur = 0;
  }
  const saveScenarios = () => { try { localStorage.setItem(SC_KEY, JSON.stringify(scenarios)); } catch (e) { /* нет хранилища */ } };
  // Снимок всего, что видно: возраст, разрез, камера, включённые проблемы с параметрами и лечением, выделение, скрытые слои
  function captureState() {
    const conds = {};
    CONDITIONS.forEach(c => { if (cond[c.id].on) { conds[c.id] = Object.assign({}, cond[c.id]); delete conds[c.id].on; conds[c.id].treat = treat[c.id].id || null; } });
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      age: age.idx, clip: Object.assign({}, clip), cam: { pos: camera.position.toArray().map(r2), target: controls.target.toArray().map(r2) },
      conds, focus: focus.cond && cond[focus.cond].on ? focus.cond : null, selected: selectedId, rays: ui.rays, labels: ui.labels,
      hidden: STRUCTURES.filter(s => !S[s.id].visible && !structHidden(s.id)).map(s => s.id),
    };
  }
  function applyState(st, opts = {}) {
    st = st || {};
    if (demoTimer) { cancelAnimationFrame(demoTimer); demoTimer = null; }
    quietUI = true;
    age.idx = st.age === undefined ? AGE_STOPS.length - 1 : Math.min(AGE_STOPS.length - 1, Math.max(0, parseInt(st.age, 10) || 0)); $('#age').value = age.idx;
    CONDITIONS.forEach(c => {
      const s = st.conds && st.conds[c.id], cur = cond[c.id];
      cur.on = !!s;
      if (c.options) cur[c.options.id] = s && c.options.values.some(v => v.id === s[c.options.id]) ? s[c.options.id] : c.options.values[0].id;
      c.params.forEach(p => { cur[p.id] = s && typeof s[p.id] === 'number' ? Math.min(p.max, Math.max(p.min, s[p.id])) : p.def; });
      treat[c.id].id = s && s.treat && (TREATMENTS[c.id] || []).some(t => t.id === s.treat) ? s.treat : null;
      syncCondBoxes(c.id);
      boxesOf(c.id).forEach(box => { const sel = box.querySelector('.copt'); if (sel && c.options) sel.value = cur[c.options.id]; });
    });
    const hid = new Set(Array.isArray(st.hidden) ? st.hidden : []);
    STRUCTURES.forEach(s => setVisible(s.id, !hid.has(s.id)));
    ui.rays = !!st.rays; $('#raysOn').checked = ui.rays; raysGroup.visible = ui.rays;
    ui.labels = st.labels !== false; $('#labelsOn').checked = ui.labels;
    if (st.clip) { Object.assign(clip, st.clip); updateClipPlane(); }
    applyConditions(); syncCondGroups();
    if (st.selected && S[st.selected]) select(st.selected); else { selectedId = null; syncLayerUI(); }
    setFocus(st.focus && cond[st.focus] && cond[st.focus].on ? st.focus : null, { noFly: true, keepAge: true });
    if (st.cam && Array.isArray(st.cam.pos) && Array.isArray(st.cam.target)) { flyTo(st.cam.pos, st.cam.target, opts.instant ? 1 : 900); $('#views').querySelectorAll('button').forEach(x => x.classList.remove('on')); }
    updateMarker(); updateLabels();
    quietUI = false;
  }
  function autoLabel(st) {
    const parts = [], ids = Object.keys(st.conds || {});
    if (st.age !== undefined && st.age < AGE_STOPS.length - 1 && AGE_STOPS[st.age]) parts.push(AGE_STOPS[st.age].label);
    ids.forEach(id => {
      const c = condById[id]; if (!c) return; const s = st.conds[id];
      let t = (c.short || c.name).replace(/\s*\(.*\)/, '');
      if (c.options) { const o = c.options.values.find(v => v.id === s[c.options.id]); if (o) t += ', ' + o.label.toLowerCase(); }
      const p = c.params[0]; if (p && typeof s[p.id] === 'number') t += ' ' + fmt(s[p.id], p);
      if (s.treat) { const tr = (TREATMENTS[id] || []).find(x => x.id === s.treat); if (tr) t += ' → ' + tr.name.replace(/\s*\(.*\)/, ''); }
      parts.push(t);
    });
    if (!ids.length) parts.push('Норма');
    if (st.selected && byId[st.selected]) parts.push('карточка: ' + byId[st.selected].name.replace(/\s*\(.*\)/, ''));
    return parts.join(' · ');
  }
  function applyStep(st, i) {
    applyState(st.state || {});
    setPvFloat(!!st.pv);
    const f = st.state && st.state.focus;
    if (st.demo && f && cond[f] && cond[f].on) setTimeout(() => { if (i === undefined || (play && play.i === i)) demo(f); }, 950);
  }
  function startPlay(idx, i = 0) {
    const sc = scenarios[idx]; if (!sc || !sc.steps.length) return;
    play = { sc: idx, i: 0 };
    $('#playbar').hidden = false; $('#hint').hidden = true; view.classList.add('playing');
    if (isMobile()) { $('#left').classList.remove('open'); $('#right').classList.remove('open'); syncMobileBar(); }
    playStep(Math.min(i, sc.steps.length - 1));
  }
  function playStep(i) {
    if (!play) return; const sc = scenarios[play.sc]; if (!sc || i < 0 || i >= sc.steps.length) return;
    play.i = i; const st = sc.steps[i], last = i === sc.steps.length - 1;
    $('#playTitle').textContent = `${sc.name} · шаг ${i + 1} из ${sc.steps.length}: ${st.label || ''}`;
    $('#playNote').textContent = st.note || ''; $('#playNote').hidden = !st.note;
    $('#playPrev').disabled = i === 0; $('#playNext').textContent = last ? 'Готово' : '▶'; $('#playNext').title = last ? 'Закончить показ' : 'Следующий шаг (→ или пробел)';
    applyStep(st, i);
    if (scCur === play.sc) renderScenario();
  }
  function stopPlay() { if (!play) return; play = null; $('#playbar').hidden = true; $('#hint').hidden = false; view.classList.remove('playing'); renderScenario(); }
  function renderScenario() {
    const sel = $('#scSelect'); sel.innerHTML = scenarios.map((s, i) => `<option value="${i}">${esc(s.name)}${s.locked ? ' ✓' : ''}</option>`).join(''); sel.value = String(scCur);
    const sc = scenarios[scCur], ol = $('#scSteps'); ol.innerHTML = '';
    sc.steps.forEach((st, i) => {
      const li = document.createElement('li'); li.className = 'step' + (scEditIdx === i ? ' sel' : '') + (play && play.sc === scCur && play.i === i ? ' cur' : '');
      li.innerHTML = `<span class="lbl" title="Показать этот шаг на модели">${esc(st.label)}</span><span class="flags">${st.demo ? '<span title="проигрывается изменение от нормы">▶</span>' : ''}${st.pv ? '<span title="окно «Как видит пациент» поверх модели">◉</span>' : ''}</span>` +
        (sc.locked ? '' : `<span class="ops"><button class="iso up" title="Выше">▲</button><button class="iso down" title="Ниже">▼</button><button class="iso edit" title="Изменить">✎</button><button class="iso del" title="Удалить шаг">✕</button></span>`);
      li.querySelector('.lbl').addEventListener('click', () => applyStep(st));
      if (!sc.locked) {
        li.querySelector('.up').addEventListener('click', () => { if (i > 0) { [sc.steps[i - 1], sc.steps[i]] = [sc.steps[i], sc.steps[i - 1]]; if (scEditIdx === i) scEditIdx = i - 1; saveScenarios(); renderScenario(); } });
        li.querySelector('.down').addEventListener('click', () => { if (i < sc.steps.length - 1) { [sc.steps[i + 1], sc.steps[i]] = [sc.steps[i], sc.steps[i + 1]]; if (scEditIdx === i) scEditIdx = i + 1; saveScenarios(); renderScenario(); } });
        li.querySelector('.edit').addEventListener('click', () => { scEditIdx = scEditIdx === i ? -1 : i; renderScenario(); });
        li.querySelector('.del').addEventListener('click', () => { sc.steps.splice(i, 1); scEditIdx = -1; saveScenarios(); renderScenario(); });
      }
      ol.appendChild(li);
    });
    if (!sc.steps.length) ol.innerHTML = '<li class="empty">Шагов пока нет. Настройте модель и нажмите «Запомнить шаг».</li>';
    $('#scAdd').hidden = sc.locked; $('#scLock').textContent = sc.locked ? 'Изменить' : 'Зафиксировать'; $('#scLock').title = sc.locked ? 'Разрешить правку шагов' : 'Сохранить порядок и закрыть от случайных правок';
    $('#scPlay').disabled = !sc.steps.length;
    const ed = $('#scEdit'); ed.hidden = scEditIdx < 0 || sc.locked || !sc.steps[scEditIdx];
    if (!ed.hidden) renderStepEdit(sc.steps[scEditIdx]);
  }
  function renderStepEdit(st) {
    const ed = $('#scEdit');
    ed.innerHTML = `<label>Название шага<input type="text" id="seLabel"></label><label>Подсказка врачу, видна во время показа<textarea id="seNote" rows="2"></textarea></label>` +
      `<label class="chk"><input type="checkbox" id="seDemo"> проиграть изменение от нормы</label><label class="chk"><input type="checkbox" id="sePv"> окно «Как видит пациент» поверх модели</label>` +
      `<div class="sc-tools"><button class="btn" id="seRecap" title="Заменить сохранённое состояние тем, что сейчас на модели">Обновить из модели</button><button class="btn" id="seDone">Готово</button></div>`;
    $('#seLabel').value = st.label || ''; $('#seNote').value = st.note || ''; $('#seDemo').checked = !!st.demo; $('#sePv').checked = !!st.pv;
    $('#seLabel').addEventListener('input', (e) => { st.label = e.target.value; saveScenarios(); const li = $('#scSteps li.sel .lbl'); if (li) li.textContent = st.label; });
    $('#seNote').addEventListener('input', (e) => { st.note = e.target.value; saveScenarios(); });
    $('#seDemo').addEventListener('change', (e) => { st.demo = e.target.checked; saveScenarios(); });
    $('#sePv').addEventListener('change', (e) => { st.pv = e.target.checked; saveScenarios(); });
    $('#seRecap').addEventListener('click', () => { const auto = st.label === autoLabel(st.state || {}); st.state = captureState(); if (auto) st.label = autoLabel(st.state); saveScenarios(); renderScenario(); });
    $('#seDone').addEventListener('click', () => { scEditIdx = -1; renderScenario(); });
  }
  function buildScenario() {
    loadScenarios();
    const cur = () => scenarios[scCur];
    $('#scSelect').addEventListener('change', (e) => { scCur = parseInt(e.target.value, 10) || 0; scEditIdx = -1; renderScenario(); });
    $('#scNew').addEventListener('click', () => { const name = window.prompt('Название сценария', `Сценарий ${scenarios.length + 1}`); if (name === null) return; scenarios.push({ name: name.trim() || `Сценарий ${scenarios.length + 1}`, steps: [], locked: false }); scCur = scenarios.length - 1; scEditIdx = -1; saveScenarios(); renderScenario(); });
    $('#scRename').addEventListener('click', () => { const name = window.prompt('Новое название', cur().name); if (name === null || !name.trim()) return; cur().name = name.trim(); saveScenarios(); renderScenario(); });
    $('#scDelete').addEventListener('click', () => { if (!window.confirm(`Удалить сценарий «${cur().name}»?`)) return; scenarios.splice(scCur, 1); if (!scenarios.length) scenarios.push({ name: 'Сценарий 1', steps: [], locked: false }); scCur = Math.max(0, Math.min(scCur, scenarios.length - 1)); scEditIdx = -1; saveScenarios(); renderScenario(); });
    $('#scAdd').addEventListener('click', () => { const sc = cur(); if (sc.locked) return; const state = captureState(); sc.steps.push({ label: autoLabel(state), note: '', demo: !!state.focus, pv: show.pvFloat, state }); scEditIdx = sc.steps.length - 1; saveScenarios(); renderScenario(); });
    $('#scLock').addEventListener('click', () => { const sc = cur(); sc.locked = !sc.locked; scEditIdx = -1; saveScenarios(); renderScenario(); });
    $('#scPlay').addEventListener('click', () => startPlay(scCur, 0));
    $('#scCopy').addEventListener('click', () => {
      const sc = cur(), json = JSON.stringify({ name: sc.name, locked: true, steps: sc.steps }, null, 1), b = $('#scCopy');
      const done = () => { b.textContent = 'Скопировано ✓'; setTimeout(() => { b.textContent = 'JSON'; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(done, () => window.prompt('Скопируйте текст сценария', json)); else window.prompt('Скопируйте текст сценария', json);
    });
    $('#playPrev').addEventListener('click', () => { if (play) playStep(play.i - 1); });
    $('#playNext').addEventListener('click', () => { if (!play) return; if (play.i >= scenarios[play.sc].steps.length - 1) stopPlay(); else playStep(play.i + 1); });
    $('#playStop').addEventListener('click', stopPlay);
    document.addEventListener('keydown', (e) => {
      if (!play || e.target.matches('input, select, textarea')) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); $('#playNext').click(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); playStep(play.i - 1); }
      else if (e.key === 'Escape') stopPlay();
    });
    renderScenario();
  }

  // ---------- Старт ----------
  buildLayers();
  buildConditions();
  buildParents();
  buildSettings();
  buildShowBar();
  buildScenario();
  STRUCTURES.filter(s => ['adnexa', 'muscles', 'orbit'].includes(s.group) || ['cloquet', 'posterior_chamber'].includes(s.id)).forEach(s => setVisible(s.id, false));
  applyConfigToLayout();
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
      syncCondBoxes(id);
      boxesOf(id).forEach(box => { const sel = box.querySelector('.copt'); const c = condById[id]; if (sel && c.options) sel.value = cond[id][c.options.id]; });
      applyConditions();
      if (values.on) setFocus(id, { demo: !!values.demo }); else if (values.on === false && focus.cond === id) setFocus(nextEnabledCond(id));
    },
    setFocus, flyToCondition, demo, showPathoCard, showSurgCard, setTreatment: selectTreatment,
    getConfig: () => JSON.parse(JSON.stringify(cfg)),
    setConfig: (o) => { try { localStorage.setItem('eye3d.config', JSON.stringify(o)); } catch (e) {} location.reload(); },
    resetConfig: () => { try { localStorage.removeItem('eye3d.config'); } catch (e) {} location.reload(); },
    setAge: (years) => setAgeByYears(years), setAgeIndex: (i) => { age.idx = i; $('#age').value = i; applyConditions(); syncCondGroups(); },
    setFly: (on) => { ui.fly = !!on; $('#flyOn').checked = ui.fly; },
    setShow: (o) => { Object.assign(show, o || {}); saveShow(); applyOpacity(); }, getShow: () => Object.assign({}, show),
    setPatientFloat: (on) => setPvFloat(on),
    scenarios: {
      list: () => scenarios.map(s => s.name), get: () => JSON.parse(JSON.stringify(scenarios)),
      set: (list) => { if (Array.isArray(list) && list.length) { scenarios = JSON.parse(JSON.stringify(list)); scCur = 0; scEditIdx = -1; saveScenarios(); renderScenario(); } },
      play: (name, i = 0) => { const idx = typeof name === 'number' ? name : scenarios.findIndex(s => s.name === name); if (idx >= 0) startPlay(idx, i); },
      next: () => $('#playNext').click(), prev: () => { if (play) playStep(play.i - 1); }, stop: stopPlay, capture: captureState, apply: applyState,
    },
    getState: () => ({ clip: Object.assign({}, clip), age: stop(), conditions: JSON.parse(JSON.stringify(cond)), visible: Object.fromEntries(STRUCTURES.map(s => [s.id, S[s.id].visible])) }),
    camera, controls, scene,
  };
})();
