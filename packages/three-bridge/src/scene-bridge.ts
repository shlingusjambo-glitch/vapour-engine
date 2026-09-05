import {
  FrameBuilder,
  MAX_LIGHTS,
  WebGpuRenderHost,
  type MaterialUpload,
  type MeshUpload,
  type RenderHost,
  type RenderLayerSubmission,
  type RenderStats,
  type TextureUpload,
  type Vector3,
} from "@vapour/engine";
import * as THREE from "three";

/** A light's direction of travel in world space, from its own transform to
 * its target. Three expresses this as a target object rather than a vector. */
function directionOf(
  light: THREE.DirectionalLight | THREE.SpotLight,
  origin: THREE.Vector3,
  target: THREE.Vector3,
): Vector3 {
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);
  light.getWorldPosition(origin);
  light.target.getWorldPosition(target);
  const direction = target.clone().sub(origin);
  if (direction.lengthSq() < 1e-12) return [0, -1, 0];
  direction.normalize();
  return [direction.x, direction.y, direction.z];
}

/** Minimal renderer contract used by the bridge. Kept public so migration
 * tools, recorders, headless tests, and alternative Vapour hosts can consume
 * the same scene extraction without owning a browser GPU. */
export type ThreeBridgeHost = RenderHost;

export interface ThreeSceneBridgeOptions {
  readonly host?: ThreeBridgeHost;
  readonly wasmModuleUrl?: string;
  /** Called once per unsupported object/material kind instead of silently
   * dropping migration fidelity. */
  readonly onDiagnostic?: (message: string) => void;
}

export interface ThreeBridgeResourceStats {
  readonly geometries: number;
  readonly textures: number;
  readonly materials: number;
}

/** One Three scene/camera view in a single Vapour presentation. Later layers
 * can preserve the existing colour and clear depth, which is the conventional
 * first-person view-model setup. The same API also serves editor overlays,
 * minimaps, and portal composition. */
export interface ThreeRenderLayer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly clearColor?: boolean;
  readonly clearDepth?: boolean;
}

interface GeometryRecord {
  readonly id: string;
  version: number;
  lastSeenFrame: number;
}

interface AssetRecord {
  readonly id: string;
  version: string;
  lastSeenFrame: number;
}

/**
 * Extracts an ordinary Three.js scene graph into Vapour's binary game-frame
 * path while Vapour retains complete ownership of the WebGPU surface.
 *
 * This is a migration adapter, not a WebGL compatibility renderer. Three is
 * used for its established object graph, geometry generators, and math types;
 * no `WebGLRenderer`, GPU resource, shader, or framebuffer is created here.
 */
export class ThreeSceneBridge {
  readonly #host: ThreeBridgeHost;
  readonly #frames: FrameBuilder[] = [new FrameBuilder(512)];
  readonly #geometries = new Map<string, GeometryRecord>();
  readonly #textures = new Map<string, AssetRecord>();
  readonly #materials = new Map<string, AssetRecord>();
  readonly #diagnostics = new Set<string>();
  readonly #onDiagnostic: (message: string) => void;
  readonly #instanceMatrix = new THREE.Matrix4();
  readonly #worldInstanceMatrix = new THREE.Matrix4();
  #frameIndex = 0;
  #destroyed = false;

  constructor(
    canvas: HTMLCanvasElement,
    options: ThreeSceneBridgeOptions = {},
  ) {
    this.#host =
      options.host ??
      new WebGpuRenderHost(
        canvas,
        options.wasmModuleUrl === undefined
          ? {}
          : { moduleUrl: options.wasmModuleUrl },
      );
    this.#onDiagnostic =
      options.onDiagnostic ??
      ((message) => console.warn(`[Vapour Three bridge] ${message}`));
  }

  get initialized(): boolean {
    return this.#host.initialized;
  }

  resourceStats(): ThreeBridgeResourceStats {
    return {
      geometries: this.#geometries.size,
      textures: this.#textures.size,
      materials: this.#materials.size,
    };
  }

  async initialize(): Promise<void> {
    if (this.#destroyed)
      throw new Error("Cannot initialize a destroyed Three scene bridge.");
    if (!this.#host.initialized) await this.#host.initialize();
  }

  /** Extracts, submits, and renders one scene frame. */
  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    timeMilliseconds = performance.now(),
  ): RenderStats | undefined {
    return this.renderLayers([{ scene, camera }], timeMilliseconds);
  }

  /** Extracts several scene/camera layers, submits them atomically, and
   * presents once. Resources are tracked across the whole presentation, so a
   * mesh shared by the world and an overlay is uploaded only once. */
  renderLayers(
    layers: readonly ThreeRenderLayer[],
    timeMilliseconds = performance.now(),
  ): RenderStats | undefined {
    if (this.#destroyed)
      throw new Error("Cannot render with a destroyed Three scene bridge.");
    if (!this.#host.initialized)
      throw new Error("Initialize the Three scene bridge before rendering.");
    if (layers.length === 0)
      throw new Error("A Three scene presentation needs at least one layer.");
    this.#frameIndex += 1;
    const submissions: RenderLayerSubmission[] = [];
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index]!;
      const frame = this.#frames[index] ?? new FrameBuilder(128);
      this.#frames[index] = frame;
      submissions.push({
        frame: this.#extractFrame(frame, layer.scene, layer.camera),
        ...(layer.clearColor === undefined
          ? {}
          : { clearColor: layer.clearColor }),
        ...(layer.clearDepth === undefined
          ? {}
          : { clearDepth: layer.clearDepth }),
      });
    }
    this.#releaseStaleAssets();
    this.#host.submitLayers(submissions);
    return this.#host.renderFrame(timeMilliseconds);
  }

  #extractFrame(
    frame: FrameBuilder,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ): ReturnType<FrameBuilder["pack"]> {
    frame.reset();
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    frame.setCamera(
      camera.matrixWorld.elements,
      camera.fov,
      camera.near,
      camera.far,
    );
    this.#extractEnvironment(scene, frame);
    this.#extractLight(scene, frame);

    scene.traverseVisible((object) => {
      if (!(object instanceof THREE.Mesh)) {
        if (object instanceof THREE.Line || object instanceof THREE.Points) {
          this.#diagnose(
            `${object.type} rendering is not implemented yet; object '${object.name || object.uuid}' was omitted.`,
          );
        }
        return;
      }
      if (object instanceof THREE.SkinnedMesh) {
        this.#diagnose(
          "SkinnedMesh currently renders its bind-pose geometry; GPU skinning is still required for animated parity.",
        );
      }
      const meshId = this.#ensureGeometry(object.geometry);
      const material = primaryMaterial(object.material);
      const materialId = this.#ensureMaterial(material);
      const options = { ...drawOptions(material), material: materialId };
      if (object instanceof THREE.InstancedMesh) {
        for (let index = 0; index < object.count; index += 1) {
          object.getMatrixAt(index, this.#instanceMatrix);
          this.#worldInstanceMatrix.multiplyMatrices(
            object.matrixWorld,
            this.#instanceMatrix,
          );
          frame.draw(meshId, this.#worldInstanceMatrix.elements, options);
        }
      } else {
        frame.draw(meshId, object.matrixWorld.elements, options);
      }
    });
    return frame.pack();
  }

  #extractEnvironment(scene: THREE.Scene, frame: FrameBuilder): void {
    const background = scene.background;
    const fog = scene.fog;
    if (!(background instanceof THREE.Color) && fog === null) return;

    const fallback = fog?.color;
    const clear = background instanceof THREE.Color ? background : fallback;
    const clearColor: [number, number, number, number] =
      clear === undefined
        ? [0.012, 0.018, 0.035, 1]
        : [clear.r, clear.g, clear.b, 1];
    if (fog instanceof THREE.Fog) {
      frame.setEnvironment({
        clearColor,
        fog: {
          mode: "linear",
          color: [fog.color.r, fog.color.g, fog.color.b],
          near: fog.near,
          far: fog.far,
        },
      });
    } else if (fog instanceof THREE.FogExp2) {
      frame.setEnvironment({
        clearColor,
        fog: {
          mode: "exponential",
          color: [fog.color.r, fog.color.g, fog.color.b],
          density: fog.density,
        },
      });
    } else {
      frame.setEnvironment({ clearColor });
    }

    if (background !== null && !(background instanceof THREE.Color)) {
      this.#diagnose(
        "Texture and cube-texture scene backgrounds are not translated yet; Vapour uses the fog/default clear colour.",
      );
    }
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const record of this.#materials.values())
      this.#host.releaseMaterial(record.id);
    for (const record of this.#textures.values())
      this.#host.releaseTexture(record.id);
    for (const record of this.#geometries.values())
      this.#host.releaseMesh(record.id);
    this.#materials.clear();
    this.#textures.clear();
    this.#geometries.clear();
    this.#host.destroy();
  }

  #ensureGeometry(geometry: THREE.BufferGeometry): string {
    const existing = this.#geometries.get(geometry.uuid);
    const version = geometryVersion(geometry);
    if (existing !== undefined && existing.version === version) {
      existing.lastSeenFrame = this.#frameIndex;
      return existing.id;
    }
    const id = existing?.id ?? `three:${geometry.uuid}`;
    this.#host.uploadMesh(id, extractGeometry(geometry));
    this.#geometries.set(geometry.uuid, {
      id,
      version,
      lastSeenFrame: this.#frameIndex,
    });
    return id;
  }

  /**
   * Rebuilds the frame's light rig from the Three scene.
   *
   * Every light type Three exposes is carried across, not just the first
   * directional one: a scene's readable brightness usually comes from its
   * ambient and hemisphere fill, and dropping those renders a correctly
   * shaded world as an almost black one.
   */
  #extractLight(scene: THREE.Scene, frame: FrameBuilder): void {
    const rig = frame.lights;
    rig.reset();
    const origin = new THREE.Vector3();
    const target = new THREE.Vector3();
    let carried = 0;
    let skipped = 0;

    scene.traverseVisible((object) => {
      if (!(object as THREE.Light).isLight) return;
      if (carried >= MAX_LIGHTS) {
        skipped += 1;
        return;
      }
      const light = object as THREE.Light;
      const color: Vector3 = [light.color.r, light.color.g, light.color.b];

      if ((light as THREE.AmbientLight).isAmbientLight) {
        rig.addAmbient(color, light.intensity);
      } else if ((light as THREE.HemisphereLight).isHemisphereLight) {
        const hemisphere = light as THREE.HemisphereLight;
        rig.addHemisphere(
          color,
          [
            hemisphere.groundColor.r,
            hemisphere.groundColor.g,
            hemisphere.groundColor.b,
          ],
          hemisphere.intensity,
        );
      } else if ((light as THREE.DirectionalLight).isDirectionalLight) {
        const directional = light as THREE.DirectionalLight;
        rig.addDirectional(
          directionOf(directional, origin, target),
          color,
          directional.intensity,
        );
      } else if ((light as THREE.SpotLight).isSpotLight) {
        const spot = light as THREE.SpotLight;
        spot.updateMatrixWorld(true);
        spot.getWorldPosition(origin);
        rig.addSpot(
          [origin.x, origin.y, origin.z],
          directionOf(spot, origin, target),
          color,
          spot.intensity,
          spot.distance,
          spot.angle,
          spot.penumbra,
        );
      } else if (light instanceof THREE.PointLight) {
        const point = light;
        point.updateMatrixWorld(true);
        point.getWorldPosition(origin);
        rig.addPoint(
          [origin.x, origin.y, origin.z],
          color,
          point.intensity,
          point.distance,
        );
      } else {
        // Area and probe lights have no equivalent yet; saying so beats
        // rendering a scene that is quietly missing part of its lighting.
        skipped += 1;
        return;
      }
      carried += 1;
    });

    if (skipped > 0) {
      this.#diagnose(
        `${String(skipped)} light(s) were not carried across: the rig holds at most ${String(MAX_LIGHTS)} lights and area/probe lights are unsupported.`,
      );
    }
    if (carried === 0) {
      // A scene with no lights at all would otherwise render black.
      rig.addDirectional([-0.4, -0.82, -0.35], [1, 0.96, 0.88], 2.6);
      rig.addHemisphere([0.55, 0.68, 0.92], [0.28, 0.26, 0.24], 0.45);
    }
  }

  #ensureMaterial(material: THREE.Material): string {
    const maps = materialMaps(material);
    const textureIds: Record<string, string> = {};
    for (const [role, texture] of Object.entries(maps)) {
      if (texture !== undefined) {
        const textureId = this.#ensureTexture(texture);
        if (textureId !== "") textureIds[role] = textureId;
      }
    }
    const existing = this.#materials.get(material.uuid);
    const atlasVersion = JSON.stringify(
      (material.userData as { vapourAtlas?: unknown }).vapourAtlas ?? null,
    );
    const version = `${String(material.version)}:${Object.values(maps)
      .map((texture) => texture?.version ?? -1)
      .join(":")}:${atlasVersion}`;
    const id = existing?.id ?? `three-material:${material.uuid}`;
    if (existing === undefined || existing.version !== version) {
      const surface = material as THREE.Material & {
        normalScale?: THREE.Vector2;
        aoMapIntensity?: number;
        userData: { vapourAtlas?: unknown };
        transparent?: boolean;
        alphaTest?: number;
        side?: THREE.Side;
        depthWrite?: boolean;
      };
      const atlas = textureAtlasLayout(surface.userData.vapourAtlas);
      const primaryMap = maps.baseColor;
      if (primaryMap !== undefined && Math.abs(primaryMap.rotation) > 1e-7) {
        this.#diagnose(
          `Texture rotation on material '${material.name || material.uuid}' is not supported yet; repeat and offset were preserved.`,
        );
      }
      this.#host.defineMaterial(id, {
        uvScale:
          primaryMap === undefined
            ? [1, 1]
            : [primaryMap.repeat.x, primaryMap.repeat.y],
        uvOffset:
          primaryMap === undefined
            ? [0, 0]
            : [primaryMap.offset.x, primaryMap.offset.y],
        normalScale: surface.normalScale?.x ?? 1,
        occlusionStrength: surface.aoMapIntensity ?? 1,
        textures: textureIds,
        filter: Object.values(maps).some(
          (texture) => texture?.magFilter === THREE.NearestFilter,
        )
          ? "nearest"
          : "linear",
        addressMode:
          primaryMap?.wrapS === THREE.ClampToEdgeWrapping
            ? "clamp"
            : primaryMap?.wrapS === THREE.MirroredRepeatWrapping
              ? "mirror"
              : "repeat",
        ...(atlas === undefined ? {} : { atlas }),
        alphaMode:
          surface.transparent === true
            ? "blend"
            : (surface.alphaTest ?? 0) > 0
              ? "mask"
              : "opaque",
        doubleSided: surface.side === THREE.DoubleSide,
        depthWrite: surface.depthWrite ?? surface.transparent !== true,
      });
      this.#materials.set(material.uuid, {
        id,
        version,
        lastSeenFrame: this.#frameIndex,
      });
    } else {
      existing.lastSeenFrame = this.#frameIndex;
    }
    return id;
  }

  #ensureTexture(texture: THREE.Texture): string {
    const existing = this.#textures.get(texture.uuid);
    const version = String(texture.version);
    if (existing !== undefined && existing.version === version) {
      existing.lastSeenFrame = this.#frameIndex;
      return existing.id;
    }
    const id = existing?.id ?? `three-texture:${texture.uuid}`;
    const upload = extractTexture(texture);
    if (upload === undefined) {
      this.#diagnose(
        `Texture '${texture.name || texture.uuid}' has no readable RGBA pixel source yet; the material uses Vapour's neutral fallback.`,
      );
      return "";
    }
    this.#host.uploadTexture(id, upload);
    this.#textures.set(texture.uuid, {
      id,
      version,
      lastSeenFrame: this.#frameIndex,
    });
    return id;
  }

  #releaseStaleAssets(): void {
    // A two-frame grace period avoids release/re-upload churn when a caller
    // swaps scenes inside a single animation turn.
    for (const [uuid, record] of this.#geometries) {
      if (record.lastSeenFrame >= this.#frameIndex - 1) continue;
      this.#host.releaseMesh(record.id);
      this.#geometries.delete(uuid);
    }
    // Materials must go before their textures because render hosts reject a
    // texture release while a bind group still references it.
    for (const [uuid, record] of this.#materials) {
      if (record.lastSeenFrame >= this.#frameIndex - 1) continue;
      this.#host.releaseMaterial(record.id);
      this.#materials.delete(uuid);
    }
    for (const [uuid, record] of this.#textures) {
      if (record.lastSeenFrame >= this.#frameIndex - 1) continue;
      this.#host.releaseTexture(record.id);
      this.#textures.delete(uuid);
    }
  }

  #diagnose(message: string): void {
    if (this.#diagnostics.has(message)) return;
    this.#diagnostics.add(message);
    this.#onDiagnostic(message);
  }
}

function extractGeometry(geometry: THREE.BufferGeometry): MeshUpload {
  const position = geometry.getAttribute("position");
  if (position === undefined || position.itemSize < 3) {
    throw new Error(
      `Three geometry '${geometry.uuid}' has no three-component position attribute.`,
    );
  }
  const positions = attribute(position, 3);
  const vertexCount = position.count;
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const color = geometry.getAttribute("color");
  const nativeOcclusion = geometry.getAttribute("vertexOcclusion");
  const legacyOcclusion =
    nativeOcclusion === undefined ? geometry.getAttribute("aAO") : undefined;
  // `textureLayer` is Vapour's native semantic. `aTile` is accepted by this
  // migration adapter because it is the conventional attribute in voxel
  // projects migrating from custom Three shaders.
  const textureLayer =
    geometry.getAttribute("textureLayer") ?? geometry.getAttribute("aTile");
  const indices =
    geometry.index === null
      ? sequentialTriangleIndices(vertexCount, geometry.uuid)
      : uint32Indices(geometry.index, vertexCount, geometry.uuid);
  return {
    positions,
    indices,
    ...(normal === undefined ? {} : { normals: attribute(normal, 3) }),
    ...(uv === undefined ? {} : { uvs: attribute(uv, 2) }),
    ...(color === undefined &&
    nativeOcclusion === undefined &&
    legacyOcclusion === undefined
      ? {}
      : {
          colors: colorAndOcclusionAttribute(
            color,
            nativeOcclusion ?? legacyOcclusion,
            legacyOcclusion !== undefined,
          ),
        }),
    ...(textureLayer === undefined
      ? {}
      : { textureLayers: attribute(textureLayer, 1) }),
  };
}

function textureAtlasLayout(
  value: unknown,
): MaterialUpload["atlas"] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const source = value as Record<string, unknown>;
  const columns = source.columns;
  const rows = source.rows;
  if (
    !Number.isInteger(columns) ||
    Number(columns) < 1 ||
    !Number.isInteger(rows) ||
    Number(rows) < 1
  )
    return undefined;
  const inset = typeof source.inset === "number" ? source.inset : 0;
  const origin = source.origin === "top-left" ? "top-left" : "bottom-left";
  return { columns: Number(columns), rows: Number(rows), inset, origin };
}

function attribute(
  source: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  components: number,
): Float32Array {
  const result = new Float32Array(source.count * components);
  for (let index = 0; index < source.count; index += 1) {
    result[index * components] = source.getX(index);
    if (components > 1) result[index * components + 1] = source.getY(index);
    if (components > 2) result[index * components + 2] = source.getZ(index);
    if (components > 3) result[index * components + 3] = source.getW(index);
  }
  return result;
}

function colorAttribute(
  source: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): Float32Array {
  const result = new Float32Array(source.count * 4);
  const hasAlpha = source.itemSize >= 4;
  for (let index = 0; index < source.count; index += 1) {
    result[index * 4] = source.getX(index);
    result[index * 4 + 1] = source.getY(index);
    result[index * 4 + 2] = source.getZ(index);
    result[index * 4 + 3] = hasAlpha ? source.getW(index) : 1;
  }
  return result;
}

function colorAndOcclusionAttribute(
  color: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  occlusion:
    THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  legacyZeroToThree: boolean,
): Float32Array {
  const count = color?.count ?? occlusion?.count ?? 0;
  if (
    color !== undefined &&
    occlusion !== undefined &&
    color.count !== occlusion.count
  ) {
    throw new Error(
      "Three geometry color and vertex-occlusion attributes have different vertex counts.",
    );
  }
  const result =
    color === undefined
      ? new Float32Array(count * 4).fill(1)
      : colorAttribute(color);
  if (occlusion === undefined) return result;
  for (let index = 0; index < count; index += 1) {
    const normalized = Math.max(
      0,
      Math.min(1, occlusion.getX(index) / (legacyZeroToThree ? 3 : 1)),
    );
    // Match the useful non-black floor of the original voxel shader while
    // expressing the result through Vapour's generic vertex-colour semantic.
    const factor = 0.35 + normalized * 0.65;
    result[index * 4] = result[index * 4]! * factor;
    result[index * 4 + 1] = result[index * 4 + 1]! * factor;
    result[index * 4 + 2] = result[index * 4 + 2]! * factor;
  }
  return result;
}

function sequentialTriangleIndices(
  vertexCount: number,
  uuid: string,
): Uint32Array {
  if (vertexCount % 3 !== 0)
    throw new Error(
      `Non-indexed Three geometry '${uuid}' has ${String(vertexCount)} vertices, not complete triangles.`,
    );
  return Uint32Array.from({ length: vertexCount }, (_, index) => index);
}

function uint32Indices(
  index: THREE.BufferAttribute,
  vertexCount: number,
  uuid: string,
): Uint32Array {
  if (index.count % 3 !== 0)
    throw new Error(
      `Three geometry '${uuid}' has ${String(index.count)} indices, not complete triangles.`,
    );
  const result = new Uint32Array(index.count);
  for (let offset = 0; offset < index.count; offset += 1) {
    const value = index.getX(offset);
    if (!Number.isInteger(value) || value < 0 || value >= vertexCount) {
      throw new Error(
        `Three geometry '${uuid}' has invalid index ${String(value)} at ${String(offset)}.`,
      );
    }
    result[offset] = value;
  }
  return result;
}

function geometryVersion(geometry: THREE.BufferGeometry): number {
  let version = geometry.index?.version ?? 0;
  for (const attribute of Object.values(geometry.attributes))
    version = Math.max(version, attributeVersion(attribute));
  return version;
}

function primaryMaterial(
  material: THREE.Material | readonly THREE.Material[],
): THREE.Material {
  if (Array.isArray(material))
    return material[0] ?? new THREE.MeshStandardMaterial();
  return material as THREE.Material;
}

function attributeVersion(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): number {
  return attribute instanceof THREE.InterleavedBufferAttribute
    ? attribute.data.version
    : attribute.version;
}

function drawOptions(material: THREE.Material): {
  color: [number, number, number, number];
  metallic: number;
  roughness: number;
  emissive: number;
  alphaCutoff: number;
} {
  const surface = material as THREE.Material & {
    color?: THREE.Color;
    opacity?: number;
    metalness?: number;
    roughness?: number;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
    alphaTest?: number;
  };
  const color = surface.color ?? new THREE.Color(1, 1, 1);
  const emissive = surface.emissive;
  const emissionStrength =
    emissive === undefined
      ? 0
      : Math.max(emissive.r, emissive.g, emissive.b) *
        (surface.emissiveIntensity ?? 1);
  return {
    color: [color.r, color.g, color.b, surface.opacity ?? 1],
    metallic: surface.metalness ?? 0,
    roughness: surface.roughness ?? 0.72,
    emissive: emissionStrength,
    alphaCutoff: surface.alphaTest ?? 0.01,
  };
}

function materialMaps(material: THREE.Material): {
  baseColor?: THREE.Texture;
  normal?: THREE.Texture;
  metallicRoughness?: THREE.Texture;
  occlusion?: THREE.Texture;
  emission?: THREE.Texture;
} {
  const surface = material as THREE.Material & {
    map?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
    metalnessMap?: THREE.Texture | null;
    roughnessMap?: THREE.Texture | null;
    aoMap?: THREE.Texture | null;
    emissiveMap?: THREE.Texture | null;
  };
  if (
    surface.metalnessMap !== undefined &&
    surface.roughnessMap !== undefined &&
    surface.metalnessMap !== null &&
    surface.roughnessMap !== null &&
    surface.metalnessMap !== surface.roughnessMap
  ) {
    // Standard Vapour/glTF packing expects roughness in G and metallic in B.
    // Two independent Three maps need importer-side channel packing.
  }
  return {
    ...(surface.map == null ? {} : { baseColor: surface.map }),
    ...(surface.normalMap == null ? {} : { normal: surface.normalMap }),
    ...((surface.metalnessMap ?? surface.roughnessMap) == null
      ? {}
      : { metallicRoughness: (surface.metalnessMap ?? surface.roughnessMap)! }),
    ...(surface.aoMap == null ? {} : { occlusion: surface.aoMap }),
    ...(surface.emissiveMap == null ? {} : { emission: surface.emissiveMap }),
  };
}

function extractTexture(texture: THREE.Texture): TextureUpload | undefined {
  const source = texture.image as
    | {
        width?: number;
        height?: number;
        data?: ArrayBufferView;
        getContext?: (
          kind: "2d",
          options?: { willReadFrequently?: boolean },
        ) => CanvasRenderingContext2D | null;
      }
    | undefined;
  const width = source?.width;
  const height = source?.height;
  if (
    source === undefined ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width! < 1 ||
    height! < 1
  )
    return undefined;
  let pixels: Uint8Array;
  if (source.data !== undefined) {
    const bytes = new Uint8Array(
      source.data.buffer,
      source.data.byteOffset,
      source.data.byteLength,
    );
    if (bytes.length !== width! * height! * 4) return undefined;
    pixels = bytes.slice();
  } else if (source.getContext !== undefined) {
    const context = source.getContext("2d", { willReadFrequently: true });
    if (context === null) return undefined;
    pixels = new Uint8Array(context.getImageData(0, 0, width!, height!).data);
  } else if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width!;
    canvas.height = height!;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return undefined;
    try {
      context.drawImage(
        texture.image as CanvasImageSource,
        0,
        0,
        width!,
        height!,
      );
    } catch {
      return undefined;
    }
    pixels = new Uint8Array(context.getImageData(0, 0, width!, height!).data);
  } else {
    return undefined;
  }
  return {
    width: width!,
    height: height!,
    pixels,
    colorSpace: texture.colorSpace === THREE.SRGBColorSpace ? "srgb" : "linear",
  };
}
