import * as THREE from 'three';
import { BlockRegistry } from '../world/BlockRegistry';
import { getFeatureBlockStyle, getFeatureItemStyle, type GeneratedTextureStyle } from '../content/FeatureCatalog';
import { ItemRegistry } from '../items/ItemRegistry';

export class TextureGenerator {
  public static atlasCanvas: HTMLCanvasElement | null = null;
  public static atlasTexture: THREE.CanvasTexture | null = null;

  private static pendingTextures: Map<number, string> = new Map();
  private static customIcons: Map<number, string> = new Map();
  private static itemIconCache: Map<number, string> = new Map();

  public static registerModTexture(tileIndex: number, imageSrc: string): void {
    this.pendingTextures.set(tileIndex, imageSrc);
  }

  public static registerCustomIcon(itemId: number, dataUrl: string): void {
    this.customIcons.set(itemId, dataUrl);
    this.itemIconCache.delete(itemId);
  }

  public static async generateAtlas(): Promise<THREE.CanvasTexture> {
    const tileSize = 16;
    const cols = 16;
    const rows = 96;
    const canvas = document.createElement('canvas');
    canvas.width = cols * tileSize;
    canvas.height = rows * tileSize;
    const ctx = canvas.getContext('2d')!;

    // Helper: Fill a tile with random noise matching a base color
    const drawNoiseTile = (
      tileX: number, tileY: number,
      r: number, g: number, b: number,
      noiseAmount: number
    ) => {
      const startX = tileX * tileSize;
      const startY = tileY * tileSize;
      for (let y = 0; y < tileSize; y++) {
        for (let x = 0; x < tileSize; x++) {
          const noise = (Math.random() - 0.5) * noiseAmount;
          const nr = Math.max(0, Math.min(255, r + noise));
          const ng = Math.max(0, Math.min(255, g + noise));
          const nb = Math.max(0, Math.min(255, b + noise));
          ctx.fillStyle = `rgb(${Math.floor(nr)},${Math.floor(ng)},${Math.floor(nb)})`;
          ctx.fillRect(startX + x, startY + y, 1, 1);
        }
      }
    };

    // Helper: Draw border highlights for voxel grid appeal
    const drawBevel = (tileX: number, tileY: number, opacity: number = 0.25) => {
      const startX = tileX * tileSize;
      const startY = tileY * tileSize;
      // top/left highlight
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.fillRect(startX, startY, tileSize, 1);
      ctx.fillRect(startX, startY, 1, tileSize);
      // bottom/right shadow
      ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
      ctx.fillRect(startX, startY + tileSize - 1, tileSize, 1);
      ctx.fillRect(startX + tileSize - 1, startY, 1, tileSize);
    };


    const drawOreClusters = (tileX: number, tileY: number, color: [number, number, number]) => {
      const startX = tileX * tileSize;
      const startY = tileY * tileSize;
      const clusters = [
        [3, 2, 3, 3], [10, 3, 3, 2], [5, 8, 4, 3], [11, 10, 3, 4], [2, 12, 2, 2]
      ];
      clusters.forEach(([cx, cy, w, h], idx) => {
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            const edge = px === 0 || py === 0 || px === w - 1 || py === h - 1;
            const chip = Math.sin((px + cx + idx * 7) * 13.37 + (py + cy) * 9.91) > -0.35;
            if (!chip) continue;
            const light = edge ? -32 : 34;
            ctx.fillStyle = `rgb(${Math.max(0, Math.min(255, color[0] + light))},${Math.max(0, Math.min(255, color[1] + light))},${Math.max(0, Math.min(255, color[2] + light))})`;
            ctx.fillRect(startX + cx + px, startY + cy + py, 1, 1);
          }
        }
      });
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fillRect(startX + 4, startY + 2, 1, 1);
      ctx.fillRect(startX + 12, startY + 10, 1, 1);
    };

    const drawGeneratedTile = (tileIndex: number, style: GeneratedTextureStyle, label: string) => {
      const tileX = tileIndex % cols;
      const tileY = Math.floor(tileIndex / cols);
      if (tileY >= rows) return;

      const [r, g, b] = style.base;
      const [ar, ag, ab] = style.accent ?? [
        Math.max(0, r - 42),
        Math.max(0, g - 42),
        Math.max(0, b - 42),
      ];
      const sx = tileX * tileSize;
      const sy = tileY * tileSize;

      ctx.clearRect(sx, sy, tileSize, tileSize);
      if (style.pattern === 'plant' || style.pattern === 'leaves') {
        for (let y = 0; y < tileSize; y++) {
          for (let x = 0; x < tileSize; x++) {
            const seed = Math.sin((x + tileIndex) * 17.13 + (y + 3) * 41.7) * 43758.5453;
            const roll = seed - Math.floor(seed);
            const centerBias = Math.abs(x - 7.5) + Math.abs(y - 7.5);
            if (style.pattern === 'plant' && (centerBias > 10 || roll > 0.66)) continue;
            if (style.pattern === 'leaves' && roll > 0.84) continue;
            const shade = (roll - 0.5) * 36;
            ctx.fillStyle = `rgba(${Math.floor(r + shade)},${Math.floor(g + shade)},${Math.floor(b + shade)},0.95)`;
            ctx.fillRect(sx + x, sy + y, 1, 1);
          }
        }
      } else if (style.pattern === 'glass') {
        ctx.fillStyle = `rgba(${r},${g},${b},0.22)`;
        ctx.fillRect(sx + 1, sy + 1, 14, 14);
        ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.72)`;
        ctx.strokeRect(sx, sy, tileSize, tileSize);
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillRect(sx + 4, sy + 3, 1, 5);
        ctx.fillRect(sx + 5, sy + 3, 4, 1);
      } else {
        drawNoiseTile(tileX, tileY, r, g, b, style.pattern === 'cloth' ? 16 : 28);

        if (style.pattern === 'ore') {
          drawOreClusters(tileX, tileY, [ar, ag, ab]);
        } else if (style.pattern === 'planks') {
          ctx.fillStyle = `rgba(${ar},${ag},${ab},0.55)`;
          ctx.fillRect(sx, sy + 5, tileSize, 1);
          ctx.fillRect(sx, sy + 10, tileSize, 1);
          ctx.fillRect(sx + 4, sy, 1, 5);
          ctx.fillRect(sx + 10, sy + 5, 1, 5);
          ctx.fillRect(sx + 7, sy + 10, 1, 6);
        } else if (style.pattern === 'log') {
          ctx.fillStyle = `rgba(${ar},${ag},${ab},0.55)`;
          for (let x = 1; x < tileSize; x += 4) ctx.fillRect(sx + x, sy, 1, tileSize);
          ctx.fillStyle = `rgba(${Math.max(0, ar - 28)},${Math.max(0, ag - 24)},${Math.max(0, ab - 18)},0.65)`;
          ctx.fillRect(sx + 5, sy + 2, 3, 2);
          ctx.fillRect(sx + 10, sy + 9, 4, 2);
          ctx.fillRect(sx + 2, sy + 12, 2, 2);
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(sx + 6, sy, 1, tileSize);
          ctx.fillRect(sx + 12, sy, 1, tileSize);
        } else if (style.pattern === 'brick' || style.pattern === 'utility') {
          ctx.fillStyle = `rgba(${ar},${ag},${ab},0.58)`;
          ctx.fillRect(sx, sy + 7, tileSize, 1);
          ctx.fillRect(sx, sy + 15, tileSize, 1);
          ctx.fillRect(sx + 4, sy, 1, 7);
          ctx.fillRect(sx + 12, sy + 8, 1, 7);
        } else if (style.pattern === 'metal') {
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillRect(sx + 2, sy + 2, 12, 2);
          ctx.fillStyle = `rgba(${ar},${ag},${ab},0.55)`;
          ctx.fillRect(sx + 2, sy + 12, 12, 2);
        } else if (style.pattern === 'cloth') {
          ctx.fillStyle = `rgba(${ar},${ag},${ab},0.22)`;
          for (let i = 1; i < tileSize; i += 4) {
            ctx.fillRect(sx, sy + i, tileSize, 1);
            ctx.fillRect(sx + i, sy, 1, tileSize);
          }
        }
      }

      const hash = Array.from(label).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      if (style.pattern !== 'plant' && style.pattern !== 'leaves' && hash % 3 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(sx + 2, sy + 2, 4, 1);
      }
      drawBevel(tileX, tileY, style.pattern === 'metal' ? 0.28 : 0.16);
    };

    // Clear background
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 0: Grass Top (rich green)
    drawNoiseTile(0, 0, 86, 172, 53, 25);
    drawBevel(0, 0, 0.15);

    // 1: Grass Side (dirt bottom + green overhang)
    drawNoiseTile(1, 0, 114, 82, 59, 20); // base dirt
    const sX = 1 * tileSize;
    for (let x = 0; x < tileSize; x++) {
      const hang = 3 + Math.floor(Math.random() * 3); // overhang height 3 to 5px
      for (let y = 0; y < hang; y++) {
        const noise = (Math.random() - 0.5) * 20;
        ctx.fillStyle = `rgb(${Math.floor(86 + noise)},${Math.floor(172 + noise)},${Math.floor(53 + noise)})`;
        ctx.fillRect(sX + x, y, 1, 1);
      }
    }
    // border shadow overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(sX, 0, tileSize, 1);

    // 2: Dirt (rich brown)
    drawNoiseTile(2, 0, 114, 82, 59, 20);
    drawBevel(2, 0, 0.12);

    // 3: Stone (slate grey)
    drawNoiseTile(3, 0, 125, 125, 125, 30);
    // Draw crack specs
    ctx.fillStyle = '#656565';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(3 * tileSize + Math.floor(Math.random() * 14), Math.floor(Math.random() * 14), 2, 1);
    }
    drawBevel(3, 0, 0.2);

    // 4: Wood Log Side (bark ridges + knots, not planks)
    drawNoiseTile(4, 0, 95, 68, 48, 15);
    ctx.fillStyle = 'rgba(50, 30, 20, 0.48)';
    for (let x = 2; x < tileSize; x += 4) {
      ctx.fillRect(4 * tileSize + x, 0, 1, tileSize);
    }
    ctx.fillStyle = 'rgba(42, 24, 14, 0.62)';
    ctx.fillRect(4 * tileSize + 5, 3, 4, 2);
    ctx.fillRect(4 * tileSize + 10, 10, 3, 2);
    ctx.fillStyle = 'rgba(220, 170, 112, 0.15)';
    ctx.fillRect(4 * tileSize + 7, 0, 1, tileSize);
    drawBevel(4, 0, 0.25);

    // 5: Wood Log Top (rings)
    drawNoiseTile(5, 0, 206, 177, 133, 10);
    ctx.strokeStyle = 'rgba(100, 70, 50, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(5 * tileSize + 8, 8, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(5 * tileSize + 8, 8, 3, 0, Math.PI * 2);
    ctx.stroke();
    // bark border
    ctx.strokeStyle = 'rgb(95, 68, 48)';
    ctx.lineWidth = 1;
    ctx.strokeRect(5 * tileSize, 0, tileSize, tileSize);

    // 6: Leaves (alpha-cutout clusters)
    // Transparent holes are back, but the shader uses alphaTest + depthWrite so
    // water and other leaves only show through the holes, not through solid leaf pixels.
    const leavesX = 6 * tileSize;
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const cluster = Math.sin(x * 1.7 + y * 0.8) + Math.cos(x * 0.6 - y * 1.4);
        const holeSeed = Math.sin((x + 3) * 12.9898 + (y + 7) * 78.233) * 43758.5453;
        const hole = (holeSeed - Math.floor(holeSeed)) > 0.84 && cluster < 0.95;
        if (hole) {
          ctx.clearRect(leavesX + x, y, 1, 1);
          continue;
        }

        const shade = cluster > 0.55 ? 34 : cluster < -0.45 ? -30 : (Math.random() - 0.5) * 24;
        const r = Math.max(18, Math.min(94, 42 + shade * 0.45));
        const g = Math.max(84, Math.min(190, 134 + shade));
        const b = Math.max(24, Math.min(98, 42 + shade * 0.35));
        const alpha = cluster > 1.05 ? 1.0 : 0.92;
        ctx.fillStyle = `rgba(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)},${alpha})`;
        ctx.fillRect(leavesX + x, y, 1, 1);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(leavesX, 0, tileSize, 1);
    ctx.fillRect(leavesX, 0, 1, tileSize);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(leavesX, tileSize - 1, tileSize, 1);
    ctx.fillRect(leavesX + tileSize - 1, 0, 1, tileSize);

    // 7: Sand (pale beige)
    drawNoiseTile(7, 0, 225, 210, 160, 15);
    drawBevel(7, 0, 0.1);

    // 8: Water (layered blue shimmer for the shader to animate)
    const waterX = 8 * tileSize;
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const ripple = Math.sin((x + y) * 0.9) * 10 + Math.cos(x * 1.6 - y * 0.7) * 8;
        const r = 35 + ripple * 0.25;
        const g = 115 + ripple;
        const b = 220 + ripple * 0.9;
        ctx.fillStyle = `rgba(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)},0.9)`;
        ctx.fillRect(waterX + x, y, 1, 1);
      }
    }
    // overlay wave highlights
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(waterX + 1, 3, 6, 1);
    ctx.fillRect(waterX + 8, 8, 7, 1);
    ctx.fillRect(waterX + 3, 13, 5, 1);

    // 9: Coal Ore (Stone + clustered coal veins)
    drawNoiseTile(9, 0, 125, 125, 125, 25);
    drawOreClusters(9, 0, [32, 32, 32]);
    drawBevel(9, 0, 0.18);

    // 10: Iron Ore (Stone + clustered raw iron flecks)
    drawNoiseTile(10, 0, 125, 125, 125, 25);
    drawOreClusters(10, 0, [212, 154, 106]);
    drawBevel(10, 0, 0.18);

    // 11: Brick (red bricks + grey mortar)
    const brickX = 11 * tileSize;
    ctx.fillStyle = '#b04030';
    ctx.fillRect(brickX, 0, tileSize, tileSize);
    // Mortar lines
    ctx.fillStyle = '#b0b0b0';
    ctx.fillRect(brickX, 7, tileSize, 1);
    ctx.fillRect(brickX, 15, tileSize, 1);
    ctx.fillRect(brickX + 4, 0, 1, 7);
    ctx.fillRect(brickX + 12, 8, 1, 7);
    drawBevel(11, 0, 0.2);

    // 12: Glass (border + glint)
    const glassX = 12 * tileSize;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(glassX + 1, 1, 14, 14);
    // Border outline
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.strokeRect(glassX, 0, tileSize, tileSize);
    // White light glint lines
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillRect(glassX + 3, 3, 1, 1);
    ctx.fillRect(glassX + 4, 4, 2, 1);
    ctx.fillRect(glassX + 11, 11, 2, 1);

    // 13: Tall Grass billboard
    const grassB = 13 * tileSize;
    for (let y = 0; y < tileSize; y++) {
      const width = Math.max(2, Math.floor((16 - y) / 1.5));
      const offset = Math.floor((16 - width) / 2);
      ctx.fillStyle = `rgb(60, ${140 + Math.floor(Math.random() * 40)}, 40)`;
      ctx.fillRect(grassB + offset, y, width, 1);
    }

    // 14: Red Flower billboard
    const redFlowerX = 14 * tileSize;
    // stem
    ctx.fillStyle = '#308020';
    ctx.fillRect(redFlowerX + 7, 7, 2, 9);
    // red petals
    ctx.fillStyle = '#ff2030';
    ctx.fillRect(redFlowerX + 5, 3, 6, 4);
    ctx.fillRect(redFlowerX + 6, 2, 4, 6);
    // yellow center
    ctx.fillStyle = '#ffff30';
    ctx.fillRect(redFlowerX + 7, 4, 2, 2);

    // 15: Yellow Flower billboard
    const yelFlowerX = 15 * tileSize;
    // stem
    ctx.fillStyle = '#308020';
    ctx.fillRect(yelFlowerX + 7, 7, 2, 9);
    // yellow petals
    ctx.fillStyle = '#ffd020';
    ctx.fillRect(yelFlowerX + 5, 3, 6, 4);
    ctx.fillRect(yelFlowerX + 6, 2, 4, 6);
    // orange center
    ctx.fillStyle = '#ff7020';
    ctx.fillRect(yelFlowerX + 7, 4, 2, 2);

    // 16-21: Block Mining Cracks (Cracks 1 to 6)
    // Drawn on Row 1 (y = tileSize)
    for (let step = 0; step < 6; step++) {
      const crackX = step * tileSize;
      const crackY = 1 * tileSize;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      
      // Progressively draw more crack lines
      if (step >= 0) {
        ctx.fillRect(crackX + 2, crackY + 2, 4, 1);
        ctx.fillRect(crackX + 10, crackY + 11, 4, 1);
      }
      if (step >= 1) {
        ctx.fillRect(crackX + 5, crackY + 2, 1, 5);
        ctx.fillRect(crackX + 11, crackY + 7, 1, 5);
      }
      if (step >= 2) {
        ctx.fillRect(crackX + 5, crackY + 6, 6, 1);
        ctx.fillRect(crackX + 2, crackY + 10, 4, 1);
      }
      if (step >= 3) {
        ctx.fillRect(crackX + 9, crackY + 3, 4, 1);
        ctx.fillRect(crackX + 3, crackY + 13, 8, 1);
      }
      if (step >= 4) {
        ctx.fillRect(crackX + 1, crackY + 1, 1, 14);
        ctx.fillRect(crackX + 14, crackY + 1, 1, 14);
      }
      if (step >= 5) {
        ctx.fillRect(crackX + 1, crackY + 1, 14, 1);
        ctx.fillRect(crackX + 1, crackY + 14, 14, 1);
        // add dark cross hatching
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.fillRect(crackX + 4, crackY + 4, 8, 8);
      }
    }

    // 22: Planks (Row 1, Index 6) - Tile X=6, Y=1
    const plankX = 6 * tileSize;
    const plankY = 1 * tileSize;
    // Base wood color
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const noise = (Math.random() - 0.5) * 12;
        ctx.fillStyle = `rgb(${Math.floor(180 + noise)},${Math.floor(145 + noise)},${Math.floor(100 + noise)})`;
        ctx.fillRect(plankX + x, plankY + y, 1, 1);
      }
    }
    // Horizontal lines
    ctx.fillStyle = 'rgba(80, 50, 30, 0.45)';
    ctx.fillRect(plankX, plankY + 5, tileSize, 1);
    ctx.fillRect(plankX, plankY + 10, tileSize, 1);
    ctx.fillRect(plankX, plankY + 15, tileSize, 1);
    // Vertical joins
    ctx.fillRect(plankX + 4, plankY, 1, 5);
    ctx.fillRect(plankX + 11, plankY + 5, 1, 5);
    ctx.fillRect(plankX + 6, plankY + 10, 1, 5);
    drawBevel(6, 1, 0.18);

    // 23: Netherrack (Tile X=7, Y=1)
    drawNoiseTile(7, 1, 110, 20, 20, 20);
    drawBevel(7, 1, 0.22);

    // 24: Soul Sand (Tile X=8, Y=1)
    drawNoiseTile(8, 1, 80, 55, 45, 15);
    drawBevel(8, 1, 0.15);

    // 25: Obsidian (Tile X=9, Y=1)
    drawNoiseTile(9, 1, 15, 10, 25, 10);
    drawBevel(9, 1, 0.3);

    // 26: Portal (Tile X=10, Y=1)
    drawNoiseTile(10, 1, 160, 32, 240, 45);
    drawBevel(10, 1, 0.4);

    // 27: Redstone Wire (Tile X=11, Y=1)
    const rx = 11 * tileSize;
    const ry = 1 * tileSize;
    ctx.fillStyle = 'rgba(255, 20, 20, 0.85)';
    ctx.fillRect(rx + 4, ry + 7, 8, 2);
    ctx.fillRect(rx + 7, ry + 4, 2, 8);

    // 28: Redstone Torch (Tile X=12, Y=1)
    const rtx = 12 * tileSize;
    const rty = 1 * tileSize;
    ctx.fillStyle = '#5c4033';
    ctx.fillRect(rtx + 7, rty + 6, 2, 7);
    ctx.fillStyle = '#ff3300';
    ctx.fillRect(rtx + 6, rty + 2, 4, 4);

    // 29: Redstone Lamp Off (Tile X=13, Y=1)
    drawNoiseTile(13, 1, 60, 30, 20, 10);
    drawBevel(13, 1, 0.2);

    // 30 to 37: Crops stages 0-7
    for (let stage = 0; stage < 8; stage++) {
      let cx = 14 + stage;
      let cy = 1;
      if (cx >= 16) {
        cx -= 16;
        cy += 1;
      }
      const cTileX = cx * tileSize;
      const cTileY = cy * tileSize;
      
      const height = 2 + stage * 2;
      const color = stage === 7 ? 'rgb(218, 165, 32)' : `rgb(40, ${100 + stage * 15}, 30)`;
      ctx.fillStyle = color;
      
      // Draw 3 vertical stalks
      ctx.fillRect(cTileX + 3, cTileY + 16 - height, 1, height);
      ctx.fillRect(cTileX + 8, cTileY + 16 - height, 1, height);
      ctx.fillRect(cTileX + 13, cTileY + 16 - height, 1, height);
    }

    // 38: End Stone (Tile X=6, Y=2)
    drawNoiseTile(6, 2, 230, 230, 170, 15);
    drawBevel(6, 2, 0.15);

    // 39: Bedrock (Tile X=7, Y=2)
    drawNoiseTile(7, 2, 60, 60, 60, 60);
    drawBevel(7, 2, 0.3);

    // 40: Redstone Lamp On (Tile X=8, Y=2)
    drawNoiseTile(8, 2, 230, 180, 60, 20);
    drawBevel(8, 2, 0.25);

    // 41: Gravel (Tile X=9, Y=2)
    drawNoiseTile(9, 2, 115, 110, 105, 30);
    ctx.fillStyle = '#65605a';
    for (let i = 0; i < 10; i++) {
      ctx.fillRect(9 * tileSize + Math.floor(Math.random() * 14), 2 * tileSize + Math.floor(Math.random() * 14), 2, 2);
    }
    drawBevel(9, 2, 0.15);

    // 42: Gold Ore (Tile X=10, Y=2)
    drawNoiseTile(10, 2, 125, 125, 125, 25);
    ctx.fillStyle = '#e6b800';
    ctx.fillRect(10 * tileSize + 4, 2 * tileSize + 2, 3, 2);
    ctx.fillRect(10 * tileSize + 10, 2 * tileSize + 5, 2, 2);
    ctx.fillRect(10 * tileSize + 3, 2 * tileSize + 10, 3, 3);
    ctx.fillRect(10 * tileSize + 11, 2 * tileSize + 11, 2, 2);
    drawBevel(10, 2, 0.18);

    // 43: Diamond Ore (Tile X=11, Y=2)
    drawNoiseTile(11, 2, 125, 125, 125, 25);
    ctx.fillStyle = '#00e6ff';
    ctx.fillRect(11 * tileSize + 3, 2 * tileSize + 4, 3, 2);
    ctx.fillRect(11 * tileSize + 10, 2 * tileSize + 2, 2, 3);
    ctx.fillRect(11 * tileSize + 6, 2 * tileSize + 9, 3, 2);
    ctx.fillRect(11 * tileSize + 11, 2 * tileSize + 10, 3, 3);
    drawBevel(11, 2, 0.18);

    // 44: Mossy Cobblestone (Tile X=12, Y=2)
    drawNoiseTile(12, 2, 120, 120, 120, 20);
    ctx.fillStyle = '#406020';
    ctx.fillRect(12 * tileSize + 2, 2 * tileSize + 1, 4, 5);
    ctx.fillRect(12 * tileSize + 10, 2 * tileSize + 8, 5, 4);
    ctx.fillRect(12 * tileSize + 4, 2 * tileSize + 11, 4, 3);
    drawBevel(12, 2, 0.2);

    // 45: Bookshelf side (Tile X=13, Y=2)
    const bsX = 13 * tileSize;
    const bsY = 2 * tileSize;
    drawNoiseTile(13, 2, 180, 145, 100, 10);
    ctx.fillStyle = '#5c4033';
    ctx.fillRect(bsX, bsY + 4, tileSize, 1);
    ctx.fillRect(bsX, bsY + 10, tileSize, 1);
    ctx.fillStyle = '#cc3333';
    ctx.fillRect(bsX + 2, bsY + 1, 2, 3);
    ctx.fillRect(bsX + 9, bsY + 7, 2, 3);
    ctx.fillStyle = '#3333cc';
    ctx.fillRect(bsX + 5, bsY + 1, 1, 3);
    ctx.fillRect(bsX + 12, bsY + 7, 2, 3);
    ctx.fillStyle = '#33cc33';
    ctx.fillRect(bsX + 7, bsY + 1, 2, 3);
    ctx.fillRect(bsX + 2, bsY + 7, 3, 3);

    // 46: Torch (Tile X=14, Y=2) — readable stick + glowing flame sprite
    const torchX = 14 * tileSize;
    const torchY = 2 * tileSize;
    ctx.clearRect(torchX, torchY, tileSize, tileSize);
    const flameGrad = ctx.createRadialGradient(torchX + 8, torchY + 4, 1, torchX + 8, torchY + 4, 6);
    flameGrad.addColorStop(0, 'rgba(255, 255, 180, 1)');
    flameGrad.addColorStop(0.45, 'rgba(255, 142, 28, 0.95)');
    flameGrad.addColorStop(1, 'rgba(255, 60, 0, 0)');
    ctx.fillStyle = flameGrad;
    ctx.fillRect(torchX + 2, torchY, 12, 10);
    ctx.fillStyle = '#ff8a1c';
    ctx.fillRect(torchX + 6, torchY + 2, 4, 4);
    ctx.fillStyle = '#fff49a';
    ctx.fillRect(torchX + 7, torchY + 3, 2, 2);
    ctx.fillStyle = '#4b2d16';
    ctx.fillRect(torchX + 6, torchY + 6, 4, 10);
    ctx.fillStyle = '#8a552a';
    ctx.fillRect(torchX + 7, torchY + 6, 2, 9);
    ctx.fillStyle = '#24160b';
    ctx.fillRect(torchX + 6, torchY + 15, 4, 1);
    ctx.fillStyle = '#1f1308';
    ctx.fillRect(torchX + 6, torchY + 6, 4, 1);

    // 47: Crafting Table top (Tile X=15, Y=2)
    const ctTopX = 15 * tileSize;
    const ctTopY = 2 * tileSize;
    drawNoiseTile(15, 2, 150, 115, 75, 10);
    ctx.fillStyle = '#5c4033';
    ctx.fillRect(ctTopX, ctTopY, tileSize, 2);
    ctx.fillRect(ctTopX, ctTopY + tileSize - 2, tileSize, 2);
    ctx.fillRect(ctTopX, ctTopY, 2, tileSize);
    ctx.fillRect(ctTopX + tileSize - 2, ctTopY, 2, tileSize);
    ctx.fillStyle = '#888888';
    ctx.fillRect(ctTopX + 4, ctTopY + 4, 3, 3);
    ctx.fillStyle = '#444444';
    ctx.fillRect(ctTopX + 10, ctTopY + 9, 3, 3);

    // 48: Crafting Table side (Tile X=0, Y=3)
    const ctSideX = 0 * tileSize;
    const ctSideY = 3 * tileSize;
    drawNoiseTile(0, 3, 160, 125, 85, 15);
    ctx.fillStyle = '#5c4033';
    ctx.strokeRect(ctSideX + 1, ctSideY + 1, tileSize - 2, tileSize - 2);
    ctx.fillStyle = '#888888';
    ctx.fillRect(ctSideX + 4, ctSideY + 4, 2, 6);
    ctx.fillRect(ctSideX + 10, ctSideY + 5, 2, 5);

    // 49: Chest side/front (Tile X=1, Y=3)
    const chestX = 1 * tileSize;
    const chestY = 3 * tileSize;
    drawNoiseTile(1, 3, 130, 95, 60, 10);
    ctx.fillStyle = '#402a1a';
    ctx.strokeRect(chestX, chestY, tileSize, tileSize);
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(chestX + 7, chestY + 6, 2, 3);
    ctx.fillStyle = '#505050';
    ctx.fillRect(chestX + 7, chestY + 9, 2, 1);

    // 50: Furnace front off (Tile X=2, Y=3)
    const furnaceX = 2 * tileSize;
    const furnaceY = 3 * tileSize;
    drawNoiseTile(2, 3, 100, 100, 100, 15);
    ctx.fillStyle = '#303030';
    ctx.fillRect(furnaceX + 3, furnaceY + 8, 10, 5);
    ctx.fillStyle = '#606060';
    ctx.fillRect(furnaceX, furnaceY, tileSize, 2);
    drawBevel(2, 3, 0.2);

    // 51: Furnace front lit (Tile X=3, Y=3)
    const furnaceLitX = 3 * tileSize;
    const furnaceLitY = 3 * tileSize;
    drawNoiseTile(3, 3, 100, 100, 100, 15);
    ctx.fillStyle = '#ff6600';
    ctx.fillRect(furnaceLitX + 3, furnaceLitY + 8, 10, 5);
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(furnaceLitX + 5, furnaceLitY + 9, 6, 3);
    ctx.fillStyle = '#606060';
    ctx.fillRect(furnaceLitX, furnaceLitY, tileSize, 2);
    drawBevel(3, 3, 0.2);

    // 53: Coal Block (Tile X=5, Y=3)
    const coalBlockX = 5 * tileSize;
    const coalBlockY = 3 * tileSize;
    drawNoiseTile(5, 3, 22, 22, 22, 10);
    // Draw some coal chunk details
    ctx.fillStyle = '#111111';
    ctx.fillRect(coalBlockX + 2, coalBlockY + 2, 4, 4);
    ctx.fillRect(coalBlockX + 10, coalBlockY + 3, 3, 4);
    ctx.fillRect(coalBlockX + 4, coalBlockY + 9, 5, 5);
    ctx.fillStyle = '#2c2c2c';
    ctx.fillRect(coalBlockX + 3, coalBlockY + 3, 2, 2);
    ctx.fillRect(coalBlockX + 11, coalBlockY + 4, 1, 2);
    ctx.fillRect(coalBlockX + 5, coalBlockY + 10, 3, 3);
    drawBevel(5, 3, 0.35);

    for (const block of BlockRegistry.getAll()) {
      const textureIndices = Array.isArray(block.textures) ? block.textures : [block.textures];
      for (const tileIndex of textureIndices) {
        if (tileIndex <= 53 || tileIndex >= cols * rows) continue;
        const style = getFeatureBlockStyle(block.id);
        if (style) {
          drawGeneratedTile(tileIndex, style, block.name);
        }
      }
    }

    // Save canvas reference statically for UI icons
    this.atlasCanvas = canvas;

    // Draw all pending mod textures asynchronously
    const loadPromises = Array.from(this.pendingTextures.entries()).map(([tileIndex, imageSrc]) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const tx = (tileIndex % cols) * tileSize;
          const ty = Math.floor(tileIndex / cols) * tileSize;
          ctx.clearRect(tx, ty, tileSize, tileSize);
          ctx.drawImage(img, tx, ty, tileSize, tileSize);
          resolve();
        };
        img.onerror = () => {
          console.warn(`[TextureGenerator] Failed to load mod texture: ${imageSrc} for tile ${tileIndex}`);
          resolve(); // resolve anyway so we don't freeze the boot sequence
        };
        img.src = imageSrc;
      });
    });

    if (loadPromises.length > 0) {
      await Promise.all(loadPromises);
    }

    // Create THREE Texture
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter; // sharp retro pixel edges
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    this.atlasTexture = texture;
    this.itemIconCache.clear();
    return texture;
  }

  public static getItemIconDataURL(id: number): string {
    const customIcon = this.customIcons.get(id);
    if (customIcon) return customIcon;

    const cached = this.itemIconCache.get(id);
    if (cached) return cached;

    const dataUrl = this.buildItemIconDataURL(id);
    if (dataUrl) this.itemIconCache.set(id, dataUrl);
    return dataUrl;
  }

  private static buildItemIconDataURL(id: number): string {
    if (this.customIcons.has(id)) {
      return this.customIcons.get(id)!;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 16;
    tempCanvas.height = 16;
    const ctx = tempCanvas.getContext('2d')!;

    const getTierColor = (tier: number): string => {
      switch (tier) {
        case 0: return '#866043';
        case 1: return '#8b8b8b';
        case 2: return '#e2e2e2';
        case 3: return '#f4c430';
        case 4: return '#4ee2ec';
        default: return '#ffffff';
      }
    };

    const drawPixelLine = (x0: number, y0: number, x1: number, y1: number, color: string, width = 1) => {
      ctx.fillStyle = color;
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 0 : i / steps;
        const x = Math.round(x0 + (x1 - x0) * t);
        const y = Math.round(y0 + (y1 - y0) * t);
        ctx.fillRect(x, y, width, width);
      }
    };

    const drawHandle = () => {
      drawPixelLine(3, 13, 10, 6, '#5c4033', 2);
      drawPixelLine(4, 13, 10, 7, '#8a6545', 1);
    };

    const drawToolIcon = (type: string, headColor: string) => {
      ctx.clearRect(0, 0, 16, 16);

      if (type === 'bow') {
        ctx.strokeStyle = headColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(3, 3, 11, 0, Math.PI / 2);
        ctx.stroke();
        ctx.strokeStyle = '#e8e0d0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(14, 3);
        ctx.lineTo(3, 14);
        ctx.stroke();
        return;
      }

      if (type === 'sword') {
        drawPixelLine(5, 10, 13, 2, headColor, 2);
        drawPixelLine(7, 10, 14, 3, 'rgba(255,255,255,0.45)', 1);
        ctx.fillStyle = '#5c4033';
        ctx.fillRect(2, 13, 2, 2);
        ctx.fillRect(3, 12, 2, 2);
        ctx.fillStyle = '#d0b070';
        ctx.fillRect(3, 10, 5, 1);
        ctx.fillRect(5, 8, 1, 5);
        return;
      }

      drawHandle();
      ctx.fillStyle = headColor;

      if (type === 'pickaxe') {
        ctx.fillRect(3, 2, 10, 2);
        ctx.fillRect(2, 3, 3, 2);
        ctx.fillRect(11, 3, 3, 2);
        ctx.fillRect(8, 4, 3, 2);
      } else if (type === 'axe') {
        ctx.fillRect(8, 1, 5, 3);
        ctx.fillRect(9, 4, 4, 3);
        ctx.fillRect(7, 2, 2, 5);
        ctx.clearRect(12, 5, 1, 1);
      } else if (type === 'shovel') {
        ctx.fillRect(10, 1, 3, 2);
        ctx.fillRect(9, 3, 5, 3);
        ctx.fillRect(10, 6, 3, 2);
      } else if (type === 'hoe') {
        ctx.fillRect(9, 1, 5, 2);
        ctx.fillRect(9, 3, 2, 3);
      }

      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(9, 2, 2, 1);
    };

    const drawGeneratedItemIcon = (style: GeneratedTextureStyle, itemId: number): string => {
      const [r, g, b] = style.base;
      const [ar, ag, ab] = style.accent ?? [
        Math.max(0, r - 48),
        Math.max(0, g - 48),
        Math.max(0, b - 48),
      ];
      const def = ItemRegistry.get(itemId);
      const type = def?.toolType ?? 'material';
      const itemName = (def?.name || '').toLowerCase();
      ctx.clearRect(0, 0, 16, 16);

      if (itemName.includes('compass') || itemName.includes('clock')) {
        ctx.fillStyle = '#273348';
        ctx.beginPath(); ctx.arc(8, 8, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = itemName.includes('clock') ? '#f3c744' : '#dfe7ff';
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(8, 8, 5, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = itemName.includes('clock') ? '#ffffff' : '#ff4b4b';
        ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(itemName.includes('clock') ? 8 : 12, itemName.includes('clock') ? 3 : 5); ctx.stroke();
        ctx.strokeStyle = '#55b8ff'; ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(5, 11); ctx.stroke();
        return tempCanvas.toDataURL();
      }

      if (itemName.includes('map') || itemName.includes('paper') || itemName.includes('scroll')) {
        ctx.fillStyle = '#dbc38f'; ctx.fillRect(3, 3, 10, 10);
        ctx.fillStyle = '#8d6d3b'; ctx.fillRect(4, 4, 2, 8); ctx.fillRect(10, 4, 2, 8);
        ctx.fillStyle = '#4f8f56'; ctx.fillRect(6, 6, 3, 2); ctx.fillRect(9, 9, 2, 2);
        return tempCanvas.toDataURL();
      }

      if (itemName.includes('book') || itemName.includes('tome')) {
        ctx.fillStyle = '#7b2d2d'; ctx.fillRect(3, 3, 10, 10);
        ctx.fillStyle = '#d9c18a'; ctx.fillRect(5, 4, 6, 8);
        ctx.fillStyle = '#3d1d1d'; ctx.fillRect(3, 3, 2, 10);
        ctx.strokeStyle = '#2a1515'; ctx.strokeRect(3, 3, 10, 10);
        return tempCanvas.toDataURL();
      }

      if (itemName.includes('potion') || itemName.includes('bottle')) {
        ctx.fillStyle = '#cfe9ff'; ctx.fillRect(6, 2, 4, 4); ctx.fillRect(4, 6, 8, 7);
        ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(5, 8, 6, 4);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(6, 4, 2, 2); ctx.fillRect(5, 7, 1, 1);
        return tempCanvas.toDataURL();
      }

      if (itemName.includes('bucket')) {
        ctx.fillStyle = '#9aa8b2'; ctx.fillRect(4, 5, 8, 8); ctx.fillRect(5, 13, 6, 1);
        ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(5, 7, 6, 4);
        ctx.strokeStyle = '#e6eef7'; ctx.beginPath(); ctx.arc(8, 5, 5, Math.PI, 0); ctx.stroke();
        return tempCanvas.toDataURL();
      }

      if (itemName.includes('disc') || itemName.includes('record')) {
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(8, 8, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.beginPath(); ctx.arc(8, 8, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#080808'; ctx.fillRect(8, 8, 1, 1);
        return tempCanvas.toDataURL();
      }

      if (itemName.includes('ingot') || itemName.includes('brick') || itemName.includes('bar')) {
        ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(3, 5, 10, 6);
        ctx.fillStyle = `rgba(${Math.min(255, r + 62)},${Math.min(255, g + 62)},${Math.min(255, b + 62)},0.8)`; ctx.fillRect(4, 6, 8, 2);
        ctx.fillStyle = `rgb(${ar},${ag},${ab})`; ctx.strokeRect(3, 5, 10, 6);
        return tempCanvas.toDataURL();
      }

      if (itemName.includes('gem') || itemName.includes('diamond') || itemName.includes('emerald') || itemName.includes('ruby') || itemName.includes('sapphire') || itemName.includes('crystal') || itemName.includes('shard') || itemName.includes('pearl')) {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath(); ctx.moveTo(8, 2); ctx.lineTo(13, 7); ctx.lineTo(8, 14); ctx.lineTo(3, 7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(6, 5, 2, 2);
        ctx.fillStyle = `rgb(${ar},${ag},${ab})`; ctx.fillRect(8, 8, 3, 3);
        return tempCanvas.toDataURL();
      }

      if (itemName.includes('dust') || itemName.includes('powder') || itemName.includes('ash')) {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        for (let i = 0; i < 18; i++) ctx.fillRect(3 + ((i * 5) % 10), 4 + ((i * 7) % 9), 1 + (i % 2), 1 + ((i + 1) % 2));
        ctx.fillStyle = `rgb(${ar},${ag},${ab})`; ctx.fillRect(7, 7, 3, 2);
        return tempCanvas.toDataURL();
      }

      if (itemName.includes('banner') || itemName.includes('flag')) {
        ctx.fillStyle = '#5c4033'; ctx.fillRect(4, 2, 2, 12);
        ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(6, 3, 7, 6);
        ctx.fillStyle = `rgb(${ar},${ag},${ab})`; ctx.fillRect(7, 5, 5, 2);
        return tempCanvas.toDataURL();
      }

      if (['pickaxe', 'axe', 'shovel', 'sword', 'hoe', 'bow'].includes(type)) {
        drawToolIcon(type, `rgb(${r},${g},${b})`);
        return tempCanvas.toDataURL();
      }

      if (type === 'armor') {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(4, 3, 8, 4);
        ctx.fillRect(3, 7, 10, 6);
        ctx.clearRect(6, 8, 4, 5);
        ctx.fillStyle = `rgba(${ar},${ag},${ab},0.7)`;
        ctx.strokeRect(3, 3, 10, 10);
        return tempCanvas.toDataURL();
      }

      if (type === 'shield') {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(4, 3, 8, 9);
        ctx.fillRect(5, 12, 6, 2);
        ctx.fillStyle = `rgb(${ar},${ag},${ab})`;
        ctx.fillRect(7, 4, 2, 8);
        return tempCanvas.toDataURL();
      }

      if (type === 'food' || type === 'seed') {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(5, 5, 6, 8);
        ctx.fillRect(4, 7, 8, 5);
        ctx.fillStyle = `rgb(${ar},${ag},${ab})`;
        ctx.fillRect(6, 4, 3, 2);
        ctx.fillStyle = '#2d8f3a';
        ctx.fillRect(8, 3, 3, 2);
        return tempCanvas.toDataURL();
      }

      if (type === 'bucket') {
        ctx.fillStyle = `rgb(${ar},${ag},${ab})`;
        ctx.fillRect(4, 5, 8, 8);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(5, 6, 6, 5);
        ctx.strokeStyle = '#d8e0e8';
        ctx.beginPath();
        ctx.arc(8, 5, 5, Math.PI, 0);
        ctx.stroke();
        return tempCanvas.toDataURL();
      }

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(4, 5, 8, 6);
      ctx.fillRect(5, 4, 6, 8);
      ctx.fillStyle = `rgba(${ar},${ag},${ab},0.72)`;
      ctx.strokeRect(4, 5, 8, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(5, 5, 2, 2);
      return tempCanvas.toDataURL();
    };

    // Draw tools (pickaxe, axe, shovel, sword, hoe)
    const def = ItemRegistry.get(id);
    if (def?.name === 'CrownForge Navigator') {
      const glow = ctx.createRadialGradient(8, 8, 1, 8, 8, 8);
      glow.addColorStop(0, '#fff6a8');
      glow.addColorStop(0.45, '#55b8ff');
      glow.addColorStop(1, '#182642');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(8, 8, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(8, 8, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(8, 2);
      ctx.lineTo(10, 8);
      ctx.lineTo(8, 14);
      ctx.lineTo(6, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff5a72';
      ctx.beginPath();
      ctx.moveTo(8, 2);
      ctx.lineTo(10, 8);
      ctx.lineTo(8, 7);
      ctx.lineTo(6, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(4, 4, 2, 2);
      return tempCanvas.toDataURL();
    }

    if (def && ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'].includes(def.toolType)) {
      drawToolIcon(def.toolType, getTierColor(def.tier));
      return tempCanvas.toDataURL();
    }

    switch (id) {
      case 200: // Stick
        ctx.fillStyle = '#866043';
        for (let i = 0; i < 12; i++) {
          ctx.fillRect(2 + i, 13 - i, 1, 1);
        }
        return tempCanvas.toDataURL();

      case 201: // Coal
        ctx.fillStyle = '#222222';
        ctx.fillRect(4, 5, 8, 7);
        ctx.fillRect(5, 4, 6, 9);
        ctx.fillStyle = '#444444';
        ctx.fillRect(6, 6, 2, 2);
        return tempCanvas.toDataURL();

      case 202: // Iron Ingot
        ctx.fillStyle = '#bfbfbf';
        ctx.fillRect(3, 5, 10, 6);
        ctx.fillStyle = '#e5e5e5';
        ctx.fillRect(4, 6, 8, 2);
        ctx.fillStyle = '#808080';
        ctx.strokeRect(3, 5, 10, 6);
        return tempCanvas.toDataURL();

      case 203: // Gold Ingot
        ctx.fillStyle = '#e6b800';
        ctx.fillRect(3, 5, 10, 6);
        ctx.fillStyle = '#ffe680';
        ctx.fillRect(4, 6, 8, 2);
        ctx.fillStyle = '#997a00';
        ctx.strokeRect(3, 5, 10, 6);
        return tempCanvas.toDataURL();

      case 204: // Diamond
        ctx.fillStyle = '#4ee2ec';
        ctx.fillRect(5, 3, 6, 10);
        ctx.fillRect(3, 5, 10, 6);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(5, 5, 2, 2);
        return tempCanvas.toDataURL();

      case 205: // Flint
        ctx.fillStyle = '#4a4a4a';
        ctx.fillRect(5, 4, 6, 8);
        ctx.fillRect(4, 6, 8, 4);
        ctx.fillStyle = '#7a7a7a';
        ctx.fillRect(5, 5, 2, 2);
        return tempCanvas.toDataURL();

      case 206: // String
        ctx.strokeStyle = '#e2e2e2';
        ctx.beginPath();
        ctx.moveTo(3, 13);
        ctx.bezierCurveTo(6, 8, 10, 14, 13, 3);
        ctx.stroke();
        return tempCanvas.toDataURL();

      case 208: // Bone
        ctx.fillStyle = '#f0ede4';
        ctx.fillRect(5, 5, 6, 6);
        ctx.fillRect(3, 3, 3, 3);
        ctx.fillRect(10, 10, 3, 3);
        ctx.fillRect(4, 4, 8, 8);
        return tempCanvas.toDataURL();

      case 209: // Gunpowder
        ctx.fillStyle = '#7f7f7f';
        ctx.fillRect(4, 6, 8, 4);
        ctx.fillRect(6, 4, 4, 8);
        ctx.fillStyle = '#3f3f3f';
        ctx.fillRect(5, 7, 1, 1);
        ctx.fillRect(10, 5, 1, 1);
        return tempCanvas.toDataURL();

      case 210: // Wool
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(4, 4, 8, 8);
        ctx.strokeRect(3, 3, 10, 10);
        return tempCanvas.toDataURL();

      case 211: // Arrow
        ctx.fillStyle = '#866043';
        for (let i = 0; i < 10; i++) {
          ctx.fillRect(3 + i, 12 - i, 1, 1);
        }
        ctx.fillStyle = '#c0c0c0';
        ctx.fillRect(13, 2, 2, 2);
        ctx.fillRect(12, 3, 2, 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(2, 13, 2, 1);
        ctx.fillRect(3, 14, 1, 1);
        return tempCanvas.toDataURL();

      case 215: // Spectral Arrow (glowing yellow arrow)
        ctx.fillStyle = '#e6b800'; // gold shaft
        for (let i = 0; i < 10; i++) {
          ctx.fillRect(3 + i, 12 - i, 1, 1);
        }
        ctx.fillStyle = '#ffcc00'; // bright gold head
        ctx.fillRect(13, 2, 2, 2);
        ctx.fillRect(12, 3, 2, 1);
        ctx.fillStyle = '#ffff66'; // glowing yellow feathers
        ctx.fillRect(2, 13, 2, 1);
        ctx.fillRect(3, 14, 1, 1);
        return tempCanvas.toDataURL();

      case 270: // Bow
        ctx.strokeStyle = '#866043';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(3, 3, 11, 0, Math.PI / 2);
        ctx.stroke();
        ctx.strokeStyle = '#e2e2e2';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(14, 3);
        ctx.lineTo(3, 14);
        ctx.stroke();
        return tempCanvas.toDataURL();

      case 280: // Apple
        ctx.fillStyle = '#ff2222';
        ctx.fillRect(5, 5, 6, 8);
        ctx.fillRect(4, 7, 8, 5);
        ctx.fillRect(6, 13, 4, 1);
        ctx.fillStyle = '#7c5435';
        ctx.fillRect(7, 3, 1, 2);
        ctx.fillStyle = '#22aa22';
        ctx.fillRect(8, 3, 2, 1);
        return tempCanvas.toDataURL();

      case 285: // Golden Apple
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(5, 5, 6, 8);
        ctx.fillRect(4, 7, 8, 5);
        ctx.fillRect(6, 13, 4, 1);
        ctx.fillStyle = '#7c5435';
        ctx.fillRect(7, 3, 1, 2);
        ctx.fillStyle = '#22aa22';
        ctx.fillRect(8, 3, 2, 1);
        return tempCanvas.toDataURL();

      case 281: // Bread
        ctx.fillStyle = '#b08040';
        ctx.fillRect(3, 6, 10, 5);
        ctx.fillStyle = '#d0ad70';
        ctx.fillRect(4, 7, 8, 3);
        ctx.fillStyle = '#805020';
        ctx.fillRect(5, 7, 1, 3);
        ctx.fillRect(8, 7, 1, 3);
        return tempCanvas.toDataURL();

      case 213: // Raw Porkchop
      case 214: // Raw Beef
        ctx.fillStyle = '#ff7f7f';
        ctx.fillRect(4, 5, 8, 6);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(5, 6, 2, 1);
        ctx.fillRect(8, 8, 2, 1);
        return tempCanvas.toDataURL();

      case 282: // Cooked Porkchop
      case 283: // Cooked Beef
      case 284: // Cooked Chicken
        ctx.fillStyle = '#8f3f3f';
        ctx.fillRect(4, 5, 8, 6);
        ctx.fillStyle = '#5f2f2f';
        ctx.fillRect(5, 6, 1, 4);
        ctx.fillRect(8, 6, 1, 4);
        return tempCanvas.toDataURL();
    }

    const generatedStyle = getFeatureItemStyle(id);
    if (generatedStyle) {
      return drawGeneratedItemIcon(generatedStyle, id);
    }

    if (!this.atlasCanvas) return '';

    const isBlock = BlockRegistry.has(id) && id !== 0;
    const config = isBlock ? BlockRegistry.get(id) : null;
    const isFoliageBlock = config && (
      config.isFoliage ||
      config.name.toLowerCase().includes('sapling') ||
      config.name.toLowerCase().includes('flower') ||
      config.name.toLowerCase().includes('grass') ||
      config.name.toLowerCase().includes('mushroom') ||
      config.name.toLowerCase().includes('torch') ||
      config.name.toLowerCase().includes('wire') ||
      config.name.toLowerCase().includes('lily') ||
      config.name.toLowerCase().includes('sprout') ||
      config.name.toLowerCase().includes('fern')
    );

    if (isBlock && !isFoliageBlock) {
      const blockCanvas = document.createElement('canvas');
      blockCanvas.width = 32;
      blockCanvas.height = 32;
      const bCtx = blockCanvas.getContext('2d')!;

      const cols = 16;
      const tileSize = 16;
      
      const idxTop = BlockRegistry.getFaceTextureIndex(id, 0);
      const idxLeft = BlockRegistry.getFaceTextureIndex(id, 4);
      const idxRight = BlockRegistry.getFaceTextureIndex(id, 2);

      const txTop = (idxTop % cols) * tileSize;
      const tyTop = Math.floor(idxTop / cols) * tileSize;
      const txLeft = (idxLeft % cols) * tileSize;
      const tyLeft = Math.floor(idxLeft / cols) * tileSize;
      const txRight = (idxRight % cols) * tileSize;
      const tyRight = Math.floor(idxRight / cols) * tileSize;

      // 1. Top Face
      bCtx.save();
      bCtx.beginPath();
      bCtx.moveTo(16, 4);
      bCtx.lineTo(26, 10);
      bCtx.lineTo(16, 16);
      bCtx.lineTo(6, 10);
      bCtx.closePath();
      bCtx.clip();
      bCtx.setTransform(0.625, -0.375, -0.625, -0.375, 16, 16);
      bCtx.drawImage(this.atlasCanvas, txTop, tyTop, tileSize, tileSize, 0, 0, 16, 16);
      bCtx.restore();

      // 2. Left Face (Shaded to 80% brightness)
      bCtx.save();
      bCtx.beginPath();
      bCtx.moveTo(6, 10);
      bCtx.lineTo(16, 16);
      bCtx.lineTo(16, 27);
      bCtx.lineTo(6, 21);
      bCtx.closePath();
      bCtx.clip();
      bCtx.setTransform(0.625, 0.375, 0, -0.6875, 6, 21);
      bCtx.drawImage(this.atlasCanvas, txLeft, tyLeft, tileSize, tileSize, 0, 0, 16, 16);
      bCtx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      bCtx.fillRect(0, 0, 16, 16);
      bCtx.restore();

      // 3. Right Face (Shaded to 60% brightness)
      bCtx.save();
      bCtx.beginPath();
      bCtx.moveTo(16, 16);
      bCtx.lineTo(26, 10);
      bCtx.lineTo(26, 21);
      bCtx.lineTo(16, 27);
      bCtx.closePath();
      bCtx.clip();
      bCtx.setTransform(0.625, -0.375, 0, -0.6875, 16, 27);
      bCtx.drawImage(this.atlasCanvas, txRight, tyRight, tileSize, tileSize, 0, 0, 16, 16);
      bCtx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      bCtx.fillRect(0, 0, 16, 16);
      bCtx.restore();

      return blockCanvas.toDataURL();
    }

    const blockToTextureMap: { [id: number]: number } = {
      1: 1,
      2: 2,
      3: 3,
      4: 4,
      5: 6,
      6: 7,
      7: 8,
      8: 9,
      9: 10,
      10: 11,
      11: 12,
      12: 13,
      13: 14,
      14: 15,
      15: 22,
      16: 41,
      17: 42,
      18: 43,
      19: 44,
      20: 45,
      21: 46,
      22: 48,
      23: 49,
      24: 50,
      25: 51,
      26: 23,
      27: 24,
      28: 25,
      29: 26,
      30: 27,
      31: 28,
      32: 29,
      33: 30,
      35: 39,
      36: 40,
      38: 53
    };

    const tileIdx = BlockRegistry.has(id) && id !== 0
      ? BlockRegistry.getFaceTextureIndex(id, 0)
      : blockToTextureMap[id] !== undefined ? blockToTextureMap[id] : 3;
    const tileSize = 16;
    const cols = 16;
    const tx = (tileIdx % cols) * tileSize;
    const ty = Math.floor(tileIdx / cols) * tileSize;

    ctx.drawImage(this.atlasCanvas, tx, ty, tileSize, tileSize, 0, 0, 16, 16);
    return tempCanvas.toDataURL();
  }
}
