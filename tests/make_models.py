"""Тестовые модели VRtrip (Тёма, 3D-технолог).
Запуск: python3 tests/make_models.py  →  файлы в tests/models/
Тяжёлые модели (heavy_*) генерируются, но не коммитятся (.gitignore)."""
import os, io, zipfile, math, sys
import numpy as np, trimesh

OUT = os.path.join(os.path.dirname(__file__), 'models')
os.makedirs(OUT, exist_ok=True)

def box(c, s):
    m = trimesh.creation.box(extents=s); m.apply_translation(c); return m

def building(floors=2, nx=4, ny=3, span=6.0, h=3.3):
    """Каркасное здание в метрах, Y — вверх. Возвращает {материал: [меши]}"""
    parts = {'concrete': [], 'columns': [], 'glass': [], 'wood': []}
    W, D = nx * span, ny * span
    for f in range(floors + 1):
        parts['concrete'].append(box([W / 2, f * h, D / 2], [W + 1, 0.3, D + 1]))
    for f in range(floors):
        for i in range(nx + 1):
            for j in range(ny + 1):
                parts['columns'].append(trimesh.creation.cylinder(radius=0.2, height=h - 0.3, sections=24,
                    transform=trimesh.transformations.compose_matrix(angles=[math.pi / 2, 0, 0], translate=[i * span, f * h + h / 2, j * span])))
        parts['glass'].append(box([W / 2, f * h + h / 2, 0], [W, h - 0.3, 0.05]))
    for k in range(12):                                   # stair
        parts['wood'].append(box([W + 1.5, 0.15 + k * h / 12, D - 1 - k * 0.3], [1.2, 0.3 + k * h / 12, 0.3]))
    return parts

COLORS = {'concrete': (0.82, 0.80, 0.76), 'columns': (0.15, 0.15, 0.17), 'glass': (0.55, 0.75, 0.85), 'wood': (0.72, 0.45, 0.22)}

def write_obj(path, parts, scale=1.0, zup=False, mtl=True):
    name = os.path.splitext(os.path.basename(path))[0]
    lines, off = [f'# VRtrip test model: {name}'], 1
    if mtl: lines.append(f'mtllib {name}.mtl')
    R = trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0]) if zup else np.eye(4)   # Y-up → Z-up like Rhino
    for mat, meshes in parts.items():
        m = trimesh.util.concatenate(meshes).copy(); m.apply_transform(R); m.apply_scale(scale)
        lines.append(f'o {mat}')
        if mtl: lines.append(f'usemtl {mat}')
        lines += [f'v {x:.4f} {y:.4f} {z:.4f}' for x, y, z in m.vertices]
        lines += [f'f {a + off} {b + off} {c + off}' for a, b, c in m.faces]
        off += len(m.vertices)
    open(path, 'w').write('\n'.join(lines) + '\n')
    if mtl:
        ml = []
        for mat, (r, g, b) in COLORS.items():
            ml += [f'newmtl {mat}', f'Kd {r} {g} {b}', 'd 0.35' if mat == 'glass' else 'd 1', '']
        open(os.path.join(os.path.dirname(path), name + '.mtl'), 'w').write('\n'.join(ml))

def scene(parts):
    s = trimesh.Scene()
    for mat, meshes in parts.items():
        m = trimesh.util.concatenate(meshes); m.visual = trimesh.visual.ColorVisuals(m, face_colors=[int(c * 255) for c in COLORS[mat]] + [255])
        s.add_geometry(m, node_name=mat, geom_name=mat)
    return s

def main(heavy=True):
    b = building()
    # 1. маленькая модель OBJ+MTL в метрах, Y-up
    write_obj(f'{OUT}/01_pavilion_m.obj', b)
    # 2. та же модель как из Rhino: Z-up, миллиметры
    write_obj(f'{OUT}/02_rhino_zup_mm.obj', b, scale=1000, zup=True)
    # 3. ZIP: OBJ + MTL внутри папки
    zb = io.BytesIO()
    with zipfile.ZipFile(zb, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(f'{OUT}/01_pavilion_m.obj', 'project/pavilion.obj')
        z.writestr('project/01_pavilion_m.mtl', open(f'{OUT}/01_pavilion_m.mtl').read())
        z.writestr('project/pavilion.mtl', open(f'{OUT}/01_pavilion_m.mtl').read())
    open(f'{OUT}/03_pavilion_zip.zip', 'wb').write(zb.getvalue())
    # 4. OBJ без MTL (ссылка на отсутствующий файл)
    write_obj(f'{OUT}/04_missing_mtl.obj', b); os.remove(f'{OUT}/04_missing_mtl.mtl')
    # 5–7. GLB, STL, PLY
    sc = scene(b)
    sc.export(f'{OUT}/05_pavilion.glb')
    big = building(floors=5, nx=8, ny=5)
    tower = trimesh.util.concatenate([m for v in big.values() for m in v]); tower.apply_scale(1000)
    tower.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0])); tower.export(f'{OUT}/06_tower_mm_zup.stl')
    trimesh.util.concatenate([m for v in b.values() for m in v]).export(f'{OUT}/07_pavilion.ply')
    # 8–9. битый и пустой файл
    open(f'{OUT}/08_broken.obj', 'w').write('v 1 2\nf 1 2 99\nэто не obj\x00\x01\n')
    open(f'{OUT}/09_empty.obj', 'w').write('')
    # 10. крошечная деталь в мм (проверка авто-единиц: 40 мм кубик)
    write_obj(f'{OUT}/10_tiny_part_mm.obj', {'wood': [box([20, 20, 20], [40, 40, 40])]})
    # 11. очень большая площадка в метрах (1.2 км) — проверка теней, отсечения, масштаба AR
    write_obj(f'{OUT}/11_masterplan_km.obj', {'concrete': [box([0, 0, 0], [1200, 1, 800])] + [box([x, 15, z], [40, 30, 40]) for x in range(-500, 501, 125) for z in range(-300, 301, 120)]})
    if heavy:   # тяжёлые: ~300k и ~1M треугольников (не в git)
        for name, k in (('heavy_300k', 18), ('heavy_1m', 33)):
            parts = {'concrete': [], 'columns': []}
            for i in range(k):
                for j in range(k):
                    s = trimesh.creation.icosphere(subdivisions=3, radius=0.4); s.apply_translation([i * 1.2, 0.4, j * 1.2])
                    parts['columns' if (i + j) % 2 else 'concrete'].append(s)
            write_obj(f'{OUT}/{name}.obj', parts)
    for f in sorted(os.listdir(OUT)):
        print(f'{os.path.getsize(os.path.join(OUT, f)) / 1024:9.1f} KB  {f}')

if __name__ == '__main__':
    main(heavy='--no-heavy' not in sys.argv)
