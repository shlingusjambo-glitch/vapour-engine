import { compose, multiplyMat4, type Mat4 } from "@vapour/math";
import type { GltfAsset } from "@vapour/engine";

export interface PlacedAsset { readonly asset: string; readonly matrix: Mat4; }
export interface DistrictCell { readonly id: string; readonly center: readonly [number, number]; readonly placements: readonly PlacedAsset[]; }
const place = (asset: string, x: number, z: number, yaw = 0, scale = 1): PlacedAsset => ({ asset, matrix: compose([x, 0, z], [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], [scale, scale, scale]) });

export const DISTRICT: readonly DistrictCell[] = [
  { id: "breakwater", center: [0, 0], placements: [
    place("road",0,0), place("road",0,-32), place("road",0,32), place("sidewalk",-10,0), place("sidewalk",10,0,Math.PI),
    place("hotel",-23,-3,Math.PI/2), place("storefront",21,-7,-Math.PI/2), place("palm",-9,-12), place("palm",9,14,.4),
    place("streetlight",-8,-8), place("streetlight",8,8,Math.PI), place("bench",-10,9,Math.PI/2), place("bollard",10,-13)
  ]},
  { id: "warehouse-row", center: [0, -64], placements: [
    place("road",0,-64), place("road",0,-96), place("sidewalk",-10,-64), place("sidewalk",10,-64,Math.PI),
    place("warehouse",-23,-69,Math.PI/2), place("warehouse",23,-91,-Math.PI/2), place("streetlight",-8,-54), place("streetlight",8,-78,Math.PI),
    place("palm",-9,-83), place("bollard",10,-50), place("bollard",10,-53), place("bollard",10,-56)
  ]},
  { id: "hotel-bend", center: [0, 64], placements: [
    place("road",0,64), place("road",0,96), place("sidewalk",-10,64), place("sidewalk",10,64,Math.PI),
    place("hotel",23,70,-Math.PI/2), place("storefront",-21,91,Math.PI/2), place("palm",-9,50,.2), place("palm",9,78,-.25),
    place("streetlight",-8,55), place("streetlight",8,89,Math.PI), place("bench",10,70,-Math.PI/2)
  ]}
];

export function visibleCells(position: readonly [number, number, number], radius = 78): readonly DistrictCell[] {
  return DISTRICT.filter(cell => Math.hypot(cell.center[0] - position[0], cell.center[1] - position[2]) < radius);
}
export function drawCell(cell: DistrictCell, assets: ReadonlyMap<string, GltfAsset>, draw: (asset: GltfAsset, matrix: Mat4) => void): void {
  for (const placed of cell.placements) { const asset = assets.get(placed.asset); if (asset) draw(asset, placed.matrix); }
}
