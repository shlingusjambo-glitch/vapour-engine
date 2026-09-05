/** Resource upload descriptions and their validation.
 *
 * Meshes, textures, and materials cross into Rust as flat typed arrays plus a
 * JSON descriptor. Validating here — before the boundary — means a malformed
 * upload reports which field was wrong in TypeScript, where the call site is,
 * instead of surfacing as an opaque error from the renderer.
 */

/** Geometry a game hands the renderer at runtime.
 *
 * `positions` and `indices` are required; the rest are optional and are filled
 * with usable defaults when omitted, which is what a voxel mesher or a simple
 * procedural generator usually wants. */
export interface MeshUpload {
  /** Three floats per vertex. Sets the vertex count. */
  readonly positions: Float32Array;
  /** Three indices per triangle, addressing `positions`. */
  readonly indices: Uint32Array;
  /** Three floats per vertex. Defaults to +Y when omitted. */
  readonly normals?: Float32Array;
  /** Two floats per vertex. Defaults to (0, 0). */
  readonly uvs?: Float32Array;
  /** Four linear RGBA floats per vertex, multiplied into the surface colour.
   * Defaults to white. Generated geometry uses this for per-vertex tint and
   * baked ambient occlusion without needing a custom shader. */
  readonly colors?: Float32Array;
  /** Four floats per vertex: tangent xyz and bitangent sign. When omitted,
   * Vapour generates a UV-consistent tangent frame from indexed triangles. */
  readonly tangents?: Float32Array;
  /** One texture-layer value per vertex. Standard atlas materials interpret
   * this as a zero-based cell index; future array-texture materials can use
   * the same geometry semantic without repacking the mesh. Defaults to 0. */
  readonly textureLayers?: Float32Array;
}

/** Uncompressed source pixels for a runtime texture. Importers should prefer
 * GPU-native compressed assets for production content once the negotiated
 * compression path is available; RGBA8 is the deterministic procedural and
 * migration baseline. */
export interface TextureUpload {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  /** Base-color/emission images are normally sRGB; data maps are linear. */
  readonly colorSpace?: "srgb" | "linear";
}

export interface MaterialTextureSet {
  readonly baseColor?: string;
  readonly normal?: string;
  readonly metallicRoughness?: string;
  readonly occlusion?: string;
  readonly emission?: string;
}

/** Grid-atlas addressing for a standard material. `inset` is measured inside
 * each cell in normalized cell coordinates and prevents filtered samples from
 * bleeding across cell borders. */
export interface TextureAtlasLayout {
  readonly columns: number;
  readonly rows: number;
  readonly inset?: number;
  readonly origin?: "bottom-left" | "top-left";
}

/** Standard PBR material asset. Numeric metallic/roughness/emission/cutoff
 * remain per draw so one material can be instanced with cheap variations. */
export interface MaterialUpload {
  readonly baseColor?: readonly [number, number, number, number];
  readonly emission?: readonly [number, number, number];
  readonly uvScale?: readonly [number, number];
  readonly uvOffset?: readonly [number, number];
  readonly normalScale?: number;
  readonly occlusionStrength?: number;
  readonly textures?: MaterialTextureSet;
  readonly filter?: "nearest" | "linear";
  readonly addressMode?: "repeat" | "clamp" | "mirror";
  /** When present, local UVs repeat inside the cell selected by each vertex's
   * `textureLayers` value instead of addressing the full texture. */
  readonly atlas?: TextureAtlasLayout;
  /** Interprets base-color alpha as ordinary coverage or a signed-distance
   * field. SDF mode uses derivative-aware smoothing at any display scale. */
  readonly coverageMode?: "alpha" | "sdf";
  /** `mask` uses alpha cutoff with depth writes; `blend` enables source-alpha
   * compositing and is submitted after opaque/cutout surfaces. */
  readonly alphaMode?: "opaque" | "mask" | "blend";
  readonly doubleSided?: boolean;
  /** Defaults to true except for blended materials. */
  readonly depthWrite?: boolean;
}

export function validateTextureUpload(
  id: string,
  texture: TextureUpload,
): void {
  if (id.trim() === "" || id.startsWith("builtin:"))
    throw new Error("A texture needs a non-empty, non-reserved identifier.");
  if (
    !Number.isInteger(texture.width) ||
    texture.width < 1 ||
    !Number.isInteger(texture.height) ||
    texture.height < 1
  ) {
    throw new Error(`Texture '${id}' needs positive integer dimensions.`);
  }
  const expected = texture.width * texture.height * 4;
  if (!Number.isSafeInteger(expected) || texture.pixels.length !== expected) {
    throw new Error(
      `Texture '${id}' needs ${String(expected)} RGBA8 bytes, received ${String(texture.pixels.length)}.`,
    );
  }
}

export function validateMaterialUpload(
  id: string,
  material: MaterialUpload,
  hasTexture: (id: string) => boolean,
): void {
  if (id.trim() === "" || id.startsWith("builtin:"))
    throw new Error("A material needs a non-empty, non-reserved identifier.");
  const numbers = [
    ...(material.baseColor ?? [1, 1, 1, 1]),
    ...(material.emission ?? [1, 1, 1]),
    ...(material.uvScale ?? [1, 1]),
    ...(material.uvOffset ?? [0, 0]),
    material.normalScale ?? 1,
    material.occlusionStrength ?? 1,
    material.atlas?.columns ?? 1,
    material.atlas?.rows ?? 1,
    material.atlas?.inset ?? 0,
  ];
  if (numbers.some((value) => !Number.isFinite(value)))
    throw new Error(`Material '${id}' contains a non-finite number.`);
  if (material.atlas !== undefined) {
    if (
      !Number.isInteger(material.atlas.columns) ||
      material.atlas.columns < 1 ||
      !Number.isInteger(material.atlas.rows) ||
      material.atlas.rows < 1
    ) {
      throw new Error(
        `Material '${id}' atlas needs positive integer columns and rows.`,
      );
    }
    const inset = material.atlas.inset ?? 0;
    if (inset < 0 || inset >= 0.5)
      throw new Error(`Material '${id}' atlas inset must be in [0, 0.5).`);
  }
  if (
    material.coverageMode !== undefined &&
    material.coverageMode !== "alpha" &&
    material.coverageMode !== "sdf"
  ) {
    throw new Error(`Material '${id}' coverageMode must be alpha or sdf.`);
  }
  for (const textureId of Object.values(material.textures ?? {})) {
    if (!hasTexture(textureId))
      throw new Error(
        `Material '${id}' references missing texture '${textureId}'.`,
      );
  }
}
