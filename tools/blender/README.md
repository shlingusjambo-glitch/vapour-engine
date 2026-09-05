# Blender → Vapour: Port Solace kit

Generate the complete original asset kit with Blender 4.5+ or 5.x:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/blender/generate_coastal.py -- \
  --output examples/coastal-city/public/assets --render
```

`--render` adds an offline asset proof image. It is an authoring preview, not a game screenshot. Without it, only the runtime GLBs, manifest, material images and editable `.blend` are produced. `--only sedan,hotel` is useful for authoring iteration but produces a manifest containing only those assets; regenerate the full kit before committing.

The script creates every mesh and pixel locally using Blender and seeded NumPy operations. It does not fetch or depend on any third-party asset. It exports self-contained glTF 2.0 GLBs with PNG albedo and tangent-space detail normals, UV0, material regions and authored normals. No Draco or meshopt decoder is required. Model modifiers are applied before export. Static pieces are joined by asset, preserving material slots; the renderer can batch instances of each exported material primitive.

## Coordinate contract

- Units: metres. GLB uses standard Y-up. All geometry is authored Z-up and converted by Blender's exporter.
- Architecture front: glTF +Z. Road length: Z; width: X. Ground contact: Y=0.
- Road: 14 × 32m. Four lanes are approximately 3.5m wide. Sidewalk: 3 × 32m plus a 22cm curb on local -X.
- Sedan forward: glTF -Z. Overall body length: 4.68m. Wheelbase: 2.78m. Its four wheel nodes are `wheel_front_left`, `wheel_front_right`, `wheel_rear_left`, `wheel_rear_right`.
- Wheel nodes retain local axle origins. Use node transforms rather than translating individual mesh vertices. Other geometry is grouped into `sedan_body`.
- Static node names begin with the asset ID. Nodes can have a non-zero translation: the glTF node hierarchy is part of the asset and must be honored.

## Manifest

`manifest.json` contains `version`, `units`, `upAxis`, `vehicleForward`, `buildingFront` and an `assets` array. Each asset has:

```json
{
  "id": "sedan",
  "file": "sedan.glb",
  "lodFile": "sedan_lod1.glb",
  "triangles": 24000,
  "bounds": { "min": [-1, 0, -2.4], "max": [1, 1.5, 2.4] },
  "colliders": [{ "center": [0, 0.74, 0], "halfExtents": [0.94, 0.58, 2.28] }],
  "description": "..."
}
```

Numbers above illustrate the schema; consume measured values in the generated manifest. Bounds and colliders use glTF coordinates. Colliders are intentionally inexpensive axis-aligned approximations; the long palm collider is conservative. Colliders are metadata, not invisible meshes embedded in the GLB.

LOD1 is a separate GLB exported with a 0.38 decimation ratio. Authoring preserves material boundaries but does not guarantee the requested triangle ratio on tiny objects. Do not draw both LODs simultaneously. Load LOD1 at distance; hysteresis belongs in the engine, not the asset generator.

## Validation

The generator must finish with `ASSET_KIT_COMPLETE`. Review `asset-proof.png` when present and inspect all asset imports using Vapour's own glTF parser. Rendering in Blender verifies authored geometry and materials only; runtime correctness requires a Vapour launch. Keep the `.blend` as editable source and the generator as the repeatable build recipe. The `.blend` arranges asset collections on a grid after export for convenient inspection.

After building `@vapour/engine`, run the asset contract check:

```sh
node tools/blender/validate-assets.mjs
```

This reads all twenty GLBs through Vapour's importer and checks finite positions/normals/UVs/tangents, index bounds, LOD triangle budgets, manifest bounds and the four wheel axle nodes. The exporter explicitly triangulates before asking Blender to calculate tangents; leaving ngon caps in the source can make Blender silently omit tangents for an entire mesh.
