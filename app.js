// app.js — сцена, разрез, слои, подписи, патологические состояния, «вид пациента».
(() => {
  const $ = (s) => document.querySelector(s);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const E = EyeModel.E;
  const byId = {}; STRUCTURES.forEach(s => byId[s.id] = s);
  const condById = {}; CONDITIONS.forEach(c => condById[c.id] = c);

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
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 500);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.1; controls.minDistance = 8; controls.maxDistance = 220;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5262, 0.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.85); keyLight.position.set(0.4, 0.6, 1); camera.add(keyLight); scene.add(camera);
  const backLight = new THREE.DirectionalLight(0xffffff, 0.3); backLight.position.set(-20, 30, -40); scene.add(backLight);

  const eyeGroup = new THREE.Group(); eyeGroup.rotation.x = Math.PI / 2; scene.add(eyeGroup);
  const toWorld = (v) => eyeGroup.localToWorld(v.clone());

  // ---------- Плоскость разреза и заглушки среза ----------
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
    // синхронизация элементов управления
    const chk = $('#clipOn'); if (chk.checked !== clip.on) chk.checked = clip.on;
    $('#clipAxis').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.axis === clip.axis));
    const sl = $('#clipOffset'); if (parseFloat(sl.value) !== clip.offset) sl.value = clip.offset;
  }

  const S = {};            // id → { def, mesh, cap, stencils, visible }
  const caps = [];
  let orderCounter = 10;

  function baseMaterial(def, opts) {
    const glassy = ['cornea', 'lens', 'vitreous', 'anterior_chamber', 'lens_nucleus', 'zonule', 'nerve_sheath'].includes(def.id);
    const m = new THREE.MeshStandardMaterial({
      color: def.color, roughness: glassy ? 0.18 : 0.62, metalness: 0,
      transparent: def.opacity < 1, opacity: def.opacity,
      side: opts.noCap ? THREE.DoubleSide : THREE.FrontSide,
      clippingPlanes: [clipPlane],
    });
    return m;
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
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), m);
    cap.renderOrder = order; cap.onAfterRender = () => renderer.clearStencil();
    cap.userData.cap = true;
    scene.add(cap); caps.push(cap);
    return cap;
  }

  const params = { elong: 0, cone: 0, cdr: 0.3, bombe: 0, pupil: E.pupil };
  const meshes = EyeModel.build((id, opts) => baseMaterial(byId[id], opts), params);
  const structureMeshes = [];
  const detailGroup = new THREE.Group(); scene.add(detailGroup); // меши из Blender уже в мировой системе
  STRUCTURES.forEach(def => {
    const id = def.id;
    let mesh = meshes[id];
    if (!mesh) { // структура без процедурной формы: пустой меш, форма придёт из glTF
      const noCap = def.group === 'vessels';
      mesh = new THREE.Mesh(new THREE.BufferGeometry(), baseMaterial(def, { noCap }));
      mesh.name = id; mesh.userData.id = id; if (noCap) mesh.userData.noCap = true;
    }
    eyeGroup.add(mesh);
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

  // Детализированные меши из Blender подменяют процедурные там, где патология не деформирует форму
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
    detailGroup.add(m);
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
  function setGeometry(id, g) {
    const e = S[id]; if (!e) return;
    const old = e.mesh.geometry; e.mesh.geometry = g; e.stencils.forEach(s => s.geometry = g); old.dispose();
  }

  // ---------- Подписи ----------
  const labels = {};
  Object.keys(EyeModel.LABELS).forEach(id => {
    if (!byId[id]) return;
    const div = document.createElement('div'); div.className = 'label'; div.textContent = byId[id].name.replace(/\s*\(.*\)/, '');
    div.addEventListener('click', (e) => { e.stopPropagation(); select(id); });
    const obj = new THREE.CSS2DObject(div); obj.position.copy(EyeModel.LABELS[id]);
    eyeGroup.add(obj); labels[id] = obj;
  });
  const ui = { labels: true, rays: false };
  const labelGroups = { shell: true, inner: true, vessels: false, nerves: true, muscles: false, adnexa: false };
  const tmpV = new THREE.Vector3();
  function updateLabels() {
    eyeGroup.updateMatrixWorld(true);
    const F = focusSet();
    Object.keys(labels).forEach(id => {
      const o = labels[id], vis = S[id].visible;
      let ok = ui.labels && vis && (labelGroups[S[id].def.group] || id === selectedId);
      if (F && !F.has(id) && id !== selectedId) ok = false; // в режиме выделения подписи только у затронутых структур
      if (ok) {
        // если якорь попал в отрезанную половину — зеркально отражаем его относительно плоскости среза
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

  // ---------- Ход лучей ----------
  const raysGroup = new THREE.Group(); eyeGroup.add(raysGroup); raysGroup.visible = false;
  const rayMat = new THREE.LineBasicMaterial({ color: 0xffc83d });
  const focusDot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc83d }));
  raysGroup.add(focusDot);
  const rayLines = [];
  for (let i = 0; i < 7; i++) { const l = new THREE.Line(new THREE.BufferGeometry(), rayMat); raysGroup.add(l); rayLines.push(l); }
  function updateRays() {
    const yF = -E.R_ret, yRet = -E.R_ret - params.elong;
    focusDot.position.set(0, yF, 0);
    rayLines.forEach((line, i) => {
      const x = -3.6 + i * 1.2;
      const yc = E.c_ca + Math.sqrt(Math.max(0, E.R_ca * E.R_ca - x * x));
      const a = EyeModel.lensArcs(1);
      const xl = x * 0.86, yl = a.ca + Math.sqrt(Math.max(0, a.Ra * a.Ra - xl * xl));
      const jitter = params.cone * (i % 2 ? 0.6 : -0.6) * Math.abs(x) * 0.3;
      const t = (yRet - yl) / (yF - yl);
      const xe = xl + (0 + jitter - xl) * t;
      const pts = [V3(x, 34, 0), V3(x, yc, 0), V3(xl, yl, 0), V3(xe, yRet, 0)];
      line.geometry.dispose(); line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    });
  }
  updateRays();

  // ---------- Патологические меши ----------
  const patho = {};
  const pmat = (color, opacity, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0, transparent: opacity < 1, opacity, clippingPlanes: [clipPlane], side: THREE.DoubleSide }, extra));
  function addPatho(id, geometry, material, count) {
    const m = count ? new THREE.InstancedMesh(geometry, material, count) : new THREE.Mesh(geometry, material);
    m.visible = false; m.renderOrder = 1200; m.userData.patho = id; eyeGroup.add(m); patho[id] = m; return m;
  }
  // Катаракта
  addPatho('spokes', new THREE.BoxGeometry(2.7, 0.7, 0.55), pmat(0xf1e9d2, 0.8), 18);
  addPatho('psc', EyeModel.geo.psc(1.5), pmat(0xd9cfa8, 0.8));
  // Отслойка
  addPatho('flap', new THREE.BufferGeometry(), pmat(0xe6c3b4, 0.95, { roughness: 0.4 }));
  addPatho('fluid', new THREE.BufferGeometry(), pmat(0xd8c98c, 0.5));
  // ВМД
  addPatho('drusen', new THREE.SphereGeometry(0.11, 10, 8), pmat(0xf2d25a, 1), 80);
  addPatho('cnv', new THREE.BufferGeometry(), pmat(0xa8262a, 1));
  addPatho('cnvBlood', new THREE.CircleGeometry(1, 24), pmat(0x8f1c1c, 0.85), 1);
  // Диабетическая ретинопатия
  addPatho('microan', new THREE.SphereGeometry(0.075, 8, 6), pmat(0xb01e1e, 1), 60);
  addPatho('dotHem', new THREE.CircleGeometry(0.34, 16), pmat(0x8f1c1c, 0.9), 24);
  addPatho('exudate', new THREE.CircleGeometry(0.16, 10), pmat(0xf5e27a, 1), 50);
  addPatho('nvd', new THREE.BufferGeometry(), pmat(0xb02a2a, 1));
  // Тромбоз ЦВС
  addPatho('flameHem', new THREE.CircleGeometry(0.4, 16), pmat(0x6e1010, 0.92), 110);

  const fundus = EyeModel.fundus;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  // Ставит экземпляр i на глазное дно в точке (u, v), плоские фигуры ориентирует по поверхности
  function placeOnFundus(inst, i, u, v, R, sx, sy, rot) {
    _p.copy(fundus(u, v, R));
    const n = _p.clone().normalize();
    _q.setFromUnitVectors(V3(0, 0, 1), n.clone().negate());
    if (rot) _q.multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), rot));
    _s.set(sx, sy, 1);
    _m.compose(_p, _q, _s); inst.setMatrixAt(i, _m);
  }
  function placeSphere(inst, i, p, s) { _q.identity(); _s.set(s, s, s); _m.compose(p, _q, _s); inst.setMatrixAt(i, _m); }
  function commit(inst, count) { inst.count = count; inst.instanceMatrix.needsUpdate = true; inst.visible = count > 0; }

  // Случайные точки в круге (u,v) вокруг центра
  function discPoints(n, cu, cv, r, seed) { const R = EyeModel.rng(seed), out = []; for (let i = 0; i < n; i++) { const a = R() * Math.PI * 2, d = r * Math.sqrt(R()); out.push([cu + d * Math.cos(a), cv + d * Math.sin(a), R()]); } return out; }
  const PTS = {
    drusen: discPoints(80, 0, 0, 2.3, 11), microan: EyeModel.treeSamplePoints(60, 21), dotHem: discPoints(24, 1.0, 0, 6.5, 31),
    exudate: discPoints(50, -0.6, 0.3, 2.4, 41).filter(p => Math.hypot(p[0] + 0.6, p[1] - 0.3) > 0.9), flame: discPoints(110, 1.2, 0, 8.2, 51),
  };
  function tangleGeometry(cu, cv, radiusMm, R, seed, n, tubeR) {
    const rnd = EyeModel.rng(seed), geos = [];
    for (let k = 0; k < n; k++) {
      const pts = [];
      let u = cu + (rnd() - 0.5) * radiusMm, v = cv + (rnd() - 0.5) * radiusMm;
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

  // Режим выделения проблемы: затронутые структуры остаются яркими, остальные становятся полупрозрачными
  const focus = { on: true, cond: null };
  const GHOST = 0.1;
  function focusSet() {
    if (!focus.on || !focus.cond || !cond[focus.cond] || !cond[focus.cond].on) return null;
    const c = condById[focus.cond];
    const set = new Set(c.affects);
    if (c.id === 'cataract') { set.add('lens'); set.add('lens_nucleus'); }
    return set;
  }
  function nextEnabledCond(except) {
    const list = CONDITIONS.map(c => c.id).filter(id => id !== except && cond[id].on);
    return list.length ? list[list.length - 1] : null;
  }
  function setFocus(id) {
    focus.cond = id;
    if (id && focus.on && cond[id].on) condById[id].affects.forEach(a => setVisible(a, true));
    document.querySelectorAll('.cond').forEach(b => b.classList.toggle('focus', !!id && b.dataset.cond === id && focus.on && cond[id].on));
    applyOpacity();
    updateLabels();
  }
  const lensBase = new THREE.Color(byId.lens.color), lensYellow = new THREE.Color(0xd8b25a);
  const nucBase = new THREE.Color(byId.lens_nucleus.color), nucBrown = new THREE.Color(0x8f6a2e);
  const nerveBase = new THREE.Color(byId.optic_nerve.color), nervePale = new THREE.Color(0xd6d6d0);
  const macBase = new THREE.Color(byId.macula.color), macEdema = new THREE.Color(0xb35a3a);
  const crvBase = new THREE.Color(byId.crv.color), crvDark = new THREE.Color(0x2a2470);
  let lastGeoKey = '', lastVeinKey = '', lastDetachKey = '';

  function applyConditions() {
    const c = cond;
    // --- геометрические параметры ---
    params.elong = c.ametropia.on ? -c.ametropia.diopters * 0.35 : 0;
    params.cone = c.keratoconus.on ? c.keratoconus.severity / 100 : 0;
    params.cdr = c.glaucoma.on ? c.glaucoma.cdr : 0.3;
    params.bombe = (c.glaucoma.on && c.glaucoma.type === 'closed') ? 0.55 : 0;
    // при деформации переключаемся с детализированных мешей Blender на процедурные
    ['sclera', 'choroid', 'retina', 'retinal_arteries'].forEach(id => setDetailUse(id, params.elong === 0));
    setDetailUse('iris', params.bombe === 0);
    setDetailUse('retinal_veins', params.elong === 0 && !(c.crvo.on && c.crvo.severity > 0));
    const key = [params.elong, params.cone, params.cdr, params.bombe].join('|');
    if (key !== lastGeoKey) {
      const elongChanged = lastGeoKey.split('|')[0] !== String(params.elong);
      lastGeoKey = key;
      EyeModel.setFundusElong(params.elong);
      if (elongChanged) { setGeometry('retinal_arteries', EyeModel.retinalTree(false, {})); lastVeinKey = ''; lastDetachKey = ''; }
      setGeometry('sclera', EyeModel.geo.sclera(params));
      setGeometry('choroid', EyeModel.geo.choroid(params));
      setGeometry('retina', EyeModel.geo.retina(params));
      setGeometry('vitreous', EyeModel.geo.vitreous(params));
      setGeometry('macula', EyeModel.geo.macula(params));
      setGeometry('cornea', EyeModel.geo.cornea(params));
      setGeometry('iris', EyeModel.geo.iris(params));
      setGeometry('disc', EyeModel.geo.disc(params));
      const D = E.disc_dir;
      S.disc.mesh.position.copy(D).multiplyScalar(E.R_ret + 0.02 + params.elong);
      const L = 27, ns = E.R_sc - 0.6 + params.elong;
      S.optic_nerve.mesh.position.copy(D).multiplyScalar(ns + L / 2);
      S.nerve_sheath.mesh.position.copy(D).multiplyScalar(ns + 1.2 + (L - 1) / 2);
      updateRays();
    }
    // --- глаукома: побледнение нерва ---
    const gk = c.glaucoma.on ? Math.min(1, (c.glaucoma.cdr - 0.3) / 0.65) : 0;
    S.optic_nerve.mesh.material.color.copy(nerveBase).lerp(nervePale, gk * 0.8);
    S.disc.mesh.material.color.setHex(byId.disc.color).lerp(new THREE.Color(0xf5e2cf), gk * 0.7);

    // --- катаракта ---
    const cat = c.cataract.on ? c.cataract.severity / 100 : 0, ct = c.cataract.type;
    const lensM = S.lens.mesh.material, nucM = S.lens_nucleus.mesh.material;
    lensM.color.copy(lensBase).lerp(lensYellow, cat * (ct === 'nuclear' ? 0.9 : 0.35));
    S.lens.baseOpacity = byId.lens.opacity + 0.42 * cat * (ct === 'nuclear' ? 1 : 0.5);
    S.lens.cap.material.color.copy(lensM.color).multiplyScalar(0.85);
    nucM.color.copy(nucBase).lerp(nucBrown, cat * (ct === 'nuclear' ? 1 : 0.2));
    S.lens_nucleus.baseOpacity = byId.lens_nucleus.opacity + 0.88 * cat * (ct === 'nuclear' ? 1 : 0.12);
    S.lens_nucleus.cap.material.color.copy(nucM.color).multiplyScalar(0.85);
    // спицы
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
    // задняя субкапсулярная бляшка
    const psc = patho.psc, pscOn = ct === 'psc' && cat > 0;
    if (pscOn) { psc.geometry.dispose(); psc.geometry = EyeModel.geo.psc(0.7 + 2.4 * cat); psc.material.opacity = 0.3 + 0.7 * cat; }
    psc.visible = pscOn;

    // --- отслойка ---
    const det = c.detachment.on ? c.detachment.extent / 100 : 0;
    const dk = det.toFixed(2);
    if (dk !== lastDetachKey) {
      lastDetachKey = dk;
      if (det > 0) {
        const g = EyeModel.detachmentGeometries(0.4 + 3.0 * det);
        patho.flap.geometry.dispose(); patho.flap.geometry = g.flap;
        patho.fluid.geometry.dispose(); patho.fluid.geometry = g.fluid;
      }
    }
    patho.flap.visible = det > 0; patho.fluid.visible = det > 0;

    // --- ВМД ---
    const amd = c.amd.on ? c.amd.severity / 100 : 0, wet = c.amd.type === 'wet';
    const nDr = Math.round(amd * (wet ? 30 : 80));
    for (let i = 0; i < nDr; i++) { const p = PTS.drusen[i]; placeSphere(patho.drusen, i, fundus(p[0], p[1], E.R_ret - 0.03 + params.elong * 0), 0.6 + p[2] * 0.9); }
    commit(patho.drusen, nDr);
    if (wet && amd > 0) {
      patho.cnv.geometry.dispose(); patho.cnv.geometry = tangleGeometry(0.2, -0.1, 1.2 + 1.6 * amd, E.R_ret + 0.08, 5, 4 + Math.round(amd * 6), 0.06);
      placeOnFundus(patho.cnvBlood, 0, 0.4, -0.3, E.R_ret - 0.06, 0.5 + 1.6 * amd, 0.4 + 1.2 * amd, 0.4); commit(patho.cnvBlood, 1);
      patho.cnv.visible = true;
    } else { patho.cnv.visible = false; commit(patho.cnvBlood, 0); }

    // --- диабетическая ретинопатия ---
    const dr = c.diabetic.on ? c.diabetic.severity / 100 : 0;
    const nMa = Math.round(dr * 60), nDh = Math.round(Math.max(0, dr - 0.2) * 30), nEx = Math.round(Math.max(0, dr - 0.3) * 70);
    for (let i = 0; i < nMa; i++) placeSphere(patho.microan, i, PTS.microan[i], 1);
    commit(patho.microan, nMa);
    for (let i = 0; i < nDh; i++) { const p = PTS.dotHem[i]; placeOnFundus(patho.dotHem, i, p[0], p[1], E.R_ret - 0.05, 0.6 + p[2] * 0.8, 0.5 + p[2] * 0.6, p[2] * 3); }
    commit(patho.dotHem, nDh);
    for (let i = 0; i < nEx; i++) { const p = PTS.exudate[i]; placeOnFundus(patho.exudate, i, p[0], p[1], E.R_ret - 0.04, 0.7 + p[2] * 0.8, 0.7 + p[2] * 0.8, 0); }
    commit(patho.exudate, nEx);
    if (dr > 0.7) { patho.nvd.geometry.dispose(); patho.nvd.geometry = tangleGeometry(2.7, 0.2, 1.4 + (dr - 0.7) * 5, E.R_ret - 0.2, 9, 6, 0.05); patho.nvd.visible = true; } else patho.nvd.visible = false;

    // --- тромбоз ЦВС ---
    const crvo = c.crvo.on ? c.crvo.severity / 100 : 0;
    const vk = crvo.toFixed(2);
    if (vk !== lastVeinKey) { lastVeinKey = vk; setGeometry('retinal_veins', EyeModel.retinalTree(true, { dilate: 1.4 * crvo, tortuosity: crvo })); }
    S.crv.mesh.material.color.copy(crvBase).lerp(crvDark, crvo);
    S.retinal_veins.mesh.material.color.setHex(byId.retinal_veins.color).lerp(crvDark, crvo * 0.8);
    const nFl = Math.round(crvo * 80);
    for (let i = 0; i < nFl; i++) { const p = PTS.flame[i]; const ang = Math.atan2(p[1], p[0] - 2.7); placeOnFundus(patho.flameHem, i, p[0], p[1], E.R_ret - 0.05, 0.35 + p[2] * 0.5, 1.2 + p[2] * 1.4, ang); }
    commit(patho.flameHem, nFl);

    // --- макула: отёк при диабете/тромбозе/влажной ВМД ---
    const edema = Math.min(1, (dr > 0.4 ? dr * 0.8 : 0) + crvo * 0.9 + (wet ? amd : 0));
    S.macula.mesh.material.color.copy(macBase).lerp(macEdema, edema);
    S.macula.cap.material.color.copy(S.macula.mesh.material.color).multiplyScalar(0.85);

    applyOpacity();
    renderPatientView();
    renderConditionNotes();
  }

  // ---------- Вид пациента ----------
  const pvCanvas = $('#pvCanvas'), pvGhost = $('#pvGhost');
  function drawScene(ctx, w, h) {
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62); sky.addColorStop(0, '#5fa8ea'); sky.addColorStop(1, '#cfe6fb');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd94a'; ctx.beginPath(); ctx.arc(w * 0.84, h * 0.17, h * 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7fbf5a'; ctx.fillRect(0, h * 0.62, w, h * 0.38);
    ctx.fillStyle = '#6f6f6f'; ctx.beginPath(); ctx.moveTo(w * 0.42, h); ctx.lineTo(w * 0.58, h); ctx.lineTo(w * 0.53, h * 0.62); ctx.lineTo(w * 0.47, h * 0.62); ctx.fill();
    // дом
    ctx.fillStyle = '#e9d7b8'; ctx.fillRect(w * 0.08, h * 0.42, w * 0.2, h * 0.24);
    ctx.fillStyle = '#b1483a'; ctx.beginPath(); ctx.moveTo(w * 0.06, h * 0.42); ctx.lineTo(w * 0.18, h * 0.28); ctx.lineTo(w * 0.30, h * 0.42); ctx.fill();
    ctx.fillStyle = '#5b6f94'; ctx.fillRect(w * 0.11, h * 0.47, w * 0.05, h * 0.07); ctx.fillRect(w * 0.20, h * 0.47, w * 0.05, h * 0.07);
    ctx.fillStyle = '#6b4a2e'; ctx.fillRect(w * 0.155, h * 0.55, w * 0.045, h * 0.11);
    // дерево
    ctx.fillStyle = '#7b5230'; ctx.fillRect(w * 0.72, h * 0.5, w * 0.03, h * 0.17);
    ctx.fillStyle = '#3e9448'; ctx.beginPath(); ctx.arc(w * 0.735, h * 0.44, h * 0.13, 0, Math.PI * 2); ctx.fill();
    // таблица
    ctx.fillStyle = '#fff'; ctx.fillRect(w * 0.36, h * 0.12, w * 0.28, h * 0.46);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.strokeRect(w * 0.36, h * 0.12, w * 0.28, h * 0.46);
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const rows = [['Ш Б', 0.14], ['М Н К', 0.095], ['Ы М Б Ш', 0.07], ['Б Ы Н К М', 0.052], ['И Н Ш М К Б', 0.04]];
    let y = h * 0.2;
    rows.forEach(([t, s]) => { ctx.font = `bold ${Math.round(h * s)}px Arial`; ctx.fillText(t, w * 0.5, y); y += h * (s + 0.035); });
  }
  const pctx = pvCanvas.getContext('2d'); drawScene(pctx, pvCanvas.width, pvCanvas.height);
  const gctx = pvGhost.getContext('2d'); drawScene(gctx, pvGhost.width, pvGhost.height);

  function renderPatientView() {
    const c = cond;
    const cat = c.cataract.on ? c.cataract.severity / 100 : 0, ct = c.cataract.type;
    const D = c.ametropia.on ? Math.abs(c.ametropia.diopters) : 0;
    const cone = c.keratoconus.on ? c.keratoconus.severity / 100 : 0;
    const gk = c.glaucoma.on ? Math.min(1, (c.glaucoma.cdr - 0.3) / 0.65) : 0;
    const det = c.detachment.on ? c.detachment.extent / 100 : 0;
    const amd = c.amd.on ? c.amd.severity / 100 : 0, wet = c.amd.type === 'wet';
    const dr = c.diabetic.on ? c.diabetic.severity / 100 : 0;
    const crvo = c.crvo.on ? c.crvo.severity / 100 : 0;

    const blur = cat * (ct === 'psc' ? 6 : ct === 'nuclear' ? 5 : 3.5) + D * 0.55 + cone * 3 + crvo * 3 + dr * 1.8 + (wet ? amd * 1.5 : 0);
    const sepia = ct === 'nuclear' ? cat * 0.85 : cat * 0.2;
    const contrast = 1 - 0.45 * cat - 0.25 * crvo - 0.15 * dr;
    const bright = 1 + 0.35 * cat * (ct === 'psc' ? 1 : ct === 'cortical' ? 0.6 : 0.25);
    pvCanvas.style.filter = `blur(${blur.toFixed(1)}px) sepia(${sepia.toFixed(2)}) contrast(${contrast.toFixed(2)}) brightness(${bright.toFixed(2)})`;
    // двоение при кератоконусе и кортикальной катаракте
    const ghost = cone * 0.6 + (ct === 'cortical' ? cat * 0.35 : 0);
    pvGhost.style.opacity = ghost.toFixed(2);
    pvGhost.style.transform = `translate(${(cone * 10 + (ct === 'cortical' ? cat * 5 : 0)).toFixed(1)}px, ${(cone * 5).toFixed(1)}px)`;
    pvGhost.style.filter = pvCanvas.style.filter;
    // ореолы и засветка
    $('#ovGlare').style.background = cat > 0 ? `radial-gradient(circle at 84% 17%, rgba(255,255,255,${(0.9 * cat * (ct === 'psc' ? 1 : 0.7)).toFixed(2)}) 0, rgba(255,255,230,${(0.5 * cat).toFixed(2)}) ${Math.round(8 + 30 * cat)}%, transparent ${Math.round(20 + 60 * cat)}%)` : 'none';
    // центральная скотома при ВМД
    $('#ovScotoma').style.background = amd > 0 ? `radial-gradient(circle at 50% 46%, rgba(35,25,25,${(0.95 * amd).toFixed(2)}) 0, rgba(35,25,25,${(0.7 * amd).toFixed(2)}) ${Math.round(4 + 14 * amd)}%, transparent ${Math.round(12 + 26 * amd)}%)` : 'none';
    // сужение поля при глаукоме
    $('#ovVignette').style.background = gk > 0 ? `radial-gradient(ellipse at 50% 50%, transparent ${Math.round(55 - 50 * gk)}%, rgba(0,0,0,${(0.95 * Math.min(1, gk + 0.2)).toFixed(2)}) ${Math.round(75 - 45 * gk)}%)` : 'none';
    // «занавеска» при отслойке височной сетчатки правого глаза: выпадает носовая (левая) часть поля, больше сверху
    $('#ovCurtain').style.background = det > 0 ? `linear-gradient(to bottom right, rgba(20,15,15,0.96) ${Math.round(det * 40)}%, rgba(20,15,15,0.4) ${Math.round(det * 40 + 6)}%, transparent ${Math.round(det * 40 + 16)}%)` : 'none';
    // плавающие пятна и кровоизлияния
    const fl = $('#ovFloaters'); fl.innerHTML = '';
    const nF = Math.round(dr * 8 + crvo * 10 + (wet ? amd * 3 : 0));
    const rnd = EyeModel.rng(77);
    for (let i = 0; i < nF; i++) {
      const d = document.createElement('div');
      const sz = 6 + rnd() * 26;
      d.style.cssText = `position:absolute;left:${(rnd() * 90).toFixed(0)}%;top:${(rnd() * 85).toFixed(0)}%;width:${sz.toFixed(0)}px;height:${(sz * (0.5 + rnd() * 0.5)).toFixed(0)}px;border-radius:50%;background:rgba(${crvo > dr ? '90,10,10' : '30,20,20'},${(0.45 + rnd() * 0.4).toFixed(2)});filter:blur(${(1 + rnd() * 2).toFixed(1)}px)`;
      fl.appendChild(d);
    }
    // подпись
    const notes = [];
    if (cat) notes.push(ct === 'nuclear' ? 'Катаракта: туман, желтизна, ослепление от света.' : ct === 'cortical' ? 'Катаракта: блики и двоение от периферических помутнений.' : 'Катаракта: резкое ухудшение при ярком свете и вблизи.');
    if (D) notes.push(c.ametropia.diopters < 0 ? 'Близорукость без очков: вдаль размыто.' : 'Дальнозоркость без очков: нечётко и утомительно.');
    if (cone) notes.push('Кератоконус: двоение и искажения.');
    if (gk) notes.push('Глаукома: выпадение периферии поля зрения.');
    if (det) notes.push('Отслойка: тёмная «занавеска» с одной стороны.');
    if (amd) notes.push('ВМД: пятно в центре поля зрения, искажение линий.');
    if (dr) notes.push('Диабет: плавающие пятна, снижение чёткости.');
    if (crvo) notes.push('Тромбоз ЦВС: пелена и пятна на одном глазу.');
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
  function setVisible(id, v) {
    const e = S[id]; if (!e) return;
    e.visible = v; refreshVisibility(e);
    syncLayerUI();
  }
  function syncLayerUI() {
    GROUPS.forEach(g => {
      const ids = STRUCTURES.filter(s => s.group === g.id).map(s => s.id);
      const n = ids.filter(id => S[id].visible).length;
      const chk = document.querySelector(`.group[data-group="${g.id}"] .gchk`);
      chk.checked = n === ids.length; chk.indeterminate = n > 0 && n < ids.length;
    });
    document.querySelectorAll('.row').forEach(r => { r.querySelector('.schk').checked = S[r.dataset.id].visible; r.classList.toggle('sel', r.dataset.id === selectedId); });
    updateLabels();
  }
  // Итоговый вид структуры: базовая прозрачность × прозрачность группы × режим выделения, подсветка выбранной
  function applyOpacity() {
    const F = focusSet();
    STRUCTURES.forEach(s => {
      const e = S[s.id];
      let op = Math.min(1, e.baseOpacity) * groupOpacity[s.group];
      let emissive = 0;
      if (F) {
        if (F.has(s.id)) { op = Math.min(1, Math.max(op, e.baseOpacity < 1 ? e.baseOpacity + 0.3 : 1)); emissive = 0x161616; }
        else op = Math.min(op, GHOST);
      }
      if (s.id === selectedId) emissive = 0x3a3a3a;
      const m = e.mesh.material;
      m.opacity = op; m.transparent = op < 1; m.depthWrite = op >= 0.5; m.emissive.setHex(emissive);
      m.needsUpdate = true;
      e.mesh.renderOrder = m.transparent ? 1000 : 0;
      if (e.detail) e.detail.renderOrder = e.mesh.renderOrder;
      if (e.cap) {
        const cm = e.cap.material;
        cm.opacity = op < 1 ? Math.min(1, op + 0.12) : 1; cm.depthWrite = op >= 0.5; cm.emissive.setHex(emissive);
      }
    });
  }
  function isolate(id) {
    STRUCTURES.forEach(s => setVisible(s.id, s.id === id));
    select(id);
  }
  $('#allOn').addEventListener('click', () => STRUCTURES.forEach(s => setVisible(s.id, true)));
  $('#coreOnly').addEventListener('click', () => STRUCTURES.forEach(s => setVisible(s.id, ['shell', 'inner'].includes(s.group))));

  // ---------- Выбор и карточка ----------
  function select(id) {
    selectedId = id;
    const e = S[id]; if (!e) return;
    applyOpacity();
    Object.keys(labels).forEach(k => labels[k].element.classList.toggle('sel', k === id));
    const d = e.def, g = GROUPS.find(x => x.id === d.group);
    const links = d.links.map(l => `<button data-cond="${l}">${condById[l].name.replace(/\s*\(.*\)/, '')}</button>`).join('');
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

  // Клик по модели (без выбора при вращении)
  const raycaster = new THREE.Raycaster();
  let downPos = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(m, camera);
    const hits = raycaster.intersectObjects(structureMeshes.filter(o => o.visible), false)
      .filter(h => !clip.on || clipPlane.distanceToPoint(h.point) >= 0);
    if (!hits.length) return;
    const opaque = hits.find(h => h.object.material.opacity >= 0.5);
    select((opaque || hits[0]).object.userData.id);
  });

  // ---------- Панель состояний ----------
  function buildConditions() {
    const root = $('#condList'); root.innerHTML = '';
    CONDITIONS.forEach(c => {
      const box = document.createElement('div'); box.className = 'cond'; box.dataset.cond = c.id;
      const head = document.createElement('div'); head.className = 'cond-head';
      head.innerHTML = `<input type="checkbox" class="con"><span class="name">${c.name}</span>`;
      const body = document.createElement('div'); body.className = 'cond-body';
      let html = '';
      if (c.options) html += `<label>${c.options.label}</label><select class="copt">${c.options.values.map(v => `<option value="${v.id}">${v.label}</option>`).join('')}</select>`;
      c.params.forEach(p => { html += `<label>${p.label}<span class="val" data-p="${p.id}"></span></label><input type="range" class="cp" data-p="${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.def}">`; });
      const chips = c.affects.filter(a => byId[a]).map(a => `<button data-s="${a}" title="Показать описание">${byId[a].name.replace(/\s*\(.*\)/, '')}</button>`).join('');
      html += `<div class="chips"><span>Затронуто:</span>${chips}</div><p class="note"></p><p>${c.desc}</p><p class="sym"><b>Жалобы:</b> ${c.symptoms}</p>`;
      body.innerHTML = html;
      head.querySelector('.con').addEventListener('change', (e) => {
        cond[c.id].on = e.target.checked; box.classList.toggle('on', e.target.checked); applyConditions();
        setFocus(e.target.checked ? c.id : (focus.cond === c.id ? nextEnabledCond(c.id) : focus.cond));
      });
      head.querySelector('.name').addEventListener('click', () => {
        const chk = head.querySelector('.con');
        if (chk.checked && focus.cond !== c.id) { setFocus(c.id); return; } // клик по включённой проблеме делает её текущей
        chk.checked = !chk.checked; chk.dispatchEvent(new Event('change'));
      });
      const sel = body.querySelector('.copt'); if (sel) sel.addEventListener('change', (e) => { cond[c.id][c.options.id] = e.target.value; applyConditions(); if (focus.cond !== c.id) setFocus(c.id); });
      body.querySelectorAll('.cp').forEach(inp => inp.addEventListener('input', (e) => { cond[c.id][inp.dataset.p] = parseFloat(e.target.value); applyConditions(); if (focus.cond !== c.id) setFocus(c.id); }));
      body.querySelectorAll('.chips button').forEach(b => b.addEventListener('click', () => select(b.dataset.s)));
      box.appendChild(head); box.appendChild(body); root.appendChild(box);
    });
    renderConditionNotes();
  }
  function renderConditionNotes() {
    CONDITIONS.forEach(c => {
      const box = document.querySelector(`.cond[data-cond="${c.id}"]`); if (!box) return;
      c.params.forEach(p => { const v = cond[c.id][p.id]; const el = box.querySelector(`.val[data-p="${p.id}"]`); if (el) el.textContent = (p.step < 1 ? v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : v) + p.unit; });
      const note = box.querySelector('.note');
      if (c.typeNotes) note.textContent = c.typeNotes[cond[c.id][c.options.id]] || '';
      else if (c.id === 'glaucoma') note.textContent = cond.glaucoma.iop > 21 ? `ВГД ${cond.glaucoma.iop} мм рт. ст. — выше нормы (10–21).` : `ВГД ${cond.glaucoma.iop} мм рт. ст. — в пределах нормы; возможна глаукома нормального давления.`;
      else if (c.id === 'ametropia') { const d = cond.ametropia.diopters; note.textContent = d === 0 ? 'Эмметропия: фокус на сетчатке.' : d < 0 ? `Миопия ${d} дптр: глаз длиннее нормы примерно на ${(-d * 0.35).toFixed(1)} мм, фокус перед сетчаткой.` : `Гиперметропия +${d} дптр: глаз короче нормы примерно на ${(d * 0.35).toFixed(1)} мм, фокус за сетчаткой.`; }
      else note.textContent = '';
    });
  }
  function enableCondition(id) {
    const box = document.querySelector(`.cond[data-cond="${id}"]`); const chk = box.querySelector('.con');
    if (!chk.checked) { chk.checked = true; chk.dispatchEvent(new Event('change')); }
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const c = condById[id];
    // показать затронутые структуры и включить нужные слои
    c.affects.forEach(a => setVisible(a, true));
    if (['detachment', 'amd', 'diabetic', 'crvo', 'glaucoma'].includes(id)) { ['sclera', 'choroid'].forEach(s => setVisible(s, true)); }
    if (id === 'ametropia') { ui.rays = true; $('#raysOn').checked = true; raysGroup.visible = true; }
  }

  // ---------- Управление ----------
  $('#clipOn').addEventListener('change', (e) => { clip.on = e.target.checked; updateClipPlane(); updateLabels(); });
  // Камера должна быть со стороны удалённой половины, иначе виден только наружный купол, а не срез
  function cameraToCutSide() {
    if (!clip.on) return;
    const d = clipPlane.distanceToPoint(camera.position);
    if (d > 0) {
      camera.position.addScaledVector(clipPlane.normal, -2 * d);
      const dt = clipPlane.distanceToPoint(controls.target);
      controls.target.addScaledVector(clipPlane.normal, -2 * dt);
      controls.update();
    }
    updateLabels();
  }
  $('#clipAxis').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    clip.axis = b.dataset.axis; updateClipPlane(); cameraToCutSide();
  }));
  $('#clipOffset').addEventListener('input', (e) => { clip.offset = parseFloat(e.target.value); updateClipPlane(); updateLabels(); });
  $('#clipFlip').addEventListener('click', () => { clip.flip = !clip.flip; updateClipPlane(); cameraToCutSide(); });
  $('#focusOn').addEventListener('change', (e) => { focus.on = e.target.checked; setFocus(focus.cond); });
  $('#labelsOn').addEventListener('change', (e) => { ui.labels = e.target.checked; updateLabels(); });
  $('#raysOn').addEventListener('change', (e) => { ui.rays = e.target.checked; raysGroup.visible = ui.rays; });
  const VIEWS = { iso: [[23, 11, 30], [0, -2.5, -1]], front: [[0, 2, 44], [0, 0, 2]], side: [[-46, 4, 3], [0, 0, -5]], top: [[1.5, 46, 1.5], [0, 0, -3]] };
  let currentView = 'iso';
  function setView(name) {
    const v = VIEWS[name]; currentView = name;
    controls.target.set(...v[1]);
    // на узком (портретном) экране камера отъезжает дальше, чтобы глаз поместился по ширине
    const k = camera.aspect < 1 ? Math.min(2.2, 1 / camera.aspect) : 1;
    camera.position.set(...v[0]).sub(controls.target).multiplyScalar(k).add(controls.target);
    controls.update();
    $('#views').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.view === name));
    $('#axisHint').style.display = (name === 'front' || name === 'top') ? '' : 'none';
    $('#axisHint').textContent = name === 'front' ? 'Нос → справа · Висок ← слева' : 'Вид сверху: роговица внизу экрана, нос справа';
  }
  $('#views').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#snap').addEventListener('click', () => {
    render();
    const a = document.createElement('a'); a.download = 'глаз-3d.png'; a.href = renderer.domElement.toDataURL('image/png'); a.click();
  });
  const isMobile = () => window.innerWidth <= 980;
  function syncMobileBar() {
    $('#toggleLeft').classList.toggle('on', $('#left').classList.contains('open'));
    $('#toggleRight').classList.toggle('on', $('#right').classList.contains('open'));
    $('#toggleCtl').classList.toggle('on', document.querySelector('header').classList.contains('ctl-open'));
  }
  $('#toggleLeft').addEventListener('click', () => { $('#left').classList.toggle('open'); $('#right').classList.remove('open'); syncMobileBar(); });
  $('#toggleRight').addEventListener('click', () => { $('#right').classList.toggle('open'); $('#left').classList.remove('open'); syncMobileBar(); });
  $('#toggleCtl').addEventListener('click', () => { document.querySelector('header').classList.toggle('ctl-open'); syncMobileBar(); });
  // на телефоне касание модели закрывает выдвинутые панели
  renderer.domElement.addEventListener('pointerdown', () => {
    if (!isMobile()) return;
    if ($('#left').classList.contains('open') || $('#right').classList.contains('open')) { $('#left').classList.remove('open'); $('#right').classList.remove('open'); syncMobileBar(); }
  });

  // Подписи, наложившиеся друг на друга, прячутся: приоритет у выбранной структуры и у оболочек
  const GROUP_PRIO = { shell: 0, inner: 1, nerves: 2, vessels: 3, muscles: 4, adnexa: 5 };
  let declutterTick = 0;
  function declutterLabels() {
    if ((declutterTick++ % 5) !== 0) return;
    const items = Object.keys(labels).filter(id => labels[id].visible && labels[id].element.style.display !== 'none')
      .map(id => ({ id, el: labels[id].element, p: (id === selectedId ? -10 : 0) + GROUP_PRIO[S[id].def.group] }))
      .sort((a, b) => a.p - b.p);
    const kept = [];
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
    if (lastPortrait !== null && portrait !== lastPortrait) setView(currentView); // поворот экрана: пересчитать ракурс
    lastPortrait = portrait;
  }
  new ResizeObserver(resize).observe(view);
  function applyTheme() { scene.background = new THREE.Color(isDark() ? 0x161a22 : 0xe3e7ed); }
  applyTheme();
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- Цикл ----------
  const capPos = new THREE.Vector3();
  function render() {
    controls.update();
    if (clip.on) {
      clipPlane.coplanarPoint(capPos);
      const look = capPos.clone().sub(clipPlane.normal);
      caps.forEach(c => { c.position.copy(capPos); c.lookAt(look); });
    }
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    declutterLabels();
  }
  function loop() { render(); requestAnimationFrame(loop); }

  // ---------- Старт ----------
  buildLayers();
  buildConditions();
  STRUCTURES.filter(s => s.group === 'adnexa' || s.group === 'muscles').forEach(s => setVisible(s.id, false));

  // Внешний API (для отладки и встраивания через WebView2): window.Eye3D
  window.Eye3D = {
    setView, select, setVisible, isolate,
    setClip: (o) => { Object.assign(clip, o); updateClipPlane(); updateLabels(); },
    setCondition: (id, values) => {
      if (!cond[id]) return; Object.assign(cond[id], values);
      const box = document.querySelector(`.cond[data-cond="${id}"]`);
      if (box) { box.querySelector('.con').checked = !!cond[id].on; box.classList.toggle('on', !!cond[id].on);
        box.querySelectorAll('.cp').forEach(i => { if (cond[id][i.dataset.p] !== undefined) i.value = cond[id][i.dataset.p]; });
        const sel = box.querySelector('.copt'); const c = condById[id]; if (sel && c.options) sel.value = cond[id][c.options.id]; }
      applyConditions();
      if (values.on) setFocus(id); else if (values.on === false && focus.cond === id) setFocus(nextEnabledCond(id));
    },
    setFocus, setFocusMode: (on) => { focus.on = !!on; $('#focusOn').checked = focus.on; setFocus(focus.cond); },
    getState: () => ({ clip: Object.assign({}, clip), conditions: JSON.parse(JSON.stringify(cond)), visible: Object.fromEntries(STRUCTURES.map(s => [s.id, S[s.id].visible])) }),
    camera, controls, scene,
  };
  applyOpacity();
  updateClipPlane();
  applyConditions();
  loadDetail();
  resize();
  setView('iso');
  controls.addEventListener('change', updateLabels);
  updateLabels();
  loop();
})();
