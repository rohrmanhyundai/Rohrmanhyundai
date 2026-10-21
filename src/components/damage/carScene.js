import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// ── 3D loaner for the Report Damage page ──────────────────────────────────────
// A stylised modern SUV built from separate panels so every one can be clicked:
// bumpers (3 pieces each end), hood, roof, liftgate, fenders, doors, quarters,
// glass, lights, mirrors, wheels. Front points +X, the car's RIGHT side is +Z.
// Plain three.js (no React) — LoanerDamage.jsx drives it through the handle
// createCarScene returns.

// id → label. The order here is the order the side list uses.
export const CAR_PARTS = [
  ['bumperFL', 'Front bumper — left corner'], ['bumperFC', 'Front bumper — center'], ['bumperFR', 'Front bumper — right corner'],
  ['grille', 'Grille'], ['hood', 'Hood'], ['windshield', 'Windshield'], ['roof', 'Roof'],
  ['headlightL', 'Left headlight'], ['headlightR', 'Right headlight'],
  ['fenderL', 'Left front fender'], ['doorLF', 'Left front door'], ['doorLR', 'Left rear door'], ['quarterL', 'Left rear quarter panel'],
  ['fenderR', 'Right front fender'], ['doorRF', 'Right front door'], ['doorRR', 'Right rear door'], ['quarterR', 'Right rear quarter panel'],
  ['windowLF', 'Left front window'], ['windowLR', 'Left rear window'], ['windowRF', 'Right front window'], ['windowRR', 'Right rear window'],
  ['mirrorL', 'Left mirror'], ['mirrorR', 'Right mirror'],
  ['liftgate', 'Liftgate'], ['rearGlass', 'Rear glass'], ['taillightL', 'Left taillight'], ['taillightR', 'Right taillight'],
  ['bumperRL', 'Rear bumper — left corner'], ['bumperRC', 'Rear bumper — center'], ['bumperRR', 'Rear bumper — right corner'],
  ['wheelLF', 'Left front wheel'], ['wheelLR', 'Left rear wheel'], ['wheelRF', 'Right front wheel'], ['wheelRR', 'Right rear wheel'],
];
export const PART_LABEL = Object.fromEntries(CAR_PARTS);

export const VIEWS = {
  front: [7.5, 1.6, 0], rear: [-7.5, 1.6, 0], left: [0, 1.7, -9], right: [0, 1.7, 9],
  top: [0.01, 9.5, 0.01], corner: [6, 3, 6],
};

const HOVER = new THREE.Color('#38bdf8');
const SELECT = new THREE.Color('#22d3ee');
const DAMAGE = new THREE.Color('#ef4444');

export function createCarScene(container, { onHover, onPick } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(...VIEWS.corner);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.8, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 4.2;
  controls.maxDistance = 13;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.9;
  controls.update();

  // Lights: soft key + rim, the environment does most of the reflections.
  scene.add(new THREE.HemisphereLight('#cbd5e1', '#0b1120', 0.6));
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(5, 9, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 });
  key.shadow.radius = 6;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#7dd3fc', 1.1);
  rim.position.set(-6, 4, -5);
  scene.add(rim);

  // Floor: shadow catcher + a glowing ring.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.ShadowMaterial({ opacity: 0.45 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.15, 3.22, 96), new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.35 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.005;
  scene.add(ring);

  // ── Materials ──
  // Deep metallic blue — reads premium and makes the red damage pop.
  const paint = () => new THREE.MeshPhysicalMaterial({ color: '#2b4a78', metalness: 0.7, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05 });
  const trim = () => new THREE.MeshStandardMaterial({ color: '#0b0f17', metalness: 0.3, roughness: 0.55 });
  const glass = () => new THREE.MeshPhysicalMaterial({ color: '#0f172a', metalness: 0.1, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.88, clearcoat: 1, side: THREE.DoubleSide });
  const lamp = (c, glow = 0.6) => () => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: glow, roughness: 0.2 });

  const car = new THREE.Group();
  scene.add(car);
  const parts = {};   // id → { meshes: [], base: [{ color, emissive }] }
  const pickables = [];

  const addPart = (id, mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.part = id;
    car.add(mesh);
    const meshes = [];
    mesh.traverse(o => { if (o.isMesh) { o.userData.part = id; o.castShadow = true; meshes.push(o); pickables.push(o); } });
    const p = parts[id] || (parts[id] = { meshes: [], base: [] });
    meshes.forEach(m => {
      p.meshes.push(m);
      p.base.push({ color: m.material.color.clone(), emissive: m.material.emissive ? m.material.emissive.clone() : null, ei: m.material.emissiveIntensity ?? 0 });
    });
    return mesh;
  };
  const box = (w, h, d, mat, r = 0.03) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), mat);
  const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };

  // ── Body core (not clickable) ──
  const core = at(box(4.3, 0.6, 1.82, paint(), 0.16), 0.08, 0.7, 0);
  core.castShadow = true;
  car.add(core);
  // Cabin: side profile extruded across the car — slanted windshield and hatch.
  const prof = new THREE.Shape();
  prof.moveTo(-1.95, 0.98); prof.lineTo(1.0, 0.98); prof.lineTo(0.32, 1.62); prof.lineTo(-1.4, 1.64); prof.lineTo(-1.98, 1.08); prof.closePath();
  const cabinGeo = new THREE.ExtrudeGeometry(prof, { depth: 1.56, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 });
  cabinGeo.translate(0, 0, -0.78);
  const cabin = new THREE.Mesh(cabinGeo, trim());
  cabin.castShadow = true;
  car.add(cabin);
  // Under-tray / rocker shadow line.
  car.add(at(box(3.9, 0.12, 1.7, trim(), 0.05), 0.08, 0.36, 0));

  // ── Bumpers (3 pieces each end) ──
  const zs = [[-0.66, 0.5], [0, 0.82], [0.66, 0.5]];  // [z center, width] for L, C, R
  ['FL', 'FC', 'FR'].forEach((k, i) => addPart(`bumper${k}`, at(box(0.18, 0.34, zs[i][1] - 0.01, paint(), 0.07), 2.22, 0.52, zs[i][0])));
  ['RL', 'RC', 'RR'].forEach((k, i) => addPart(`bumper${k}`, at(box(0.18, 0.34, zs[i][1] - 0.01, paint(), 0.07), -2.06, 0.52, zs[i][0])));

  // ── Front end ──
  addPart('grille', at(box(0.06, 0.2, 0.9, trim(), 0.03), 2.24, 0.84, 0));
  addPart('headlightL', at(box(0.08, 0.1, 0.42, lamp('#e0f2fe')(), 0.03), 2.25, 0.9, -0.62));
  addPart('headlightR', at(box(0.08, 0.1, 0.42, lamp('#e0f2fe')(), 0.03), 2.25, 0.9, 0.62));
  const hood = addPart('hood', at(box(1.2, 0.03, 1.64, paint(), 0.015), 1.62, 1.005, 0));
  hood.rotation.z = -0.06;

  // ── Glass ──
  const slab = (x1, y1, x2, y2, width, mat) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const m = box(len, 0.035, width, mat, 0.015);
    m.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
    m.rotation.z = Math.atan2(y2 - y1, x2 - x1);
    return m;
  };
  const ws = slab(1.03, 0.99, 0.35, 1.63, 1.5, glass());
  ws.position.x += 0.02; ws.position.y += 0.02;
  addPart('windshield', ws);
  const rg = slab(-1.42, 1.65, -2.0, 1.09, 1.42, glass());
  rg.position.x -= 0.02; rg.position.y += 0.02;
  addPart('rearGlass', rg);
  addPart('roof', at(box(1.7, 0.05, 1.5, paint(), 0.02), -0.54, 1.67, 0));
  // Side windows: flat shapes on each cabin side.
  const winShape = (pts) => { const s = new THREE.Shape(); s.moveTo(...pts[0]); pts.slice(1).forEach(p => s.lineTo(...p)); s.closePath(); return new THREE.ShapeGeometry(s); };
  const front = [[0.05, 1.06], [0.9, 1.06], [0.34, 1.56], [0.05, 1.56]];
  const rear = [[-1.3, 1.06], [-0.05, 1.06], [-0.05, 1.56], [-1.36, 1.56]];
  [['L', -0.84], ['R', 0.84]].forEach(([side, z]) => {
    addPart(`window${side}F`, at(new THREE.Mesh(winShape(front), glass()), 0, 0, z));
    addPart(`window${side}R`, at(new THREE.Mesh(winShape(rear), glass()), 0, 0, z));
  });

  // ── Side panels ──
  const sideZ = 0.925;
  const sides = [['fender', 1.72, 0.86], ['door$F', 0.62, 1.08], ['door$R', -0.47, 1.06], ['quarter', -1.5, 0.98]];
  [['L', -1], ['R', 1]].forEach(([side, sgn]) => {
    sides.forEach(([name, x, w]) => {
      const id = name.includes('$') ? name.replace('$', side) : `${name}${side}`;
      addPart(id, at(box(w, 0.5, 0.05, paint(), 0.025), x, 0.73, sgn * sideZ));
    });
    const mirror = addPart(`mirror${side}`, at(box(0.22, 0.12, 0.2, paint(), 0.05), 0.86, 1.1, sgn * 0.98));
    mirror.rotation.y = sgn * 0.15;
  });

  // ── Rear ──
  addPart('liftgate', at(box(0.06, 0.42, 1.5, paint(), 0.03), -2.0, 0.84, 0));
  addPart('taillightL', at(box(0.08, 0.1, 0.4, lamp('#5b1414', 0.25)(), 0.03), -2.05, 1.0, -0.6));
  addPart('taillightR', at(box(0.08, 0.1, 0.4, lamp('#5b1414', 0.25)(), 0.03), -2.05, 1.0, 0.6));

  // ── Wheels ──
  const wheel = () => {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.11, 20, 40), new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.9 }));
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 36), new THREE.MeshStandardMaterial({ color: '#9ca3af', metalness: 0.9, roughness: 0.25 }));
    rim.rotation.x = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 16), new THREE.MeshStandardMaterial({ color: '#374151', metalness: 0.8, roughness: 0.3 }));
    hub.rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.04), rim.material);
      spoke.position.set(Math.cos(i * 1.2566) * 0.11, Math.sin(i * 1.2566) * 0.11, 0.07);
      spoke.rotation.z = i * 1.2566 - Math.PI / 2;
      g.add(spoke);
    }
    g.add(tire, rim, hub);
    return g;
  };
  [['LF', 1.42, -0.9], ['LR', -1.32, -0.9], ['RF', 1.42, 0.9], ['RR', -1.32, 0.9]].forEach(([k, x, z]) => addPart(`wheel${k}`, at(wheel(), x, 0.38, z)));

  // ── Highlighting ──
  let damaged = new Set();
  let hoverId = null, selectedId = null;
  const paintPart = (id) => {
    const p = parts[id];
    if (!p) return;
    const state = id === selectedId ? 'sel' : damaged.has(id) ? 'dmg' : id === hoverId ? 'hov' : '';
    p.meshes.forEach((m, i) => {
      const b = p.base[i];
      const mat = m.material;
      if (state === 'dmg') mat.color.copy(b.color).lerp(DAMAGE, 0.75);
      else mat.color.copy(b.color);
      if (mat.emissive) {
        if (state === 'sel') { mat.emissive.copy(SELECT); mat.emissiveIntensity = 0.55; }
        else if (state === 'dmg') { mat.emissive.copy(DAMAGE); mat.emissiveIntensity = 0.5; }
        else if (state === 'hov') { mat.emissive.copy(HOVER); mat.emissiveIntensity = 0.35; }
        else { if (b.emissive) mat.emissive.copy(b.emissive); mat.emissiveIntensity = b.ei; }
      }
    });
  };
  const repaintAll = () => Object.keys(parts).forEach(paintPart);

  // ── Picking ──
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects([...pickables, core, cabin], false)[0];
    return h && h.object.userData.part ? h.object.userData.part : null;
  };
  let down = null;
  const onMove = (e) => {
    const id = hit(e);
    if (id !== hoverId) {
      const prev = hoverId; hoverId = id;
      paintPart(prev); paintPart(id);
      renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
      onHover && onHover(id, e);
    } else if (id && onHover) onHover(id, e);
  };
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; controls.autoRotate = false; };
  const onUp = (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return;           // that was a drag (rotate), not a click
    const id = hit(e);
    if (id && onPick) onPick(id);
  };
  const onLeave = () => { const prev = hoverId; hoverId = null; paintPart(prev); onHover && onHover(null); };
  const el = renderer.domElement;
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointerleave', onLeave);

  // ── Camera moves ──
  let tween = null;
  const viewFrom = (name) => {
    const to = VIEWS[name];
    if (!to) return;
    controls.autoRotate = false;
    tween = { from: camera.position.clone(), to: new THREE.Vector3(...to), t: 0 };
  };

  // ── Loop + resize ──
  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const clock = new THREE.Clock();
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const dt = clock.getDelta();
    if (tween) {
      tween.t = Math.min(1, tween.t + dt * 1.8);
      const k = 1 - Math.pow(1 - tween.t, 3);
      camera.position.lerpVectors(tween.from, tween.to, k);
      if (tween.t >= 1) tween = null;
    }
    // Damaged parts breathe so they catch the eye.
    const pulse = 0.35 + 0.25 * Math.sin(clock.elapsedTime * 3);
    damaged.forEach(id => { if (id !== selectedId && parts[id]) parts[id].meshes.forEach(m => { if (m.material.emissive) m.material.emissiveIntensity = pulse; }); });
    ring.material.opacity = 0.25 + 0.1 * Math.sin(clock.elapsedTime * 1.5);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  return {
    setDamaged(ids) { damaged = new Set(ids); repaintAll(); },
    setSelected(id) { const prev = selectedId; selectedId = id; paintPart(prev); paintPart(id); },
    viewFrom,
    setAutoRotate(on) { controls.autoRotate = !!on; },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
      envTex.dispose(); pmrem.dispose();
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
}
