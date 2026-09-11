// highlight.js — подсветка структуры при наведении и выборе. Униформы
// MeshPhysicalMaterial загружаются при смене материала, поэтому середина пачки
// с общим материалом не обновилась бы; вместо этого мешам структуры на время
// подставляется вариант материала (та же программа, свои униформы).
import { makeTissueMaterial } from '../materials.js';

export function createHighlighter(engine, picker) {
  const variants = new Map(); // ключ: палитра + регион + сила → материал
  let n = 0;
  function variant(base, region, strength) {
    const p = base.userData.palette;
    const key = `${p.endo}-${p.depth}-${p.cap}-${p.sheen || 0}:${region}:${strength}`;
    let m = variants.get(key);
    if (!m) {
      m = makeTissueMaterial(p);
      m.userData.uniforms.uHighlight.value = strength;
      m.userData.uniforms.uHighlightRegion.value = region;
      engine.materials[`hl${n++}`] = m; // чтобы рентген и каркас затрагивали варианты
      variants.set(key, m);
    }
    m.transparent = base.transparent; m.opacity = base.opacity; m.depthWrite = base.depthWrite; m.wireframe = base.wireframe;
    m.userData.uniforms.uCapMode.value = base.userData.uniforms.uCapMode.value;
    return m;
  }
  const applied = new Map(); // mesh → { material, tint }
  function applyTo(list, strength) {
    for (const { mesh, regions } of list) {
      if (mesh.material.isShaderMaterial && mesh.material.uniforms.uBase) {
        if (!applied.has(mesh)) applied.set(mesh, { tint: mesh.material.uniforms.uBase.value.clone() });
        mesh.material.uniforms.uBase.value.copy(applied.get(mesh).tint).lerp({ r: 0.85, g: 0.93, b: 1 }, strength);
        continue;
      }
      if (!mesh.material.userData || !mesh.material.userData.palette) continue;
      const base = applied.has(mesh) ? applied.get(mesh).material : mesh.material;
      if (!applied.has(mesh)) applied.set(mesh, { material: base });
      const region = regions && regions.length === 1 ? regions[0] : -1;
      mesh.material = variant(base, region, strength);
    }
  }
  function restoreAll() {
    for (const [mesh, st] of applied) {
      if (st.tint) mesh.material.uniforms.uBase.value.copy(st.tint);
      else mesh.material = st.material;
    }
    applied.clear();
  }
  let hover = null, selected = null;
  function refresh() {
    restoreAll();
    if (hover && hover !== selected) applyTo(picker.targetsOf.get(hover) || [], 0.55);
    if (selected) applyTo(picker.targetsOf.get(selected) || [], 1);
  }
  return {
    setHover(id) { if (id === hover) return; hover = id; refresh(); },
    setSelected(id) { if (id === selected) return; selected = id; refresh(); },
    get hover() { return hover; }, get selected() { return selected; },
  };
}
