import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export function initSite3D(deps) {
const { getS, schedule, PHASES, GPUS, fmtN, REDUCE, perRack, incidents: INC } = deps;
// Thermal camera post-process. In thermal mode every mesh renders its temperature as a grey level
// (0 = 20 °C, 1 = 80 °C) into a low-res target, like a 320x240 microbolometer. The composite pass
// blurs it, adds heat bloom around hot spots, sensor noise and fixed-pattern stripes, then maps
// the result through the ironbow palette.


const T_LO = 20, T_HI = 80;
const tnorm = (t) => Math.min(1, Math.max(0, (t - T_LO) / (T_HI - T_LO)));

// temperature material: flat value plus a slight warm-at-top gradient, no lighting
function tempMaterial(t, inst = false) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uT: { value: tnorm(t) }, uInst: { value: inst ? 1 : 0 } },
    vertexShader: `varying vec3 vW; varying vec3 vN; varying float vIT; void main(){ vec4 p = vec4(position,1.); vec3 n = normal; vIT = -1.;
      #ifdef USE_INSTANCING
        p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vIT = instanceColor.r;
      #endif
      vec4 w = modelMatrix * p; vW = w.xyz; vN = normalize(mat3(modelMatrix) * n); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uT; uniform float uInst; varying vec3 vW; varying vec3 vN; varying float vIT;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){ float t = (uInst > .5 && vIT >= 0. ? vIT : uT) + vW.y * .002 + (h(floor(vW * 9.)) - .5) * .012 - max(0., -vN.y) * .01 + vN.y * .004; gl_FragColor = vec4(vec3(t), 1.); }`,
  });
  m.userData.setT = (tc) => { m.uniforms.uT.value = tnorm(tc); };
  return m;
}

class ThermalCam {
  constructor(renderer) {
    this.r = renderer;
    const o = { type: THREE.HalfFloatType, depthBuffer: true };
    this.rtLo = new THREE.WebGLRenderTarget(320, 240, o);
    this.rtGlow = new THREE.WebGLRenderTarget(64, 48, { type: THREE.HalfFloatType, depthBuffer: false });
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = (mat) => { const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)); return s; };
    this.down = new THREE.ShaderMaterial({
      uniforms: { src: { value: this.rtLo.texture }, px: { value: new THREE.Vector2(1 / 320, 1 / 240) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`,
      fragmentShader: `uniform sampler2D src; uniform vec2 px; varying vec2 vUv;
        void main(){ float s = 0., w = 0.; for (int i=-3;i<=3;i++) for (int j=-3;j<=3;j++){ float k = exp(-float(i*i+j*j)/8.); float v = texture2D(src, vUv + vec2(i,j)*px*2.5).r; s += max(0., v - .45) * k; w += k; } gl_FragColor = vec4(vec3(s / w), 1.); }`,
    });
    this.comp = new THREE.ShaderMaterial({
      uniforms: { lo: { value: this.rtLo.texture }, glow: { value: this.rtGlow.texture }, px: { value: new THREE.Vector2(1 / 320, 1 / 240) }, time: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`,
      fragmentShader: `uniform sampler2D lo, glow; uniform vec2 px; uniform float time; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        vec3 ironbow(float x){
          x = clamp(x, 0., 1.);
          vec3 c0 = vec3(.03,.015,.11), c1 = vec3(.18,.02,.43), c2 = vec3(.5,.04,.55), c3 = vec3(.78,.12,.43), c4 = vec3(.93,.31,.12), c5 = vec3(.99,.63,.04), c6 = vec3(1.,.89,.35), c7 = vec3(1.,1.,.94);
          if (x < .18) return mix(c0,c1,x/.18); if (x < .36) return mix(c1,c2,(x-.18)/.18); if (x < .52) return mix(c2,c3,(x-.36)/.16);
          if (x < .66) return mix(c3,c4,(x-.52)/.14); if (x < .8) return mix(c4,c5,(x-.66)/.14); if (x < .92) return mix(c5,c6,(x-.8)/.12); return mix(c6,c7,(x-.92)/.08);
        }
        void main(){
          // 3x3 tent blur of the 320x240 sensor image: optics + detector crosstalk
          float t = 0.; for (int i=-1;i<=1;i++) for (int j=-1;j<=1;j++) t += texture2D(lo, vUv + vec2(i,j)*px).r * (i==0&&j==0 ? .25 : (i==0||j==0 ? .125 : .0625));
          t += texture2D(glow, vUv).r * .9;                    // heat bleeding into surroundings
          vec2 sp = floor(vUv * vec2(320.,240.));
          t += (h(sp + fract(time) * 91.) - .5) * .018;        // temporal sensor noise (NETD)
          t += (h(vec2(sp.x, 7.)) - .5) * .008;                // fixed-pattern column noise
          vec2 d = vUv - .5; t -= dot(d,d) * .06;              // lens vignetting reads cooler at the edge
          t = pow(clamp((t - .02) / .9, 0., 1.), .78);         // camera AGC: stretch the span, lift the midtones
          gl_FragColor = vec4(ironbow(t), 1.);
        }`,
    });
    this.downScene = quad(this.down); this.compScene = quad(this.comp);
  }
  resize(w, h) {
    const a = w / h, H = 240, W = Math.round(H * a);
    this.rtLo.setSize(W, H); this.rtGlow.setSize(Math.round(W / 5), Math.round(H / 5));
    this.down.uniforms.px.value.set(1 / W, 1 / H); this.comp.uniforms.px.value.set(1 / W, 1 / H);
  }
  render(scene, camera, time) {
    const r = this.r, tm = r.toneMapping, cs = r.outputColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.rtLo); r.render(scene, camera);
    r.setRenderTarget(this.rtGlow); r.render(this.downScene, this.cam);
    r.setRenderTarget(null); this.comp.uniforms.time.value = time; r.render(this.compScene, this.cam);
    r.toneMapping = tm; r.outputColorSpace = cs;
  }
}

// props.js - set dressing for the MCC electrical room diorama.
// Everything is added under one group; update(dt, t) drives the micro animations.



const BACK_Z = -11.9; // inner face of back wall
const LEFT_X = -10.9; // inner face of left wall
const HALF_PI = Math.PI / 2;

function buildProps(scene) {
  const root = new THREE.Group();
  root.name = "props";
  scene.add(root);

  // ---------- shared geometry ----------
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
    cylLo: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    plane: new THREE.PlaneGeometry(1, 1),
    cone: new THREE.ConeGeometry(0.5, 1, 16, 1, true),
    disc: new THREE.CircleGeometry(0.5, 32),
    torus: new THREE.TorusGeometry(0.5, 0.08, 6, 24),
    shackle: new THREE.TorusGeometry(0.5, 0.12, 6, 12, Math.PI),
  };
  const rboxCache = new Map();
  function rbox(w, h, d, r = 0.015) {
    const k = `${w}|${h}|${d}|${r}`;
    if (!rboxCache.has(k)) rboxCache.set(k, new RoundedBoxGeometry(w, h, d, 2, r));
    return rboxCache.get(k);
  }

  // ---------- shared materials ----------
  const std = (color, rough = 0.6, metal = 0.1, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const M = {
    cab: std(0x8e959b, 0.55, 0.35), // ANSI 61 grey enclosure
    cabDark: std(0x3a3f44, 0.6, 0.3),
    plinth: std(0x1d1f22, 0.8, 0.1),
    vent: std(0x24282c, 0.7, 0.4),
    galv: std(0xa9aeb2, 0.42, 0.65),
    galvDark: std(0x7c8186, 0.5, 0.6),
    black: std(0x141516, 0.7, 0.1),
    rubber: std(0x1a1a1a, 0.9, 0.0),
    red: std(0xb3261e, 0.45, 0.2),
    redDeep: std(0x8a1c16, 0.5, 0.2),
    yellow: std(0xe8b90e, 0.5, 0.1),
    orange: std(0xe0601a, 0.55, 0.05),
    green: std(0x2e7d32, 0.5, 0.1),
    blue: std(0x1f4f9a, 0.5, 0.1),
    white: std(0xeceae4, 0.5, 0.0),
    beige: std(0xd8d2c2, 0.6, 0.0),
    fiberglass: std(0xf0c21a, 0.45, 0.05),
    alu: std(0xc9ccce, 0.35, 0.75),
    cardboard: std(0xb08a5a, 0.9, 0.0),
    cardboard2: std(0x9c7748, 0.9, 0.0),
    cable: std(0x222222, 0.6, 0.0),
    battery: std(0x2b2d30, 0.7, 0.1),
    battTop: std(0x7a2a24, 0.6, 0.1),
    checker: null, // filled below
    trenchVoid: std(0x0a0b0c, 1.0, 0.0),
    lens: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0 }),
  };

  let meshCount = 0;
  function add(geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, temp = 26, o = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    if (o.rx) m.rotation.x = o.rx;
    if (o.ry) m.rotation.y = o.ry;
    if (o.rz) m.rotation.z = o.rz;
    m.castShadow = !!o.cast;
    m.receiveShadow = o.recv !== false;
    m.userData.temp = temp;
    (o.parent || root).add(m);
    meshCount++;
    return m;
  }
  // box by center
  const B = (mat, x, y, z, w, h, d, temp = 26, o) => add(G.box, mat, x, y, z, w, h, d, temp, o);

  function canvasTex(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    draw(ctx, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { tex, ctx, canvas: c };
  }
  const labelMat = (tex, emissive = false) =>
    emissive
      ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
      : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0 });

  // plane facing +z (back wall) or +x (left wall)
  const planeZ = (mat, x, y, z, w, h, temp = 26, parent) => add(G.plane, mat, x, y, z, w, h, 1, temp, { parent });
  const planeX = (mat, x, y, z, w, h, temp = 26, parent) => add(G.plane, mat, x, y, z, w, h, 1, temp, { ry: HALF_PI, parent });

  // ---------- LED instancing ----------
  const leds = []; // {pos, color, mode, rate, phase}
  function led(x, y, z, color, mode = "steady", rate = 1, size = 0.014) {
    leds.push({ x, y, z, color: new THREE.Color(color), mode, rate, phase: Math.random() * 10, size, on: true, next: Math.random() });
  }

  // conduit couplings / straps, instanced
  const couplers = []; // {x,y,z,axis}
  const conduitR = 0.0125;
  function runX(y, z, x0, x1) {
    const len = x1 - x0;
    add(G.cylLo, M.galv, (x0 + x1) / 2, y, z, conduitR * 2, len, conduitR * 2, 26, { rz: HALF_PI });
    for (let x = x0 + 1.5; x < x1 - 0.2; x += 3.05) couplers.push({ x, y, z, axis: "x" });
  }
  function runZ(y, x, z0, z1) {
    const len = z1 - z0;
    add(G.cylLo, M.galv, x, y, (z0 + z1) / 2, conduitR * 2, len, conduitR * 2, 26, { rx: HALF_PI });
    for (let z = z0 + 1.5; z < z1 - 0.2; z += 3.05) couplers.push({ x, y, z, axis: "z" });
  }
  function runY(x, z, y0, y1) {
    const len = y1 - y0;
    add(G.cylLo, M.galv, x, (y0 + y1) / 2, z, conduitR * 2, len, conduitR * 2, 26);
    if (len > 1.2) couplers.push({ x, y: (y0 + y1) / 2, z, axis: "y" });
  }
  const jboxBack = (x, y) => B(M.galvDark, x, y, BACK_Z + 0.05, 0.12, 0.12, 0.08, 26);
  const jboxLeft = (z, y) => B(M.galvDark, LEFT_X + 0.05, y, z, 0.08, 0.12, 0.12, 26);

  // =====================================================================
  // BACK WALL LINE-UP
  // =====================================================================

  // ---- VFD drive cabinets ----
  const vfdXs = [-6.4, -5.55, -4.7, -3.85];
  const vfdW = 0.82, vfdH = 2.2, vfdD = 0.6;
  const vfdZ = BACK_Z + vfdD / 2;
  const vfdFront = BACK_Z + vfdD;
  const arcLabel = canvasTex(128, 96, (c, w, h) => {
    c.fillStyle = "#f7f3e8"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#f07b12"; c.fillRect(0, 0, w, 30);
    c.fillStyle = "#111"; c.font = "bold 19px Arial"; c.textAlign = "center";
    c.fillText("WARNING", w / 2, 22);
    c.font = "bold 12px Arial";
    c.fillText("ARC FLASH AND", w / 2, 48);
    c.fillText("SHOCK HAZARD", w / 2, 62);
    c.font = "10px Arial";
    c.fillText("PPE CAT 2  8 cal/cm2", w / 2, 82);
  });
  const arcMat = labelMat(arcLabel.tex);
  const nameplate = (txt) => {
    const t = canvasTex(128, 32, (c, w, h) => {
      c.fillStyle = "#1b1b1b"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#f2f2f2"; c.font = "bold 16px Arial"; c.textAlign = "center";
      c.fillText(txt, w / 2, 22);
    });
    return labelMat(t.tex);
  };

  const vfdData = [
    { name: "VFD-101 CRAH-1", hz: 60.0, a: 42.1, run: true },
    { name: "VFD-102 CRAH-2", hz: 45.2, a: 18.6, run: true },
    { name: "VFD-103 CHWP-1", hz: 0.0, a: 0.0, run: false },
    { name: "VFD-104 CT FAN", hz: 52.8, a: 27.3, run: true },
  ];
  const keypads = [];
  vfdXs.forEach((x, i) => {
    B(M.plinth, x, 0.05, vfdZ, vfdW, 0.1, vfdD, 26);
    add(rbox(vfdW, vfdH - 0.1, vfdD, 0.02), M.cab, x, 0.1 + (vfdH - 0.1) / 2, vfdZ, 1, 1, 1, 36 + (i % 2) * 2, { cast: true });
    // top exhaust hood (hot)
    B(M.vent, x, vfdH + 0.04, vfdZ + 0.03, vfdW - 0.14, 0.08, vfdD - 0.16, 45);
    // lower intake grille
    B(M.vent, x, 0.42, vfdFront + 0.004, vfdW - 0.28, 0.32, 0.01, 44);
    // upper filter grille
    B(M.vent, x, 1.95, vfdFront + 0.004, vfdW - 0.36, 0.16, 0.01, 45);
    // handle
    B(M.black, x + vfdW / 2 - 0.08, 1.1, vfdFront + 0.02, 0.03, 0.2, 0.03, 34);
    // keypad bezel + screen
    B(M.black, x - 0.05, 1.5, vfdFront + 0.008, 0.2, 0.2, 0.014, 38);
    const kp = canvasTex(160, 80, () => {});
    const scr = planeZ(labelMat(kp.tex, true), x - 0.05, 1.54, vfdFront + 0.016, 0.16, 0.08, 38);
    scr.receiveShadow = false;
    keypads.push({ ...vfdData[i], kp, base: { hz: vfdData[i].hz, a: vfdData[i].a } });
    // arc flash label + nameplate
    planeZ(arcMat, x + 0.18, 1.52, vfdFront + 0.003, 0.16, 0.12, 36);
    planeZ(nameplate(vfdData[i].name), x - 0.05, 1.8, vfdFront + 0.003, 0.3, 0.075, 36);
    // status LEDs: RUN (green), READY (amber), FAULT (red)
    const ly = 1.43;
    led(x - 0.1, ly, vfdFront + 0.017, 0x28ff5a, vfdData[i].run ? "steady" : "off");
    led(x - 0.05, ly, vfdFront + 0.017, 0xffb020, vfdData[i].run ? "off" : "blink", 1.0);
    led(x, ly, vfdFront + 0.017, 0xff2a1a, i === 3 ? "blink" : "off", 0.35);
    // conduit drop from overhead run
    runY(x, BACK_Z + 0.08, vfdH + 0.08, 3.5);
    jboxBack(x, 3.55);
  });
  // yellow floor tape: working clearance in front of drives
  {
    const x0 = vfdXs[0] - vfdW / 2 - 0.05, x1 = vfdXs[3] + vfdW / 2 + 0.05;
    const z0 = vfdFront + 0.05, z1 = vfdFront + 1.0;
    const tw = 0.05, ty = 0.004;
    B(M.yellow, (x0 + x1) / 2, ty, z1, x1 - x0, 0.004, tw, 26, { recv: true });
    B(M.yellow, x0, ty, (z0 + z1) / 2, tw, 0.004, z1 - z0, 26);
    B(M.yellow, x1, ty, (z0 + z1) / 2, tw, 0.004, z1 - z0, 26);
  }

  // ---- UPS ----
  const upsX = -2.6, upsW = 0.7, upsH = 1.9, upsD = 0.8;
  const upsFront = BACK_Z + upsD;
  add(rbox(upsW, upsH, upsD, 0.025), M.cabDark, upsX, upsH / 2, BACK_Z + upsD / 2, 1, 1, 1, 32, { cast: true });
  B(M.vent, upsX, 0.35, upsFront + 0.004, upsW - 0.2, 0.4, 0.01, 35);
  {
    const t = canvasTex(192, 96, (c, w, h) => {
      c.fillStyle = "#08131e"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#6fd0ff"; c.font = "bold 18px monospace";
      c.fillText("UPS-1  ONLINE", 10, 24);
      c.font = "15px monospace";
      c.fillText("LOAD   42 %", 10, 48);
      c.fillText("BATT  100 %", 10, 68);
      c.fillText("RUNTIME 18 min", 10, 88);
    });
    const s = planeZ(labelMat(t.tex, true), upsX, 1.45, upsFront + 0.006, 0.26, 0.13, 32);
    s.receiveShadow = false;
    planeZ(nameplate("UPS-1 1.2 MVA"), upsX, 1.7, upsFront + 0.004, 0.3, 0.075, 32);
    led(upsX - 0.08, 1.3, upsFront + 0.008, 0x28ff5a, "steady");
    led(upsX - 0.03, 1.3, upsFront + 0.008, 0x28ff5a, "steady");
    led(upsX + 0.02, 1.3, upsFront + 0.008, 0xffb020, "off");
    led(upsX + 0.07, 1.3, upsFront + 0.008, 0x28ff5a, "blink", 0.5);
  }
  runY(upsX, BACK_Z + 0.08, upsH, 3.5);
  jboxBack(upsX, 3.55);

  // ---- battery rack (open frame, instanced jars) ----
  {
    const bx = -1.55, bw = 0.9, bh = 1.5, bd = 0.55;
    const bz = BACK_Z + bd / 2 + 0.03;
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      B(M.galvDark, bx + sx * (bw / 2 - 0.02), bh / 2, bz + sz * (bd / 2 - 0.02), 0.04, bh, 0.04, 27);
    const shelfYs = [0.08, 0.45, 0.82, 1.19];
    for (const y of shelfYs) B(M.galvDark, bx, y, bz, bw, 0.03, bd, 27);
    B(M.galvDark, bx, bh, bz, bw, 0.03, bd, 27);
    const jar = new THREE.InstancedMesh(G.box, M.battery, shelfYs.length * 4);
    const cap = new THREE.InstancedMesh(G.box, M.battTop, shelfYs.length * 4);
    const d = new THREE.Object3D();
    let k = 0;
    for (const y of shelfYs) for (let j = 0; j < 4; j++) {
      const x = bx - bw / 2 + 0.12 + j * 0.22;
      d.position.set(x, y + 0.015 + 0.14, bz); d.scale.set(0.17, 0.28, 0.45); d.updateMatrix();
      jar.setMatrixAt(k, d.matrix);
      d.position.set(x, y + 0.015 + 0.29, bz); d.scale.set(0.12, 0.02, 0.35); d.updateMatrix();
      cap.setMatrixAt(k, d.matrix);
      k++;
    }
    for (const im of [jar, cap]) {
      im.castShadow = false; im.receiveShadow = true; im.userData.temp = 30; root.add(im); meshCount++;
    }
    planeZ(nameplate("BATT RACK B1"), bx, bh + 0.08, bz + bd / 2, 0.3, 0.075, 27);
  }

  // ---- 42U network / PLC rack ----
  {
    const rx = -0.4, rw = 0.6, rh = 2.05, rd = 1.0;
    const rz = BACK_Z + rd / 2 + 0.02;
    const front = rz + rd / 2;
    // frame: side panels, top, rear
    B(M.black, rx - rw / 2 + 0.01, rh / 2, rz, 0.02, rh, rd, 34, { cast: true });
    B(M.black, rx + rw / 2 - 0.01, rh / 2, rz, 0.02, rh, rd, 34, { cast: true });
    B(M.black, rx, rh - 0.02, rz, rw, 0.04, rd, 38);
    B(M.black, rx, 0.04, rz, rw, 0.08, rd, 30);
    B(M.cabDark, rx, rh / 2, rz - rd / 2 + 0.02, rw - 0.04, rh, 0.02, 34);
    // front rails
    B(M.galvDark, rx - 0.24, rh / 2, front - 0.05, 0.02, rh - 0.1, 0.02, 34);
    B(M.galvDark, rx + 0.24, rh / 2, front - 0.05, 0.02, rh - 0.1, 0.02, 34);
    const U = 0.0445, u0 = 0.1;
    const devs = [
      // [startU, heightU, material, ledCount, ledColor, temp]
      [39, 1, M.alu, 12, 0x28ff5a, 30],
      [37, 1, M.cabDark, 24, 0x28ff5a, 38],
      [35, 1, M.cabDark, 24, 0xffb020, 38],
      [31, 2, M.black, 4, 0x3aa0ff, 40],
      [24, 5, M.cab, 10, 0x28ff5a, 36],
      [18, 3, M.cabDark, 3, 0x28ff5a, 34],
      [13, 2, M.black, 4, 0x3aa0ff, 40],
      [9, 1, M.alu, 12, 0x28ff5a, 30],
    ];
    for (const [su, hu, mat, n, col, temp] of devs) {
      const y = u0 + (su + hu / 2) * U;
      B(mat, rx, y, front - 0.28, 0.48, hu * U - 0.004, 0.44, temp);
      const w = 0.4;
      for (let j = 0; j < n; j++) {
        const lx = rx - w / 2 + (j + 0.5) * (w / n);
        const ly = y + (hu > 2 ? (j % 2 ? 0.04 : -0.04) : 0);
        led(lx, ly, front - 0.055, j % 7 === 3 ? 0xffb020 : col, "rand", 3 + Math.random() * 8, 0.01);
      }
    }
    planeZ(nameplate("NET/PLC RK-1"), rx, rh - 0.1, front + 0.002, 0.3, 0.075, 34);
    runY(rx, BACK_Z + 0.08, rh, 3.5);
    jboxBack(rx, 3.55);
  }

  // ---- whiteboard with single-line diagram + PM schedule ----
  {
    const wx = 1.8, wy = 1.55, ww = 2.0, wh = 1.15;
    const t = canvasTex(1024, 576, (c, w, h) => {
      c.fillStyle = "#f6f7f4"; c.fillRect(0, 0, w, h);
      // faint ghosting of old erased notes
      c.globalAlpha = 0.08; c.fillStyle = "#333"; c.font = "34px 'Comic Sans MS', cursive";
      c.fillText("call Mike re: CRAH-2", 540, 520); c.globalAlpha = 1;
      const hand = (x, y, x2, y2, col = "#1a2a6c", wdt = 4) => {
        c.strokeStyle = col; c.lineWidth = wdt; c.lineCap = "round";
        c.beginPath(); c.moveTo(x + Math.random() * 2, y + Math.random() * 2);
        const mx = (x + x2) / 2 + (Math.random() - 0.5) * 4, my = (y + y2) / 2 + (Math.random() - 0.5) * 4;
        c.quadraticCurveTo(mx, my, x2, y2); c.stroke();
      };
      const circ = (x, y, r, col = "#1a2a6c") => { c.strokeStyle = col; c.lineWidth = 4; c.beginPath(); c.arc(x, y, r, 0.1, Math.PI * 2.05); c.stroke(); };
      c.fillStyle = "#1a2a6c"; c.font = "bold 34px 'Comic Sans MS', cursive";
      c.fillText("SINGLE LINE - HALL A", 30, 50);
      c.font = "24px 'Comic Sans MS', cursive";
      // utility -> xfmr -> bus
      hand(240, 70, 240, 110); c.fillText("UTIL 12.47kV", 260, 95);
      circ(240, 130, 20); circ(240, 162, 20);
      c.fillText("T1 1500kVA", 275, 155);
      hand(240, 182, 240, 225);
      c.fillRect(234, 212, 12, 12);
      c.fillText("MB 2000A", 260, 225);
      hand(60, 250, 470, 250, "#1a2a6c", 7);
      c.fillText("480V BUS", 60, 240);
      const feeds = [90, 180, 270, 360, 450];
      const labels = ["PDU-A", "PDU-B", "CRAH", "UPS", "PP-1"];
      feeds.forEach((fx, i) => {
        hand(fx, 250, fx, 300);
        c.strokeStyle = "#1a2a6c"; c.lineWidth = 3; c.strokeRect(fx - 8, 300, 16, 16);
        hand(fx, 316, fx, 370);
        circ(fx, 392, 22, i === 2 ? "#b3261e" : "#1a2a6c");
        c.fillStyle = i === 2 ? "#b3261e" : "#1a2a6c";
        c.fillText("M", fx - 10, 400);
        c.fillStyle = "#1a2a6c"; c.font = "20px 'Comic Sans MS', cursive";
        c.fillText(labels[i], fx - 26, 440); c.font = "24px 'Comic Sans MS', cursive";
      });
      // PM schedule table in red/green
      c.fillStyle = "#b3261e"; c.font = "bold 32px 'Comic Sans MS', cursive";
      c.fillText("PM SCHEDULE", 600, 60);
      hand(600, 70, 820, 72, "#b3261e", 3);
      c.font = "24px 'Comic Sans MS', cursive"; c.fillStyle = "#222";
      const rows = [
        ["IR scan PDU-A/B", "OCT 06", true],
        ["VFD filters", "OCT 13", false],
        ["UPS batt test", "OCT 20", false],
        ["Torque check T1", "NOV 03", false],
        ["Clean HVAC coil", "SEP 22", true],
      ];
      rows.forEach(([a, d, done], i) => {
        const y = 115 + i * 44;
        c.fillStyle = "#222"; c.fillText(a, 610, y); c.fillText(d, 880, y);
        if (done) { hand(590, y - 10, 598, y - 2, "#2e7d32", 4); hand(598, y - 2, 612, y - 22, "#2e7d32", 4); }
      });
      c.fillStyle = "#2e7d32"; c.font = "22px 'Comic Sans MS', cursive";
      c.fillText("LOTO before opening!", 610, 360);
    });
    B(M.alu, wx, wy, BACK_Z + 0.015, ww + 0.05, wh + 0.05, 0.03, 26);
    planeZ(labelMat(t.tex), wx, wy, BACK_Z + 0.032, ww, wh, 26);
    B(M.alu, wx, wy - wh / 2 - 0.03, BACK_Z + 0.05, ww * 0.6, 0.02, 0.07, 26);
    add(G.cylLo, M.blue, wx - 0.2, wy - wh / 2 - 0.01, BACK_Z + 0.05, 0.015, 0.13, 0.015, 26, { rz: HALF_PI });
    add(G.cylLo, M.red, wx - 0.05, wy - wh / 2 - 0.01, BACK_Z + 0.06, 0.015, 0.13, 0.015, 26, { rz: HALF_PI });
    B(M.black, wx + 0.2, wy - wh / 2 - 0.005, BACK_Z + 0.055, 0.12, 0.035, 0.05, 26); // eraser
  }

  // ---- wall clock with ticking second hand ----
  const clock = {};
  {
    const cx = 1.8, cy = 2.58, r = 0.16, cz = BACK_Z + 0.03;
    const face = canvasTex(256, 256, (c, w) => {
      c.fillStyle = "#fbfbf8"; c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#111";
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2, big = i % 5 === 0;
        c.save(); c.translate(w / 2, w / 2); c.rotate(a);
        c.fillRect(-(big ? 3 : 1), -w / 2 + 12, big ? 6 : 2, big ? 20 : 8); c.restore();
      }
    });
    add(G.cyl, M.black, cx, cy, cz - 0.01, r * 2 + 0.03, 0.04, r * 2 + 0.03, 26, { rx: HALF_PI });
    add(G.disc, labelMat(face.tex), cx, cy, cz + 0.012, r * 2, r * 2, 1, 26);
    const mk = (len, wid, mat, zoff) => {
      const g = new THREE.Group(); g.position.set(cx, cy, cz + 0.015 + zoff); root.add(g);
      B(mat, 0, len / 2 - 0.015, 0, wid, len, 0.003, 26, { parent: g });
      return g;
    };
    clock.h = mk(r * 0.55, 0.012, M.black, 0.0);
    clock.m = mk(r * 0.8, 0.008, M.black, 0.003);
    clock.s = mk(r * 0.9, 0.003, M.red, 0.006);
  }

  // ---- tool cart parked against back wall ----
  {
    const g = new THREE.Group(); g.position.set(3.55, 0, BACK_Z + 0.35); g.rotation.y = -0.06; root.add(g);
    const w = 0.9, d = 0.48, h = 0.82;
    add(rbox(w, h - 0.14, d, 0.02), M.red, 0, 0.14 + (h - 0.14) / 2, 0, 1, 1, 1, 26, { cast: true, parent: g });
    B(M.black, 0, h + 0.012, 0, w + 0.02, 0.025, d + 0.02, 26, { parent: g }); // rubber mat top
    for (let i = 0; i < 4; i++) B(M.redDeep, 0, 0.26 + i * 0.14, d / 2 + 0.002, w - 0.06, 0.004, 0.004, 26, { parent: g });
    for (let i = 0; i < 4; i++) B(M.alu, 0, 0.3 + i * 0.14, d / 2 + 0.012, 0.5, 0.012, 0.012, 26, { parent: g });
    B(M.alu, w / 2 + 0.05, 0.95, 0, 0.02, 0.02, d - 0.05, 26, { parent: g }); // push handle
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      add(G.cylLo, M.rubber, sx * (w / 2 - 0.07), 0.06, sz * (d / 2 - 0.07), 0.1, 0.035, 0.1, 26, { rx: HALF_PI, parent: g });
    // stuff on top: meter + tape roll
    B(M.yellow, -0.2, h + 0.06, 0.02, 0.1, 0.05, 0.18, 26, { parent: g });
    add(G.cylLo, M.black, 0.15, h + 0.045, -0.05, 0.1, 0.035, 0.1, 26, { parent: g });
  }

  // ---- LOTO station board ----
  {
    const lx = 7.2, ly = 1.5, lz = BACK_Z;
    const t = canvasTex(256, 192, (c, w, h) => {
      c.fillStyle = "#b3261e"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#fff"; c.fillRect(8, 8, w - 16, h - 16);
      c.fillStyle = "#b3261e"; c.fillRect(8, 8, w - 16, 40);
      c.fillStyle = "#fff"; c.font = "bold 24px Arial"; c.textAlign = "center";
      c.fillText("LOCKOUT STATION", w / 2, 37);
      c.fillStyle = "#222"; c.font = "12px Arial";
      c.fillText("AUTHORIZED PERSONNEL ONLY", w / 2, h - 18);
    });
    B(M.red, lx, ly, lz + 0.012, 0.82, 0.62, 0.024, 26);
    planeZ(labelMat(t.tex), lx, ly, lz + 0.025, 0.8, 0.6, 26);
    const cols = [M.red, M.red, M.yellow, M.yellow, M.blue, M.green, M.red, M.blue];
    cols.forEach((mat, i) => {
      const px = lx - 0.28 + (i % 4) * 0.185, py = ly + 0.06 - Math.floor(i / 4) * 0.2;
      if (i === 5) return; // one lock is out on a job
      add(G.shackle, M.alu, px, py + 0.035, lz + 0.05, 0.035, 0.04, 0.035, 26);
      B(mat, px, py, lz + 0.05, 0.04, 0.05, 0.022, 26);
      B(M.white, px + 0.004, py - 0.055, lz + 0.043, 0.035, 0.05, 0.002, 26, { rz: 0.1 }); // tag
    });
    B(M.galvDark, lx, ly - 0.36, lz + 0.05, 0.6, 0.04, 0.08, 26); // hasp tray
  }

  // ---- arc flash PPE cabinet ----
  {
    const px = 8.55, w = 0.9, h = 1.9, d = 0.5;
    const pf = BACK_Z + d;
    add(rbox(w, h, d, 0.02), M.yellow, px, h / 2, BACK_Z + d / 2, 1, 1, 1, 26, { cast: true });
    B(M.black, px, h / 2 + 0.1, pf + 0.002, 0.004, h - 0.3, 0.004, 26);
    B(M.alu, px - 0.05, 1.05, pf + 0.02, 0.02, 0.18, 0.02, 26);
    B(M.alu, px + 0.05, 1.05, pf + 0.02, 0.02, 0.18, 0.02, 26);
    const t = canvasTex(256, 128, (c, w2, h2) => {
      c.fillStyle = "#111"; c.fillRect(0, 0, w2, h2);
      c.fillStyle = "#f7c90e"; c.font = "bold 30px Arial"; c.textAlign = "center";
      c.fillText("ARC FLASH", w2 / 2, 48); c.fillText("PPE", w2 / 2, 86);
      c.font = "15px Arial"; c.fillText("CAT 2 / CAT 4 SUITS - GLOVES", w2 / 2, 114);
    });
    planeZ(labelMat(t.tex), px, 1.55, pf + 0.004, 0.6, 0.3, 26);
  }

  // ---- eyewash station ----
  {
    const ex = 10.2, ez = BACK_Z + 0.25;
    add(G.cylLo, M.green, ex, 0.55, ez, 0.045, 1.1, 0.045, 24);
    add(G.cylLo, M.galvDark, ex, 0.02, ez, 0.2, 0.04, 0.2, 24);
    add(G.cyl, M.yellow, ex, 1.08, ez + 0.08, 0.34, 0.08, 0.3, 24);
    add(G.cylLo, M.green, ex, 1.08, BACK_Z + 0.12, 0.035, 0.25, 0.035, 24, { rx: HALF_PI });
    B(M.green, ex + 0.22, 1.1, ez + 0.02, 0.2, 0.025, 0.025, 24); // push flag
    const t = canvasTex(128, 128, (c, w, h) => {
      c.fillStyle = "#1c7a3a"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#fff"; c.font = "bold 18px Arial"; c.textAlign = "center";
      c.fillText("EMERGENCY", w / 2, 40); c.fillText("EYE WASH", w / 2, 64);
      c.beginPath(); c.arc(w / 2, 96, 16, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#1c7a3a"; c.beginPath(); c.arc(w / 2, 96, 7, 0, Math.PI * 2); c.fill();
    });
    planeZ(labelMat(t.tex), ex, 1.85, BACK_Z + 0.006, 0.3, 0.3, 26);
  }

  // ---- exhaust fan (spinning) on back wall ----
  const fan = {};
  {
    const fx = 7.2, fy = 2.95, fz = BACK_Z;
    B(M.galvDark, fx, fy, fz + 0.1, 0.72, 0.72, 0.2, 30, { cast: true });
    add(G.cyl, M.vent, fx, fy, fz + 0.2, 0.62, 0.02, 0.62, 30, { rx: HALF_PI });
    const g = new THREE.Group(); g.position.set(fx, fy, fz + 0.23); root.add(g);
    add(G.cylLo, M.galv, 0, 0, 0, 0.1, 0.05, 0.1, 34, { rx: HALF_PI, parent: g });
    for (let i = 0; i < 5; i++) {
      const b = B(M.galv, 0, 0, 0, 0.08, 0.26, 0.01, 30, { parent: g });
      const a = (i / 5) * Math.PI * 2;
      b.position.set(Math.sin(a) * 0.15, Math.cos(a) * 0.15, 0); b.rotation.set(0.35, 0, -a);
    }
    fan.blades = g;
    // guard rings
    add(G.torus, M.galv, fx, fy, fz + 0.27, 0.6, 0.6, 0.3, 30);
    add(G.torus, M.galv, fx, fy, fz + 0.27, 0.35, 0.35, 0.3, 30);
    B(M.galv, fx, fy, fz + 0.27, 0.6, 0.01, 0.01, 30);
    B(M.galv, fx, fy, fz + 0.27, 0.01, 0.6, 0.01, 30);
    runY(fx + 0.3, fz + 0.08, fy + 0.36, 3.5);
  }

  // ---- overhead EMT runs on back wall ----
  runX(3.55, BACK_Z + 0.03, LEFT_X + 0.05, 10.9);
  runX(3.7, BACK_Z + 0.03, LEFT_X + 0.05, 10.9);
  runY(5.4, BACK_Z + 0.03, 2.15, 3.55); // feeders into panelboard
  runY(5.6, BACK_Z + 0.03, 2.15, 3.7);
  jboxBack(5.4, 3.55);
  jboxBack(9.2, 3.62);
  jboxBack(-9.0, 3.62);
  jboxBack(2.2, 3.62);

  // =====================================================================
  // LEFT WALL
  // =====================================================================
  runZ(3.55, LEFT_X + 0.03, BACK_Z + 0.03, 1.7);
  runZ(3.7, LEFT_X + 0.03, BACK_Z + 0.03, 1.7);
  jboxLeft(-2.0, 3.62);
  jboxLeft(1.6, 3.62);

  // ---- EXIT sign over door ----
  {
    const t = canvasTex(256, 96, (c, w, h) => {
      c.fillStyle = "#0e1a10"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#39ff6a"; c.font = "bold 64px Arial"; c.textAlign = "center";
      c.fillText("EXIT", w / 2, 70);
      c.beginPath(); c.moveTo(18, 48); c.lineTo(38, 30); c.lineTo(38, 66); c.fill();
    });
    B(M.white, LEFT_X + 0.05, 2.5, 2.5, 0.1, 0.22, 0.4, 30);
    const s = planeX(labelMat(t.tex, true), LEFT_X + 0.102, 2.5, 2.5, 0.36, 0.14, 30);
    s.receiveShadow = false;
  }

  // ---- fire alarm pull station ----
  {
    const t = canvasTex(64, 80, (c, w, h) => {
      c.fillStyle = "#c62a20"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#fff"; c.font = "bold 13px Arial"; c.textAlign = "center";
      c.fillText("FIRE", w / 2, 18); c.fillText("ALARM", w / 2, 32);
      c.fillRect(18, 44, 28, 10); c.font = "bold 10px Arial"; c.fillText("PULL DOWN", w / 2, 72);
    });
    B(M.red, LEFT_X + 0.03, 1.22, 1.55, 0.06, 0.16, 0.13, 26);
    planeX(labelMat(t.tex), LEFT_X + 0.062, 1.22, 1.55, 0.12, 0.15, 26);
    runY(LEFT_X + 0.03, 1.55, 1.3, 3.55);
  }

  // ---- horn/strobe ----
  const strobe = {};
  {
    const sz = 0.7, sy = 2.45;
    B(M.red, LEFT_X + 0.04, sy, sz, 0.08, 0.14, 0.12, 26);
    strobe.lens = B(M.lens, LEFT_X + 0.095, sy + 0.035, sz, 0.03, 0.045, 0.06, 26);
    strobe.light = new THREE.PointLight(0xf4f6ff, 0, 6, 2);
    strobe.light.position.set(LEFT_X + 0.3, sy, sz);
    root.add(strobe.light);
    runY(LEFT_X + 0.03, sz, sy + 0.07, 3.55);
  }

  // ---- thermostat ----
  {
    B(M.beige, LEFT_X + 0.015, 1.5, -0.4, 0.03, 0.12, 0.09, 26);
    const t = canvasTex(64, 32, (c, w, h) => {
      c.fillStyle = "#22313a"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#9fe3ff"; c.font = "bold 18px monospace"; c.fillText("78F", 12, 23);
    });
    const s = planeX(labelMat(t.tex, true), LEFT_X + 0.031, 1.52, -0.4, 0.05, 0.03, 26);
    s.receiveShadow = false;
  }

  // ---- mini-split HVAC head (louver flutters) ----
  const hvac = {};
  {
    const hz = -7.2, hy = 3.1;
    add(rbox(0.26, 0.3, 1.0, 0.04), M.white, LEFT_X + 0.13, hy, hz, 1, 1, 1, 22, { cast: true });
    B(M.vent, LEFT_X + 0.2, hy - 0.13, hz, 0.1, 0.03, 0.9, 16); // supply slot (cold)
    const g = new THREE.Group(); g.position.set(LEFT_X + 0.26, hy - 0.14, hz); root.add(g);
    B(M.white, 0.03, 0, 0, 0.07, 0.008, 0.88, 17, { parent: g });
    hvac.louver = g;
    led(LEFT_X + 0.261, hy + 0.08, hz + 0.4, 0x3aa0ff, "steady", 1, 0.01);
    runY(LEFT_X + 0.03, hz + 0.45, hy + 0.1, 3.55); // line set
    add(G.cylLo, M.white, LEFT_X + 0.04, (hy + 3.9) / 2, hz + 0.55, 0.05, 3.9 - hy, 0.05, 20); // line-set cover
  }

  // ---- unit heater (hot) ----
  {
    const uz = -4.1, uy = 2.95;
    B(M.galvDark, LEFT_X + 0.2, uy + 0.36, uz, 0.4, 0.03, 0.05, 30); // bracket
    B(M.galvDark, LEFT_X + 0.38, uy + 0.3, uz, 0.02, 0.12, 0.02, 40);
    B(std(0x6e6a62, 0.6, 0.3), LEFT_X + 0.42, uy, uz, 0.42, 0.5, 0.6, 55, { cast: true });
    for (let i = 0; i < 5; i++) B(M.vent, LEFT_X + 0.635, uy - 0.18 + i * 0.09, uz, 0.02, 0.018, 0.54, 58, { rz: -0.4 });
    runY(LEFT_X + 0.03, uz, uy + 0.2, 3.55);
  }

  // ---- wall-hung vertical cable ladder with cables ----
  {
    const cz = -5.3, y0 = 0.4, y1 = 3.95, lxv = LEFT_X + 0.08;
    B(M.galv, lxv, (y0 + y1) / 2, cz - 0.2, 0.08, y1 - y0, 0.02, 26);
    B(M.galv, lxv, (y0 + y1) / 2, cz + 0.2, 0.08, y1 - y0, 0.02, 26);
    const n = Math.floor((y1 - y0) / 0.23);
    const rungs = new THREE.InstancedMesh(G.box, M.galv, n);
    const d = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      d.position.set(lxv - 0.02, y0 + 0.12 + i * 0.23, cz); d.scale.set(0.025, 0.02, 0.38); d.updateMatrix();
      rungs.setMatrixAt(i, d.matrix);
    }
    rungs.userData.temp = 26; rungs.receiveShadow = true; root.add(rungs); meshCount++;
    [[-0.12, 0.03], [-0.04, 0.025], [0.05, 0.03], [0.13, 0.022]].forEach(([oz, r], i) =>
      add(G.cylLo, M.cable, lxv + 0.03, (y0 + y1) / 2 + 0.1, cz + oz, r * 2, y1 - y0 + 0.2, r * 2, 28 + i));
  }

  // ---- spare parts shelving ----
  {
    const sz = -7.4 + 0.0, len = 1.6, dep = 0.55, h = 2.0;
    const sx = LEFT_X + dep / 2 + 0.03;
    // avoid mini-split (y>2.9) - top of shelf at 2.0 is fine
    for (const a of [-1, 1]) for (const b of [-1, 1])
      B(M.galvDark, sx + a * (dep / 2 - 0.02), h / 2, sz + b * (len / 2 - 0.02), 0.035, h, 0.035, 26, { cast: true });
    const shelves = [0.12, 0.62, 1.12, 1.62, 1.98];
    for (const y of shelves) B(M.galv, sx, y, sz, dep, 0.025, len, 26);
    const boxMats = [M.cardboard, M.cardboard2, M.cardboard, M.galvDark, M.blue];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    shelves.slice(0, 4).forEach((y, si) => {
      let z = sz - len / 2 + 0.06;
      while (z < sz + len / 2 - 0.25) {
        const bw = 0.2 + rnd() * 0.25, bh = 0.14 + rnd() * 0.24, bd = 0.3 + rnd() * 0.18;
        if (rnd() > 0.2) B(boxMats[(si + Math.floor(rnd() * 5)) % 5], sx + (dep - bd) / 2 - 0.02, y + 0.0125 + bh / 2, z + bw / 2, bd, bh, bw, 26);
        z += bw + 0.04;
      }
    });
    // spare contactor + breaker boxes labeled
    const t = canvasTex(128, 32, (c, w, h) => {
      c.fillStyle = "#fff"; c.fillRect(0, 0, w, h); c.fillStyle = "#111"; c.font = "bold 14px Arial";
      c.fillText("SPARE PARTS - HALL A", 6, 21);
    });
    planeX(labelMat(t.tex), sx + dep / 2 + 0.002, 1.98, sz, 0.36, 0.09, 26);
  }

  // =====================================================================
  // FLOOR
  // =====================================================================

  // ---- trench cover strip with one plate lifted (work in progress) ----
  {
    const tz = -8.3, x0 = -6.2, x1 = 4.0, tw = 0.6;
    const tt = canvasTex(1024, 64, (c, w, h) => {
      c.fillStyle = "#8b8f92"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#a3a7aa";
      for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 16) {
        c.save(); c.translate(x + ((y / 16) % 2) * 8, y + 4); c.rotate(((x + y) / 16) % 2 ? 0.7 : -0.7);
        c.fillRect(-5, -1.5, 10, 3); c.restore();
      }
      c.fillStyle = "#555a5e";
      for (let x = 0; x < w; x += w / 8.5) c.fillRect(x, 0, 3, h);
    });
    M.checker = std(0xffffff, 0.55, 0.6, { map: tt.tex });
    B(M.checker, (x0 + x1) / 2, 0.006, tz, x1 - x0, 0.012, tw, 26);
    B(M.galvDark, (x0 + 5.2) / 2, 0.008, tz - tw / 2 - 0.02, 5.2 - x0, 0.016, 0.04, 26);
    B(M.galvDark, (x0 + 5.2) / 2, 0.008, tz + tw / 2 + 0.02, 5.2 - x0, 0.016, 0.04, 26);
    // open section (plate removed) + visible cables in the trench
    B(M.trenchVoid, 4.6, 0.003, tz, 1.2, 0.006, tw, 24);
    add(G.cylLo, M.cable, 4.6, 0.012, tz - 0.1, 0.05, 1.2, 0.05, 29, { rz: HALF_PI });
    add(G.cylLo, M.cable, 4.6, 0.012, tz + 0.05, 0.05, 1.2, 0.05, 30, { rz: HALF_PI });
    // lifted plate leaning on a block beside it
    B(M.checker, 4.55, 0.12, tz - 0.75, 1.2, 0.012, 0.6, 26, { rx: 0.35, cast: true });
    B(M.cardboard2, 4.55, 0.1, tz - 0.98, 1.0, 0.2, 0.12, 26);
  }

  // ---- stanchions + yellow/black chain barrier around the open trench ----
  const chainLinks = [];
  {
    const posts = [[3.6, -7.55], [5.7, -7.55], [5.7, -9.2], [3.6, -9.2]];
    const ph = 0.9;
    for (const [px, pz] of posts) {
      add(G.cylLo, M.black, px, 0.025, pz, 0.3, 0.05, 0.3, 26, { cast: true });
      add(G.cylLo, M.yellow, px, ph / 2, pz, 0.05, ph, 0.05, 26, { cast: true });
      add(G.cylLo, M.black, px, ph + 0.02, pz, 0.065, 0.04, 0.065, 26);
    }
    const yc = new THREE.Color(0xe8b90e), kc = new THREE.Color(0x151515);
    for (let i = 0; i < posts.length; i++) {
      const [ax, az] = posts[i], [bx, bz] = posts[(i + 1) % posts.length];
      const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / 0.055);
      for (let j = 0; j <= n; j++) {
        const f = j / n;
        chainLinks.push({
          x: ax + (bx - ax) * f, z: az + (bz - az) * f,
          y: ph - 0.05 - Math.sin(Math.PI * f) * 0.12,
          ry: -Math.atan2(bz - az, bx - ax), rz: Math.cos(Math.PI * f) * 0.35 * (j % 2 ? 1 : 1),
          c: Math.floor(j / 3) % 2 ? kc : yc,
        });
      }
    }
    const im = new THREE.InstancedMesh(G.box, std(0xffffff, 0.5, 0.2), chainLinks.length);
    const d = new THREE.Object3D();
    chainLinks.forEach((l, i) => {
      d.position.set(l.x, l.y, l.z); d.rotation.set(0, l.ry, l.rz); d.scale.set(0.05, 0.016, 0.02); d.updateMatrix();
      im.setMatrixAt(i, d.matrix); im.setColorAt(i, l.c);
    });
    im.userData.temp = 26; root.add(im); meshCount++;
    // hanging DANGER sign on the chain
    const t = canvasTex(128, 64, (c, w, h) => {
      c.fillStyle = "#fff"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#c62a20"; c.fillRect(0, 0, w, 26);
      c.fillStyle = "#fff"; c.font = "bold 20px Arial"; c.textAlign = "center"; c.fillText("DANGER", w / 2, 20);
      c.fillStyle = "#111"; c.font = "bold 13px Arial"; c.fillText("OPEN TRENCH", w / 2, 44); c.fillText("KEEP OUT", w / 2, 59);
    });
    const sm = labelMat(t.tex); sm.side = THREE.DoubleSide;
    planeZ(sm, 4.65, 0.63, -7.55 + 0.012, 0.36, 0.18, 26);
  }

  // ---- traffic cones ----
  function cone(x, z, ry = 0) {
    B(M.black, x, 0.015, z, 0.36, 0.03, 0.36, 26, { ry, cast: true });
    add(G.cone, M.orange, x, 0.37, z, 0.28, 0.68, 0.28, 26, { cast: true });
    add(G.cylLo, M.white, x, 0.46, z, 0.14, 0.09, 0.14, 26);
  }
  cone(3.2, -7.2, 0.3);
  cone(6.15, -7.3, -0.4);

  // ---- cable reel ----
  {
    const cx = 7.4, cz = -8.6;
    for (const o of [-0.22, 0.22]) add(G.cyl, std(0x9a7043, 0.9, 0), cx, 0.45, cz + o, 0.9, 0.05, 0.9, 26, { rx: HALF_PI, cast: true });
    add(G.cyl, M.cable, cx, 0.45, cz, 0.62, 0.4, 0.62, 27, { rx: HALF_PI, cast: true });
    add(G.cylLo, M.galvDark, cx, 0.45, cz, 0.06, 0.6, 0.06, 26, { rx: HALF_PI });
    // tail of cable running toward trench
    add(G.cylLo, M.cable, cx - 0.9, 0.02, cz + 0.1, 0.035, 1.5, 0.035, 27, { rz: HALF_PI, ry: 0.15 });
  }

  // ---- fiberglass step ladder (A-frame) near left wall ----
  {
    const g = new THREE.Group(); g.position.set(-9.7, 0, -1.2); g.rotation.y = 0.5; root.add(g);
    const h = 1.8, spread = 0.32, w = 0.48;
    for (const side of [-1, 1]) for (const face of [-1, 1]) {
      const r = B(M.fiberglass, side * w / 2, h / 2, face * spread / 2, 0.035, h, 0.07, 26, { parent: g, cast: true });
      r.rotation.x = face * 0.17;
    }
    for (let i = 0; i < 4; i++) {
      const y = 0.35 + i * 0.36, zf = spread / 2 - (y / h) * spread / 2 + 0.02;
      B(M.alu, 0, y, zf, w, 0.025, 0.09, 26, { parent: g });
    }
    B(M.black, 0, h + 0.02, 0, w + 0.06, 0.05, 0.22, 26, { parent: g, cast: true });
    const lab = B(M.orange, w / 2 + 0.02, 1.2, spread / 2 - 0.12, 0.003, 0.2, 0.06, 26, { parent: g });
    lab.rotation.x = 0.17;
  }

  // ---- floor drains ----
  {
    const t = canvasTex(64, 64, (c, w, h) => {
      c.fillStyle = "#5d6064"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#15171a";
      for (let i = 0; i < 6; i++) c.fillRect(8 + i * 9, 8, 5, h - 16);
    });
    const dm = std(0xffffff, 0.6, 0.6, { map: t.tex });
    B(dm, 10.2, 0.003, BACK_Z + 0.75, 0.25, 0.006, 0.25, 25);
    B(dm, -1.6, 0.003, -9.4, 0.25, 0.006, 0.25, 25);
  }

  // =====================================================================
  // INSTANCED: couplers + LEDs
  // =====================================================================
  {
    const im = new THREE.InstancedMesh(G.cylLo, M.galv, couplers.length);
    const d = new THREE.Object3D();
    couplers.forEach((c, i) => {
      d.position.set(c.x, c.y, c.z);
      d.rotation.set(c.axis === "z" ? HALF_PI : 0, 0, c.axis === "x" ? HALF_PI : 0);
      d.scale.set(0.034, 0.05, 0.034); d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    });
    im.userData.temp = 26; root.add(im); meshCount++;
  }
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const ledMesh = new THREE.InstancedMesh(G.box, ledMat, leds.length);
  {
    const d = new THREE.Object3D();
    leds.forEach((l, i) => {
      d.position.set(l.x, l.y, l.z);
      // left-wall LEDs are oriented flat anyway (cube), scale uniform-ish
      d.scale.set(l.size, l.size * 0.7, 0.004); d.updateMatrix();
      ledMesh.setMatrixAt(i, d.matrix);
      ledMesh.setColorAt(i, l.color);
    });
    ledMesh.userData.temp = 30;
    ledMesh.receiveShadow = false;
    root.add(ledMesh); meshCount++;
  }
  const dimColor = new THREE.Color(0x0c0c0c);
  const tmpColor = new THREE.Color();

  // =====================================================================
  // DUST MOTES
  // =====================================================================
  const DUST = 120;
  const dustPos = new Float32Array(DUST * 3);
  const dustVel = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = -10.5 + Math.random() * 21;
    dustPos[i * 3 + 1] = 0.3 + Math.random() * 3.5;
    dustPos[i * 3 + 2] = -11.5 + Math.random() * 15.5;
    dustVel[i * 3] = (Math.random() - 0.5) * 0.04;
    dustVel[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
    dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ color: 0xfff1d8, size: 0.022, sizeAttenuation: true, transparent: true, opacity: 0.32, depthWrite: false })
  );
  dust.frustumCulled = false;
  root.add(dust);

  // =====================================================================
  // UPDATE
  // =====================================================================
  function drawKeypad(k) {
    const c = k.kp.ctx, w = 160, h = 80;
    c.fillStyle = "#0a1a0e"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#7dff9a";
    c.font = "bold 30px monospace";
    c.fillText(k.run ? `${k.hz.toFixed(1)} Hz` : "READY", 8, 34);
    c.font = "bold 22px monospace";
    c.fillText(k.run ? `${k.a.toFixed(1)} A` : "0.0 Hz STOP", 8, 66);
    k.kp.tex.needsUpdate = true;
  }
  keypads.forEach(drawKeypad);

  let kpTimer = 0;
  let lastSec = -1;
  root.userData.meshCount = meshCount;

  return {
    group: root,
    meshCount,
    update(dt, t) {
      dt = Math.min(dt || 0, 0.1);

      // keypads ~1 Hz
      kpTimer += dt;
      if (kpTimer > 1.0) {
        kpTimer = 0;
        for (const k of keypads) {
          if (!k.run) continue;
          k.hz = Math.min(60, Math.max(0, k.base.hz + (Math.random() - 0.5) * 0.4));
          k.a = Math.max(0, k.base.a + (Math.random() - 0.5) * 1.2);
          drawKeypad(k);
        }
      }

      // LEDs
      for (let i = 0; i < leds.length; i++) {
        const l = leds[i];
        let on = true;
        if (l.mode === "off") on = false;
        else if (l.mode === "blink") on = ((t * l.rate + l.phase) % 1) < 0.5;
        else if (l.mode === "rand") {
          if (t > l.next) { l.on = Math.random() > 0.35; l.next = t + (0.03 + Math.random() * 0.25) * (6 / l.rate); }
          on = l.on;
        }
        ledMesh.setColorAt(i, on ? l.color : tmpColor.copy(l.color).multiplyScalar(0.06).add(dimColor));
      }
      if (ledMesh.instanceColor) ledMesh.instanceColor.needsUpdate = true;

      // exhaust fan + HVAC louver flutter
      fan.blades.rotation.z -= dt * 14;
      hvac.louver.rotation.z = -0.45 + Math.sin(t * 7.3) * 0.04 + Math.sin(t * 13.1) * 0.02;

      // horn/strobe: short white flash every 4 s
      const ph = t % 4;
      const flash = ph < 0.07 ? 1 : 0;
      M.lens.emissiveIntensity = flash * 6;
      strobe.light.intensity = flash * 25;

      // clock (real time, second hand ticks)
      const now = new Date();
      const s = now.getSeconds();
      if (s !== lastSec) {
        lastSec = s;
        const m = now.getMinutes() + s / 60, hr = (now.getHours() % 12) + m / 60;
        clock.s.rotation.z = -(s / 60) * Math.PI * 2;
        clock.m.rotation.z = -(m / 60) * Math.PI * 2;
        clock.h.rotation.z = -(hr / 12) * Math.PI * 2;
      }

      // dust drift
      for (let i = 0; i < DUST; i++) {
        const j = i * 3;
        dustPos[j] += (dustVel[j] + Math.sin(t * 0.3 + i) * 0.01) * dt;
        dustPos[j + 1] += (dustVel[j + 1] + Math.sin(t * 0.21 + i * 1.7) * 0.006) * dt;
        dustPos[j + 2] += (dustVel[j + 2] + Math.cos(t * 0.27 + i) * 0.01) * dt;
        if (dustPos[j] < -10.6) dustPos[j] = 10.4; else if (dustPos[j] > 10.6) dustPos[j] = -10.4;
        if (dustPos[j + 1] < 0.2) dustPos[j + 1] = 3.8; else if (dustPos[j + 1] > 3.9) dustPos[j + 1] = 0.3;
        if (dustPos[j + 2] < -11.6) dustPos[j + 2] = 3.9; else if (dustPos[j + 2] > 4.0) dustPos[j + 2] = -11.5;
      }
      dustGeo.attributes.position.needsUpdate = true;
    },
  };
}

// ===================== 3D site: campus, data hall, electrical gallery =====================
// Every rack in every row is real: instanced frames, server trays and LEDs for the whole hall,
// plus a pool of detailed racks that follows the camera so any rack can be opened. Cooling and
// power gear arrive with the mechanical fit-out. After go-live, technicians and robots walk the aisles.
const $id = (id) => document.getElementById(id);
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, k) => a + (b - a) * k;
const stdM = (c, r = .5, m = .1, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra });
function ctex(w, h, draw, rep) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (rep) t.repeat.set(rep, rep); return t;
}
const rowName = (r) => { let s = ""; r++; while (r > 0) { const m = (r - 1) % 26; s = String.fromCharCode(65 + m) + s; r = Math.floor((r - 1) / 26); } return s; };
const ease = (u) => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
const GPU_COL = { h100: 0x3aa0ff, h200: 0x8ad0ff, b200: 0x3fd8c6, gb200: 0x76b900, gb300: 0xf0b443, next: 0xb48cff };
const GPU_NAME = { h100: "H100", h200: "H200", b200: "B200", gb200: "GB200 NVL72", gb300: "GB300 NVL72", next: "Rubin NVL144" };

const concrete = ctex(1024, 1024, (g, w, h) => {
  g.fillStyle = "#b9bcbd"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26000; i++) { const v = 150 + Math.random() * 70 | 0; g.fillStyle = `rgba(${v},${v},${v - 4},${Math.random() * .18})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); }
  g.strokeStyle = "rgba(60,64,68,.35)"; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
}, 8);
const GLOW = ctex(128, 128, (g) => {
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,230,1)"); r.addColorStop(.25, "rgba(255,200,60,.8)"); r.addColorStop(.6, "rgba(255,80,20,.25)"); r.addColorStop(1, "rgba(255,40,0,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});
const plateCache = new Map();
function plateTex(a, b) {
  const k = a + "|" + b; if (plateCache.has(k)) return plateCache.get(k);
  const t = ctex(256, 64, (g, w, h) => { g.fillStyle = "#e9ebe6"; g.fillRect(0, 0, w, h); g.strokeStyle = "#222"; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4); g.fillStyle = "#111"; g.textAlign = "center"; g.font = "bold 26px Arial"; g.fillText(a, w / 2, 28); g.font = "16px Arial"; g.fillText(b, w / 2, 52); });
  plateCache.set(k, t); return t;
}

// ---------------------------------------------------------------- detailed rack (camera-following pool)
// Two interiors are built once per pooled rack and toggled by GPU form:
//   hgx: up to seven 8-GPU HGX nodes (H100 / H200 / B200), fan-wall front bezels, SXM heatsink banks on top of each chassis
//   nvl: a GB200 / GB300 NVL72 rack-scale system: two blocks of nine 1U compute trays around nine NVLink switch trays,
//        power shelves top and bottom, coolant supply / return manifolds, a copper busbar and the NVLink spine at the back
const RK = { W: 1.05, H: 2.3, D: .78 };
const RM = {
  frame: stdM(0x1b1e22, .6, .25), glass: stdM(0x9fc4e0, .15, .1, { transparent: true, opacity: .14 }), handle: stdM(0xc9ced3, .35, .6), chrome: stdM(0xd8dde2, .2, .9),
  tealOn: stdM(0x3fd8c6, .3, 0, { emissive: 0x3fd8c6, emissiveIntensity: 2.5 }), tealOff: stdM(0x163a37, .3, 0),
  ambOn: stdM(0xffb020, .3, 0, { emissive: 0xffb020, emissiveIntensity: 2.5 }), ambOff: stdM(0x4a3410, .3, 0),
  redOn: stdM(0xff3b3b, .3, 0, { emissive: 0xff3b3b, emissiveIntensity: 3 }),
  server: stdM(0x3a4047, .45, .4), face: stdM(0x14171b, .5, .2), pdu: stdM(0xb3261e, .5, .1), cable: stdM(0x0e0e10, .6, 0), rail: stdM(0x9aa1a7, .3, .85), back: stdM(0x2a2e33, .6, .3),
  chassis: stdM(0x2b3036, .5, .45), fin: stdM(0xd3bd84, .32, .8), finH: stdM(0xb9c2c9, .3, .85), copper: stdM(0xb87333, .35, .8), gold: stdM(0xc9a24a, .4, .7),
  blue: stdM(0x2f7fd8, .4, .3), red: stdM(0xc0392b, .4, .3), black: stdM(0x111317, .6, .2), silver: stdM(0xaab2ba, .3, .7), violet: stdM(0x8c6bd8, .4, .6),
};
// fin stripes for the top of a GPU heatsink
const FIN_TEX = ctex(64, 64, (g, w, h) => { g.fillStyle = "#e8dcb8"; g.fillRect(0, 0, w, h); g.fillStyle = "#5a4a2a"; for (let x = 2; x < w; x += 6) g.fillRect(x, 0, 2, h); });
const RG = {
  door: new RoundedBoxGeometry(RK.W - .05, RK.H - .08, .025, 2, .006), body: new THREE.BoxGeometry(RK.W - .02, RK.H, RK.D - .05), lever: new RoundedBoxGeometry(.03, .14, .03, 2, .008),
  pilot: new THREE.CylinderGeometry(.012, .012, .012, 16), bezel: new THREE.CylinderGeometry(.017, .017, .006, 16), plate: new THREE.PlaneGeometry(.52, .13),
  led: new THREE.BoxGeometry(.022, .012, .004), ledS: new THREE.BoxGeometry(.016, .01, .004),
  backp: new THREE.BoxGeometry(RK.W - .1, RK.H - .1, .02), railv: new THREE.BoxGeometry(.03, RK.H - .2, .03), pduv: new THREE.BoxGeometry(.05, RK.H - .3, .05), cablev: new THREE.CylinderGeometry(.012, .012, RK.H - .3, 8),
  // hgx node
  nodeBox: new THREE.BoxGeometry(RK.W - .22, .2, RK.D - .22), nodeFace: new THREE.PlaneGeometry(RK.W - .24, .2), sink: new THREE.BoxGeometry(.16, .06, .2), sinkFin: new THREE.BoxGeometry(.16, .062, .012),
  // nvl rack
  nvlBody: new THREE.BoxGeometry(RK.W - .22, 1.9, RK.D - .26), nvlFace: new THREE.PlaneGeometry(RK.W - .2, .5), shelfFace: new THREE.PlaneGeometry(RK.W - .2, .2),
  sledFloor: new THREE.BoxGeometry(RK.W - .24, .015, RK.D - .2), sledRail: new THREE.BoxGeometry(.02, .09, RK.D - .2), bezelBox: new THREE.BoxGeometry(RK.W - .24, .2, .03),
  gpuMod: new THREE.BoxGeometry(.165, .13, .2), gpuBase: new THREE.BoxGeometry(.18, .012, .215), nvsw: new THREE.BoxGeometry(RK.W - .4, .05, .09), cpu: new THREE.BoxGeometry(.14, .09, .12),
  traySled: new THREE.BoxGeometry(RK.W - .24, .012, RK.D - .2), cpuPlate: new THREE.BoxGeometry(.13, .035, .13), gpuPlate: new THREE.BoxGeometry(.17, .04, .16), hose: new THREE.CylinderGeometry(.012, .012, RK.D - .24, 8), trayFace: new THREE.BoxGeometry(RK.W - .24, .045, .02),
  manifold: new THREE.CylinderGeometry(.028, .028, 1.95, 10), busbar: new THREE.BoxGeometry(.07, 1.95, .025), spine: new THREE.CylinderGeometry(.035, .035, 1.25, 8), qd: new THREE.CylinderGeometry(.014, .014, .05, 8),
};
const GPU_HEX = (k) => "#" + GPU_COL[k].toString(16).padStart(6, "0");
const texCache = new Map();
function cachedTex(key, w, h, draw) { if (texCache.has(key)) return texCache.get(key); const t = ctex(w, h, draw); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; texCache.set(key, t); return t; }
// HGX node front: brand bezel with status LEDs on the left, hex mesh and four fan modules across the rest
function hgxFaceTex(gpu, G) {
  return cachedTex("hgx:" + gpu, 512, 128, (g, w, h) => {
    g.fillStyle = "#1a1d21"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#0a0c0f"; for (let y = 9; y < h - 6; y += 7) for (let x = 132; x < w - 6; x += 8) { g.beginPath(); g.arc(x + ((y / 7 | 0) % 2) * 4, y, 2.3, 0, 6.283); g.fill(); }
    for (let i = 0; i < 4; i++) {
      const cx = 176 + i * 88, cy = h / 2; g.fillStyle = "#15181c"; g.beginPath(); g.arc(cx, cy, 44, 0, 6.283); g.fill();
      g.strokeStyle = "#5a6470"; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, 42, 0, 6.283); g.stroke();
      g.strokeStyle = "#3b434b"; g.lineWidth = 6; for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 36, cy + Math.sin(a) * 36); g.stroke(); }
      g.fillStyle = "#2e353c"; g.beginPath(); g.arc(cx, cy, 11, 0, 6.283); g.fill();
    }
    g.fillStyle = "#262b31"; g.fillRect(0, 0, 124, h); g.fillStyle = GPU_HEX(gpu); g.fillRect(8, 10, 4, h - 20);
    g.fillStyle = "#e8ecef"; g.font = "bold 18px Arial"; g.fillText("HGX", 22, 40); g.font = "bold 28px Arial"; g.fillText(G.name, 22, 72);
    g.fillStyle = "#8a949e"; g.font = "12px Arial"; g.fillText("8× SXM · " + G.hbm, 22, 94); g.fillText(G.u + "U · liquid-ready", 22, 110);
  });
}
// NVL compute block: nine 1U trays, each with blue / red coolant quick-disconnects, two superchip cold-plate covers and a status LED
function nvlComputeTex(gpu, G) {
  return cachedTex("nvlc:" + gpu, 256, 512, (g, w, h) => {
    const acc = GPU_HEX(gpu), n = 9, sh = h / n;
    for (let i = 0; i < n; i++) {
      const y = i * sh; g.fillStyle = i % 2 ? "#1c2024" : "#20252a"; g.fillRect(0, y, w, sh);
      g.fillStyle = "#6b737b"; g.fillRect(0, y, w, 2); g.fillStyle = "#44494f"; g.fillRect(0, y + sh - 3, w, 3);
      g.fillStyle = "#2f7fd8"; g.beginPath(); g.arc(16, y + sh / 2, 7, 0, 6.283); g.fill(); g.fillStyle = "#c0392b"; g.beginPath(); g.arc(36, y + sh / 2, 7, 0, 6.283); g.fill();
      for (const x of [56, 150]) { g.fillStyle = gpu === "gb200" ? "#8a5a2b" : gpu === "gb300" ? "#3a3f45" : "#4a3f6e"; g.fillRect(x, y + 8, 86, sh - 16); g.fillStyle = gpu === "gb200" ? "#b87333" : gpu === "gb300" ? "#c9a24a" : "#b48cff"; g.fillRect(x + 6, y + 13, 74, sh - 26); g.fillStyle = "#15181b"; for (let k = 0; k < 6; k++) g.fillRect(x + 10 + k * 12, y + 17, 6, sh - 34); }
      g.fillStyle = "#111"; g.fillRect(236, y + 10, 14, sh - 20); g.fillStyle = acc; g.fillRect(240, y + sh / 2 - 3, 6, 6);
      g.fillStyle = "#9aa3ad"; g.font = "bold 9px Arial"; g.fillText(G.node.split(" ")[0], 58, y + sh - 6);
    }
  });
}
// NVLink switch block: nine trays of gold port banks on a copper nameplate
function nvlSwitchTex(gpu) {
  return cachedTex("nvls:" + gpu, 256, 512, (g, w, h) => {
    const n = 9, sh = h / n;
    for (let i = 0; i < n; i++) {
      const y = i * sh; g.fillStyle = "#15181c"; g.fillRect(0, y, w, sh); g.fillStyle = "#555c64"; g.fillRect(0, y, w, 2);
      g.fillStyle = gpu === "gb300" ? "#8c6f2f" : "#8a5a2b"; g.fillRect(6, y + 6, 40, sh - 12); g.fillStyle = "#f3e2b2"; g.font = "bold 9px Arial"; g.fillText("NVLINK", 8, y + sh / 2 + 3);
      for (let k = 0; k < 18; k++) { g.fillStyle = "#c9a24a"; g.fillRect(54 + k * 11, y + 9, 8, (sh - 18) / 2 - 2); g.fillRect(54 + k * 11, y + sh / 2 + 1, 8, (sh - 18) / 2 - 2); }
      g.fillStyle = "#3fd8c6"; g.fillRect(w - 12, y + sh / 2 - 3, 6, 6);
    }
  });
}
// power shelf: six hot-swap PSUs with handles and a green status LED each
const SHELF_TEX = cachedTex("shelf", 256, 64, (g, w, h) => {
  g.fillStyle = "#1a1d21"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) { const x = i * (w / 6); g.fillStyle = "#2a2f35"; g.fillRect(x + 3, 4, w / 6 - 6, h - 8); g.fillStyle = "#0b0d10"; for (let yy = 10; yy < h - 10; yy += 6) g.fillRect(x + 8, yy, w / 6 - 24, 3); g.fillStyle = "#9aa3ad"; g.fillRect(x + w / 6 - 14, 10, 4, h - 20); g.fillStyle = "#5fd483"; g.fillRect(x + 8, h - 9, 5, 4); }
});
class Rack {
  constructor() {
    this.group = new THREE.Group(); this.parts = []; this.tmats = {}; this.thermal = false; this.index = -1; this.gpu = "b200"; this.form = "hgx"; this.fault = false;
    this.openT = 0; this.openTarget = 0; this.openV = 0; this.pop = 0; this.popT = 0; this.state = { live: false, load: 0 }; this.leds = []; this.tag = ""; this.sub = "";
    const body = this.mesh(RG.body, RM.frame, "body"); body.position.z = -.025; body.userData.pick = "door";
    this.hinge = new THREE.Group(); this.hinge.position.set(-RK.W / 2 + .02, 0, RK.D / 2 - .02); this.group.add(this.hinge);
    const door = this.mesh(RG.door, RM.glass, "door", this.hinge); door.position.x = RK.W / 2 - .025; door.userData.pick = "door"; this.doorMesh = door;
    const lever = this.mesh(RG.lever, RM.handle, "door", door); lever.position.set(RK.W / 2 - .12, 0, .03); this.lever = lever;
    this.plateMat = new THREE.MeshStandardMaterial({ map: plateTex("", ""), roughness: .6 });
    const plate = this.mesh(RG.plate, this.plateMat, "door", door); plate.position.set(0, RK.H / 2 - .2, .017);
    this.pilots = [];
    [[-.4, RM.tealOff], [-.33, RM.ambOn]].forEach(([x, m]) => {
      const b = this.mesh(RG.bezel, RM.chrome, "door", door); b.rotation.x = HALF_PI; b.position.set(x, RK.H / 2 - .34, .016);
      const p = this.mesh(RG.pilot, m, "door", door); p.rotation.x = HALF_PI; p.position.set(x, RK.H / 2 - .34, .022); this.pilots.push(p);
    });
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.position.set(0, .2, .5); this.glow.visible = false; this.group.add(this.glow);
    // shared interior: back panel, rails, vertical PDUs, cabling
    const I = new THREE.Group(); this.group.add(I);
    const back = this.mesh(RG.backp, RM.back, "body", I); back.position.z = -RK.D / 2 + .05;
    for (const x of [-1, 1]) { const r = this.mesh(RG.railv, RM.rail, "body", I); r.position.set(x * (RK.W / 2 - .1), 0, RK.D / 2 - .12); const p = this.mesh(RG.pduv, RM.pdu, "body", I); p.position.set(x * (RK.W / 2 - .09), 0, -.15); }
    for (let k = 0; k < 3; k++) { const c = this.mesh(RG.cablev, RM.cable, "body", I); c.position.set(-.3 + k * .05, 0, -RK.D / 2 + .12); }
    this.lamp = new THREE.PointLight(0xdff6ff, 0, 3.5, 1.4); this.lamp.position.set(0, .4, .1); I.add(this.lamp);
    this.buildHGX(I); this.buildNVL(I); this.detail = null; this.sleds = [];
    this.group.visible = false;
  }  // ---- pull-out detail: built the first time a rack is opened. The top three sleds slide into the aisle with their lids off,
  //      so the GPUs themselves are visible: eight SXM modules with finned heatsinks around the NVSwitch board for HGX nodes,
  //      Grace CPU and Blackwell GPU cold plates with their coolant hoses on NVL72 compute trays.
  buildDetail() {
    if (this.detail) return; const g = this.detail = new THREE.Group(); this.group.add(g); this.sleds = [];
    const finMat = (k) => new THREE.MeshStandardMaterial({ map: FIN_TEX, color: k === "b200" ? 0xd9c8a0 : k === "h200" ? 0xcfd6dc : 0xd3bd84, roughness: .35, metalness: .75 });
    const hgxSled = (y, k) => {
      const s = new THREE.Group(); s.position.y = y; g.add(s);
      const floor = this.mesh(RG.sledFloor, RM.silver, "srv", s); floor.position.set(0, -.085, 0);
      for (const x of [-1, 1]) { const r = this.mesh(RG.sledRail, RM.rail, "srv", s); r.position.set(x * (RK.W / 2 - .115), -.04, 0); }
      const bezel = this.mesh(RG.nodeFace, this.hgxFaceMat, "srv", s); bezel.position.set(0, .01, RK.D / 2 - .13); const bz = this.mesh(RG.bezelBox, RM.black, "srv", s); bz.position.set(0, .01, RK.D / 2 - .145);
      const fm = finMat(k);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { const m = this.mesh(RG.gpuMod, fm, "srv", s); m.position.set(-RK.W / 2 + .2 + c * .195, -.005, -.21 + r * .27); const base = this.mesh(RG.gpuBase, RM.copper, "srv", s); base.position.set(m.position.x, -.07, m.position.z); }
      const sw = this.mesh(RG.nvsw, RM.black, "srv", s); sw.position.set(0, -.045, -.075);
      for (const x of [-.22, .22]) { const cpu = this.mesh(RG.cpu, RM.finH, "srv", s); cpu.position.set(x, -.03, RK.D / 2 - .28); }
      for (let j = 0; j < 4; j++) { const l = this.mesh(RG.led, RM.tealOff, "srv", s); l.position.set(-RK.W / 2 + .16 + j * .04, -.06, RK.D / 2 - .127); l.castShadow = false; this.hgxLeds.push({ m: l, next: Math.random(), j, sled: true }); }
      return s;
    };
    const nvlSled = (y, k) => {
      const s = new THREE.Group(); s.position.y = y; g.add(s);
      const floor = this.mesh(RG.traySled, RM.silver, "srv", s); floor.position.set(0, -.02, 0);
      const plate = k === "gb300" ? RM.gold : k === "next" ? RM.violet : RM.copper;
      for (const x of [-.22, .22]) { const cpu = this.mesh(RG.cpuPlate, RM.finH, "srv", s); cpu.position.set(x, .01, -.18); for (const dz of [.02, .2]) { const gpu = this.mesh(RG.gpuPlate, plate, "srv", s); gpu.position.set(x, .012, dz); } }
      for (const [x, m] of [[-.43, RM.blue], [-.39, RM.red]]) { const h = this.mesh(RG.hose, m, "srv", s); h.rotation.x = HALF_PI; h.position.set(x, .02, 0); h.castShadow = false; }
      const fc = this.mesh(RG.trayFace, RM.black, "srv", s); fc.position.set(0, .015, RK.D / 2 - .13);
      return s;
    };
    this.makeSleds = (form, k, n) => {
      for (const s of this.sleds) { g.remove(s); } this.sleds = []; this.hgxLeds = this.hgxLeds.filter((l) => !l.sled);
      if (form === "nvl") for (let j = 0; j < 3; j++) this.sleds.push(nvlSled(.42 + .25 - (j + .5) * (.5 / 9), k));
      else for (let j = 0; j < Math.min(3, n); j++) this.sleds.push(hgxSled(-RK.H / 2 + .3 + (n - 1 - j) * .27, k));
      this.sledForm = form; this.sledKey = k; this.sledN = n;
      if (this.thermal) for (const m of this.parts) if (!m.userData.tset) m.material = this.tmat(m.userData.tkey);
    };
  }

  // ---- HGX: seven node slots, shown according to the rack's GPU count
  buildHGX(I) {
    const g = this.hgx = new THREE.Group(); I.add(g); this.nodes = []; this.hgxLeds = [];
    this.hgxFaceMat = new THREE.MeshStandardMaterial({ roughness: .6, metalness: .2 });
    const pitch = .27;
    for (let i = 0; i < 7; i++) {
      const y = -RK.H / 2 + .3 + i * pitch, n = new THREE.Group(); g.add(n); this.nodes.push(n);
      const ch = this.mesh(RG.nodeBox, RM.chassis, "srv", n); ch.position.set(0, y, -.06);
      const fc = this.mesh(RG.nodeFace, this.hgxFaceMat, "srv", n); fc.position.set(0, y, RK.D / 2 - .16);
      for (let j = 0; j < 4; j++) { const l = this.mesh(RG.led, RM.tealOff, "srv", n); l.position.set(-RK.W / 2 + .16 + j * .04, y - .07, RK.D / 2 - .157); l.castShadow = false; this.hgxLeds.push({ m: l, next: Math.random(), j }); }
    }
  }
  // ---- NVL72: compute blocks, switch block, power shelves, manifolds, busbar, spine
  buildNVL(I) {
    const g = this.nvl = new THREE.Group(); I.add(g); this.nvlLeds = [];
    this.nvlCompMat = new THREE.MeshStandardMaterial({ roughness: .55, metalness: .35 }); this.nvlSwMat = new THREE.MeshStandardMaterial({ roughness: .5, metalness: .5 });
    const shelfMat = new THREE.MeshStandardMaterial({ map: SHELF_TEX, roughness: .6, metalness: .3 });
    const body = this.mesh(RG.nvlBody, RM.chassis, "srv", g); body.position.set(0, -.08, -.08);
    const zf = RK.D / 2 - .17;
    const blocks = [["comp", -.58], ["sw", -.08], ["comp", .42]];
    for (const [kind, y] of blocks) {
      const fc = this.mesh(RG.nvlFace, kind === "comp" ? this.nvlCompMat : this.nvlSwMat, "srv", g); fc.position.set(0, y, zf);
      if (kind === "comp") for (let j = 0; j < 9; j++) { const l = this.mesh(RG.ledS, RM.tealOff, "srv", g); l.position.set(RK.W / 2 - .13, y + .25 - (j + .5) * (.5 / 9), zf + .003); l.castShadow = false; this.nvlLeds.push({ m: l, next: Math.random(), j }); }
    }
    for (const y of [-.93, .77]) { const s = this.mesh(RG.shelfFace, shelfMat, "srv", g); s.position.set(0, y, zf); }
    // coolant supply (blue) and return (red) manifolds up the left rear, quick-disconnect stubs off the compute blocks
    for (const [z, m] of [[-.12, RM.blue], [-.24, RM.red]]) { const c = this.mesh(RG.manifold, m, "body", g); c.position.set(-RK.W / 2 + .13, -.05, z); for (const y of [-.58, .42]) for (let j = 0; j < 3; j++) { const q = this.mesh(RG.qd, m, "body", g); q.rotation.z = HALF_PI; q.position.set(-RK.W / 2 + .16, y - .18 + j * .18, z); q.castShadow = false; } }
    const bus = this.mesh(RG.busbar, RM.copper, "body", g); bus.position.set(.12, -.05, -RK.D / 2 + .075);
    for (const x of [-.02, .06]) { const sp = this.mesh(RG.spine, RM.copper, "body", g); sp.position.set(x + .18, -.08, -RK.D / 2 + .14); }
  }
  mesh(geo, mat, tkey, parent) {
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.userData.rack = this; m.userData.tkey = tkey; m.userData.orig = mat; m.userData.shared = true;
    (parent || this.group).add(m); this.parts.push(m); if (this.thermal) m.material = this.tmat(tkey); return m;
  }
  setTarget(index, x, z, tag, sub, gpu, G, gpusInRack) {
    this.index = index; this.tag = tag; this.sub = sub; this.gpu = gpu; this.form = G.form;
    this.group.position.set(x, RK.H / 2, z); this.group.visible = true;
    this.plateMat.map = plateTex(tag, sub); this.plateMat.needsUpdate = true;
    this.onMat = stdM(GPU_COL[gpu], .3, 0, { emissive: GPU_COL[gpu], emissiveIntensity: 2.5 }); this.offMat = stdM(0x1a2026, .3, 0);
    if (this.form === "nvl") { this.hgx.visible = false; this.nvl.visible = true; this.nvlCompMat.map = nvlComputeTex(gpu, G); this.nvlSwMat.map = nvlSwitchTex(gpu); this.nvlCompMat.needsUpdate = this.nvlSwMat.needsUpdate = true; this.leds = this.nvlLeds; }
    else { this.hgx.visible = true; this.nvl.visible = false; this.hgxFaceMat.map = hgxFaceTex(gpu, G); this.hgxFaceMat.needsUpdate = true; const n = Math.max(1, Math.min(7, Math.floor(gpusInRack / 8))); this.nodes.forEach((nd, i) => nd.visible = i < n); this.leds = this.hgxLeds; }
    for (const l of [...this.hgxLeds, ...this.nvlLeds]) { l.m.material = this.offMat; l.m.userData.orig = this.offMat; }
    this.gpusInRack = gpusInRack; if (this.detail) this.detail.visible = false;
    this.setOpen(false); this.openT = 0; this.openV = 0;
  }
  release() { this.index = -1; this.group.visible = false; this.setOpen(false); this.fault = false; if (this.detail) this.detail.visible = false; }
  tmat(k) { return this.tmats[k] || (this.tmats[k] = tempMaterial(this.temp(k))); }
  temp(k) { const s = this.state; if (this.fault) return k === "srv" ? 78 : 40; if (!s.live) return 24; const rise = 1 + (s.heat || 0) * .6; return k === "srv" ? 26 + 36 * s.load * rise : k === "door" ? 24 + 12 * s.load * rise : 26 + 16 * s.load * rise; }
  setOpen(v) {
    this.openTarget = v ? 1 : 0;
    if (v) { this.buildDetail(); const n = Math.max(1, Math.min(7, Math.floor(this.gpusInRack / 8))); if (this.sledForm !== this.form || this.sledKey !== this.gpu || this.sledN !== n) this.makeSleds(this.form, this.gpu, n); for (const l of this.hgxLeds) if (l.sled) { l.m.material = this.offMat; l.m.userData.orig = this.offMat; } this.detail.visible = true; }
  }
  setThermal(on) { this.thermal = on; this.applyThermal(); }
  applyThermal() { for (const m of this.parts) m.material = this.thermal ? this.tmat(m.userData.tkey) : m.userData.orig; this.refreshThermal(); }
  refreshThermal() {
    if (this.thermal) for (const k in this.tmats) this.tmats[k].userData.setT(this.temp(k));
    const hot = this.temp("srv"); this.glow.visible = this.thermal && hot > 48;
    if (this.glow.visible) { const k = clampN((hot - 48) / 16, 0, 1); this.glow.scale.setScalar(.6 + k * 1.2); this.glow.material.opacity = .15 + k * .3; }
  }
  apply(live, load, fault = false, heat = 0) {
    this.state = { live, load, heat }; this.fault = fault;
    this.pilots[0].userData.orig = live && !fault ? RM.tealOn : RM.tealOff; this.pilots[1].userData.orig = fault ? RM.redOn : live ? RM.ambOff : RM.ambOn;
    if (!this.thermal) { this.pilots[0].material = this.pilots[0].userData.orig; this.pilots[1].material = this.pilots[1].userData.orig; }
    this.refreshThermal();
  }
  hover(v) { this.pop = v ? 1 : 0; }
  update(dt, t) {
    this.openV += ((this.openTarget - this.openT) * 38 - this.openV * 7.5) * dt; this.openT = Math.max(0, this.openT + this.openV * dt);
    this.popT += (this.pop - this.popT) * (1 - Math.exp(-dt * 14));
    this.doorMesh.position.z = this.popT * .02; this.hinge.rotation.y = -this.openT * 1.9; this.lever.rotation.z = this.openT * .8;
    this.lamp.intensity = this.openT * 18;
    if (this.detail) {
      const k = ease(clampN(this.openT, 0, 1)), show = this.openTarget > 0 || k > .02; this.detail.visible = show;
      if (show) {
        this.sleds.forEach((sl, j) => { sl.position.z = k * (.62 - j * .17); sl.visible = k > .02; });
        if (this.form === "hgx") { const n = this.sledN; this.nodes.forEach((nd, i) => nd.visible = i < n && !(k > .3 && i >= n - this.sleds.length)); }
      } else if (this.form === "hgx" && this.sledN) { const n = this.sledN; this.nodes.forEach((nd, i) => nd.visible = i < n); }
    }
    if (!this.thermal && this.onMat) {
      const live = this.state.live;
      for (const l of this.leds) {
        if (this.fault) { if (t > l.next) { l.m.material = Math.random() > .8 ? RM.redOn : this.offMat; l.next = t + .08 + Math.random() * .5; } continue; }
        if (!live) { l.m.material = this.offMat; continue; }
        if (t > l.next) { l.m.material = Math.random() > .3 ? this.onMat : this.offMat; l.next = t + .05 + Math.random() * .4; }
      }
    }
  }
}

// ---------------------------------------------------------------- walkers: crews on paths, techs and robots on the floor
function makeHuman(color, hat) {
  const m = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.26, .75, 3, 8), stdM(color, .8, 0)); body.position.y = .85; body.castShadow = true; body.userData.static = true; body.userData.temp = 33; m.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.17, 8, 6), stdM(0xd9a37a, .7, 0)); head.position.y = 1.5; head.userData.static = true; head.userData.temp = 34; m.add(head);
  const h = new THREE.Mesh(new THREE.CylinderGeometry(.19, .2, .12, 10), stdM(hat, .5, 0)); h.position.y = 1.62; h.userData.static = true; h.userData.temp = 31; m.add(h);
  return m;
}
// Floor robots are low disc units, the shape of a robot vacuum: a dark deck with a grey front bumper, a sensor puck
// on top with a status lamp, a front camera bump and a spinning side brush. They sweep and inspect the aisles.
function makeRobot(kind) {
  const m = new THREE.Group();
  if (kind === "build") {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.1, .7, 1.3), stdM(0x8f9cff, .6, .3, { emissive: 0x4050c0, emissiveIntensity: .4 })); b.position.y = .45; b.castShadow = true; b.userData.static = true; b.userData.temp = 36; m.add(b);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.12, 1.1, .12), stdM(0xd8dde3, .5, .4)); arm.position.set(.3, 1.3, 0); arm.rotation.z = -.4; arm.userData.static = true; arm.userData.temp = 30; m.add(arm);
    return m;
  }
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(.235, .245, .085, 28), stdM(0x262a2f, .5, .35)); deck.position.y = .062; deck.castShadow = true; deck.userData.static = true; deck.userData.temp = 31; m.add(deck);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(.205, .22, .02, 28), stdM(0x3a4047, .35, .5)); top.position.y = .114; top.userData.static = true; top.userData.temp = 31; m.add(top);
  const bumper = new THREE.Mesh(new THREE.CylinderGeometry(.252, .252, .06, 28, 1, false, -Math.PI * .5, Math.PI), stdM(0x9aa3ad, .6, .3)); bumper.position.y = .058; bumper.userData.static = true; bumper.userData.temp = 30; m.add(bumper);
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(.075, .08, .045, 20), stdM(0x14171b, .4, .4)); puck.position.y = .146; puck.userData.static = true; puck.userData.temp = 34; m.add(puck);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(.022, 10, 8), new THREE.MeshBasicMaterial({ color: 0x3fd8c6 })); lamp.position.set(0, .178, 0); m.add(lamp); m.userData.lamp = lamp;
  const cam = new THREE.Mesh(new THREE.BoxGeometry(.09, .035, .05), stdM(0x111317, .5, .3)); cam.position.set(0, .135, .17); cam.userData.static = true; cam.userData.temp = 32; m.add(cam);
  const eye = new THREE.Mesh(new THREE.BoxGeometry(.05, .014, .004), new THREE.MeshBasicMaterial({ color: 0x3aa0ff })); eye.position.set(0, .135, .196); m.add(eye);
  const brush = new THREE.Group(); brush.position.set(.17, .02, .14); m.add(brush); m.userData.spin = brush;
  for (let k = 0; k < 3; k++) { const br = new THREE.Mesh(new THREE.BoxGeometry(.19, .006, .016), stdM(0xd9c97a, .9, 0)); br.rotation.y = k * Math.PI * 2 / 3; br.position.x = Math.cos(k * Math.PI * 2 / 3) * .08; br.position.z = -Math.sin(k * Math.PI * 2 / 3) * .08; br.userData.static = true; br.userData.temp = 28; brush.add(br); }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .03, 8), stdM(0x3a4047, .5, .4)); brush.add(hub);
  for (const x of [-.19, .19]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .03, 12), stdM(0x111317, .8, 0)); w.rotation.z = HALF_PI; w.position.set(x, .04, -.02); w.userData.static = true; m.add(w); }
  return m;
}
class Walker {
  constructor(mesh, spd, paths) { this.m = mesh; this.spd = spd; this.paths = paths; this.pts = []; this.i = 0; this.wait = 0; this.held = false; this.task = null; this.next(); const p = this.pts[0]; if (p) this.m.position.set(p[0], 0, p[1]); }
  next() { this.pts = this.paths(this.m.position); this.i = 0; }
  // send the walker along explicit points and keep it at the end until released
  assign(pts, task) { this.pts = pts; this.i = 0; this.wait = 0; this.held = true; this.task = task; this.arrived = false; }
  release() { this.held = false; this.task = null; this.arrived = false; this.m.position.y = 0; this.next(); }
  update(dt, t) {
    if (this.m.userData.spin) this.m.userData.spin.rotation.y += dt * 14;
    if (this.m.userData.lamp) this.m.userData.lamp.material.color.setHex(this.held ? (Math.sin(t * 10) > 0 ? 0xffb020 : 0x3a2a08) : (Math.sin(t * 6) > 0 ? 0x3fd8c6 : 0x0f2a28));
    if (this.held && this.arrived) { if (!this.m.userData.spin) this.m.position.y = Math.abs(Math.sin(t * 4.5)) * .06; return; }
    if (this.wait > 0) { this.wait -= dt; return; }
    const tgt = this.pts[this.i]; if (!tgt) { if (this.held) { this.arrived = true; return; } this.next(); return; }
    const dx = tgt[0] - this.m.position.x, dz = tgt[1] - this.m.position.z, d = Math.hypot(dx, dz);
    if (d < .2) { this.i++; if (this.i >= this.pts.length) { if (this.held) { this.arrived = true; return; } this.wait = .5 + Math.random() * 2; this.next(); } return; }
    const step = Math.min(d, this.spd * dt * 60);
    this.m.position.x += dx / d * step; this.m.position.z += dz / d * step; this.m.rotation.y = Math.atan2(dx, dz);
  }
}

// ---------------------------------------------------------------- Site
const TBG = new THREE.Color(tnorm(21), tnorm(21), tnorm(21));
const HERO_POOL = 24;
class Site {
  constructor(host) {
    this.host = host; const canvas = $id("site3d");
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(2, devicePixelRatio || 1)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = .9;
    this.css = new CSS2DRenderer(); this.css.domElement.className = "css2d"; host.append(this.css.domElement);
    const scene = this.scene = new THREE.Scene(); this.BG = new THREE.Color(0x0b1118); scene.background = this.BG.clone(); scene.fog = new THREE.Fog(0x0b1118, 220, 640);
    const pmrem = new THREE.PMREMGenerator(r); scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .4;
    this.camera = new THREE.PerspectiveCamera(42, 1, .05, 2500);
    const c = this.controls = new OrbitControls(this.camera, canvas);
    c.enableDamping = true; c.dampingFactor = .08; c.maxPolarAngle = 1.565; c.minDistance = .3; c.maxDistance = 900; c.screenSpacePanning = true;
    c.addEventListener("start", () => { this.flight = null; this.idle = 0; this.stage(""); });
    scene.add(new THREE.HemisphereLight(0xdbe8f5, 0x202a36, .55));
    const key = new THREE.DirectionalLight(0xffe9cf, 1.8); key.position.set(90, 140, 70); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220, near: 10, far: 500 }); key.shadow.bias = -.0004; key.shadow.normalBias = .03; scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd3ec, .35); fill.position.set(-80, 60, -40); scene.add(fill);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), stdM(0x1b2a22, 1, 0)); ground.rotation.x = -HALF_PI; ground.receiveShadow = true; ground.userData.static = true; ground.userData.temp = 18; scene.add(ground);
    const grid = new THREE.GridHelper(1400, 70, 0x22313f, 0x182230); grid.position.y = .01; scene.add(grid); this.grid = grid;
    this.tcam = new ThermalCam(r); this.thermal = false; this.flight = null; this.idle = 0; this.droneA = null; this.selected = null; this.hovered = null; this.mode = "campus";
    this.clock = new THREE.Clock(); this.w = 0; this.h = 0; this.labels = []; this.pickables = []; this.fid = null; this.pool = [];
    for (let i = 0; i < HERO_POOL; i++) { const rk = new Rack(); scene.add(rk.group); this.pool.push(rk); rk.group.traverse((m) => { if (m.isMesh && m.userData.pick) this.pickables.push(m); }); }
    this.ray = new THREE.Raycaster(); this.ptr = new THREE.Vector2(); let down = null, lastMove = 0;
    canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    canvas.addEventListener("pointerup", (e) => {
      if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), quick = performance.now() - down.t < 450; down = null;
      if (moved > 6 || !quick) return; const h = this.pick(e.clientX, e.clientY); if (!h) return;
      if (h.rack) { if (h.rack !== this.selected) this.select(h.rack); else this.select(null); }
      else if (h.row != null) this.goRow(h.row);
    });
    canvas.addEventListener("pointermove", (e) => {
      const now = performance.now(); if (now - lastMove < 50) return; lastMove = now;
      const h = this.pick(e.clientX, e.clientY); const hr = h && h.rack && h.rack !== this.selected ? h.rack : null;
      if (hr !== this.hovered) { this.hovered && this.hovered.hover(false); hr && hr.hover(true); this.hovered = hr; }
      canvas.style.cursor = h ? "pointer" : "grab";
      const tip = $id("siteTip"); const b = this.host.getBoundingClientRect();
      if (h && h.rack) { const s = h.rack.state; tip.hidden = false; tip.style.left = (e.clientX - b.left + 14) + "px"; tip.style.top = (e.clientY - b.top + 12) + "px"; tip.innerHTML = `<b>${h.rack.tag}</b> ${h.rack.sub}<br>${s.live ? `energized · ${Math.round(s.load * 100)}% load · ${h.rack.temp("srv").toFixed(1)} °C` : "installed · not yet energized"} · click to open`; }
      else if (h && h.row != null) { tip.hidden = false; tip.style.left = (e.clientX - b.left + 14) + "px"; tip.style.top = (e.clientY - b.top + 12) + "px"; tip.innerHTML = `<b>Row ${rowName(h.row)}</b> · ${GPU_NAME[this.o.rowGpu[h.row]]} · click to fly there`; }
      else tip.hidden = true;
    });
    canvas.addEventListener("pointerleave", () => { $id("siteTip").hidden = true; });
    this._key = (e) => {
      if ($id("siteview").hidden || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (e.key === "t" || e.key === "T") this.setThermal(!this.thermal);
      if (e.key === "Escape") { if (this.selected) this.select(null); else if (this.mode !== "campus") this.goCampus(); }
    }; addEventListener("keydown", this._key);
    document.querySelectorAll(".hudnav button[data-view]").forEach((b) => b.onclick = () => ({ campus: () => this.goCampus(), hall: () => this.goHall(), elec: () => this.goElec() })[b.dataset.view]());
    $id("thermalBtn").onclick = () => this.setThermal(!this.thermal);
    this.inc = new Map();
    document.querySelectorAll("#incSim button[data-inc]").forEach((b) => b.onclick = () => { if (!this.f || this.f.status !== "live") return; const inc = INC.spawn(this.f, b.dataset.inc, false); if (inc) { this.stage(`${INC.defs[inc.kind].name.toUpperCase()} · ${this.incWhere(inc)}`); setTimeout(() => this.stage(""), 2400); } });
    $id("incList").addEventListener("click", (e) => {
      const d = e.target.closest("button[data-dispatch]"); if (d) { const inc = (this.f.incidents || []).find((i) => String(i.id) === d.dataset.dispatch); inc && INC.dispatch(this.f, inc); return; }
      const g = e.target.closest("[data-goto]"); if (g) { const inc = (this.f.incidents || []).find((i) => String(i.id) === g.dataset.goto); inc && this.gotoIncident(inc); }
    });
  }
  dispose() { removeEventListener("keydown", this._key); this.renderer.dispose(); this.css.domElement.remove(); }
  stage(t) { const el = $id("hudStage"); el.textContent = t; el.classList.toggle("on", !!t); }
  pick(x, y) {
    const r = this.renderer.domElement.getBoundingClientRect(); this.ptr.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); this.ray.setFromCamera(this.ptr, this.camera);
    const h = this.ray.intersectObjects(this.pickables, false)[0]; if (!h) return null;
    if (h.object.userData.rack) return h.object.userData.rack.index >= 0 ? { rack: h.object.userData.rack } : null;
    if (h.object === this.o.rackMesh && h.instanceId != null && h.instanceId < this.o.installed) return { row: Math.floor(h.instanceId / this.o.cols) };
    return null;
  }

  // ------------------------------------------------------------ build
  build(f) {
    if (this.g) { for (const v of this.inc.values()) this.removeVisual(v); this.inc.clear(); this._incKey = null; this.scene.remove(this.g); this.g.traverse((x) => { if (x.geometry && !x.userData.shared) x.geometry.dispose(); }); for (const l of this.labels) l.element.remove(); this.labels = []; this.pickables = this.pickables.filter((m) => m.userData.rack); this.selected = null; this.hovered = null; for (const rk of this.pool) rk.release(); }
    this.f = f; this.fid = f.id;
    const racks = f.cfg.racks, cols = Math.min(40, Math.ceil(Math.sqrt(racks * 2.2))), rows = Math.ceil(racks / cols);
    const W = cols * 1.3 + 12, D = rows * 2.6 + 10, GAL = 16, DT = D + GAL, zOff = -GAL / 2, H = 11 + Math.min(6, f.plan.facMW / 60);
    const L = cols * 1.3, x0 = -W / 2 + 6, z0 = -D / 2 + 6, liquid = f.cfg.dens >= 80;
    const g = this.g = new THREE.Group(); this.scene.add(g);
    const rackGpu = f.plan.rackGpu || Array.from({ length: racks }, () => f.cfg.gpu);
    const rowGpu = Array.from({ length: rows }, (_, r) => rackGpu[Math.min(racks - 1, r * cols)]);
    const o = this.o = { W, D, DT, GAL, zOff, H, L, x0, z0, cols, rows, racks, liquid, rackGpu, rowGpu, p: { permit: 0, civil: 0, inter: 0, shell: 0, mep: 0, racks: 0, comm: 0 }, live: 0, installed: -1, inside: false, hidden: new Set(), assign: new Map(), dropping: new Map(), poolTick: 0, downRows: new Set(), faultRacks: new Set(), heat: 0, powerOut: false, gensOn: false, chillerDown: -1 };
    const M = (c, e = {}) => stdM(c, .85, .1, e);
    const mesh = (geo, mat, x, y, z, shadow = true, temp = 24) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; m.userData.static = true; m.userData.temp = temp; g.add(m); return m; };
    const inst = (geo, mat, n, temp = 26, shadow = true) => { const im = new THREE.InstancedMesh(geo, mat, n); im.castShadow = shadow; im.receiveShadow = true; im.userData.static = true; im.userData.temp = temp; im.frustumCulled = false; im.visible = false; g.add(im); return im; };
    const d = o.dummy = new THREE.Object3D();
    const setI = (im, i, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => { d.position.set(x, y, z); d.rotation.set(0, ry, 0); d.scale.set(sx, sy, sz); d.updateMatrix(); im.setMatrixAt(i, d.matrix); };

    // pad, slab, road
    o.pad = mesh(new THREE.PlaneGeometry(W + 40, DT + 40), M(0x2b2f33, { roughness: 1 }), 0, .03, zOff, false, 20); o.pad.rotation.x = -HALF_PI; o.pad.scale.set(.001, 1, 1);
    const slabTex = concrete.clone(); slabTex.repeat.set(W / 8, DT / 8); slabTex.needsUpdate = true;
    o.slab = mesh(new THREE.BoxGeometry(W + 2, .6, DT + 2), new THREE.MeshStandardMaterial({ map: slabTex, roughness: .3, metalness: .05, color: 0x8d9193 }), 0, .3, zOff, true, 22); o.slab.scale.set(.001, 1, 1);
    const road = mesh(new THREE.PlaneGeometry(1400, 10), M(0x1c1f23, { roughness: 1 }), 0, .02, D / 2 + 30, false, 20); road.rotation.x = -HALF_PI;
    // substation and feeder
    o.trafos = []; for (let i = 0; i < 3; i++) {
      const t = new THREE.Group(); t.position.set(-(W / 2 + 34), 0, -D / 4 + i * 9 - 9);
      const b = new THREE.Mesh(new THREE.BoxGeometry(6, 4.5, 4), stdM(0x6b7684, .6, .4)); b.position.y = 2.25; b.castShadow = true; b.userData.static = true; b.userData.temp = 38; t.add(b);
      for (let k = 0; k < 3; k++) { const ins = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, 2.5, 8), stdM(0xb8c4d0)); ins.position.set(k * 1.8 - 1.8, 5.7, 0); ins.userData.static = true; ins.userData.temp = 30; t.add(ins); }
      t.scale.set(1, .001, 1); g.add(t); o.trafos.push(t);
    }
    o.poles = []; const pts = [];
    for (let i = 0; i < 4; i++) { const x = -(W / 2 + 30) + i * (W / 2 + 28) / 3; const pole = mesh(new THREE.CylinderGeometry(.3, .4, 16, 6), M(0x55606c), x, 8, -D / 4, true, 22); pole.visible = false; o.poles.push(pole); pts.push(new THREE.Vector3(x, 16, -D / 4)); }
    o.wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x3fd8c6 })); o.wire.visible = false; g.add(o.wire);
    // generator yard and fuel
    o.gens = []; const nGen = Math.min(12, Math.max(2, Math.ceil(f.plan.facMW / 40)));
    for (let i = 0; i < nGen; i++) {
      const gen = new THREE.Group(); gen.position.set(-(W / 2 + 34) + (i % 2) * 7, 0, D / 4 + Math.floor(i / 2) * 11);
      const box = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 9), stdM(0x4f5a66, .6, .3)); box.position.y = 1.5; box.castShadow = true; box.userData.static = true; box.userData.temp = 42; gen.add(box);
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, 3, 8), stdM(0x2a2f36, .6, .4)); stack.position.set(0, 4.2, -3); stack.userData.static = true; stack.userData.temp = 60; gen.add(stack);
      gen.visible = false; g.add(gen); o.gens.push(gen);
    }
    o.tanks = []; for (let i = 0; i < 2; i++) { const t = mesh(new THREE.CylinderGeometry(2, 2, 12, 16), stdM(0xe1e4e8, .5, .3), -(W / 2 + 46), 2, D / 4 + i * 6, true, 22); t.rotation.z = HALF_PI; t.visible = false; o.tanks.push(t); }
    // hall shell
    o.wallMat = stdM(0x33475f, .5, .1, { transparent: true, opacity: .42 }); o.wallIn = stdM(0x26364a, .7, .1, { transparent: true, opacity: .92 });
    const wall = (w, h, dd, x, z) => { const m = mesh(new THREE.BoxGeometry(w, h, dd), o.wallMat, x, 0, z, true, 26); m.scale.y = .001; return m; };
    o.walls = [wall(W, H, .5, 0, zOff - DT / 2 + .25), wall(W, H, .5, 0, zOff + DT / 2 - .25), wall(.5, H, DT, -W / 2 + .25, zOff), wall(.5, H, DT, W / 2 - .25, zOff)];
    o.roof = mesh(new THREE.BoxGeometry(W, .4, DT), o.wallMat, 0, H, zOff, true, 30); o.roof.visible = false;
    o.edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, DT)), new THREE.LineBasicMaterial({ color: 0x8fb4d8, transparent: true, opacity: .7 })); o.edges.position.z = zOff; g.add(o.edges);
    // rooftop chillers and cooling towers
    o.roofUnits = []; const nChill = Math.min(14, Math.max(3, Math.ceil(f.plan.facMW / 8)));
    for (let i = 0; i < nChill; i++) { const c = mesh(new THREE.BoxGeometry(4, 2.4, 3), stdM(0xa9b4c0, .6, .3), -W / 2 + 6 + i * ((W - 12) / Math.max(1, nChill - 1)), H + 1.4, zOff - DT / 2 + 4, true, 34); c.visible = false; o.roofUnits.push(c); }
    o.towers = []; o.fans = []; const nTow = Math.min(8, Math.max(2, Math.ceil(f.plan.facMW / 14)));
    for (let i = 0; i < nTow; i++) {
      const z = zOff - DT / 2 + 8 + i * ((DT - 16) / Math.max(1, nTow - 1));
      const t = mesh(new THREE.CylinderGeometry(3.2, 3.8, 7, 14), stdM(0x8d99a6, .6, .2), W / 2 + 10, 3.5, z, true, 40); t.visible = false; o.towers.push(t);
      const fan = mesh(new THREE.CylinderGeometry(2.4, 2.4, .3, 14), stdM(0x3fd8c6, .5, 0, { emissive: 0x3fd8c6, emissiveIntensity: 0 }), W / 2 + 10, 7.2, z, false, 46); fan.visible = false; o.fans.push(fan);
    }

    // ---- the hall: every rack, every server
    o.rackPos = []; for (let i = 0; i < racks; i++) { const r = Math.floor(i / cols), c = i % cols; o.rackPos.push([x0 + c * 1.3 + .5, z0 + r * 2.6]); }
    o.rackMesh = inst(new THREE.BoxGeometry(1.05, 2.3, .75), stdM(0x1b1e22, .6, .25), racks, 24); o.rackMesh.visible = true; this.pickables.push(o.rackMesh);
    o.trayMesh = inst(new THREE.BoxGeometry(.88, .17, .62), stdM(0x3a4047, .45, .4, { emissive: 0x000000 }), racks * 8, 26); o.trayMesh.visible = true;
    o.ledMesh = inst(new THREE.BoxGeometry(.5, .04, .02), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), racks * 8, 36, false); o.ledMesh.visible = true;
    o.colOff = new THREE.Color(0x151a20); o.colRed = new THREE.Color(0xff3b3b); o.gpuCol = {}; for (const k in GPU_COL) o.gpuCol[k] = new THREE.Color(GPU_COL[k]);
    for (let i = 0; i < racks; i++) { o.rackMesh.setColorAt(i, new THREE.Color(0x1b1e22)); for (let j = 0; j < 8; j++) { o.trayMesh.setColorAt(i * 8 + j, new THREE.Color(0x3a4047)); o.ledMesh.setColorAt(i * 8 + j, o.colOff); } }
    o.rackMesh.instanceColor.needsUpdate = true; o.trayMesh.instanceColor.needsUpdate = true; o.ledMesh.instanceColor.needsUpdate = true;
    this.applyInstanceAll();
    // busways, pipes, CDUs, PDUs, CRAHs
    o.busway = inst(new THREE.BoxGeometry(L + 2, .3, .3), stdM(0xd9b22a, .5, .3), rows, 32);
    o.pipes = inst(new THREE.CylinderGeometry(.08, .08, L + 3, 8), stdM(0x3a7bd5, .4, .4), rows * 2, 22); o.pipesHot = inst(new THREE.CylinderGeometry(.08, .08, L + 3, 8), stdM(0xb3261e, .4, .4), rows, 38);
    o.cdus = inst(new THREE.BoxGeometry(1.2, 2.0, .9), stdM(0x2f6f6a, .5, .3), rows, 28);
    o.pdus = inst(new THREE.BoxGeometry(.8, 2.1, .9), stdM(0x5a6572, .55, .35), rows, 34);
    o.trays = inst(new THREE.BoxGeometry(L + 2, .08, .04), stdM(0xa6adb3, .4, .8), rows * 2, 26);
    o.fixtures = inst(new THREE.BoxGeometry(1.4, .05, .3), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }), rows * Math.max(1, Math.floor(L / 7)), 26, false);
    for (let r = 0; r < rows; r++) {
      const z = z0 + r * 2.6, cx = x0 + L / 2;
      setI(o.busway, r, cx, 3.05, z - .35);
      setI(o.pipes, r * 2, cx, 2.75, z + .3, 1, 1, 1); d.rotation.set(0, 0, HALF_PI); d.position.set(cx, 2.75, z + .3); d.scale.set(1, 1, 1); d.updateMatrix(); o.pipes.setMatrixAt(r * 2, d.matrix);
      d.position.set(cx, 2.75, z + .55); d.updateMatrix(); o.pipes.setMatrixAt(r * 2 + 1, d.matrix);
      d.position.set(cx, 2.55, z + .42); d.updateMatrix(); o.pipesHot.setMatrixAt(r, d.matrix);
      setI(o.cdus, r, x0 - 1.4, 1.0, z); setI(o.pdus, r, x0 + L + 1.2, 1.05, z);
      for (const dz of [-.25, .25]) setI(o.trays, r * 2 + (dz > 0 ? 1 : 0), cx, 3.4, z + 1.3 + dz);
      let fi = 0; for (let x = x0 + 2; x < x0 + L - 1 && r * Math.max(1, Math.floor(L / 7)) + fi < o.fixtures.count; x += 7) setI(o.fixtures, r * Math.max(1, Math.floor(L / 7)) + fi++, x, H - .4, z + 1.3);
    }
    for (const im of [o.busway, o.pipes, o.pipesHot, o.cdus, o.pdus, o.trays, o.fixtures]) im.instanceMatrix.needsUpdate = true;
    if (!liquid) { o.pipes.count = 0; o.pipesHot.count = 0; o.cdus.count = 0; }
    o.crahs = []; const nCrah = Math.max(2, Math.floor(DT / 9));
    for (let i = 0; i < nCrah; i++) for (const side of [-1, 1]) { const z = zOff - DT / 2 + 6 + i * 9; if (z > zOff + DT / 2 - 4) continue; const u = new THREE.Group(); u.position.set(side * (W / 2 - 1.4), 0, z); const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.4, 2.2), stdM(0xa9b4c0, .6, .3)); b.position.y = 1.2; b.castShadow = true; b.userData.static = true; b.userData.temp = 20; u.add(b); const grille = new THREE.Mesh(new THREE.BoxGeometry(.06, 1.6, 1.8), stdM(0x2b3139, .8, .2)); grille.position.set(-side * .52, 1.3, 0); grille.userData.static = true; grille.userData.temp = 16; u.add(grille); u.visible = false; g.add(u); o.crahs.push(u); }
    // row labels and gallery
    for (let r = 0; r < rows; r++) {
      const el = document.createElement("div"); el.className = "lbl"; const n = Math.min(cols, racks - r * cols); el.innerHTML = `ROW ${rowName(r)}<small>${n} RACKS · ${GPU_NAME[rowGpu[r]]} · ${(n * f.cfg.dens / 1000).toFixed(1)} MW</small>`;
      el.onclick = (e) => { e.stopPropagation(); this.goRow(r); };
      const l = new CSS2DObject(el); l.position.set(x0 - 2.2, 2.9, z0 + r * 2.6); l.visible = false; l.userData.row = r; g.add(l); this.labels.push(l);
    }
    o.gal = new THREE.Group(); o.gal.position.set(-W / 2 + .5 + 10.9, 0, zOff - DT / 2 + .5 + 11.9); g.add(o.gal); o.gal.visible = false;
    o.props = buildProps(o.gal); o.gal.traverse((m) => { if (m.isMesh) m.userData.static = true; });
    const galEl = document.createElement("div"); galEl.className = "lbl"; galEl.innerHTML = `ELECTRICAL ROOM<small>480 V · UPS · VFD</small>`; galEl.onclick = (e) => { e.stopPropagation(); this.goElec(); };
    const galL = new CSS2DObject(galEl); galL.position.set(0, 3.2, -6); galL.visible = false; o.gal.add(galL); this.labels.push(galL);
    // crane
    o.crane = new THREE.Group(); o.crane.position.set(W / 2 + 6, 0, D / 2 + 6); g.add(o.crane);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, H + 22, 1.6), M(0xf0b443)); mast.position.y = (H + 22) / 2; mast.castShadow = true; mast.userData.static = true; o.crane.add(mast);
    o.jib = new THREE.Group(); o.jib.position.y = H + 21; o.crane.add(o.jib);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(W * .9, 1, 1), M(0xf0b443)); jib.position.x = -W * .45 + 6; jib.userData.static = true; o.jib.add(jib);
    const cjib = new THREE.Mesh(new THREE.BoxGeometry(12, 1.2, 1.4), M(0xf0b443)); cjib.position.x = 8; cjib.userData.static = true; o.jib.add(cjib);
    o.hook = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), M(0x9aa8b8)); o.hook.position.set(-W * .5, -6, 0); o.hook.userData.static = true; o.jib.add(o.hook);
    o.hookLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-W * .5, 0, 0), new THREE.Vector3(-W * .5, -6, 0)]), new THREE.LineBasicMaterial({ color: 0xcccccc })); o.jib.add(o.hookLine);
    // walkers: construction crews on the perimeter and the aisles, then floor staff after go-live
    const aisle = (r) => z0 + r * 2.6 + 1.3;
    const aislePath = (from) => { const r = Math.floor(Math.random() * rows); const z = aisle(r); const left = x0 - 2.5, right = x0 + L + 2.5; const goRight = from.x < (left + right) / 2; const endX = from.x < left ? left : from.x > right ? right : (goRight ? right : left); return [[endX, from.z], [endX, z], [goRight ? right : left, z]]; };
    const perimeter = () => { const px = W / 2 + 14, pz = DT / 2 + 14; const corners = [[-px, zOff - pz], [px, zOff - pz], [px, zOff + pz], [-px, zOff + pz]]; const s = Math.floor(Math.random() * 4); return [corners[s], corners[(s + 1) % 4], corners[(s + 2) % 4]]; };
    const crewPath = (from) => (o.p.shell > .3 ? aislePath(from) : perimeter());
    const nPeople = Math.min(40, Math.round(f.plan.people / 20)), nRobots = Math.min(30, Math.round(f.cfg.crew * f.cfg.robots / 100 / 20));
    o.crew = [];
    for (let i = 0; i < nPeople; i++) { const m = makeHuman(0xf3a267, 0xf0b443); g.add(m); o.crew.push(new Walker(m, .06 + Math.random() * .02, crewPath)); }
    for (let i = 0; i < nRobots; i++) { const m = makeRobot("build"); g.add(m); o.crew.push(new Walker(m, .08, crewPath)); }
    const nTech = Math.min(14, 2 + Math.round(f.plan.jobsPerm / 25)), nBots = Math.min(16, 3 + Math.round(racks / 400));
    o.staff = [];
    for (let i = 0; i < nTech; i++) { const m = makeHuman(0x2f7fd8, 0xffffff); m.visible = false; g.add(m); o.staff.push(new Walker(m, .05 + Math.random() * .015, aislePath)); }
    for (let i = 0; i < nBots; i++) { const m = makeRobot("floor"); m.visible = false; g.add(m); o.staff.push(new Walker(m, .04 + Math.random() * .012, aislePath)); }
    o.trucks = []; for (let i = 0; i < 2; i++) {
      const t = new THREE.Group(); const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 2.4), stdM(0xd8dde3, .5, .3)); cab.position.set(2.5, 1.6, 0); const box = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 2.6), stdM(i ? 0x3fd8c6 : 0xf0b443, .6, .1)); box.position.set(-2.5, 1.9, 0);
      cab.castShadow = box.castShadow = true; cab.userData.static = box.userData.static = true; cab.userData.temp = 30; box.userData.temp = 28; t.add(cab, box); t.position.set(-200 + i * 180, 0, D / 2 + 30 + (i ? 2.5 : -2.5)); t.userData.dir = i ? -1 : 1; g.add(t); o.trucks.push(t);
    }
    o.glow = new THREE.PointLight(0x3fd8c6, 0, Math.max(W, DT) * 1.2, 1.2); o.glow.position.set(0, H + 6, zOff); g.add(o.glow);
    const span = Math.max(W, DT);
    o.views = {
      campus: { pos: new THREE.Vector3(W * .8, span * .7 + 30, D / 2 + span * .9), target: new THREE.Vector3(0, H * .3, zOff) },
      hall: { pos: new THREE.Vector3(x0 - 3, 1.7, aisle(0)), target: new THREE.Vector3(x0 + 14, 1.2, aisle(0) - .4) },
      elec: { pos: new THREE.Vector3(5.6, 5.4, 5.2).add(o.gal.position), target: new THREE.Vector3(0, .9, -3).add(o.gal.position) },
    };
    this.camera.position.copy(o.views.campus.pos); this.controls.target.copy(o.views.campus.target); this.mode = "campus"; this.setInside(false); this.flight = null; this.idle = 0; this.droneA = null; this.stage("");
    if (this.thermal) this.thermalMats(true);
    $id("hudName").textContent = f.name;
  }

  // instanced rack visuals for one index: installed, hidden behind a pool rack, or still to come
  applyInstance(i, drop = 0) {
    const o = this.o, d = o.dummy, on = i < o.installed && !o.hidden.has(i), [x, z] = o.rackPos[i];
    d.rotation.set(0, 0, 0);
    d.position.set(x, on ? 1.15 + drop : -9, z); d.scale.setScalar(on ? 1 : .001); d.updateMatrix(); o.rackMesh.setMatrixAt(i, d.matrix);
    for (let j = 0; j < 8; j++) { const y = .32 + j * .235 + drop; d.position.set(x, on ? y : -9, z - .06); d.scale.setScalar(on ? 1 : .001); d.updateMatrix(); o.trayMesh.setMatrixAt(i * 8 + j, d.matrix); d.position.set(x - .1, on ? y + .07 : -9, z + .33); d.updateMatrix(); o.ledMesh.setMatrixAt(i * 8 + j, d.matrix); }
  }
  applyInstanceAll() { const o = this.o; for (let i = 0; i < o.racks; i++) this.applyInstance(i); o.rackMesh.instanceMatrix.needsUpdate = true; o.trayMesh.instanceMatrix.needsUpdate = true; o.ledMesh.instanceMatrix.needsUpdate = true; }
  // keep the detailed pool on the racks nearest the camera
  updatePool(live, load) {
    const o = this.o, cp = this.camera.position;
    if (!o.inside || o.installed <= 0) { for (const rk of this.pool) if (rk.index >= 0 && rk !== this.selected) { o.hidden.delete(rk.index); this.applyInstance(rk.index); o.assign.delete(rk.index); rk.release(); } this.flushInst(); return; }
    const cand = [];
    for (let i = 0; i < o.installed; i++) { const [x, z] = o.rackPos[i]; const dd = (x - cp.x) ** 2 + (z - cp.z) ** 2; if (dd < 900) cand.push([dd, i]); }
    cand.sort((a, b) => a[0] - b[0]); const want = new Set(cand.slice(0, HERO_POOL).map((c) => c[1])); if (this.selected) want.add(this.selected.index);
    let changed = false;
    for (const rk of this.pool) if (rk.index >= 0 && !want.has(rk.index)) { o.hidden.delete(rk.index); this.applyInstance(rk.index); o.assign.delete(rk.index); rk.release(); changed = true; }
    for (const i of want) if (!o.assign.has(i)) {
      const rk = this.pool.find((p) => p.index < 0); if (!rk) break;
      const [x, z] = o.rackPos[i], r = Math.floor(i / o.cols), c = i % o.cols, gpu = o.rackGpu[i];
      const G = GPUS[gpu], n = perRack(gpu, this.f.cfg.dens);
      rk.setTarget(i, x, z, `${rowName(r)}-${String(c + 1).padStart(2, "0")}`, G.form === "nvl" ? `${G.node} · ${n} GPUs` : `${Math.max(1, Math.floor(n / 8))}× ${G.node} · ${n} GPUs`, gpu, G, n);
      rk.apply(this.rackLive(i, live), load, o.faultRacks.has(i), o.heat); if (this.thermal) rk.setThermal(true);
      o.assign.set(i, rk); o.hidden.add(i); this.applyInstance(i); changed = true;
    }
    if (changed) this.flushInst();
  }
  rackLive(i, live) { const o = this.o; return live && !o.downRows.has(Math.floor(i / o.cols)); }
  flushInst() { const o = this.o; o.rackMesh.instanceMatrix.needsUpdate = true; o.trayMesh.instanceMatrix.needsUpdate = true; o.ledMesh.instanceMatrix.needsUpdate = true; }

  // ------------------------------------------------------------ navigation
  flyPath(legs) { this.flight = { legs, i: 0 }; this.startLeg(); }
  startLeg() { const F = this.flight, L = F.legs[F.i]; F.t = 0; F.done = false; F.fp = this.camera.position.clone(); F.ft = this.controls.target.clone(); L.onStart && L.onStart(); this.stage(L.label || ""); }
  flyTo(pos, target, dur = 1.6, lift = 0, label = "", onStart) { this.flyPath([{ pos: pos.clone(), target: target.clone(), dur, lift, label, onStart }]); }
  stepFlight(dt) {
    const F = this.flight, L = F.legs[F.i]; F.t += dt; const u = Math.min(1, F.t / L.dur), e = ease(u);
    this.camera.position.lerpVectors(F.fp, L.pos, e); this.camera.position.y += Math.sin(Math.PI * e) * (L.lift || 0); this.controls.target.lerpVectors(F.ft, L.target, e);
    if (u >= 1 && !F.done) { F.done = true; L.onArrive && L.onArrive(); }
    if (F.t >= L.dur + (L.hold || 0)) { if (++F.i < F.legs.length) this.startLeg(); else { this.flight = null; setTimeout(() => !this.flight && this.stage(""), 900); } }
  }
  setInside(v) { const o = this.o; if (!o) return; o.inside = v; for (const w of o.walls) w.material = v ? o.wallIn : o.wallMat; o.roof.material = v ? o.wallIn : o.wallMat; this.scene.fog.near = v ? 60 : 220; this.scene.fog.far = v ? 260 : 640; this.grid.visible = !v; }
  goCampus() { const v = this.o.views.campus; this.mode = "campus"; if (this.selected) { this.selected.setOpen(false); this.selected = null; } this.flyPath([{ pos: v.pos.clone(), target: v.target.clone(), dur: 2.2, lift: 10, label: "CAMPUS OVERVIEW", onStart: () => this.setInside(false) }]); this.navState(); }
  goHall() { const v = this.o.views.hall; this.mode = "hall"; this.flyPath([{ pos: v.pos.clone(), target: v.target.clone(), dur: 2.4, lift: 6, label: `DATA HALL · ROW A · ${GPU_NAME[this.o.rowGpu[0]]}`, onStart: () => this.setInside(true) }]); this.navState(); }
  goElec() { const v = this.o.views.elec; this.mode = "elec"; this.flyPath([{ pos: v.pos.clone(), target: v.target.clone(), dur: 2.4, lift: 6, label: "ELECTRICAL ROOM · 480 V", onStart: () => this.setInside(true) }]); this.navState(); }
  goRow(r) { const o = this.o, z = o.z0 + r * 2.6 + 1.3; const wasOut = this.mode === "campus"; this.mode = "hall"; this.flyPath([{ pos: new THREE.Vector3(o.x0 - 3, 1.7, z), target: new THREE.Vector3(o.x0 + 14, 1.2, z - .4), dur: 1.8, lift: wasOut ? 6 : 1.5, label: `ROW ${rowName(r)} · ${Math.min(o.cols, o.racks - r * o.cols)} RACKS · ${GPU_NAME[o.rowGpu[r]]}`, onStart: () => this.setInside(true) }]); this.navState(); }
  select(rk) {
    if (this.selected && this.selected !== rk) this.selected.setOpen(false);
    if (!rk) { const was = this.selected; this.selected = null; if (was && was.index >= 0) this.goRow(Math.floor(was.index / this.o.cols)); else this.navState(); return; }
    this.selected = rk; this.mode = "rack"; this.setInside(true);
    const c = rk.group.getWorldPosition(new THREE.Vector3());
    this.flyPath([
      { pos: c.clone().add(new THREE.Vector3(2.2, .9, 1.45)), target: c.clone().add(new THREE.Vector3(0, -.2, .2)), dur: 1.4, lift: .3, hold: .2, label: `1 / 2 · RACK ${rk.tag}` },
      { pos: c.clone().add(new THREE.Vector3(1.6, 1.75, 2.4)), target: c.clone().add(new THREE.Vector3(0, .55, .35)), dur: 1.4, hold: .6, label: `2 / 2 · ${rk.tag} · ${rk.sub}`, onStart: () => rk.setOpen(true) },
    ]);
    this.navState();
  }
  navState() { document.querySelectorAll(".hudnav button[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === (this.mode === "rack" ? "hall" : this.mode))); }

  // ------------------------------------------------------------ thermal
  setThermal(on) { this.thermal = on; document.body.classList.toggle("thermal", on); $id("thermalBtn").classList.toggle("on", on); this.thermalMats(on); }
  thermalMats(on) {
    const o = this.o; if (!o) return;
    this.scene.background.copy(on ? TBG : this.BG); this.scene.fog.color.copy(on ? TBG : this.BG);
    const instanced = new Set([o.rackMesh, o.trayMesh]);
    this.scene.traverse((x) => {
      if (!x.isMesh || !x.userData.static) return;
      if (on) { if (!x.userData.orig) x.userData.orig = x.material; x.material = instanced.has(x) ? (x.userData.tmat || (x.userData.tmat = tempMaterial(24, true))) : tempMaterial(x.userData.temp ?? (24 + x.getWorldPosition(new THREE.Vector3()).y * .4)); }
      else if (x.userData.orig) { if (!instanced.has(x)) x.material.dispose(); x.material = x.userData.orig; x.userData.orig = null; }
    });
    if (on) { o.colorSave = { r: o.rackMesh.instanceColor.array.slice(), t: o.trayMesh.instanceColor.array.slice() }; this.writeRackTemps(); }
    else if (o.colorSave) { o.rackMesh.instanceColor.array.set(o.colorSave.r); o.trayMesh.instanceColor.array.set(o.colorSave.t); o.rackMesh.instanceColor.needsUpdate = true; o.trayMesh.instanceColor.needsUpdate = true; o.colorSave = null; }
    o.rackMesh.castShadow = !on; o.trayMesh.castShadow = !on;
    for (const rk of this.pool) rk.setThermal(on);
  }
  writeRackTemps() {
    const o = this.o, load = this.f.plan.util, live = o.live;
    const rc = o.rackMesh.instanceColor.array, tc = o.trayMesh.instanceColor.array;
    const rise = 1 + o.heat * .6;
    for (let i = 0; i < o.racks; i++) { const inst = i < o.installed, lv = o.downRows.has(Math.floor(i / o.cols)) ? 0 : live, flt = o.faultRacks.has(i); const tR = tnorm(flt ? 40 : inst ? 24 + lv * 12 * load * rise : 20); rc[i * 3] = rc[i * 3 + 1] = rc[i * 3 + 2] = tR; for (let j = 0; j < 8; j++) { const tT = tnorm(flt ? 78 : inst ? 26 + lv * 36 * load * rise * (.85 + .3 * (((i * 7919 + j * 131) % 13) / 13)) : 20); const k = (i * 8 + j) * 3; tc[k] = tc[k + 1] = tc[k + 2] = tT; } }
    o.rackMesh.instanceColor.needsUpdate = true; o.trayMesh.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------ incidents: visuals, responders and repair progress
  incWhere(inc) { const o = this.o; return inc.kind === "leak" ? `ROW ${rowName(inc.row)}` : inc.kind === "rack" ? `RACK ${rowName(Math.floor(inc.rack / o.cols))}-${String(inc.rack % o.cols + 1).padStart(2, "0")}` : inc.kind === "power" ? "UTILITY FEEDER" : "ROOF CHILLER"; }
  incTarget(inc) {
    const o = this.o;
    if (inc.kind === "leak") { const v = this.inc.get(inc.id); return [v ? v.x : o.x0 + o.L / 2, o.z0 + inc.row * 2.6 + 1.3]; }
    if (inc.kind === "rack") { const [x, z] = o.rackPos[inc.rack]; return [x, z + 1.3]; }
    if (inc.kind === "power") return [-(o.W / 2 + 28), -o.D / 4];
    const i = Math.max(0, o.chillerDown); return [-o.W / 2 + 6 + i * ((o.W - 12) / Math.max(1, o.roofUnits.length - 1)), o.zOff - o.DT / 2 + 3];
  }
  route(from, [tx, tz]) { const left = this.o.x0 - 2.5; return [[left, from.z], [left, tz], [tx, tz]]; }
  gotoIncident(inc) { if (inc.kind === "leak") this.goRow(inc.row); else if (inc.kind === "rack") { const rk = this.o.assign.get(inc.rack); if (rk) this.select(rk); else this.goRow(Math.floor(inc.rack / this.o.cols)); } else this.goCampus(); }
  addStatic(m, temp) { m.userData.static = true; m.userData.temp = temp; if (this.thermal) { m.userData.orig = m.material; m.material = tempMaterial(temp); } return m; }
  marker(color) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(2.4); this.g.add(s); return s; }
  baseMat(m) { return m.userData.orig || m.material; }
  fixtureLight(hex, inten) { const fm = this.baseMat(this.o.fixtures); if (fm.emissive) { fm.emissive.setHex(hex); fm.emissiveIntensity = inten; } }
  spawnVisual(inc) {
    const o = this.o, v = { inc, kind: inc.kind, t: 0, objs: [], crew: [], arrived: false, dispatchT: 0 };
    if (inc.kind === "leak") {
      inc.row = Math.min(inc.row, o.rows - 1); v.x = o.x0 + 2 + Math.random() * Math.max(1, o.L - 4); v.z = o.z0 + inc.row * 2.6 + .5;
      const pud = new THREE.Mesh(new THREE.CircleGeometry(1, 28), stdM(0x16304a, .08, .35, { transparent: true, opacity: .85 })); pud.rotation.x = -HALF_PI; pud.position.set(v.x, .012, v.z); pud.scale.setScalar(.05); pud.receiveShadow = true; this.addStatic(pud, 17); this.g.add(pud); v.puddle = pud; v.objs.push(pud);
      v.drips = []; for (let k = 0; k < 5; k++) { const d = new THREE.Mesh(new THREE.SphereGeometry(.03, 6, 5), stdM(0x6fb3ff, .2, .2)); d.position.set(v.x + (Math.random() - .5) * .5, 2.7, v.z - .1 + Math.random() * .2); d.userData.v = Math.random(); this.g.add(d); v.drips.push(d); v.objs.push(d); }
      o.downRows.add(inc.row); this.setRowLeds(inc.row); v.mark = this.marker(0x3aa0ff); v.mark.position.set(v.x, 2.9, v.z);
    } else if (inc.kind === "rack") {
      inc.rack = Math.min(inc.rack, Math.max(0, o.installed - 1)); o.faultRacks.add(inc.rack); const [x, z] = o.rackPos[inc.rack]; v.mark = this.marker(0xff5f6e); v.mark.position.set(x, 2.9, z);
    } else if (inc.kind === "power") {
      o.powerOut = true; o.gensOn = false; v.mark = this.marker(0xff5f6e); v.mark.position.set(-(o.W / 2 + 34), 8, -o.D / 4);
      v.smoke = []; for (const gn of o.gens) for (let k = 0; k < 2; k++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0x7a8088, transparent: true, opacity: 0, depthWrite: false })); s.scale.setScalar(2); s.position.copy(gn.position).add(new THREE.Vector3(0, 5.5 + k * 1.5, -3)); s.userData.gn = gn; s.userData.k = k; this.g.add(s); v.smoke.push(s); v.objs.push(s); }
    } else {
      o.chillerDown = Math.floor(Math.random() * o.roofUnits.length); const u = o.roofUnits[o.chillerDown]; const um = this.baseMat(u); if (um.emissive) { um.emissive.setHex(0xff2a2a); um.emissiveIntensity = .9; } v.unit = u; v.mark = this.marker(0xff5f6e); v.mark.position.copy(u.position).add(new THREE.Vector3(0, 2.2, 0));
    }
    v.objs.push(v.mark); if (this.thermal) this.writeRackTemps();
    return v;
  }
  removeVisual(v) {
    const o = this.o; for (const m of v.objs) { this.g.remove(m); if (m.material && !m.userData.shared) m.material.dispose(); }
    for (const w of v.crew) w.release();
    if (v.kind === "leak") o.downRows.delete(v.inc.row);
    else if (v.kind === "rack") o.faultRacks.delete(v.inc.rack);
    else if (v.kind === "power") { o.powerOut = false; o.gensOn = false; this.fixtureLight(0xffffff, 2); for (const gn of o.gens) { const sm = this.baseMat(gn.children[1]); if (sm.emissive) sm.emissiveIntensity = 0; } }
    else { if (v.unit) { const um = this.baseMat(v.unit); if (um.emissive) um.emissiveIntensity = 0; } o.chillerDown = -1; }
    if (this.thermal) this.writeRackTemps();
  }
  setRowLeds(r) { const o = this.o; for (let i = r * o.cols; i < Math.min(o.racks, (r + 1) * o.cols); i++) for (let j = 0; j < 8; j++) o.ledMesh.setColorAt(i * 8 + j, o.colOff); o.ledMesh.instanceColor.needsUpdate = true; }
  dispatchVisual(v) {
    const free = this.o.staff.filter((w) => !w.held && w.m.visible); const techs = free.filter((w) => !w.m.userData.lamp).slice(0, 2), bots = free.filter((w) => w.m.userData.lamp).slice(0, 1);
    const tgt = this.incTarget(v.inc);
    [...techs, ...bots].forEach((w, k) => { const off = [[.6, .3], [-.6, .3], [0, -.5]][k]; w.assign(this.route(w.m.position, [tgt[0] + off[0], tgt[1] + off[1]]), v.inc.id); v.crew.push(w); });
    v.dispatchT = 0; if (!v.crew.length) v.arrived = true;
    if (v.kind === "leak") {
      for (let k = 0; k < 4; k++) { const a = k / 4 * 6.283; const c = new THREE.Mesh(new THREE.ConeGeometry(.16, .5, 10), stdM(0xff7a1a, .6, 0)); c.position.set(v.x + Math.cos(a) * 1.6, .25, v.z + Math.sin(a) * 1.6); c.castShadow = true; this.addStatic(c, 24); this.g.add(c); v.objs.push(c); }
      const vac = new THREE.Mesh(new THREE.CylinderGeometry(.24, .26, .6, 14), stdM(0xf0c23b, .5, .1)); vac.position.set(v.x + 1.1, .3, v.z + .9); vac.castShadow = true; this.addStatic(vac, 30); this.g.add(vac); v.objs.push(vac);
    }
  }
  syncIncidents(f, dt, t, staffed) {
    const o = this.o, list = f.incidents || [], seen = new Set();
    for (const inc of list) {
      seen.add(inc.id); inc.viewed = true;
      let v = this.inc.get(inc.id); if (!v) { v = this.spawnVisual(inc); this.inc.set(inc.id, v); }
      v.t += dt;
      if (inc.dispatched && !v.crew.length && !v.arrived && staffed) this.dispatchVisual(v);
      if (v.crew.length && !v.arrived) { v.dispatchT += dt; v.arrived = v.crew.every((w) => w.arrived) || v.dispatchT > 26; }
      if (inc.dispatched && (v.arrived || !staffed) && inc.progress < 1) { inc.progress = Math.min(1, inc.progress + dt / INC.defs[inc.kind].repairSec); if (inc.progress >= 1) { INC.resolve(f, inc); continue; } }
      if (v.kind === "leak") {
        const grow = inc.dispatched ? Math.max(.3, 2.2 * (1 - inc.progress)) : Math.min(2.2, .05 + v.t * .05); v.puddle.scale.setScalar(grow);
        for (const d of v.drips) { if (inc.progress > .5) { d.visible = false; continue; } d.userData.v += dt * 1.6; if (d.userData.v > 1) d.userData.v = 0; d.position.y = 2.7 - d.userData.v * d.userData.v * 2.7; }
      } else if (v.kind === "power") {
        if (!o.gensOn && v.t > 7) { o.gensOn = true; for (const gn of o.gens) { const sm = this.baseMat(gn.children[1]); if (sm.emissive) { sm.emissive.setHex(0xff6a1a); sm.emissiveIntensity = .8; } } }
        this.fixtureLight(o.gensOn ? 0xffd9a8 : 0xff2a2a, o.gensOn ? 1.2 : .25);
        for (const s of v.smoke) { if (!o.gensOn || !s.userData.gn.visible) { s.material.opacity = 0; continue; } const u = (t * .5 + s.userData.k * .5) % 1; s.position.y = 5.5 + u * 5; s.material.opacity = .22 * (1 - u); s.scale.setScalar(1.5 + u * 3); }
      } else if (v.kind === "chiller") {
        o.heat = Math.min(1, Math.max(0, o.heat + dt * (inc.progress >= .75 ? -.08 : .02))); const um = this.baseMat(v.unit); if (um.emissive) um.emissiveIntensity = inc.progress >= .75 ? 0 : .5 + .5 * Math.sin(t * 5);
      }
      if (v.mark) { v.mark.material.opacity = .5 + .4 * Math.sin(t * 4); v.mark.scale.setScalar(2 + .4 * Math.sin(t * 4)); }
    }
    for (const [id, v] of this.inc) if (!seen.has(id)) { this.removeVisual(v); this.inc.delete(id); }
    if (o.chillerDown < 0 && o.heat > 0) o.heat = Math.max(0, o.heat - dt * .08);
    this.renderIncidentHud(f, staffed);
  }
  renderIncidentHud(f, staffed) {
    const el = $id("incList"), list = f.incidents || []; const key = list.map((i) => `${i.id}:${i.dispatched ? 1 : 0}:${Math.round(i.progress * 40)}:${(this.inc.get(i.id) || {}).arrived ? 1 : 0}`).join("|") + (staffed ? "L" : "");
    if (key === this._incKey) return; this._incKey = key;
    $id("hudInc").classList.toggle("off", !staffed);
    el.innerHTML = list.length ? list.map((inc) => {
      const D = INC.defs[inc.kind], v = this.inc.get(inc.id), step = Math.min(D.steps.length - 1, Math.floor(inc.progress * D.steps.length));
      const status = !inc.dispatched ? "unattended · site crews respond within a month" : v && !v.arrived && staffed ? "crew en route" : `${step + 1}/${D.steps.length} · ${D.steps[step]}`;
      return `<div class="inc${inc.dispatched ? " on" : ""}"><div class="inc-h"><b data-goto="${inc.id}">${D.name} · ${this.incWhere(inc)}</b>${inc.dispatched ? "" : `<button type="button" data-dispatch="${inc.id}">Dispatch crew</button>`}</div><span>${status}</span><div class="bar"><i style="width:${Math.round(inc.progress * 100)}%"></i></div></div>`;
    }).join("") : `<span class="none">${staffed ? "No active incidents. Simulate one to watch it get found and fixed." : "Incidents can be simulated once the site is live."}</span>`;
  }

  // ------------------------------------------------------------ per frame
  frame() {
    const S = getS();
    const f = this.f, o = this.o; if (!f || !o) return;
    const dt = Math.min(.05, this.clock.getDelta()), t = this.clock.elapsedTime;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (w && h && (w !== this.w || h !== this.h)) { this.w = w; this.h = h; this.renderer.setSize(w, h, false); this.css.setSize(w, h); this.tcam.resize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    const tM = S.month - f.start, sch = schedule(f.dur), tgt = (k) => clampN((tM - sch[k].s) / f.dur[k], 0, 1);
    for (const k in o.p) o.p[k] = mix(o.p[k], tgt(k), .06);
    const live = f.status === "live"; o.live = mix(o.live, live ? 1 : 0, .04);
    const { W, H, p } = o;
    o.pad.scale.x = Math.max(.001, p.civil); o.slab.scale.x = Math.max(.001, p.civil); o.pad.visible = o.slab.visible = p.civil > .01;
    o.trafos.forEach((tr, i) => { const s = clampN(p.inter * 3 - i, 0, 1); tr.scale.y = Math.max(.001, s); tr.visible = s > .01; });
    const wired = p.inter > .98; o.poles.forEach((pl) => pl.visible = wired); o.wire.visible = wired;
    o.gens.forEach((gn, i) => gn.visible = p.mep > .3 + .6 * i / o.gens.length); o.tanks.forEach((tk) => tk.visible = p.mep > .5);
    const shellUp = p.shell > .01; for (const wl of o.walls) { wl.visible = shellUp; wl.scale.y = Math.max(.001, p.shell); wl.position.y = H * p.shell / 2; }
    o.roof.visible = p.shell > .99 && !o.inside; o.edges.visible = shellUp; o.edges.scale.y = Math.max(.001, p.shell); o.edges.position.y = H * p.shell / 2;
    o.roofUnits.forEach((c, i) => c.visible = p.shell > .99 && !o.inside && p.mep > i / o.roofUnits.length);
    o.towers.forEach((tw, i) => tw.visible = p.mep > i / o.towers.length);
    o.fans.forEach((fn, i) => { fn.visible = p.mep > i / o.fans.length; if (fn.material.emissiveIntensity != null) fn.material.emissiveIntensity = o.live * .9; fn.rotation.y += o.live * .3 * (o.chillerDown >= 0 ? 0 : 1); });
    const fit = p.mep; o.trays.visible = fit > .1; o.busway.visible = fit > .25; o.pipes.visible = o.pipesHot.visible = fit > .35; o.cdus.visible = fit > .45; o.pdus.visible = fit > .4; o.fixtures.visible = fit > .6; o.gal.visible = fit > .15;
    o.crahs.forEach((u, i) => u.visible = fit > .3 + .6 * i / o.crahs.length);
    // racks install in order; trays drop into place
    const want = Math.round(p.racks * o.racks);
    if (want !== o.installed) {
      const prev = Math.max(0, o.installed); o.installed = want;
      for (let i = prev; i < want; i++) { o.dropping.set(i, t); const gpu = o.rackGpu[i]; for (let j = 0; j < 8; j++) o.ledMesh.setColorAt(i * 8 + j, o.colOff); o.trayMesh.setColorAt(i * 8, o.gpuCol[gpu].clone().multiplyScalar(.35).add(new THREE.Color(0x2a3036))); }
      this.applyInstanceAll(); o.trayMesh.instanceColor.needsUpdate = true;
      if (this.thermal) this.writeRackTemps();
    }
    if (o.dropping.size) { for (const [i, t0] of o.dropping) { const u = (t - t0) / .7; if (u >= 1) { o.dropping.delete(i); this.applyInstance(i); } else this.applyInstance(i, 1.6 * (1 - ease(u))); } this.flushInst(); }
    // LEDs blink per GPU color once live
    if (!this.thermal && o.live > .02 && o.installed > 0) {
      const n = Math.min(o.installed * 8, 240); for (let k = 0; k < n; k++) { const idx = Math.floor(Math.random() * o.installed * 8); const i = Math.floor(idx / 8); if (o.downRows.has(Math.floor(i / o.cols))) { o.ledMesh.setColorAt(idx, o.colOff); continue; } if (o.faultRacks.has(i)) { o.ledMesh.setColorAt(idx, Math.random() < .8 ? o.colOff : o.colRed); continue; } o.ledMesh.setColorAt(idx, Math.random() < .25 ? o.colOff : o.gpuCol[o.rackGpu[i]]); }
      o.ledMesh.instanceColor.needsUpdate = true; o.trayMesh.material.emissiveIntensity = 0;
    } else if (!this.thermal && o.lastLive && o.live <= .02) { for (let k = 0; k < o.installed * 8; k++) o.ledMesh.setColorAt(k, o.colOff); o.ledMesh.instanceColor.needsUpdate = true; }
    o.lastLive = o.live > .02;
    const load = f.plan.util;
    if (o.poolTick <= 0) { o.poolTick = .4; this.updatePool(live, load); } else o.poolTick -= dt;
    for (const rk of this.pool) if (rk.index >= 0) { const rl = this.rackLive(rk.index, live), flt = o.faultRacks.has(rk.index); if (rk.state.live !== rl || rk.fault !== flt || Math.abs((rk.state.heat || 0) - o.heat) > .05) rk.apply(rl, load, flt, o.heat); rk.update(dt, t); }
    o.glow.intensity = o.inside ? 0 : o.live * 120 * (o.powerOut && !o.gensOn ? .1 : 1);
    const craneOn = p.civil > .2 && p.shell < .995; o.crane.visible = craneOn;
    if (craneOn) { o.jib.rotation.y = Math.sin(t * .25) * 1.2; o.hook.position.y = -6 - Math.abs(Math.sin(t * .5)) * H * .8; o.hookLine.geometry.setFromPoints([new THREE.Vector3(-W * .5, 0, 0), new THREE.Vector3(-W * .5, o.hook.position.y, 0)]); }
    const working = !live && p.permit > .5;
    for (const c of o.crew) { c.m.visible = working; if (working) c.update(dt, t); }
    const staffed = live && p.comm > .5;
    for (const s of o.staff) { s.m.visible = staffed; if (staffed) s.update(dt, t); }
    this.syncIncidents(f, dt, t, staffed);
    const trucksOn = !live && (p.civil > 0 || p.racks > 0) && p.racks < 1;
    for (const tr of o.trucks) { tr.visible = trucksOn; if (!trucksOn) continue; tr.position.x += tr.userData.dir * .6; if (tr.position.x > 300) tr.position.x = -300; if (tr.position.x < -300) tr.position.x = 300; tr.rotation.y = tr.userData.dir > 0 ? 0 : Math.PI; }
    if (o.gal.visible && !this.thermal) o.props.update(dt, t);
    const cp = this.camera.position; for (const l of this.labels) { const row = l.userData.row; l.visible = o.inside && (row == null ? o.gal.visible && this.mode !== "rack" : (row * o.cols < o.installed)) && l.getWorldPosition(new THREE.Vector3()).distanceTo(cp) < (row == null ? 22 : 34); }
    if (this.flight) this.stepFlight(dt);
    else {
      this.idle += dt;
      if (this.mode === "campus" && !this.selected && this.idle > 3 && !REDUCE) {
        const T = o.views.campus.target, off = this.camera.position.clone().sub(T); if (this.droneA === null) this.droneA = Math.atan2(off.z, off.x); this.droneA += dt * .035;
        const R = Math.hypot(off.x, off.z); const dp = new THREE.Vector3(T.x + Math.cos(this.droneA) * R, this.camera.position.y + Math.sin(t * .31) * .1, T.z + Math.sin(this.droneA) * R);
        const k = 1 - Math.exp(-dt * .9); this.camera.position.lerp(dp, k);
      }
    }
    this.controls.update();
    if (this.thermal) { if (!this._tt || t - this._tt > 1) { this._tt = t; this.writeRackTemps(); for (const rk of this.pool) if (rk.index >= 0) rk.refreshThermal(); } this.tcam.render(this.scene, this.camera, t); } else this.renderer.render(this.scene, this.camera);
    this.css.render(this.scene, this.camera);
    const total = sch.comm.e, cur = PHASES.find(([k]) => tgt(k) < 1 && tM >= sch[k].s);
    $id("hudPhase").textContent = live ? `live · ${f.plan.facMW.toFixed(0)} MW · PUE ${f.plan.pue.toFixed(2)} · ${o.rows} rows · ${f.plan.gpuLabel || ""}` : (cur ? `${cur[1]} · ${(tgt(cur[0]) * 100).toFixed(0)}% · month ${Math.min(tM, total)} of ${total}` : "waiting on permits");
    if (staffed) { $id("hudPeople").textContent = `● ${o.staff.filter((s) => !s.m.userData.lamp).length} technicians on the floor`; $id("hudRobots").textContent = `■ ${o.staff.filter((s) => s.m.userData.lamp).length} robots patrolling`; }
    else { $id("hudPeople").textContent = `● ${fmtN(f.plan.people)} people`; $id("hudRobots").textContent = `■ ${fmtN(Math.round(f.cfg.crew * f.cfg.robots / 100))} robots`; }
  }
}

let site = null;
return {
  T: { fid: null },
  ensure(f) { if (!site) { site = new Site($id("site3dhost")); if (typeof window !== "undefined") window.__atlasSite = site; } if (site.fid !== f.id) { site.build(f); this.T.fid = f.id; } },
  frame() { if (site) site.frame(); },
  dispose() { if (site) { if (site.f) for (const i of site.f.incidents || []) i.viewed = false; site.dispose(); } site = null; },
};
}
