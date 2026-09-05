import * as THREE from 'three';
import type { ShaderPackSettings } from './ShaderPacks';

export class VoxelShader {
  /**
   * This returns built-in Three.js materials instead of raw ShaderMaterial.
   * Why: the last pass tried to wire shadow-map chunks by hand inside a custom
   * ShaderMaterial. If any Three.js version has different chunk/uniform names,
   * the chunk shaders fail to compile and the entire world disappears. Built-in
   * Lambert/Phong materials already support lights + receiving shadow maps, and
   * onBeforeCompile lets us safely add voxel wind/water/color polish on top.
   */
  private static createVoxelMaterial(
    texture: THREE.Texture,
    materialType: number,
    options: {
      transparent?: boolean;
      opacity?: number;
      alphaTest?: number;
      depthWrite?: boolean;
      side?: THREE.Side;
      water?: boolean;
      polygonOffset?: boolean;
      polygonOffsetFactor?: number;
      polygonOffsetUnits?: number;
    } = {}
  ): THREE.ShaderMaterial {
    const uniforms = {
      uTexture: { value: texture },
      uTime: { value: 0.0 },
      uFogColor: { value: new THREE.Color('#90a0c0') },
      uFogNear: { value: 72.0 },
      uFogFar: { value: 155.0 },
      uSunLight: { value: 1.0 },
      uSunDirection: { value: new THREE.Vector3(0.35, 0.8, 0.25).normalize() },
      uMaterialType: { value: materialType },
      uShaderEnabled: { value: 1.0 },
      uSaturation: { value: 0.96 },
      uGradeStrength: { value: 0.78 }
    };

    const baseParams: THREE.MeshLambertMaterialParameters = {
      map: texture,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1.0,
      alphaTest: options.alphaTest ?? 0.0,
      depthWrite: options.depthWrite ?? true,
      depthTest: true,
      side: options.side ?? THREE.FrontSide,
      fog: true,
      polygonOffset: options.polygonOffset ?? false,
      polygonOffsetFactor: options.polygonOffsetFactor ?? 0,
      polygonOffsetUnits: options.polygonOffsetUnits ?? 0
    };

    const material = options.water
      ? new THREE.MeshPhongMaterial({
          ...baseParams,
          color: 0x6fb7ff,
          shininess: 70,
          specular: 0x9fd4ff
        })
      : new THREE.MeshLambertMaterial(baseParams);

    // Migration metadata consumed by Vapour's generic standard-material atlas
    // path. The engine does not know about CubeGame blocks or `aTile`; it only
    // receives a grid layout plus a per-vertex texture-layer semantic.
    material.userData.vapourAtlas = {
      columns: 16,
      rows: 96,
      inset: 0.006,
      origin: 'top-left'
    };

    material.onBeforeCompile = (shader) => {
      // aAO/aTile are bound by Chunk.applyGeometryToMesh. Explicitly declaring
      // aAO is required; otherwise WebGL shader compilation fails and chunk
      // meshes disappear even though geometry exists.
      (shader as any).defines = { ...((shader as any).defines || {}), USE_AO_ATTR: '' };
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform int uMaterialType;
          attribute float aTile;
          attribute float aAO;
          varying float vVoxelAO;
          varying float vVoxelWind;
          varying float vVoxelTile;
          varying vec3 vVoxelWorldPosition;
          varying vec3 vVoxelNormal;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>

          vec4 voxelWorld = modelMatrix * vec4(position, 1.0);
          vVoxelAO = 3.0;
          #ifdef USE_AO_ATTR
            vVoxelAO = aAO;
          #endif
          vVoxelTile = aTile;
          vVoxelWind = 0.0;

          // Flower-style wind copied to foliage/leaves: gentle side-to-side sway.
          if (uMaterialType == 2) {
            float heightMask = smoothstep(-0.55, 0.65, position.y);
            float flowerStyleSway = sin(uTime * 3.0 + voxelWorld.x * 1.5 + voxelWorld.z * 1.5) * 0.075;
            float slowGust = sin(uTime * 1.05 + voxelWorld.x * 0.23 - voxelWorld.z * 0.19) * 0.032;
            float tinyFlutter = sin(uTime * 5.2 + voxelWorld.x * 2.4 + voxelWorld.z * 0.8) * 0.012;
            float sway = (flowerStyleSway + slowGust + tinyFlutter) * heightMask;
            transformed.x += sway;
            transformed.z += sway * 0.35;
            vVoxelWind = heightMask;
          }

          // Water only waves on mostly-upward surfaces so shorelines stay stable.
          if (uMaterialType == 1) {
            float topMask = smoothstep(0.45, 0.95, normal.y);
            float wave = sin(voxelWorld.x * 1.65 + uTime * 1.55) * 0.5
                       + sin(voxelWorld.z * 1.45 - uTime * 1.25) * 0.35
                       + sin((voxelWorld.x + voxelWorld.z) * 0.63 + uTime * 0.8) * 0.15;
            transformed.y += wave * 0.035 * topMask;
          }

          vVoxelWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vVoxelNormal = normalize(mat3(modelMatrix) * objectNormal);`
        );

      shader.fragmentShader = shader.fragmentShader

        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
          float safeTile = max(0.0, floor(vVoxelTile + 0.5));
          float tileX = mod(safeTile, 16.0);
          float tileY = floor(safeTile / 16.0);
          vec2 localVoxelUv = fract(vMapUv);
          // Keep samples away from atlas borders to remove shimmering/bleeding.
          localVoxelUv = clamp(localVoxelUv, vec2(0.006), vec2(0.994));
          vec2 atlasUv = vec2(
            (tileX + localVoxelUv.x) / 16.0,
            1.0 - ((tileY + (1.0 - localVoxelUv.y)) / 96.0)
          );
          vec4 sampledDiffuseColor = texture2D(map, atlasUv);
          diffuseColor *= sampledDiffuseColor;
          #endif`
        )
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform float uSunLight;
          uniform vec3 uSunDirection;
          uniform int uMaterialType;
          uniform float uShaderEnabled;
          uniform float uSaturation;
          uniform float uGradeStrength;
          varying float vVoxelAO;
          varying float vVoxelWind;
          varying float vVoxelTile;
          varying vec3 vVoxelWorldPosition;
          varying vec3 vVoxelNormal;

          float voxelHash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }

          vec3 voxelSaturate(vec3 color, float amount) {
            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            return mix(vec3(luma), color, amount);
          }`
        )
        .replace(
          '#include <dithering_fragment>',
          `vec3 voxelNormal = normalize(vVoxelNormal);
          vec3 sunDir = normalize(uSunDirection);
          float day = clamp(uSunLight, 0.0, 1.0);
          float skyBounce = clamp(voxelNormal.y * 0.5 + 0.5, 0.0, 1.0);
          float direct = max(dot(voxelNormal, sunDir), 0.0);
          float sideShade = mix(0.58, 1.12, skyBounce);
          float aoFactor = mix(0.35, 1.0, clamp(vVoxelAO / 3.0, 0.0, 1.0));
          float pixelLocked = voxelHash(floor(vVoxelWorldPosition.xz * 1.35) + floor(vVoxelWorldPosition.yy * 0.7));
          float sunBand = smoothstep(0.12, 0.88, direct + (pixelLocked - 0.5) * 0.08);

          // Shader-pack style grading on top of real Three.js lights/shadows.
          // uSunLight is now overall world brightness: high for daytime, medium
          // for moonlit night. Never crush the scene to black at night.
          float worldLight = clamp(uSunLight, 0.0, 1.0);
          float warmth = smoothstep(0.46, 0.95, worldLight);
          float shadowShape = mix(0.74, 1.14, sunBand * worldLight + 0.16);
          vec3 nightTint = vec3(0.66, 0.74, 1.08);
          vec3 dayTint = vec3(1.10, 1.06, 0.92);

          vec3 graded = gl_FragColor.rgb;
          graded *= aoFactor * sideShade * shadowShape;
          graded *= mix(nightTint, dayTint, warmth);
          graded += vec3(0.024, 0.030, 0.055) * (1.0 - warmth);

          // Darken underground/cave faces that are deep, non-upward, and occluded.
          // This keeps surface daylight readable while stopping caves from looking
          // like outdoor daylight boxes.
          float depthMask = 1.0 - smoothstep(6.0, 26.0, vVoxelWorldPosition.y);
          float ceilingMask = 1.0 - smoothstep(0.42, 0.88, skyBounce);
          float caveOcclusion = depthMask * ceilingMask * (1.0 - clamp(vVoxelAO / 3.0, 0.0, 1.0) * 0.35);
          graded *= mix(1.0, 0.42, caveOcclusion);

          if (uMaterialType == 2) {
            float leafNoise = voxelHash(floor(vVoxelWorldPosition.xz * 2.0) + floor(vVoxelWorldPosition.yy));
            graded *= mix(vec3(0.84, 0.96, 0.78), vec3(1.08, 1.12, 0.92), leafNoise);
            graded += vec3(0.024, 0.060, 0.016) * vVoxelWind * worldLight;
          }

          if (uMaterialType == 1) {
            float ripple = sin(vVoxelWorldPosition.x * 2.4 + uTime * 1.8) * sin(vVoxelWorldPosition.z * 2.1 - uTime * 1.2);
            vec3 shallow = vec3(0.25, 0.62, 0.96);
            vec3 deep = vec3(0.035, 0.20, 0.50);
            vec3 moonWater = vec3(0.09, 0.18, 0.42);
            graded = mix(deep, shallow, 0.48 + ripple * 0.08) * mix(0.86, 1.02, warmth);
            graded = mix(graded, moonWater + graded * 0.42, 1.0 - warmth);
          }

          graded = voxelSaturate(graded, uSaturation);
          graded = pow(graded, vec3(0.98));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, graded, uShaderEnabled * uGradeStrength);

          #include <dithering_fragment>`
        );
    };

    material.customProgramCacheKey = () => `voxel-built-in-${materialType}`;

    // Preserve the old ShaderMaterial-like API used by SkySystem.update().
    (material as any).uniforms = uniforms;
    (material as any).isShaderMaterial = false;

    return material as unknown as THREE.ShaderMaterial;
  }

  public static createMaterials(texture: THREE.Texture): {
    opaque: THREE.ShaderMaterial;
    transparent: THREE.ShaderMaterial;
    water: THREE.ShaderMaterial;
    foliage: THREE.ShaderMaterial;
  } {
    texture.colorSpace = THREE.SRGBColorSpace;

    const opaque = this.createVoxelMaterial(texture, 0, {
      transparent: false,
      depthWrite: true,
      side: THREE.FrontSide
    });

    const transparent = this.createVoxelMaterial(texture, 3, {
      transparent: true,
      opacity: 0.72,
      alphaTest: 0.08,
      depthWrite: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 0.22,
      polygonOffsetUnits: 1
    });

    const water = this.createVoxelMaterial(texture, 1, {
      transparent: true,
      opacity: 0.62,
      alphaTest: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
      water: true,
      polygonOffset: true,
      polygonOffsetFactor: 0.28,
      polygonOffsetUnits: 1
    });

    const foliage = this.createVoxelMaterial(texture, 2, {
      // Cutout foliage gives leaves their transparent holes back, while staying
      // in the opaque/depth-writing path so water and back leaves do not bleed
      // through the solid pixels.
      transparent: false,
      alphaTest: 0.24,
      depthWrite: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 0.5,
      polygonOffsetUnits: 1
    });

    return { opaque, transparent, water, foliage };
  }

  public static applyShaderPack(
    materials: { opaque: THREE.ShaderMaterial; transparent: THREE.ShaderMaterial; water: THREE.ShaderMaterial; foliage: THREE.ShaderMaterial },
    pack: ShaderPackSettings
  ): void {
    for (const mat of [materials.opaque, materials.transparent, materials.water, materials.foliage]) {
      const uniforms = (mat as any).uniforms;
      if (!uniforms) continue;
      uniforms.uShaderEnabled.value = pack.enabled ? 1.0 : 0.0;
      uniforms.uSaturation.value = pack.saturation;
      uniforms.uGradeStrength.value = pack.gradeStrength;
    }
  }
}
