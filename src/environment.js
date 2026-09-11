// environment.js — окружение без текстур: PMREM от процедурной «комнаты»
// (тёмные стены, тёплая широкая панель сверху-справа, холодная узкая слева,
// багровый пол) и фоновая сфера с градиентом по направлению взгляда.
import * as THREE from 'three';

export function makeEnvironment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const room = new THREE.Scene();
  const add = (geom, color, pos, lookAt = true) => {
    const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(...pos);
    if (lookAt) m.lookAt(0, 0, 0);
    room.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(30, 30, 30), 0x0a0810, [0, 0, 0], false).material.side = THREE.BackSide;
  add(new THREE.PlaneGeometry(9, 5), new THREE.Color(0xffd9b8).multiplyScalar(2.2), [6, 8, 6]);       // ключ, тёплый
  add(new THREE.PlaneGeometry(2.5, 8), new THREE.Color(0x6d7fbf).multiplyScalar(1.6), [-11, 2, -3]);   // заполняющий, холодный
  add(new THREE.PlaneGeometry(5, 3), new THREE.Color(0xffc8b0).multiplyScalar(1.0), [-3, -6, -10]);    // контровой
  add(new THREE.PlaneGeometry(24, 24), 0x2a0d12, [0, -14, 0]);                                         // пол, багровый
  const env = pm.fromScene(room, 0.04).texture;
  pm.dispose();
  room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return env;
}

export function makeBackground() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { uTop: { value: new THREE.Color(0x0d0b12) }, uBottom: { value: new THREE.Color(0x2a0e15) } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uBottom;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        float k = smoothstep(-0.7, 0.6, vDir.y);
        vec3 c = mix(uBottom, uTop, k);
        // Виньетка: к краям чуть темнее.
        float edge = smoothstep(0.2, 1.0, abs(vDir.x));
        c *= 1.0 - 0.35 * edge;
        // Дизеринг против бандинга.
        c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}
