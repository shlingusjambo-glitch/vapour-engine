import { getFeatureBlockId } from '../content/FeatureCatalog';
import { generateCrownForgeColumn, generateCrownForgeSurvivalGamesOverlay } from '../crownforge/CrownForgeMaps';
import {
  SinePermutationNoise,
  VoxelGenerationPipeline,
  type VoxelSectionGenerationContext,
} from '@vapour/engine';

export class BiomeGenerator {
  private noise: SinePermutationNoise;
  private seed: number = 0;
  private generation: VoxelGenerationPipeline;
  private readonly biomeCellSize = 320;
  private readonly biomeBlendWidth = 64;

  public static readonly SEA_LEVEL = 18;

  constructor(seed: number | string) {
    if (typeof seed === 'string') {
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = (hash << 5) - hash + seed.charCodeAt(i);
        hash |= 0;
      }
      this.seed = hash;
    } else {
      this.seed = seed;
    }
    this.noise = new SinePermutationNoise(this.seed);
    this.generation = new VoxelGenerationPipeline({
      sectionSize: 16,
      sectionHeight: 16,
      fallbackDimension: 'overworld',
    });
    const register = (
      id: string,
      column: (data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number) => void,
      decorate: ((context: VoxelSectionGenerationContext) => void)[] = [],
    ) => this.generation.register({
      id,
      version: 1,
      generateColumn: (context) => column(
        context.blocks,
        context.worldX,
        context.localX,
        context.worldZ,
        context.localZ,
        context.startY,
      ),
      decorate,
    });
    const overworldDecorators = [(context: VoxelSectionGenerationContext) => {
      this.decorateOverworldSection(context);
    }];
    register('overworld', this.generateOverworldColumn.bind(this), overworldDecorators);
    register('baseline_sandbox', this.generateBaselineSandboxColumn.bind(this));
    register('nether', this.generateNetherColumn.bind(this));
    register('the_end', this.generateEndColumn.bind(this), [(context) => {
      this.generateEndObsidianTowers(context.blocks, context.startX, context.startY, context.startZ);
    }]);
    register('survival_247', this.generateSurvival247Column.bind(this), overworldDecorators);
    register('survival_games', this.generateSurvivalGamesColumn.bind(this));
    this.generation.registerResolver((id) => ({
      id,
      version: 1,
      generateColumn: (context) => {
        if (!generateCrownForgeColumn(
          id,
          context.blocks,
          context.worldX,
          context.localX,
          context.worldZ,
          context.localZ,
          context.startY,
        )) {
          this.generateOverworldColumn(
            context.blocks,
            context.worldX,
            context.localX,
            context.worldZ,
            context.localZ,
            context.startY,
          );
        }
      },
    }));
  }

  /**
   * Generates blocks for a chunk in a specific dimension
   * dimension: "overworld" | "nether" | "the_end"
   */
  public generateChunkData(chunkX: number, chunkY: number, chunkZ: number, dimension = 'overworld'): Uint16Array {
    return this.generation.generate({
      x: chunkX,
      y: chunkY,
      z: chunkZ,
      dimension,
      seed: this.seed,
    });
  }

  private decorateOverworldSection(context: VoxelSectionGenerationContext): void {
    const { x, y, z } = context.request;
    if (this.checkImperialFortressChunk(x, z)) {
      this.generateImperialFortressStructure(context.blocks, x, y, z);
    } else if (this.checkVillageChunk(x, z)) {
      this.generateVillageStructure(context.blocks, x, y, z);
    } else if (this.checkRuinsChunk(x, z)) {
      this.generateRuinsStructure(context.blocks, x, y, z);
    } else {
      this.generateOverworldFoliage(context.blocks, context.startX, context.startY, context.startZ);
    }
  }

  private generateBaselineSandboxColumn(data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number): void {
    const ax = Math.abs(gx);
    const az = Math.abs(gz);
    if (ax > 52 || az > 52) return;

    const stoneBricks = getFeatureBlockId('Stone Bricks') || 3;
    const quartz = getFeatureBlockId('Quartz Block') || stoneBricks;
    const glowstone = getFeatureBlockId('Glowstone') || quartz;
    const floorPlate = ax <= 50 && az <= 50;
    const wall = floorPlate && (ax >= 49 || az >= 49);
    const centerPad = ax <= 2 && az <= 2;

    for (let ly = 0; ly < 16; ly++) {
      const gy = startY + ly;
      const index = lxToIdx(lx, ly, lz);
      if (floorPlate && gy >= -3 && gy <= 0) {
        data[index] = gy === 0 && centerPad ? glowstone : stoneBricks;
      }
      if (wall && gy >= 1 && gy <= 8) {
        data[index] = gy === 8 ? quartz : stoneBricks;
      }
    }
  }

  // 1. OVERWORLD GENERATION
  private getDeepslateEquivalent(blockId: number): number {
    const deepslate = getFeatureBlockId('Deepslate') || 3;
    if (blockId === 3) return deepslate; // Stone -> Deepslate
    if (blockId === 8) return getFeatureBlockId('Deepslate Coal Ore') || 8;
    if (blockId === 9) return getFeatureBlockId('Deepslate Iron Ore') || 9;
    if (blockId === 17) return getFeatureBlockId('Deepslate Gold Ore') || 17;
    if (blockId === 18) return getFeatureBlockId('Deepslate Diamond Ore') || 18;
    
    const copper = getFeatureBlockId('Copper Ore');
    if (copper && blockId === copper) return getFeatureBlockId('Deepslate Copper Ore') || copper;
    
    const redstone = getFeatureBlockId('Redstone Ore');
    if (redstone && blockId === redstone) return getFeatureBlockId('Deepslate Redstone Ore') || redstone;
    
    const lapis = getFeatureBlockId('Lapis Ore');
    if (lapis && blockId === lapis) return getFeatureBlockId('Deepslate Lapis Ore') || lapis;
    
    const emerald = getFeatureBlockId('Emerald Ore');
    if (emerald && blockId === emerald) return getFeatureBlockId('Deepslate Emerald Ore') || emerald;
    
    return blockId;
  }

  private generateOverworldColumn(data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number): void {
    const biome = this.getOverworldBiome(gx, gz);
    const terrainHeight = Math.floor(this.getTerrainHeight(gx, gz, biome));
    const surfaceBlock = this.getSurfaceBlock(biome, gx, gz);
    const subsurfaceBlock = this.getSubsurfaceBlock(biome);

    for (let ly = 0; ly < 16; ly++) {
      const gy = startY + ly;
      const index = lxToIdx(lx, ly, lz);

      if (gy <= -60) {
        data[index] = 35; // Bedrock bottom crust for the expanded Caves & Cliffs depth.
        continue;
      }

      const caveBlock = this.getCaveBlock(gx, gy, gz, terrainHeight);
      if (caveBlock !== null) {
        data[index] = caveBlock;
        continue;
      }

      if (gy <= terrainHeight) {
        if (gy === terrainHeight) {
          data[index] = (gy < 0) ? this.getDeepslateEquivalent(surfaceBlock) : surfaceBlock;
        } else if (gy > terrainHeight - 4) {
          data[index] = (gy < 0) ? this.getDeepslateEquivalent(subsurfaceBlock) : subsurfaceBlock;
        } else {
          // Ore blob veins: use noise3D at multiple frequencies to create natural clusters
          // Each ore type is tested with a dedicated noise seed offset to avoid overlap patterns
          const veinA = this.noise.noise3D(gx * 0.14 + 0.5, gy * 0.14, gz * 0.14 + 0.5);
          const veinB = this.noise.noise3D(gx * 0.17 + 100.5, gy * 0.17, gz * 0.17 + 200.5);
          const veinC = this.noise.noise3D(gx * 0.21 + 300.5, gy * 0.21, gz * 0.21 + 400.5);
          // Detail noise adds irregularity within blob boundaries
          const veinDetail = this.noise.noise3D(gx * 0.09, gy * 0.11, gz * 0.09);

          const copperOre = getFeatureBlockId('Copper Ore');
          const tinOre = getFeatureBlockId('Tin Ore');
          const silverOre = getFeatureBlockId('Silver Ore');
          const redstoneOre = getFeatureBlockId('Redstone Ore');
          const lapisOre = getFeatureBlockId('Lapis Ore');
          const emeraldOre = getFeatureBlockId('Emerald Ore');
          const rubyOre = getFeatureBlockId('Ruby Ore');
          const sapphireOre = getFeatureBlockId('Sapphire Ore');
          const calcite = getFeatureBlockId('Calcite');
          const tuff = getFeatureBlockId('Tuff');
          const amethyst = getFeatureBlockId('Amethyst Block');
          const buddingAmethyst = getFeatureBlockId('Budding Amethyst');

          let block = 3; // Stone
          const geodeField = this.noise.noise3D((gx + 7100) * 0.030, (gy - 1200) * 0.030, (gz + 5100) * 0.030);
          const geodeCore = this.noise.noise3D((gx + 7129) * 0.058, (gy - 1229) * 0.058, (gz + 5129) * 0.058);
          if (gy > -48 && gy < 50 && geodeField > 0.72 && calcite && tuff && amethyst) {
            block = geodeField > 0.84
              ? (geodeCore > 0.38 && buddingAmethyst ? buddingAmethyst : amethyst)
              : (geodeCore > 0 ? calcite : tuff);
          }

          // Rare gem ores — deep only, tight threshold
          if (block !== 3) {
            // Geode shell/core already selected above.
          } else if (veinC > 0.76 && veinDetail > 0.1 && gy < 6 && rubyOre) block = rubyOre;
          else if (veinC < -0.76 && veinDetail < -0.1 && gy < 6 && sapphireOre) block = sapphireOre;
          else if (veinC > 0.71 && gy < 8 && emeraldOre) block = emeraldOre;
          else if (veinC < -0.69 && gy < 12 && lapisOre) block = lapisOre;
          // Diamond and gold — deep veins
          else if (veinB > 0.67 && veinDetail > 0.0 && gy < 7) block = 18; // Diamond
          else if (veinB < -0.65 && gy < 10 && redstoneOre) block = redstoneOre;
          else if (veinB > 0.62 && gy < 12) block = 17; // Gold
          // Mid-depth: silver, iron, tin
          else if (veinA < -0.62 && gy < 16 && silverOre) block = silverOre;
          else if (veinA > 0.60 && gy < 22) block = 9; // Iron
          else if (veinA < -0.58 && gy < 20 && tinOre) block = tinOre;
          // Shallow: copper, coal
          else if (veinA > 0.55 && gy >= 6 && gy < 30 && copperOre) block = copperOre;
          else if (veinA < -0.54 && gy >= 4 && gy < 28) block = 8; // Coal
          else block = 3; // Stone

          data[index] = (gy < 0) ? this.getDeepslateEquivalent(block) : block;
        }
      } else {
        if (gy <= BiomeGenerator.SEA_LEVEL) {
          const ice = getFeatureBlockId('Ice');
          data[index] = biome === 'snowy' && gy === BiomeGenerator.SEA_LEVEL && ice ? ice : 7;
        } else {
          data[index] = 0; // Air
        }
      }
    }

    // Fallen-empire roads: low, deterministic overlays so multiplayer clients/server produce the same world.
    const roadBlock = this.getImperialRoadBlock(gx, gz);
    if (roadBlock !== 0 && terrainHeight >= startY && terrainHeight < startY + 16) {
      const roadY = terrainHeight - startY;
      const roadIdx = lxToIdx(lx, roadY, lz);
      const existing = data[roadIdx];
      if (existing !== 0 && existing !== 7 && existing !== 37) {
        data[roadIdx] = roadBlock;
        if (roadY + 1 < 16) data[lxToIdx(lx, roadY + 1, lz)] = 0;
        if (roadY + 2 < 16) data[lxToIdx(lx, roadY + 2, lz)] = 0;
        if (roadY + 1 < 16 && this.rand2D(gx, gz, 873) < 0.008) {
          data[lxToIdx(lx, roadY + 1, lz)] = 21; // Occasional lonely torch/marker posts.
        }
      }
    }

    // === STALACTITE / STALAGMITE DECORATION ===
    // After the column is filled, scan for cave openings and place formations.
    // Stalactite: solid block with air below it inside the cave → hang downward
    // Stalagmite: air block with solid below it inside the cave → grow upward
    const deepslateId = getFeatureBlockId('Deepslate') || 3;
    const dripstoneBlock = getFeatureBlockId('Dripstone Block') || 3;
    const pointedDripstone = getFeatureBlockId('Pointed Dripstone') || dripstoneBlock;
    for (let ly = 1; ly < 15; ly++) {
      const gy = startY + ly;
      // Only decorate deep underground, not near the surface
      if (gy < -30 || gy >= terrainHeight - 3) continue;

      const here = data[lxToIdx(lx, ly, lz)];
      const above = data[lxToIdx(lx, ly + 1, lz)];
      const below = data[lxToIdx(lx, ly - 1, lz)];
      const isSolidBase = (here === 3 || here === deepslateId);

      // Stalactite: solid block at top of a cave ceiling, air below
      if (isSolidBase && below === 0 && above !== 0) {
        const roll = this.rand2D(gx * 7 + gy, gz * 13 + gy, 991);
        if (roll < 0.06) {
          const len = roll < 0.02 ? 2 : 1;
          for (let d = 1; d <= len; d++) {
            const ty = ly - d;
            if (ty >= 0 && data[lxToIdx(lx, ty, lz)] === 0) {
              data[lxToIdx(lx, ty, lz)] = pointedDripstone;
            } else break;
          }
        }
      }

      // Stalagmite: air block on cave floor, solid below
      const isBelowSolidBase = (below === 3 || below === deepslateId);
      if (here === 0 && isBelowSolidBase && above === 0) {
        const roll = this.rand2D(gx * 11 + gy, gz * 7 + gy, 883);
        if (roll < 0.06) {
          const len = roll < 0.015 ? 3 : roll < 0.04 ? 2 : 1;
          for (let d = 0; d < len; d++) {
            const ty = ly + d;
            if (ty < 16 && data[lxToIdx(lx, ty, lz)] === 0) {
              data[lxToIdx(lx, ty, lz)] = pointedDripstone;
            } else break;
          }
        }
      }
    }
  }

  private generateOverworldFoliage(data: Uint16Array, startX: number, startY: number, startZ: number): void {
    for (let lx = 0; lx < 16; lx++) {
      const gx = startX + lx;
      for (let lz = 0; lz < 16; lz++) {
        const gz = startZ + lz;
        const biome = this.getOverworldBiome(gx, gz);
        const terrainHeight = Math.floor(this.getTerrainHeight(gx, gz, biome));

        if (terrainHeight >= startY && terrainHeight < startY + 16) {
          const ly = terrainHeight - startY;
          const index = lxToIdx(lx, ly, lz);
          const surfaceId = data[index];

          if (surfaceId !== 0 && ly + 1 < 16) {
            const airIdx = lxToIdx(lx, ly + 1, lz);
            if (data[airIdx] === 0) {
              const plantRoll = this.rand2D(gx, gz, 11);
              const flowerRoll = this.rand2D(gx, gz, 23);
              const bushRoll = this.rand2D(gx, gz, 37);
              const boulderRoll = this.rand2D(gx, gz, 53);

              if (lx > 2 && lx < 13 && lz > 2 && lz < 13 && this.canTreeGrowOn(biome, surfaceId) && this.shouldPlaceTree(gx, gz, biome)) {
                const tree = this.getTreeBlocksForBiome(biome, gx, gz);
                this.growTree(data, lx, ly + 1, lz, tree.log, tree.leaves);
              } else if (biome === 'forest' && bushRoll > 0.965 && lx > 1 && lx < 14 && lz > 1 && lz < 14) {
                this.growBush(data, lx, ly + 1, lz);
              } else if (boulderRoll > 0.992 && lx > 1 && lx < 14 && lz > 1 && lz < 14) {
                this.placeBoulder(data, lx, ly + 1, lz);
              } else if (biome === 'desert') {
                const cactus = getFeatureBlockId('Cactus');
                const redSand = getFeatureBlockId('Red Sand');
                if (cactus && (surfaceId === 6 || surfaceId === redSand) && plantRoll < 0.02 && ly + 3 < 16) {
                  data[airIdx] = cactus;
                  data[lxToIdx(lx, ly + 2, lz)] = cactus;
                  if (plantRoll < 0.008) data[lxToIdx(lx, ly + 3, lz)] = cactus;
                }
              } else if (this.canSpawnGroundPlants(biome, surfaceId)) {
                const plantChance = biome === 'forest' || biome === 'swamp' ? 0.1 : 0.06;
                if (plantRoll < plantChance) {
                  const flowerChance = biome === 'plains' ? 0.32 : 0.18;
                  const berryBush = getFeatureBlockId('Berry Bush');
                  const bamboo = getFeatureBlockId('Bamboo');
                  const mushroom = flowerRoll < 0.09 ? getFeatureBlockId('Brown Mushroom') : getFeatureBlockId('Red Mushroom');
                  const azalea = flowerRoll < 0.10 ? getFeatureBlockId('Flowering Azalea Leaves') : getFeatureBlockId('Azalea Leaves');
                  if (biome === 'swamp' && mushroom) data[airIdx] = mushroom;
                  else if ((biome === 'forest' || biome === 'jungle') && azalea && flowerRoll < 0.045) data[airIdx] = azalea;
                  else if (biome === 'forest' && berryBush && flowerRoll < 0.12) data[airIdx] = berryBush;
                  else if (biome === 'jungle' && bamboo && flowerRoll < 0.18) data[airIdx] = bamboo;
                  else if (biome === 'savanna') data[airIdx] = 12;
                  else data[airIdx] = flowerRoll < flowerChance
                    ? (flowerRoll < flowerChance * 0.5 ? 13 : 14)
                    : 12;
                }
              }
            }
          }
        }
      }
    }
  }

  private getOverworldBiome(gx: number, gz: number): string {
    const blend = this.getBiomeBlend(gx, gz);
    const primary = blend[0]?.biome || 'plains';
    const secondary = blend[1];

    // Avoid per-block biome speckling. Only let the secondary biome take over
    // at strong blend weights so biome borders read as broad, natural regions.
    if (secondary && secondary.weight > 0.62) return secondary.biome;
    return primary;
  }

  private getTerrainHeight(gx: number, gz: number, biome: string): number {
    const blendedHeightAt = (x: number, z: number): number => {
      const blend = this.getBiomeBlend(x, z);
      if (blend.length > 0) {
        let height = 0;
        let total = 0;
        for (const sample of blend) {
          height += this.getRawTerrainHeight(x, z, sample.biome) * sample.weight;
          total += sample.weight;
        }
        return height / Math.max(0.001, total);
      }
      return this.getRawTerrainHeight(x, z, biome);
    };

    // Five-tap smoothing kills the hard staircase cliffs from the previous pass
    // while keeping the terrain blocky enough to still feel like a voxel world.
    const center = blendedHeightAt(gx, gz);
    const radius = 3;
    const smooth = center * 0.52
      + blendedHeightAt(gx + radius, gz) * 0.12
      + blendedHeightAt(gx - radius, gz) * 0.12
      + blendedHeightAt(gx, gz + radius) * 0.12
      + blendedHeightAt(gx, gz - radius) * 0.12;

    return this.clamp(smooth, 4, 58);
  }

  private getRawTerrainHeight(gx: number, gz: number, biome: string): number {
    // Coherent 1.18-style terrain stack. The old generator pushed raw Perlin
    // values straight into height, which made spawn areas look like random spikes.
    // This stack separates continental scale, erosion, ridges, rivers, and detail.
    const warpX = this.normalizedFbm2D((gx + 9100) * 0.0018, (gz - 6100) * 0.0018, 3) * 38;
    const warpZ = this.normalizedFbm2D((gx - 3300) * 0.0018, (gz + 7700) * 0.0018, 3) * 38;
    const wx = gx + warpX;
    const wz = gz + warpZ;

    const continental = this.normalizedFbm2D(wx * 0.0022, wz * 0.0022, 5);
    const erosion = this.normalizedFbm2D((wx + 4200) * 0.0042, (wz - 3600) * 0.0042, 4);
    const detail = this.normalizedFbm2D((wx - 1300) * 0.018, (wz + 2100) * 0.018, 3);
    const micro = this.normalizedFbm2D((wx + 240) * 0.045, (wz - 920) * 0.045, 2);

    const ridgeSample = this.normalizedNoise2D((wx - 900) * 0.0095, (wz + 500) * 0.0095);
    const ridge = this.clamp(1 - Math.abs(ridgeSample), 0, 1);
    const riverField = Math.abs(this.normalizedNoise2D((wx + 8000) * 0.0048, (wz - 8000) * 0.0048));
    const riverMask = this.smoothstep(0.075, 0.015, riverField);

    const biomeBase =
      biome === 'swamp' ? 17 :
      biome === 'desert' ? 21 :
      biome === 'savanna' ? 23 :
      biome === 'snowy' ? 26 :
      biome === 'taiga' ? 25 :
      biome === 'forest' || biome === 'jungle' ? 24 :
      22;

    const biomeRoughness =
      biome === 'swamp' ? 0.18 :
      biome === 'desert' ? 0.26 :
      biome === 'savanna' ? 0.42 :
      biome === 'plains' ? 0.36 :
      biome === 'forest' ? 0.50 :
      biome === 'jungle' ? 0.58 :
      0.62;

    const continental01 = (continental + 1) * 0.5;
    const erosion01 = (erosion + 1) * 0.5;
    const lowland = continental * 4.2;
    const erosionFlatten = this.smoothstep(0.20, 0.92, erosion01);
    const hillMask = this.smoothstep(0.24, 0.76, continental01) * (1 - erosionFlatten * 0.28);
    const mountainMask = this.smoothstep(0.72, 0.96, continental01 * 0.72 + ridge * 0.28) * (1 - erosionFlatten * 0.42);
    const valleyCut = this.smoothstep(0.62, 0.95, 1 - continental01) * 3.2;

    const hills = hillMask * biomeRoughness * (2.2 + Math.max(0, detail) * 2.8);
    const mountains = mountainMask * biomeRoughness * (4.5 + ridge * 8.5 + Math.max(0, detail) * 2.2);
    const surfaceDetail = micro * (biome === 'desert' ? 0.7 : 1.05) * (1 - mountainMask * 0.45);
    const riverCut = riverMask * (3.4 + Math.max(0, -detail) * 1.25);

    return this.clamp(biomeBase + lowland + hills + mountains + surfaceDetail - riverCut - valleyCut, 5, 58);
  }

  private normalizedNoise2D(x: number, y: number): number {
    return this.clamp(this.noise.noise2D(x, y) / 1.65, -1, 1);
  }

  private normalizedFbm2D(x: number, y: number, octaves: number): number {
    return this.clamp(this.noise.fbm2D(x, y, octaves) / 1.45, -1, 1);
  }

  private getBiomeBlend(gx: number, gz: number): Array<{ biome: string; weight: number }> {
    const size = this.biomeCellSize;
    const border = this.biomeBlendWidth;
    const cellX = Math.floor(gx / size);
    const cellZ = Math.floor(gz / size);
    const localX = ((gx % size) + size) % size;
    const localZ = ((gz % size) + size) % size;

    const xSamples: Array<{ cell: number; weight: number }> = [{ cell: cellX, weight: 1 }];
    if (localX < border) {
      const t = this.smoothstep(0, border, localX);
      xSamples[0] = { cell: cellX - 1, weight: 1 - t };
      xSamples.push({ cell: cellX, weight: t });
    } else if (localX > size - border) {
      const t = this.smoothstep(size - border, size, localX);
      xSamples[0] = { cell: cellX, weight: 1 - t };
      xSamples.push({ cell: cellX + 1, weight: t });
    }

    const zSamples: Array<{ cell: number; weight: number }> = [{ cell: cellZ, weight: 1 }];
    if (localZ < border) {
      const t = this.smoothstep(0, border, localZ);
      zSamples[0] = { cell: cellZ - 1, weight: 1 - t };
      zSamples.push({ cell: cellZ, weight: t });
    } else if (localZ > size - border) {
      const t = this.smoothstep(size - border, size, localZ);
      zSamples[0] = { cell: cellZ, weight: 1 - t };
      zSamples.push({ cell: cellZ + 1, weight: t });
    }

    const weights = new Map<string, number>();
    for (const xs of xSamples) {
      for (const zs of zSamples) {
        const biomeName = this.getCellBiome(xs.cell, zs.cell);
        weights.set(biomeName, (weights.get(biomeName) || 0) + xs.weight * zs.weight);
      }
    }

    return Array.from(weights.entries())
      .map(([biomeName, weight]) => ({ biome: biomeName, weight }))
      .filter(sample => sample.weight > 0.001)
      .sort((a, b) => b.weight - a.weight);
  }

  private getCellBiome(cellX: number, cellZ: number): string {
    const sampleX = cellX * this.biomeCellSize + this.biomeCellSize * 0.5;
    const sampleZ = cellZ * this.biomeCellSize + this.biomeCellSize * 0.5;

    const climate = this.noise.fbm2D(sampleX * 0.0016, sampleZ * 0.0016, 4);
    const moisture = this.noise.fbm2D((sampleX + 1700) * 0.0020, (sampleZ - 1300) * 0.0020, 4);

    if (climate < -0.48) return moisture > 0.02 ? 'taiga' : 'snowy';
    if (climate > 0.46 && moisture < -0.30) return 'desert';
    if (climate > 0.34 && moisture > 0.20) return 'jungle';
    if (moisture > 0.44 && climate > -0.24) return 'swamp';
    if (moisture < -0.34 && climate > -0.08) return 'savanna';
    if (climate > 0.10) return 'forest';
    if (climate < -0.18) return 'taiga';
    return 'plains';
  }

  private getCaveBlock(gx: number, gy: number, gz: number, terrainHeight: number): number | null {
    // Do not carve bedrock or the fragile top skin of the terrain.
    if (gy <= -59 || gy >= terrainHeight - 6) return null;

    const depth01 = this.clamp((terrainHeight - gy) / Math.max(1, terrainHeight), 0, 1);

    // Domain warp first so tunnels do not look like blobby random holes.
    const warpX = this.noise.noise3D(gx * 0.020, gy * 0.035, gz * 0.020) * 7.5;
    const warpY = this.noise.noise3D((gx + 911) * 0.020, (gy - 431) * 0.035, (gz + 217) * 0.020) * 3.0;
    const warpZ = this.noise.noise3D((gx - 271) * 0.020, (gy + 683) * 0.035, (gz - 881) * 0.020) * 7.5;

    const wx = gx + warpX;
    const wy = gy + warpY;
    const wz = gz + warpZ;

    // Spaghetti caves: two near-zero 3D fields create long connected tubes.
    const tunnelA = Math.abs(this.noise.noise3D(wx * 0.045, wy * 0.082, wz * 0.045));
    const tunnelB = Math.abs(this.noise.noise3D((wx + 700) * 0.052, (wy - 300) * 0.075, (wz + 1100) * 0.052));
    const tunnelWidth = 0.048 + depth01 * 0.020;
    const isSpaghetti = (tunnelA < tunnelWidth && tunnelB < 0.22) || (tunnelB < tunnelWidth && tunnelA < 0.24);

    // Cheese caves: larger chambers deeper underground with noisy edges.
    const cheeseNoise = this.noise.noise3D((wx - 2000) * 0.020, (wy + 400) * 0.030, (wz + 1500) * 0.020);
    const cheeseDetail = this.noise.noise3D(wx * 0.072, wy * 0.084, wz * 0.072);
    const chamberGate = this.noise.noise2D((gx + 1337) * 0.006, (gz - 7331) * 0.006);
    const isCheese = gy < Math.min(18, terrainHeight - 12) && chamberGate > 0.58 && cheeseNoise > (0.56 - depth01 * 0.06 + cheeseDetail * 0.045);

    // Ravines: rare, tall cracks that cut across several chunks.
    const ravineField = Math.abs(this.noise.noise2D((gx + 3000) * 0.010, (gz - 3000) * 0.010));
    const ravineJitter = this.noise.noise3D(gx * 0.035, gy * 0.030, gz * 0.035);
    const ravineHeightMask = this.smoothstep(3, 18, gy) * (1 - this.smoothstep(terrainHeight - 10, terrainHeight - 2, gy));
    const isRavine = ravineField < 0.012 && ravineJitter > 0.10 && ravineHeightMask > 0.22;

    if (!isSpaghetti && !isCheese && !isRavine) return null;

    // Lava level is at the very bottom of the expanded underground.
    if (gy <= -54) {
      return this.rand2D(gx, gz, 811) > 0.30 ? 37 : 0; // lava pockets near bedrock
    }
    
    // Dry caves: Aquifers are disabled (return air 0) to fix player cave swimming issues.
    return 0;
  }

  private smoothstep(edge0: number, edge1: number, value: number): number {
    const t = this.clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private getSurfaceBlock(biome: string, gx: number, gz: number): number {
    if (biome === 'desert') {
      const redSand = getFeatureBlockId('Red Sand');
      return this.rand2D(gx, gz, 313) > 0.78 && redSand ? redSand : 6;
    }
    if (biome === 'snowy') return getFeatureBlockId('Snow Block') || 1;
    if (biome === 'taiga') return getFeatureBlockId('Podzol') || 1;
    if (biome === 'swamp') return getFeatureBlockId('Mud') || 2;
    if (biome === 'jungle') return getFeatureBlockId('Rooted Dirt') || 1;
    if (biome === 'savanna') return getFeatureBlockId('Coarse Dirt') || 1;
    if (this.rand2D(gx, gz, 317) > 0.985) return getFeatureBlockId('Mycelium') || 1;
    return 1;
  }

  private getSubsurfaceBlock(biome: string): number {
    if (biome === 'desert') return 6;
    if (biome === 'swamp') return getFeatureBlockId('Mud') || 2;
    if (biome === 'snowy') return getFeatureBlockId('Packed Ice') || 2;
    return 2;
  }

  private getTreeBlocksForBiome(biome: string, gx: number, gz: number): { log: number; leaves: number } {
    const pair = (wood: string) => ({
      log: getFeatureBlockId(`${wood} Log`) || 4,
      leaves: getFeatureBlockId(`${wood} Leaves`) || 5,
    });

    if (biome === 'taiga' || biome === 'snowy') return pair('Pine');
    if (biome === 'jungle') return pair('Jungle');
    if (biome === 'savanna') return pair('Acacia');
    if (biome === 'swamp') return this.rand2D(gx, gz, 401) > 0.5 ? pair('Mangrove') : pair('Dark Oak');
    if (biome === 'forest') return this.rand2D(gx, gz, 409) > 0.78 ? pair('Cherry') : pair('Birch');
    return this.rand2D(gx, gz, 419) > 0.82 ? pair('Palm') : { log: 4, leaves: 5 };
  }

  private canTreeGrowOn(biome: string, surfaceId: number): boolean {
    if (biome === 'desert') return false;
    const snow = getFeatureBlockId('Snow Block');
    const podzol = getFeatureBlockId('Podzol');
    const rooted = getFeatureBlockId('Rooted Dirt');
    const coarse = getFeatureBlockId('Coarse Dirt');
    const mud = getFeatureBlockId('Mud');
    return surfaceId === 1 || surfaceId === 2 || surfaceId === snow || surfaceId === podzol || surfaceId === rooted || surfaceId === coarse || surfaceId === mud;
  }

  private canSpawnGroundPlants(biome: string, surfaceId: number): boolean {
    if (biome === 'snowy' || biome === 'desert') return false;
    const podzol = getFeatureBlockId('Podzol');
    const rooted = getFeatureBlockId('Rooted Dirt');
    const coarse = getFeatureBlockId('Coarse Dirt');
    const mud = getFeatureBlockId('Mud');
    if (biome === 'swamp') return surfaceId === mud || surfaceId === 2;
    if (biome === 'taiga') return surfaceId === podzol || surfaceId === 1;
    if (biome === 'jungle') return surfaceId === rooted || surfaceId === 1;
    if (biome === 'savanna') return surfaceId === coarse || surfaceId === 1;
    return surfaceId === 1 || surfaceId === 2;
  }

  private growTree(data: Uint16Array, tx: number, ty: number, tz: number, logId = 4, leavesId = 5): void {
    const h = 4 + Math.floor(this.rand2D(tx, tz, 71) * 3);
    for (let i = 0; i < h; i++) {
      if (ty + i < 16) data[lxToIdx(tx, ty + i, tz)] = logId; // Wood Log
    }
    const leavesCenter = ty + h - 1;
    const r = 2;
    for (let lx = -r; lx <= r; lx++) {
      const ax = tx + lx;
      if (ax < 0 || ax >= 16) continue;
      for (let lz = -r; lz <= r; lz++) {
        const az = tz + lz;
        if (az < 0 || az >= 16) continue;
        for (let ly = -r; ly <= r; ly++) {
          const ay = leavesCenter + ly;
          if (ay < 0 || ay >= 16) continue;

          if (Math.abs(lx) + Math.abs(ly) + Math.abs(lz) <= 3) {
            const idx = lxToIdx(ax, ay, az);
            if (data[idx] === 0) data[idx] = leavesId; // Leaves
          }
        }
      }
    }
  }

  private growBush(data: Uint16Array, tx: number, ty: number, tz: number): void {
    for (let ox = -1; ox <= 1; ox++) {
      const x = tx + ox;
      if (x < 0 || x >= 16) continue;
      for (let oz = -1; oz <= 1; oz++) {
        const z = tz + oz;
        if (z < 0 || z >= 16) continue;
        const dist = Math.abs(ox) + Math.abs(oz);
        if (dist > 1 && this.rand2D(x, z, 89) < 0.35) continue;
        const idx = lxToIdx(x, ty, z);
        if (data[idx] === 0) data[idx] = 5;
      }
    }
  }

  private placeBoulder(data: Uint16Array, tx: number, ty: number, tz: number): void {
    const radius = this.rand2D(tx, tz, 97) > 0.5 ? 1 : 2;
    for (let ox = -radius; ox <= radius; ox++) {
      const x = tx + ox;
      if (x < 0 || x >= 16) continue;
      for (let oy = 0; oy <= 1; oy++) {
        const y = ty + oy;
        if (y < 0 || y >= 16) continue;
        for (let oz = -radius; oz <= radius; oz++) {
          const z = tz + oz;
          if (z < 0 || z >= 16) continue;
          if (Math.abs(ox) + oy + Math.abs(oz) > radius + 1) continue;

          const idx = lxToIdx(x, y, z);
          if (data[idx] === 0) data[idx] = 3;
        }
      }
    }
  }

  private shouldPlaceTree(gx: number, gz: number, biome: string): boolean {
    if (biome === 'desert' || biome === 'swamp') return false;

    const cellSize = biome === 'forest' || biome === 'jungle' || biome === 'taiga' ? 7 : 13;
    const cellX = Math.floor(gx / cellSize);
    const cellZ = Math.floor(gz / cellSize);
    const density =
      biome === 'jungle' ? 0.82 :
      biome === 'forest' ? 0.72 :
      biome === 'taiga' ? 0.64 :
      biome === 'snowy' ? 0.28 :
      biome === 'savanna' ? 0.16 :
      0.22;

    if (this.rand2D(cellX, cellZ, 131) > density) return false;

    const anchorX = cellX * cellSize + 2 + Math.floor(this.rand2D(cellX, cellZ, 137) * Math.max(1, cellSize - 4));
    const anchorZ = cellZ * cellSize + 2 + Math.floor(this.rand2D(cellX, cellZ, 149) * Math.max(1, cellSize - 4));
    return gx === anchorX && gz === anchorZ;
  }

  public rand2D(x: number, z: number, salt: number): number {
    const n = Math.sin((x * 127.1 + z * 311.7 + this.seed * 17.17 + salt * 101.3)) * 43758.5453123;
    return n - Math.floor(n);
  }

  // 2. NETHER GENERATION
  private generateNetherColumn(data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number): void {
    for (let ly = 0; ly < 16; ly++) {
      const gy = startY + ly;
      const index = lxToIdx(lx, ly, lz);

      // Instantly bypass expensive 3D noise outside the playable Y=0..31 cavern bounds
      if (gy < 0) {
        data[index] = gy <= -60 ? 35 : 26; // Bedrock bottom crust, otherwise solid Netherrack
        continue;
      }
      if (gy > 31) {
        data[index] = gy >= 156 ? 35 : 26; // Bedrock top crust, otherwise solid Netherrack
        continue;
      }

      // Bedrock ceilings and floors
      if (gy === 0 || gy === 31) {
        data[index] = 35; // Bedrock
        continue;
      }

      // Nether Cavern noise
      const density = this.noise.noise3D(gx * 0.05, gy * 0.05, gz * 0.05);
      const isSolid = density > 0.05 || gy < 3 || gy > 28;

      if (isSolid) {
        // Pockets of Soul Sand, Obsidian, basalt, blackstone, and quartz
        const pocketNoise = this.noise.noise3D(gx * 0.12, gy * 0.12, gz * 0.12);
        if (pocketNoise > 0.7) {
          data[index] = 28; // Obsidian
        } else if (pocketNoise > 0.58 && gy < 14) {
          data[index] = 27; // Soul Sand
        } else {
          const basalt = getFeatureBlockId('Basalt');
          const blackstone = getFeatureBlockId('Blackstone');
          const quartzOre = getFeatureBlockId('Quartz Ore');
          if (pocketNoise < -0.62 && basalt) data[index] = basalt;
          else if (pocketNoise < -0.52 && blackstone) data[index] = blackstone;
          else if (pocketNoise > 0.5 && quartzOre && gy > 8) data[index] = quartzOre;
          else data[index] = 26; // Netherrack
        }
      } else {
        // Empty cavern, lava seas at depth (y <= 6)
        data[index] = gy <= 6 ? 37 : 0; // Lava
      }
    }
  }

  // 3. THE END GENERATION
  private generateEndColumn(data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number): void {
    // Flying islands centered around 0,0
    const distToCenter = Math.sqrt(gx * gx + gz * gz);

    for (let ly = 0; ly < 16; ly++) {
      const gy = startY + ly;
      const index = lxToIdx(lx, ly, lz);

      let isIsland = false;

      // Central Island
      if (distToCenter < 42) {
        const height = 10 + Math.cos(gx * 0.08) * Math.cos(gz * 0.08) * 6;
        if (gy <= height && gy >= 3) {
          isIsland = true;
        }
      } 
      // Outer small floating islands
      else if (distToCenter > 65) {
        const islandNoise = this.noise.noise2D(gx * 0.04, gz * 0.04);
        if (islandNoise > 0.42) {
          const height = 12 + this.noise.noise2D(gx * 0.1, gz * 0.1) * 3;
          if (gy <= height && gy >= 7) {
            isIsland = true;
          }
        }
      }

      const endSlate = getFeatureBlockId('Slate') || 34;
      data[index] = isIsland ? (distToCenter > 65 ? endSlate : 34) : 0; // End Stone or Void Air
    }
  }

  private generateEndObsidianTowers(data: Uint16Array, startX: number, startY: number, startZ: number): void {
    // Spawn simple tall obsidian pillars at specific radius coordinates
    // We check if a pillar falls within the chunk boundaries
    const pillarPositions = [
      [20, 20], [-20, 20], [20, -20], [-20, -20]
    ];

    for (const [px, pz] of pillarPositions) {
      if (px >= startX && px < startX + 16 && pz >= startZ && pz < startZ + 16) {
        const lx = px - startX;
        const lz = pz - startZ;
        const towerHeight = 24;

        for (let gy = 0; gy < towerHeight; gy++) {
          if (gy >= startY && gy < startY + 16) {
            const ly = gy - startY;
            data[lxToIdx(lx, ly, lz)] = 28; // Obsidian pillar block
          }
        }
      }
    }
  }

  public checkVillageChunk(chunkX: number, chunkZ: number): boolean {
    const gx = chunkX * 16 + 8;
    const gz = chunkZ * 16 + 8;
    const biome = this.getOverworldBiome(gx, gz);
    if (biome !== 'plains') return false;

    if (Math.hypot(gx, gz) < 160) return false;
    return this.rand2D(chunkX, chunkZ, 701) < 0.025;
  }

  private generateVillageStructure(data: Uint16Array, chunkX: number, chunkY: number, chunkZ: number): void {
    const startX = chunkX * 16;
    const startY = chunkY * 16;
    const startZ = chunkZ * 16;

    const gx = startX + 8;
    const gz = startZ + 8;
    const biome = this.getOverworldBiome(gx, gz);
    const terrainHeight = Math.floor(this.getTerrainHeight(gx, gz, biome));

    if (terrainHeight >= startY && terrainHeight < startY + 16) {
      const ly = terrainHeight - startY;
      if (terrainHeight < BiomeGenerator.SEA_LEVEL || !this.canPlaceSurfaceStructure(data, ly)) return;

      const structureType = Math.floor(this.rand2D(chunkX, chunkZ, 702) * 3);
      if (structureType === 0) {
        this.spawnWell(data, ly);
      } else if (structureType === 1) {
        this.spawnHouse(data, ly);
      } else {
        this.spawnFarm(data, ly);
      }
    }
  }

  private setBlockInChunk(data: Uint16Array, lx: number, ly: number, lz: number, blockId: number): void {
    if (lx >= 0 && lx < 16 && ly >= 0 && ly < 16 && lz >= 0 && lz < 16) {
      data[lxToIdx(lx, ly, lz)] = blockId;
    }
  }

  private canPlaceSurfaceStructure(data: Uint16Array, terrainLocalY: number): boolean {
    if (terrainLocalY < 0 || terrainLocalY > 12) return false;

    let solidSurface = 0;
    let openHeadroom = 0;
    let caveLikeAirBelow = 0;
    const sampleCount = 16;

    for (let lx = 6; lx <= 9; lx++) {
      for (let lz = 6; lz <= 9; lz++) {
        const base = data[lxToIdx(lx, terrainLocalY, lz)];
        const above1 = data[lxToIdx(lx, terrainLocalY + 1, lz)];
        const above2 = data[lxToIdx(lx, terrainLocalY + 2, lz)];
        const below1 = terrainLocalY > 0 ? data[lxToIdx(lx, terrainLocalY - 1, lz)] : 0;
        const below2 = terrainLocalY > 1 ? data[lxToIdx(lx, terrainLocalY - 2, lz)] : 0;

        if (base !== 0) solidSurface++;
        if (above1 === 0 && above2 === 0) openHeadroom++;
        if (below1 === 0 || below2 === 0) caveLikeAirBelow++;
      }
    }

    return solidSurface >= Math.ceil(sampleCount * 0.75)
      && openHeadroom >= Math.ceil(sampleCount * 0.75)
      && caveLikeAirBelow <= Math.floor(sampleCount * 0.25);
  }

  private wrappedDistanceToGridLine(value: number, spacing: number): number {
    const half = spacing / 2;
    const wrapped = ((value + half) % spacing + spacing) % spacing;
    return Math.abs(wrapped - half);
  }

  private getImperialRoadBlock(gx: number, gz: number): number {
    const spacing = 96;
    const distanceX = this.wrappedDistanceToGridLine(gx, spacing);
    const distanceZ = this.wrappedDistanceToGridLine(gz, spacing);
    const onMainRoad = distanceX <= 1 || distanceZ <= 1;
    const onShoulder = distanceX <= 2 || distanceZ <= 2;
    if (!onShoulder) return 0;

    const stoneBricks = getFeatureBlockId('Stone Bricks') || 3;
    const mossyBricks = getFeatureBlockId('Mossy Stone Bricks') || 19;
    const crackedBricks = getFeatureBlockId('Cracked Stone Bricks') || stoneBricks;
    const gravel = 16;
    const roll = this.rand2D(gx, gz, 872);

    if (!onMainRoad && roll < 0.45) return gravel;
    if (roll < 0.16) return mossyBricks;
    if (roll < 0.34) return crackedBricks;
    return stoneBricks;
  }

  public checkImperialFortressChunk(chunkX: number, chunkZ: number): boolean {
    if (this.checkVillageChunk(chunkX, chunkZ)) return false;

    const gx = chunkX * 16 + 8;
    const gz = chunkZ * 16 + 8;
    const biome = this.getOverworldBiome(gx, gz);
    const allowed = ['plains', 'forest', 'taiga', 'snowy', 'savanna', 'swamp', 'jungle'];
    if (!allowed.includes(biome)) return false;

    const nearRoad = this.getImperialRoadBlock(gx, gz) !== 0
      || this.getImperialRoadBlock(gx + 24, gz) !== 0
      || this.getImperialRoadBlock(gx, gz + 24) !== 0;

    if (Math.hypot(gx, gz) < 320) return false;
    return nearRoad && this.rand2D(chunkX, chunkZ, 906) < 0.012;
  }

  private generateImperialFortressStructure(data: Uint16Array, chunkX: number, chunkY: number, chunkZ: number): void {
    const startX = chunkX * 16;
    const startY = chunkY * 16;
    const startZ = chunkZ * 16;
    const gx = startX + 8;
    const gz = startZ + 8;
    const biome = this.getOverworldBiome(gx, gz);
    const terrainHeight = Math.floor(this.getTerrainHeight(gx, gz, biome));

    if (terrainHeight < startY || terrainHeight >= startY + 16) return;

    const ty = terrainHeight - startY;
    if (terrainHeight < BiomeGenerator.SEA_LEVEL || !this.canPlaceSurfaceStructure(data, ty)) return;
    const stoneBricks = getFeatureBlockId('Stone Bricks') || 3;
    const mossyBricks = getFeatureBlockId('Mossy Stone Bricks') || 19;
    const crackedBricks = getFeatureBlockId('Cracked Stone Bricks') || stoneBricks;
    const chiseledStone = getFeatureBlockId('Chiseled Stone Bricks') || stoneBricks;
    const ironBars = getFeatureBlockId('Iron Bars') || 11;
    const ancientObelisk = getFeatureBlockId('Ancient Obelisk') || chiseledStone;
    const goldBlock = getFeatureBlockId('Gold Block') || 17;
    const torch = 21;
    const chest = 24;

    const pickAgedStone = (x: number, z: number, salt: number): number => {
      const roll = this.rand2D(chunkX * 31 + x, chunkZ * 31 + z, salt);
      if (roll < 0.18) return mossyBricks;
      if (roll < 0.42) return crackedBricks;
      return stoneBricks;
    };

    // Buried foundation and courtyard.
    for (let dx = 1; dx <= 14; dx++) {
      for (let dz = 1; dz <= 14; dz++) {
        this.setBlockInChunk(data, dx, ty - 1, dz, stoneBricks);
        this.setBlockInChunk(data, dx, ty, dz, pickAgedStone(dx, dz, 907));
        for (let clearY = ty + 1; clearY <= ty + 5; clearY++) {
          this.setBlockInChunk(data, dx, clearY, dz, 0);
        }
      }
    }

    // Curtain walls, with damaged gaps so it feels old rather than copy-pasted.
    for (let dy = 1; dy <= 4; dy++) {
      for (let dx = 1; dx <= 14; dx++) {
        for (let dz = 1; dz <= 14; dz++) {
          const edge = dx === 1 || dx === 14 || dz === 1 || dz === 14;
          if (!edge) continue;
          const gate = dz === 1 && dx >= 6 && dx <= 9 && dy <= 3;
          const collapseRoll = this.rand2D(chunkX * 19 + dx, chunkZ * 19 + dz + dy, 908);
          if (!gate && collapseRoll > 0.08 + dy * 0.05) {
            const window = (dx === 1 || dx === 14 || dz === 14) && dy === 3 && ((dx + dz) % 4 === 0);
            this.setBlockInChunk(data, dx, ty + dy, dz, window ? ironBars : pickAgedStone(dx, dz + dy, 909));
          }
        }
      }
    }

    // Crenellations.
    for (let i = 1; i <= 14; i++) {
      if (i % 2 === 0) {
        this.setBlockInChunk(data, i, ty + 5, 1, pickAgedStone(i, 1, 910));
        this.setBlockInChunk(data, i, ty + 5, 14, pickAgedStone(i, 14, 911));
        this.setBlockInChunk(data, 1, ty + 5, i, pickAgedStone(1, i, 912));
        this.setBlockInChunk(data, 14, ty + 5, i, pickAgedStone(14, i, 913));
      }
    }

    // Four squat towers.
    for (const [cx, cz] of [[3, 3], [12, 3], [3, 12], [12, 12]]) {
      for (let dy = 1; dy <= 7; dy++) {
        for (let ox = -1; ox <= 1; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            const outside = Math.abs(ox) === 1 || Math.abs(oz) === 1;
            if (outside && this.rand2D(chunkX + cx + ox, chunkZ + cz + oz + dy, 914) > 0.10 + dy * 0.03) {
              this.setBlockInChunk(data, cx + ox, ty + dy, cz + oz, pickAgedStone(cx + ox, cz + oz, 915));
            } else if (!outside) {
              this.setBlockInChunk(data, cx + ox, ty + dy, cz + oz, 0);
            }
          }
        }
      }
      this.setBlockInChunk(data, cx, ty + 8, cz, ancientObelisk);
    }

    // Throne/dais for the fallen crown, plus loot marker.
    for (let dx = 6; dx <= 9; dx++) {
      for (let dz = 6; dz <= 9; dz++) {
        this.setBlockInChunk(data, dx, ty + 1, dz, chiseledStone);
      }
    }
    this.setBlockInChunk(data, 8, ty + 2, 8, ancientObelisk);
    this.setBlockInChunk(data, 8, ty + 3, 8, goldBlock);
    this.setBlockInChunk(data, 7, ty + 2, 8, chest);

    for (const [tx, tz] of [[2, 7], [13, 7], [7, 2], [7, 13]]) {
      this.setBlockInChunk(data, tx, ty + 1, tz, torch);
    }

    // Rubble piles inside and around the gate.
    for (let dx = 2; dx <= 13; dx++) {
      for (let dz = 2; dz <= 13; dz++) {
        if ((dx >= 6 && dx <= 9 && dz >= 6 && dz <= 9) || this.rand2D(dx + chunkX * 17, dz + chunkZ * 17, 916) > 0.18) continue;
        this.setBlockInChunk(data, dx, ty + 1, dz, pickAgedStone(dx, dz, 917));
      }
    }
  }

  private spawnWell(data: Uint16Array, ty: number): void {
    for (let dy = -3; dy <= 0; dy++) {
      for (let dx = 6; dx <= 9; dx++) {
        for (let dz = 6; dz <= 9; dz++) {
          const isCenter = (dx === 7 || dx === 8) && (dz === 7 || dz === 8);
          if (isCenter) {
            this.setBlockInChunk(data, dx, ty + dy, dz, 7);
          } else {
            this.setBlockInChunk(data, dx, ty + dy, dz, 19);
          }
        }
      }
    }
    
    for (let dx = 6; dx <= 9; dx++) {
      for (let dz = 6; dz <= 9; dz++) {
        const isCenter = (dx === 7 || dx === 8) && (dz === 7 || dz === 8);
        if (!isCenter) {
          this.setBlockInChunk(data, dx, ty + 1, dz, 19);
        } else {
          this.setBlockInChunk(data, dx, ty + 1, dz, 0);
        }
      }
    }

    const corners = [[6, 6], [9, 6], [6, 9], [9, 9]];
    for (const [px, pz] of corners) {
      this.setBlockInChunk(data, px, ty + 2, pz, 4);
      this.setBlockInChunk(data, px, ty + 3, pz, 4);
    }

    for (let dx = 6; dx <= 9; dx++) {
      for (let dz = 6; dz <= 9; dz++) {
        this.setBlockInChunk(data, dx, ty + 4, dz, 15);
      }
    }
  }

  private spawnHouse(data: Uint16Array, ty: number): void {
    for (let dx = 5; dx <= 10; dx++) {
      for (let dz = 5; dz <= 10; dz++) {
        this.setBlockInChunk(data, dx, ty, dz, 3);
      }
    }

    for (let dy = 1; dy <= 3; dy++) {
      for (let dx = 5; dx <= 10; dx++) {
        for (let dz = 5; dz <= 10; dz++) {
          const isEdgeX = dx === 5 || dx === 10;
          const isEdgeZ = dz === 5 || dz === 10;
          
          if (isEdgeX || isEdgeZ) {
            const isCorner = isEdgeX && isEdgeZ;
            if (isCorner) {
              this.setBlockInChunk(data, dx, ty + dy, dz, 4);
            } else {
              this.setBlockInChunk(data, dx, ty + dy, dz, 15);
            }
          } else {
            this.setBlockInChunk(data, dx, ty + dy, dz, 0);
          }
        }
      }
    }

    for (let dx = 5; dx <= 10; dx++) {
      for (let dz = 5; dz <= 10; dz++) {
        this.setBlockInChunk(data, dx, ty + 4, dz, 15);
      }
    }

    this.setBlockInChunk(data, 7, ty + 2, 5, 11);
    this.setBlockInChunk(data, 7, ty + 2, 10, 11);
    this.setBlockInChunk(data, 10, ty + 2, 7, 11);

    this.setBlockInChunk(data, 5, ty + 1, 7, 0);
    this.setBlockInChunk(data, 5, ty + 2, 7, 0);

    this.setBlockInChunk(data, 6, ty + 1, 6, 22);
    this.setBlockInChunk(data, 9, ty + 1, 6, 24);
    this.setBlockInChunk(data, 9, ty + 1, 9, 23);

    this.setBlockInChunk(data, 8, ty + 2, 6, 21);
  }

  private spawnFarm(data: Uint16Array, ty: number): void {
    for (let dx = 4; dx <= 11; dx++) {
      for (let dz = 4; dz <= 11; dz++) {
        const isBorder = dx === 4 || dx === 11 || dz === 4 || dz === 11;
        if (isBorder) {
          this.setBlockInChunk(data, dx, ty, dz, 4);
          this.setBlockInChunk(data, dx, ty + 1, dz, 0);
        } else {
          const isWaterChannel = dx === 7 || dx === 8;
          if (isWaterChannel) {
            this.setBlockInChunk(data, dx, ty, dz, 7);
            this.setBlockInChunk(data, dx, ty + 1, dz, 0);
          } else {
            this.setBlockInChunk(data, dx, ty, dz, getFeatureBlockId('Farmland') || 2);
            const cropRoll = this.rand2D(dx, dz, 733);
            const crop = cropRoll < 0.25 ? getFeatureBlockId('Carrot Crops')
              : cropRoll < 0.5 ? getFeatureBlockId('Potato Crops')
              : cropRoll < 0.7 ? getFeatureBlockId('Beetroot Crops')
              : 33;
            this.setBlockInChunk(data, dx, ty + 1, dz, crop || 33);
          }
        }
      }
    }
  }

  public checkRuinsChunk(chunkX: number, chunkZ: number): boolean {
    if (this.checkVillageChunk(chunkX, chunkZ)) return false;
    const gx = chunkX * 16 + 8;
    const gz = chunkZ * 16 + 8;
    const biome = this.getOverworldBiome(gx, gz);
    const allowed = ['plains', 'forest', 'taiga', 'snowy', 'savanna', 'swamp', 'desert', 'jungle'];
    if (!allowed.includes(biome)) return false;

    if (Math.hypot(gx, gz) < 192) return false;
    return this.rand2D(chunkX, chunkZ, 808) < 0.018; // sparse ruins; no massive spawn clutter
  }

  private generateRuinsStructure(data: Uint16Array, chunkX: number, chunkY: number, chunkZ: number): void {
    const startX = chunkX * 16;
    const startY = chunkY * 16;
    const startZ = chunkZ * 16;

    const gx = startX + 8;
    const gz = startZ + 8;
    const biome = this.getOverworldBiome(gx, gz);
    const terrainHeight = Math.floor(this.getTerrainHeight(gx, gz, biome));

    if (terrainHeight >= startY && terrainHeight < startY + 16) {
      const ly = terrainHeight - startY;
      if (terrainHeight < BiomeGenerator.SEA_LEVEL || !this.canPlaceSurfaceStructure(data, ly)) return;
      
      if (biome === 'desert') {
        this.spawnDesertCrypt(data, ly, chunkX, chunkZ);
      } else {
        const roll = this.rand2D(chunkX, chunkZ, 809);
        if (roll < 0.5) {
          this.spawnCastleKeepRuins(data, ly, chunkX, chunkZ);
        } else {
          this.spawnDecayedTower(data, ly, chunkX, chunkZ);
        }
      }
    }
  }

  private spawnCastleKeepRuins(data: Uint16Array, ty: number, cx: number, cz: number): void {
    const stoneBricks = getFeatureBlockId('Stone Bricks') || 3;
    const mossyBricks = getFeatureBlockId('Mossy Stone Bricks') || 19;
    const crackedBricks = getFeatureBlockId('Cracked Stone Bricks') || 3;
    const obelisk = getFeatureBlockId('Ancient Obelisk') || 3;
    const ironBars = getFeatureBlockId('Iron Bars') || 11;

    // Foundation
    for (let dx = 4; dx <= 11; dx++) {
      for (let dz = 4; dz <= 11; dz++) {
        this.setBlockInChunk(data, dx, ty, dz, stoneBricks);
      }
    }

    // Walls
    for (let dy = 1; dy <= 5; dy++) {
      for (let dx = 4; dx <= 11; dx++) {
        for (let dz = 4; dz <= 11; dz++) {
          const isEdgeX = dx === 4 || dx === 11;
          const isEdgeZ = dz === 4 || dz === 11;
          if (isEdgeX || isEdgeZ) {
            const decayChance = 0.15 + (dy * 0.15);
            if (this.rand2D(dx + cx, dz + cz + dy, 812) > decayChance) {
              const blockRoll = this.rand2D(dx - cx, dz - cz - dy, 813);
              let bId = stoneBricks;
              if (blockRoll < 0.2) bId = mossyBricks;
              else if (blockRoll < 0.4) bId = crackedBricks;
              else if (blockRoll < 0.45 && dy >= 2 && dy <= 3) bId = ironBars;
              
              this.setBlockInChunk(data, dx, ty + dy, dz, bId);
            } else {
              this.setBlockInChunk(data, dx, ty + dy, dz, 0);
            }
          } else {
            this.setBlockInChunk(data, dx, ty + dy, dz, 0);
          }
        }
      }
    }

    // Rubble
    for (let ox = 5; ox <= 10; ox++) {
      for (let oz = 5; oz <= 10; oz++) {
        if (this.rand2D(ox + cx, oz + cz, 814) < 0.25) {
          this.setBlockInChunk(data, ox, ty + 1, oz, crackedBricks);
        }
      }
    }

    // Chest and obelisk
    this.setBlockInChunk(data, 7, ty + 1, 7, 23);
    this.setBlockInChunk(data, 8, ty + 1, 8, obelisk);
  }

  private spawnDecayedTower(data: Uint16Array, ty: number, cx: number, cz: number): void {
    const stoneBricks = getFeatureBlockId('Stone Bricks') || 3;
    const mossyBricks = getFeatureBlockId('Mossy Stone Bricks') || 19;
    const crackedBricks = getFeatureBlockId('Cracked Stone Bricks') || 3;
    const obelisk = getFeatureBlockId('Ancient Obelisk') || 3;

    const centerX = 8;
    const centerZ = 8;
    const radius = 3.5;

    for (let dx = 3; dx <= 13; dx++) {
      for (let dz = 3; dz <= 13; dz++) {
        const dist = Math.hypot(dx - centerX, dz - centerZ);
        if (dist <= radius) {
          this.setBlockInChunk(data, dx, ty, dz, stoneBricks);
        }
      }
    }

    for (let dy = 1; dy <= 8; dy++) {
      for (let dx = 3; dx <= 13; dx++) {
        for (let dz = 3; dz <= 13; dz++) {
          const dist = Math.hypot(dx - centerX, dz - centerZ);
          if (dist >= radius - 0.75 && dist <= radius + 0.75) {
            const decayChance = 0.1 + (dy * 0.1);
            if (this.rand2D(dx + cx, dz + cz + dy, 822) > decayChance) {
              const blockRoll = this.rand2D(dx - cx, dz - cz - dy, 823);
              const bId = blockRoll < 0.35 ? mossyBricks : blockRoll < 0.6 ? crackedBricks : stoneBricks;
              this.setBlockInChunk(data, dx, ty + dy, dz, bId);
            } else {
              this.setBlockInChunk(data, dx, ty + dy, dz, 0);
            }
          } else if (dist < radius - 0.75) {
            const angle = Math.atan2(dz - centerZ, dx - centerX) + Math.PI;
            const targetHeight = Math.floor((angle / (2 * Math.PI)) * 6) + 1;
            if (dy === targetHeight) {
              this.setBlockInChunk(data, dx, ty + dy, dz, stoneBricks);
            } else if (dy < targetHeight) {
              this.setBlockInChunk(data, dx, ty + dy, dz, 3);
            } else {
              this.setBlockInChunk(data, dx, ty + dy, dz, 0);
            }
          }
        }
      }
    }

    this.setBlockInChunk(data, centerX, ty + 1, centerZ, obelisk);
    this.setBlockInChunk(data, centerX - 1, ty + 1, centerZ, 23);
  }

  private spawnDesertCrypt(data: Uint16Array, ty: number, cx: number, cz: number): void {
    const chiseledStone = getFeatureBlockId('Chiseled Stone') || 3;
    const goldBlock = getFeatureBlockId('Gold Block') || 17;
    const obelisk = getFeatureBlockId('Ancient Obelisk') || 3;

    for (let dx = 3; dx <= 12; dx++) {
      for (let dz = 4; dz <= 11; dz++) {
        this.setBlockInChunk(data, dx, ty, dz, chiseledStone);
      }
    }

    for (let dy = 1; dy <= 4; dy++) {
      for (let dx = 3; dx <= 12; dx++) {
        for (let dz = 4; dz <= 11; dz++) {
          const isEdgeX = dx === 3 || dx === 12;
          const isEdgeZ = dz === 4 || dz === 11;
          if (isEdgeX || isEdgeZ) {
            const decay = 0.08 + (dy * 0.1);
            if (this.rand2D(dx + cx, dz + cz + dy, 832) > decay) {
              const blockRoll = this.rand2D(dx - cx, dz - cz - dy, 833);
              const bId = blockRoll < 0.6 ? chiseledStone : 3;
              this.setBlockInChunk(data, dx, ty + dy, dz, bId);
            } else {
              this.setBlockInChunk(data, dx, ty + dy, dz, 0);
            }
          } else {
            this.setBlockInChunk(data, dx, ty + dy, dz, 0);
          }
        }
      }
    }

    const corners = [[3, 4], [3, 11], [12, 4], [12, 11]];
    for (const [px, pz] of corners) {
      this.setBlockInChunk(data, px, ty + 1, pz, goldBlock);
      this.setBlockInChunk(data, px, ty + 2, pz, chiseledStone);
      this.setBlockInChunk(data, px, ty + 3, pz, goldBlock);
    }

    this.setBlockInChunk(data, 7, ty + 1, 7, obelisk);
    this.setBlockInChunk(data, 8, ty + 1, 8, 23);
  }

  private generateLobbyColumn(data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number): void {
    const quartz = getFeatureBlockId('Quartz Block') || 10;
    const stoneBricks = getFeatureBlockId('Stone Bricks') || 3;
    const cracked = getFeatureBlockId('Cracked Stone Bricks') || stoneBricks;
    const mossy = getFeatureBlockId('Mossy Stone Bricks') || stoneBricks;
    const redWool = getFeatureBlockId('Red Wool') || quartz;
    const blueWool = getFeatureBlockId('Blue Wool') || quartz;
    const greenWool = getFeatureBlockId('Green Wool') || quartz;
    const yellowWool = getFeatureBlockId('Yellow Wool') || quartz;
    const purpleWool = getFeatureBlockId('Purple Wool') || quartz;
    const whiteWool = getFeatureBlockId('White Wool') || quartz;
    const glass = 11;
    const glowstone = getFeatureBlockId('Glowstone') || 32;
    const goldBlock = getFeatureBlockId('Gold Block') || glowstone;
    const planks = 15;
    const torch = 21;
    const portal = 29;
    const chain = getFeatureBlockId('Chain') || cracked;
    const bookshelf = 20;
    const chest = 23;
    const dx = gx - 8;
    const dz = gz - 8;
    const ax = Math.abs(dx);
    const az = Math.abs(dz);
    const inCastle = ax <= 52 && az <= 52;
    const outerWall = inCastle && (ax >= 48 || az >= 48);
    const tower = inCastle && ax >= 42 && az >= 42;
    const gate = (az >= 48 && ax <= 5) || (ax >= 48 && az <= 5);
    const centralCourt = ax <= 10 && az <= 10;
    const inCrossPath = ax <= 3 || az <= 3 || (Math.abs(ax - az) <= 1 && ax <= 28 && az <= 28);
    const pillar = ax <= 42 && az <= 42 && ax >= 12 && az >= 12 && ax % 12 === 0 && az % 12 === 0;
    const balcony = (gy: number) => gy === 73 && ((ax >= 34 && ax <= 45 && az <= 45) || (az >= 34 && az <= 45 && ax <= 45));
    const floorPattern = (gx * 17 + gz * 31) % 11 === 0;
    const portalDefs = [
      { x: 8, z: -18, color: blueWool, accent: whiteWool },
      { x: 8, z: 34, color: redWool, accent: yellowWool },
      { x: -18, z: 8, color: yellowWool, accent: whiteWool },
      { x: 34, z: 8, color: greenWool, accent: goldBlock },
      { x: -18, z: -18, color: purpleWool, accent: cracked },
    ];

    const portalBlockFor = (gy: number): number => {
      for (const def of portalDefs) {
        const pdx = Math.abs(gx - def.x);
        const pdz = Math.abs(gz - def.z);
        if (pdx <= 2 && pdz <= 1 && gy >= 65 && gy <= 68) return portal;
        if (gy >= 65 && gy <= 69) {
          const sideFrame = (pdx === 3 && pdz <= 2) || (pdz === 2 && pdx <= 3);
          const topFrame = gy === 69 && pdx <= 3 && pdz <= 2;
          if (sideFrame || topFrame) return def.color;
        }
        if (gy === 70 && pdx <= 2 && pdz === 3) return def.accent;
        if (gy === 64 && pdx <= 3 && pdz <= 3) return def.color;
      }
      return 0;
    };

    for (let ly = 0; ly < 16; ly++) {
      const gy = startY + ly;
      if (!inCastle) continue;

      const portalBlock = portalBlockFor(gy);
      if (portalBlock) {
        this.setBlockInChunk(data, lx, ly, lz, portalBlock);
        continue;
      }

      if (gy >= 58 && gy <= 63) {
        this.setBlockInChunk(data, lx, ly, lz, stoneBricks);
      } else if (gy === 64) {
        if (outerWall) this.setBlockInChunk(data, lx, ly, lz, cracked);
        else if (centralCourt) this.setBlockInChunk(data, lx, ly, lz, glowstone);
        else if (inCrossPath) this.setBlockInChunk(data, lx, ly, lz, planks);
        else if (floorPattern) this.setBlockInChunk(data, lx, ly, lz, mossy);
        else this.setBlockInChunk(data, lx, ly, lz, quartz);
      } else if (gy >= 65 && gy <= (tower ? 91 : 82) && outerWall && !gate) {
        const window = !tower && gy >= 69 && gy <= 75 && ((ax === 48 && az % 8 === 0) || (az === 48 && ax % 8 === 0));
        this.setBlockInChunk(data, lx, ly, lz, window ? glass : ((gx + gy + gz) % 9 === 0 ? cracked : stoneBricks));
      } else if (gy === 83 && outerWall && !gate && ((gx + gz) % 2 === 0)) {
        this.setBlockInChunk(data, lx, ly, lz, stoneBricks);
      } else if (gy >= 65 && gy <= 78 && pillar) {
        this.setBlockInChunk(data, lx, ly, lz, gy % 5 === 0 ? glowstone : stoneBricks);
      } else if (balcony(gy) && !centralCourt) {
        this.setBlockInChunk(data, lx, ly, lz, planks);
      } else if (gy === 82 && ax <= 45 && az <= 45 && !centralCourt) {
        const skylight = ax <= 7 || az <= 7 || (ax % 11 === 0 && az % 11 === 0);
        this.setBlockInChunk(data, lx, ly, lz, skylight ? glass : cracked);
      } else if (gy >= 78 && gy <= 81 && ax % 16 === 0 && az % 16 === 0 && ax <= 32 && az <= 32) {
        this.setBlockInChunk(data, lx, ly, lz, gy === 78 ? glowstone : chain);
      } else if (gy === 65 && ((az === 12 && ax >= 16 && ax <= 32 && ax % 4 === 0) || (ax === 12 && az >= 16 && az <= 32 && az % 4 === 0))) {
        this.setBlockInChunk(data, lx, ly, lz, planks);
      } else if (gy === 66 && ((az === 13 && ax >= 16 && ax <= 32 && ax % 4 === 0) || (ax === 13 && az >= 16 && az <= 32 && az % 4 === 0))) {
        this.setBlockInChunk(data, lx, ly, lz, bookshelf);
      } else if (gy === 65 && ((dx === -36 && dz === -30) || (dx === 28 && dz === -24) || (dx === -28 && dz === 28) || (dx === 20 && dz === 30))) {
        this.setBlockInChunk(data, lx, ly, lz, chest);
      } else if (gy >= 66 && gy <= 74) {
        const parkour = [
          [18, -6, 66], [21, -9, 67], [24, -12, 68], [27, -15, 70],
          [-8, 18, 66], [-11, 21, 67], [-15, 24, 69], [-19, 26, 71],
          [6, 27, 66], [10, 30, 68], [14, 32, 70], [18, 34, 72],
        ];
        for (const [px, pz, py] of parkour) {
          if (dx === px && dz === pz && gy === py) {
            this.setBlockInChunk(data, lx, ly, lz, gy % 2 === 0 ? yellowWool : greenWool);
          }
        }
      } else if (gy === 66 && ((ax === 46 && az % 10 === 0) || (az === 46 && ax % 10 === 0))) {
        this.setBlockInChunk(data, lx, ly, lz, torch);
      }
    }
  }

  private generatePregameLobbyColumn(data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number): void {
    const dx = gx - 8;
    const dz = gz - 96;
    const ax = Math.abs(dx);
    const az = Math.abs(dz);
    const inPlatform = ax <= 22 && az <= 22;
    if (!inPlatform) return;

    const quartz = getFeatureBlockId('Quartz Block') || 10;
    const stoneBricks = getFeatureBlockId('Stone Bricks') || 3;
    const glowstone = getFeatureBlockId('Glowstone') || 32;
    const blueWool = getFeatureBlockId('Blue Wool') || quartz;
    const redWool = getFeatureBlockId('Red Wool') || quartz;
    const yellowWool = getFeatureBlockId('Yellow Wool') || quartz;
    const glass = 11;
    const planks = 15;
    const chest = 23;

    for (let ly = 0; ly < 16; ly++) {
      const gy = startY + ly;
      if (gy >= 69 && gy <= 71) {
        this.setBlockInChunk(data, lx, ly, lz, stoneBricks);
      } else if (gy === 72) {
        if (ax === 22 || az === 22) this.setBlockInChunk(data, lx, ly, lz, glass);
        else if (ax <= 2 || az <= 2) this.setBlockInChunk(data, lx, ly, lz, planks);
        else if ((Math.abs(dx) === 12 && Math.abs(dz) <= 3) || (Math.abs(dz) === 12 && Math.abs(dx) <= 3)) this.setBlockInChunk(data, lx, ly, lz, yellowWool);
        else this.setBlockInChunk(data, lx, ly, lz, quartz);
      } else if (gy === 73) {
        if ((ax === 19 && az === 19) || (ax <= 1 && az <= 1)) {
          this.setBlockInChunk(data, lx, ly, lz, glowstone);
        }
        if ((dx === -6 && dz === -6) || (dx === 6 && dz === -6) || (dx === -6 && dz === 6) || (dx === 6 && dz === 6)) {
          this.setBlockInChunk(data, lx, ly, lz, chest);
        }
      } else if (gy >= 73 && gy <= 79 && (ax === 22 || az === 22)) {
        this.setBlockInChunk(data, lx, ly, lz, gy === 79 ? stoneBricks : glass);
      } else if (gy >= 73 && gy <= 77 && ax === 18 && az === 18) {
        this.setBlockInChunk(data, lx, ly, lz, stoneBricks);
      } else if (gy === 74 && ((dx === -14 && dz === -10) || (dx === -10 && dz === -6) || (dx === -5 && dz === -2) || (dx === 0 && dz === 2) || (dx === 5 && dz === 6) || (dx === 10 && dz === 10))) {
        this.setBlockInChunk(data, lx, ly, lz, blueWool);
      } else if (gy === 75 && ((dx === 14 && dz === -10) || (dx === 10 && dz === -6) || (dx === 5 && dz === -2) || (dx === 0 && dz === 2) || (dx === -5 && dz === 6) || (dx === -10 && dz === 10))) {
        this.setBlockInChunk(data, lx, ly, lz, redWool);
      }
    }
  }

  private generateSkyWarsColumn(data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number): void {
    const grass = 1;
    const dirt = 2;
    const stone = 3;
    const log = getFeatureBlockId('Jungle Log') || 4;
    const leaves = getFeatureBlockId('Jungle Leaves') || 5;
    const mossy = getFeatureBlockId('Mossy Stone Bricks') || stone;
    const cracked = getFeatureBlockId('Cracked Stone Bricks') || stone;
    const planks = 15;
    const glass = 11;
    const chest = 23;
    const glowstone = getFeatureBlockId('Glowstone') || 32;

    const islands = [
      { x: 8, z: 8, radius: 13, height: 61, center: true },
      { x: 38, z: 8, radius: 6, height: 60 }, { x: -22, z: 8, radius: 6, height: 60 },
      { x: 8, z: 38, radius: 6, height: 60 }, { x: 8, z: -22, radius: 6, height: 60 },
      { x: 30, z: 30, radius: 6, height: 60 }, { x: -14, z: -14, radius: 6, height: 60 },
      { x: 30, z: -14, radius: 6, height: 60 }, { x: -14, z: 30, radius: 6, height: 60 },
      { x: 52, z: 8, radius: 5, height: 60 }, { x: -36, z: 8, radius: 5, height: 60 },
      { x: 8, z: 52, radius: 5, height: 60 }, { x: 8, z: -36, radius: 5, height: 60 },
      { x: 52, z: 28, radius: 5, height: 59 }, { x: 52, z: -12, radius: 5, height: 59 },
      { x: -36, z: 28, radius: 5, height: 59 }, { x: -36, z: -12, radius: 5, height: 59 },
      { x: 28, z: 52, radius: 5, height: 59 }, { x: -12, z: 52, radius: 5, height: 59 },
      { x: 28, z: -36, radius: 5, height: 59 }, { x: -12, z: -36, radius: 5, height: 59 },
    ];

    for (const island of islands) {
      const dx = gx - island.x;
      const dz = gz - island.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const wobble = this.noise.noise2D(gx * 0.21, gz * 0.21) * 1.2;
      if (dist <= island.radius + wobble) {
        const top = island.height + Math.floor((Math.cos(dx * 0.38) + Math.cos(dz * 0.38)) * 0.55);
        const depth = island.center ? 12 : 9;
        for (let ly = 0; ly < 16; ly++) {
          const gy = startY + ly;
          const taper = Math.max(1.5, island.radius - Math.max(0, top - gy) * 0.62);
          if (gy === top && dist <= island.radius) {
            this.setBlockInChunk(data, lx, ly, lz, island.center && dist < 4 ? mossy : grass);
          } else if (gy < top && gy >= top - 3 && dist <= taper) {
            this.setBlockInChunk(data, lx, ly, lz, dirt);
          } else if (gy < top - 3 && gy >= top - depth && dist <= taper) {
            this.setBlockInChunk(data, lx, ly, lz, stone);
          } else if (gy < top - depth && gy >= top - depth - 4 && dist <= taper * 0.42) {
            this.setBlockInChunk(data, lx, ly, lz, stone);
          }

          // Glass spawn cages above every player island. They drop visually at match start by server phase.
          if (!island.center && gy >= top + 1 && gy <= top + 4 && Math.abs(dx) <= 1 && Math.abs(dz) <= 1) {
            const shell = Math.abs(dx) === 1 || Math.abs(dz) === 1 || gy === top + 4;
            this.setBlockInChunk(data, lx, ly, lz, shell ? glass : 0);
          }

          // Center ruined shrine / chest stack.
          if (island.center) {
            if (gy === top + 1 && ((Math.abs(dx) === 4 && Math.abs(dz) <= 4) || (Math.abs(dz) === 4 && Math.abs(dx) <= 4))) {
              this.setBlockInChunk(data, lx, ly, lz, cracked);
            }
            if (gy === top + 1 && ((Math.abs(dx) === 2 && Math.abs(dz) === 2) || (dx === 0 && dz === 0))) {
              this.setBlockInChunk(data, lx, ly, lz, chest);
            }
            if (Math.abs(dx) === 1 && Math.abs(dz) === 1 && gy >= top + 1 && gy <= top + 5) this.setBlockInChunk(data, lx, ly, lz, mossy);
            if (dx === 0 && dz === 0 && gy === top + 6) this.setBlockInChunk(data, lx, ly, lz, glowstone);
          } else {
            // Spawn island chest and small jungle tree silhouette.
            if (gy === top + 1 && dx === 0 && dz === -2) this.setBlockInChunk(data, lx, ly, lz, chest);
            if (gy === top + 1 && dx === -2 && dz === 0) this.setBlockInChunk(data, lx, ly, lz, planks);
            if (gy === top + 2 && dx === -2 && dz === 0 && island.radius <= 5) this.setBlockInChunk(data, lx, ly, lz, chest);
            if (dx === 2 && dz === 2 && gy >= top + 1 && gy <= top + 4) this.setBlockInChunk(data, lx, ly, lz, log);
            if (Math.abs(dx - 2) + Math.abs(dz - 2) <= 3 && gy >= top + 4 && gy <= top + 6) this.setBlockInChunk(data, lx, ly, lz, leaves);
          }
        }
        break;
      }
    }

    // Rope/wood bridge hints from the pregame lobby style without connecting every island for free.
    const nearAxisToCenter = (Math.abs(gx - 8) <= 1 && Math.abs(gz - 8) <= 30) || (Math.abs(gz - 8) <= 1 && Math.abs(gx - 8) <= 30);
    const nearOuterRing = (Math.abs(gx - 8) <= 44 && Math.abs(gz - 8) === 20) || (Math.abs(gz - 8) <= 44 && Math.abs(gx - 8) === 20);
    if (nearAxisToCenter) {
      for (let ly = 0; ly < 16; ly++) {
        const gy = startY + ly;
        if (gy === 59 && ((Math.abs(gx - 8) % 5 === 0) || (Math.abs(gz - 8) % 5 === 0))) this.setBlockInChunk(data, lx, ly, lz, planks);
      }
    }
    if (nearOuterRing) {
      for (let ly = 0; ly < 16; ly++) {
        const gy = startY + ly;
        if (gy === 58 && ((gx + gz) % 7 === 0)) this.setBlockInChunk(data, lx, ly, lz, cracked);
      }
    }

    this.generatePregameLobbyColumn(data, gx, lx, gz, lz, startY);
  }

  private generateBedWarsColumn(data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number): void {
    const sand = 6;
    const endstone = getFeatureBlockId('End Stone') || 34;
    const stone = 3;
    const planks = 15;
    const glass = 11;
    const chest = 23;
    const bed = getFeatureBlockId('Bed') || 18;
    const glowstone = getFeatureBlockId('Glowstone') || 32;
    const quartz = getFeatureBlockId('Quartz Block') || 10;
    const redWool = getFeatureBlockId('Red Wool') || 210;
    const blueWool = getFeatureBlockId('Blue Wool') || 210;
    const greenWool = getFeatureBlockId('Green Wool') || 210;
    const yellowWool = getFeatureBlockId('Yellow Wool') || 210;
    const whiteWool = getFeatureBlockId('White Wool') || quartz;
    const cyanWool = getFeatureBlockId('Cyan Wool') || quartz;
    const pinkWool = getFeatureBlockId('Pink Wool') || quartz;
    const grayWool = getFeatureBlockId('Gray Wool') || quartz;
    const emeraldBlock = getFeatureBlockId('Emerald Block') || glowstone;
    const diamondBlock = getFeatureBlockId('Diamond Block') || glowstone;
    const log = getFeatureBlockId('Palm Log') || 4;
    const leaves = getFeatureBlockId('Palm Leaves') || 5;

    const bases = [
      { x: 8, z: -32, wool: redWool, name: 'Red' },
      { x: 8, z: 48, wool: blueWool, name: 'Blue' },
      { x: -32, z: 8, wool: greenWool, name: 'Green' },
      { x: 48, z: 8, wool: yellowWool, name: 'Yellow' },
      { x: -36, z: -36, wool: whiteWool, name: 'White' },
      { x: 52, z: 52, wool: cyanWool, name: 'Cyan' },
      { x: -36, z: 52, wool: pinkWool, name: 'Pink' },
      { x: 52, z: -36, wool: grayWool, name: 'Gray' },
    ];
    const specials = [
      { x: 8, z: 8, radius: 13, block: emeraldBlock, center: true },
      { x: -12, z: -12, radius: 5, block: diamondBlock },
      { x: 28, z: 28, radius: 5, block: diamondBlock },
      { x: -12, z: 28, radius: 5, block: diamondBlock },
      { x: 28, z: -12, radius: 5, block: diamondBlock },
      { x: -28, z: -4, radius: 5, block: diamondBlock },
      { x: 44, z: 20, radius: 5, block: diamondBlock },
      { x: -4, z: 44, radius: 5, block: diamondBlock },
      { x: 20, z: -28, radius: 5, block: diamondBlock },
    ];

    for (const base of bases) {
      const dx = gx - base.x;
      const dz = gz - base.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= 8.5) {
        for (let ly = 0; ly < 16; ly++) {
          const gy = startY + ly;
          const top = 60 + (dist < 3 ? 1 : 0);
          const taper = Math.max(2, 8.5 - Math.max(0, top - gy) * 0.8);
          if (gy === top && dist <= 8.5) this.setBlockInChunk(data, lx, ly, lz, dist < 4 ? base.wool : sand);
          else if (gy < top && gy >= top - 2 && dist <= taper) this.setBlockInChunk(data, lx, ly, lz, endstone);
          else if (gy < top - 2 && gy >= top - 8 && dist <= taper) this.setBlockInChunk(data, lx, ly, lz, stone);

          // Bed, generator, shops, and clear readable team geometry.
          if (gy === top + 1 && dx === 0 && dz === -2) this.setBlockInChunk(data, lx, ly, lz, bed);
          if (gy === top + 1 && dx === 0 && dz === 2) this.setBlockInChunk(data, lx, ly, lz, glowstone); // team forge generator
          if (gy === top + 1 && dx === -3 && dz === 0) this.setBlockInChunk(data, lx, ly, lz, chest); // item shop placeholder
          if (gy === top + 1 && dx === 3 && dz === 0) this.setBlockInChunk(data, lx, ly, lz, chest); // upgrade shop placeholder
          if ((Math.abs(dx) === 6 || Math.abs(dz) === 6) && gy === top + 1 && dist <= 8.5) this.setBlockInChunk(data, lx, ly, lz, base.wool);
        }
        return;
      }
    }

    for (const island of specials) {
      const dx = gx - island.x;
      const dz = gz - island.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= island.radius) {
        for (let ly = 0; ly < 16; ly++) {
          const gy = startY + ly;
          const top = island.center ? 62 : 61;
          const taper = Math.max(2, island.radius - Math.max(0, top - gy) * 0.62);
          if (gy === top && dist <= island.radius) this.setBlockInChunk(data, lx, ly, lz, island.center ? quartz : endstone);
          else if (gy < top && gy >= top - 3 && dist <= taper) this.setBlockInChunk(data, lx, ly, lz, stone);
          else if (gy < top - 3 && gy >= top - 8 && dist <= taper) this.setBlockInChunk(data, lx, ly, lz, stone);

          if (gy === top + 1 && dx === 0 && dz === 0) this.setBlockInChunk(data, lx, ly, lz, island.block);
          if (island.center) {
            // Lighthouse tower inspired silhouette, original layout/assets.
            if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2 && gy >= top + 1 && gy <= top + 15) {
              const shell = Math.abs(dx) === 2 || Math.abs(dz) === 2 || gy === top + 15;
              if (shell) this.setBlockInChunk(data, lx, ly, lz, gy % 5 === 0 ? redWool : quartz);
            }
            if (Math.abs(dx) <= 3 && Math.abs(dz) <= 3 && gy === top + 16) this.setBlockInChunk(data, lx, ly, lz, planks);
            if (dx === 0 && dz === 0 && gy === top + 17) this.setBlockInChunk(data, lx, ly, lz, glowstone);
          }
        }
        return;
      }
    }

    // Diagonal and cardinal bridge starter pads: encourages readable rush routes over the void.
    const bridge = ((Math.abs(gx - 8) <= 1 && gz > -38 && gz < 54) || (Math.abs(gz - 8) <= 1 && gx > -38 && gx < 54));
    const diagonalBridge = (
      Math.abs((gx - 8) - (gz - 8)) <= 1 ||
      Math.abs((gx - 8) + (gz - 8)) <= 1
    ) && gx > -38 && gx < 54 && gz > -38 && gz < 54;
    if (bridge || diagonalBridge) {
      for (let ly = 0; ly < 16; ly++) {
        const gy = startY + ly;
        if (gy === 59) this.setBlockInChunk(data, lx, ly, lz, planks);
        if (gy === 60 && ((gx + gz) % 9 === 0)) this.setBlockInChunk(data, lx, ly, lz, glass);
      }
    }

    // Small palm silhouettes around center for that tropical/floating-island vibe.
    const palmAnchors = [[-1, 18], [17, -2], [19, 19]];
    for (const [px, pz] of palmAnchors) {
      const dx = gx - px;
      const dz = gz - pz;
      for (let ly = 0; ly < 16; ly++) {
        const gy = startY + ly;
        if (dx === 0 && dz === 0 && gy >= 63 && gy <= 67) this.setBlockInChunk(data, lx, ly, lz, log);
        if (Math.abs(dx) + Math.abs(dz) <= 3 && gy >= 67 && gy <= 69) this.setBlockInChunk(data, lx, ly, lz, leaves);
      }
    }

    this.generatePregameLobbyColumn(data, gx, lx, gz, lz, startY);
  }


  private generateSurvivalGamesColumn(data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number): void {
    this.generateSurvival247Column(data, gx, lx, gz, lz, startY);
    generateCrownForgeSurvivalGamesOverlay(data, gx, lx, gz, lz, startY);
  }

  private generateVoidDuelsColumn(data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number): void {
    const stoneBricks = getFeatureBlockId('Stone Bricks') || 3;
    const quartz = getFeatureBlockId('Quartz Block') || 10;
    const glass = 11;
    const glowstone = getFeatureBlockId('Glowstone') || 32;
    const dx = gx - 8;
    const dz = gz - 8;
    const distSq = dx * dx + dz * dz;
    const absX = Math.abs(dx);
    const absZ = Math.abs(dz);

    for (let ly = 0; ly < 16; ly++) {
      const gy = startY + ly;
      if (gy === 62 && distSq <= 18 * 18) {
        this.setBlockInChunk(data, lx, ly, lz, stoneBricks);
      } else if (gy === 63 && distSq <= 15 * 15) {
        const ring = distSq > 13 * 13;
        this.setBlockInChunk(data, lx, ly, lz, ring ? quartz : stoneBricks);
      } else if (gy === 64) {
        if ((absX === 16 && absZ <= 16) || (absZ === 16 && absX <= 16)) {
          this.setBlockInChunk(data, lx, ly, lz, glass);
        }
        if ((gx === -6 && gz === 8) || (gx === 22 && gz === 8) || (gx === 8 && gz === 8)) {
          this.setBlockInChunk(data, lx, ly, lz, glowstone);
        }
      }
    }
    this.generatePregameLobbyColumn(data, gx, lx, gz, lz, startY);
  }

  private generateCastleSiegeColumn(data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number): void {
    const stoneBricks = getFeatureBlockId('Stone Bricks') || 3;
    const cracked = getFeatureBlockId('Cracked Stone Bricks') || stoneBricks;
    const mossy = getFeatureBlockId('Mossy Stone Bricks') || stoneBricks;
    const planks = 15;
    const torch = 21;
    const gravel = getFeatureBlockId('Gravel') || 2;
    const x = gx - 8;
    const z = gz - 8;
    const ax = Math.abs(x);
    const az = Math.abs(z);
    const inNorthCastle = z < -18 && ax <= 22 && z >= -54;
    const inSouthCastle = z > 18 && ax <= 22 && z <= 54;
    const inBridge = ax <= 4 && Math.abs(z) <= 22;
    const inField = ax <= 30 && az <= 56;

    for (let ly = 0; ly < 16; ly++) {
      const gy = startY + ly;

      if (gy < 60 && inField) {
        this.setBlockInChunk(data, lx, ly, lz, 3);
        continue;
      }

      if (gy === 60 && inField) {
        if (inBridge) this.setBlockInChunk(data, lx, ly, lz, planks);
        else if (inNorthCastle || inSouthCastle) this.setBlockInChunk(data, lx, ly, lz, stoneBricks);
        else this.setBlockInChunk(data, lx, ly, lz, 1);
      }

      // Outer castle walls and gatehouses.
      const inCastle = inNorthCastle || inSouthCastle;
      if (inCastle) {
        const localZ = inNorthCastle ? z + 36 : z - 36;
        const wall = ax === 22 || Math.abs(localZ) === 18;
        const gate = ax <= 3 && Math.abs(localZ) === 18;
        const tower = (ax >= 18 && Math.abs(localZ) >= 14);
        if (gy >= 61 && gy <= (tower ? 75 : 69) && wall && !gate) {
          const block = ((gx + gy + gz) % 7 === 0) ? cracked : ((gx - gz + gy) % 11 === 0 ? mossy : stoneBricks);
          this.setBlockInChunk(data, lx, ly, lz, block);
        }
        if (gy === 70 && wall && !gate && ((gx + gz) % 2 === 0)) {
          this.setBlockInChunk(data, lx, ly, lz, stoneBricks);
        }
        if (gy === 61 && !wall && Math.abs(localZ) < 12 && ax < 12 && ((gx * 31 + gz * 17) % 19 === 0)) {
          this.setBlockInChunk(data, lx, ly, lz, gravel);
        }
        if (gy === 70 && wall && ((gx + gz) % 9 === 0)) {
          this.setBlockInChunk(data, lx, ly, lz, torch);
        }
      }

      // Center control obelisk.
      if (ax <= 1 && az <= 1 && gy >= 61 && gy <= 72) {
        this.setBlockInChunk(data, lx, ly, lz, gy === 72 ? torch : cracked);
      }
    }
    this.generatePregameLobbyColumn(data, gx, lx, gz, lz, startY);
  }

  private generateSurvival247Column(data: Uint16Array, gx: number, lx: number, gz: number, lz: number, startY: number): void {
    this.generateOverworldColumn(data, gx, lx, gz, lz, startY);

    if (gx >= -12 && gx <= 28 && gz >= -12 && gz <= 28) {
      const stoneBricks = getFeatureBlockId('Stone Bricks') || 3;
      const oakWood = 15;
      
      for (let ly = 0; ly < 16; ly++) {
        const gy = startY + ly;
        if (gy < 64) {
          this.setBlockInChunk(data, lx, ly, lz, 3);
        } else if (gy === 64) {
          if (gx === 8 || gz === 8) {
            this.setBlockInChunk(data, lx, ly, lz, stoneBricks);
          } else {
            this.setBlockInChunk(data, lx, ly, lz, 1);
          }
        } else if (gy > 64) {
          this.setBlockInChunk(data, lx, ly, lz, 0);
          
          if (gx === 14 && gz === 14 && gy >= 65 && gy <= 68) {
            this.setBlockInChunk(data, lx, ly, lz, oakWood);
          }
        }
      }
    }
  }
}

function lxToIdx(x: number, y: number, z: number): number {
  return x + (y << 4) + (z << 8);
}
