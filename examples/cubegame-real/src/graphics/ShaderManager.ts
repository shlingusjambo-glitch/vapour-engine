import * as THREE from 'three';

/**
 * Interface that defines a complete shader pack.
 * Mods or users can import this interface and author custom packs.
 */
export interface ShaderPackDef {
  id: string;
  name: string;
  description: string;

  // Post-processing
  bloom: boolean;
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  exposure: number;
  pixelRatioCap: number;

  // Atmosphere
  fogDensity?: number;
  fogColor?: string;

  // Water
  waterColor?: string;

  // Sky
  skyTopColor?: string;
  skyHorizonColor?: string;

  // Rendering quality hints
  ambientOcclusion?: boolean;

  // GLSL overrides — when provided these replace the entire onBeforeCompile
  // injection for the respective material type.  Each string must be a
  // complete GLSL shader (not a snippet).
  chunkVertexShader?: string;
  chunkFragmentShader?: string;
  waterVertexShader?: string;
  waterFragmentShader?: string;

  // Saturation / grading knobs (forwarded to VoxelShader uniforms)
  saturation?: number;
  gradeStrength?: number;
  shaderEnabled?: boolean;
}

/**
 * Central registry and applicator for ShaderPackDef objects.
 *
 * Usage:
 *   ShaderManager.register(MyShaderPack);
 *   ShaderManager.apply('my-pack-id', materials, renderer);
 */
export class ShaderManager {
  private static registry = new Map<string, ShaderPackDef>();

  // ---------------------------------------------------------------------------
  // Registry API
  // ---------------------------------------------------------------------------

  /** Register a shader pack.  Overwrites any existing pack with the same id. */
  public static register(pack: ShaderPackDef): void {
    ShaderManager.registry.set(pack.id, pack);
  }

  /** Retrieve a pack by id.  Returns undefined when not found. */
  public static get(id: string): ShaderPackDef | undefined {
    return ShaderManager.registry.get(id);
  }

  /** Return all registered packs in insertion order. */
  public static getAll(): ShaderPackDef[] {
    return Array.from(ShaderManager.registry.values());
  }

  // ---------------------------------------------------------------------------
  // Apply API
  // ---------------------------------------------------------------------------

  /**
   * Apply a registered shader pack to the live materials and (optionally) the
   * renderer.  The renderer reference is typed loosely so that ShaderManager
   * has no hard import dependency on the Renderer class.
   *
   * @param id        The id of the pack to apply.
   * @param materials The four voxel materials created by VoxelShader.
   * @param renderer  Optional Renderer instance; used to update bloom/exposure.
   */
  public static apply(
    id: string,
    materials: {
      opaque: THREE.ShaderMaterial;
      transparent: THREE.ShaderMaterial;
      water: THREE.ShaderMaterial;
      foliage: THREE.ShaderMaterial;
    },
    renderer?: { setVisualQuality: (opts: { bloom: boolean; exposure: number; pixelRatioCap: number }) => void }
  ): boolean {
    const pack = ShaderManager.registry.get(id);
    if (!pack) {
      console.warn(`[ShaderManager] Pack "${id}" not found in registry.`);
      return false;
    }

    const allMaterials = [materials.opaque, materials.transparent, materials.water, materials.foliage];

    for (const mat of allMaterials) {
      const uniforms = (mat as any).uniforms;
      if (!uniforms) continue;

      // Shader enabled / grade strength
      const enabled = pack.shaderEnabled ?? true;
      if (uniforms.uShaderEnabled !== undefined) {
        uniforms.uShaderEnabled.value = enabled ? 1.0 : 0.0;
      }
      if (pack.saturation !== undefined && uniforms.uSaturation !== undefined) {
        uniforms.uSaturation.value = pack.saturation;
      }
      if (pack.gradeStrength !== undefined && uniforms.uGradeStrength !== undefined) {
        uniforms.uGradeStrength.value = pack.gradeStrength;
      }

      // Fog color
      if (pack.fogColor !== undefined && uniforms.uFogColor !== undefined) {
        uniforms.uFogColor.value = new THREE.Color(pack.fogColor);
      }

      // Fog density (encoded as uFogFar — lower = denser)
      if (pack.fogDensity !== undefined && uniforms.uFogFar !== undefined) {
        // fogDensity in [0, 1]: 0 = very far (sparse), 1 = very close (dense)
        const far = THREE.MathUtils.lerp(350.0, 40.0, Math.min(Math.max(pack.fogDensity, 0), 1));
        uniforms.uFogFar.value = far;
        if (uniforms.uFogNear !== undefined) {
          uniforms.uFogNear.value = far * 0.4;
        }
      }
    }

    // Bloom / exposure (requires renderer reference)
    if (renderer) {
      renderer.setVisualQuality({
        bloom: pack.bloom,
        exposure: pack.exposure,
        pixelRatioCap: pack.pixelRatioCap,
      });
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the id that should be saved/restored from storage.
   * Falls back to 'default' when the id is unknown.
   */
  public static resolveId(id: string): string {
    return ShaderManager.registry.has(id) ? id : (ShaderManager.registry.size > 0 ? ShaderManager.getAll()[0].id : 'default');
  }
}
