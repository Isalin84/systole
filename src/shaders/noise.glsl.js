// noise.glsl.js — процедурный шум для шейдеров. Без текстур: hash →
// value-noise 3D → fbm (3 октавы). Координаты — сантиметры сцены.
export const NOISE_GLSL = /* glsl */`
float sysHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float sysNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(sysHash(i + vec3(0, 0, 0)), sysHash(i + vec3(1, 0, 0)), f.x),
        mix(sysHash(i + vec3(0, 1, 0)), sysHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(sysHash(i + vec3(0, 0, 1)), sysHash(i + vec3(1, 0, 1)), f.x),
        mix(sysHash(i + vec3(0, 1, 1)), sysHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Три октавы, результат ~[0, 0.875], среднее ~0.44.
float sysFbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * sysNoise(p); p = p * 2.03 + vec3(1.7, 9.2, 4.1); a *= 0.5; }
  return s;
}
`;
