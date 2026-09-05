/** Generates the village and prints what it produced. */
import { VILLAGE, generateVillage, previewMesh } from "./environment.js";
import { meshStats } from "@vapour/assetgen";

const village = generateVillage(VILLAGE);
const stats = village.stats;
const preview = previewMesh(village);

const rows: readonly [string, string][] = [
  ["description", `${stats.descriptionBytes} bytes of JSON`],
  ["terrain", `${meshStats(village.terrain.mesh).triangles} triangles, ${village.terrain.heights.length} height samples`],
  ["buildings", `${stats.buildings}, ${village.buildings.reduce((sum, entry) => sum + entry.building.stats.openings, 0)} openings`],
  ["vegetation", `${village.trees.reduce((sum, v) => sum + v.placements.length, 0)} trees, ${village.rocks.reduce((sum, v) => sum + v.placements.length, 0)} rocks`],
  ["NPCs", `${village.npcs.length}, ${stats.npcBones} bones each`],
  ["unique geometry", `${stats.uniqueTriangles.toLocaleString("en-US")} triangles`],
  ["with instancing", `${stats.instancedTriangles.toLocaleString("en-US")} triangles drawn`],
  ["navigation", `${stats.navSurfaces} surfaces, ${stats.navLinks} doorway links`],
  ["preview mesh", `${meshStats(preview).triangles.toLocaleString("en-US")} triangles merged`],
  ["generated in", `${stats.generationMs} ms`],
  ["expansion", `${(stats.instancedTriangles / stats.descriptionBytes).toFixed(1)} triangles per byte of description`],
];

console.log(`\n${VILLAGE.name} — generated from a structured description\n`);
for (const [label, value] of rows) console.log(`  ${label.padEnd(16)} ${value}`);
console.log();
