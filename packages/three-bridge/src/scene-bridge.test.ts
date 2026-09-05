import {
  LIGHT_KIND_AMBIENT,
  LIGHT_KIND_DIRECTIONAL,
  LIGHT_KIND_HEMISPHERE,
  LIGHT_KIND_POINT,
  LIGHT_KIND_SPOT,
  LIGHT_STRIDE,
  type MaterialUpload,
  type MeshUpload,
  type PackedFrame,
  type PostProcessSettings,
  type RenderLayerSubmission,
  type RenderStats,
  type TextureUpload,
} from "@vapour/engine";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ThreeSceneBridge, type ThreeBridgeHost } from "./scene-bridge.js";

class RecordingHost implements ThreeBridgeHost {
  initialized = true;
  readonly uploads: Array<{ id: string; mesh: MeshUpload }> = [];
  readonly releases: string[] = [];
  readonly textureUploads: Array<{ id: string; texture: TextureUpload }> = [];
  readonly materialUploads: Array<{ id: string; material: MaterialUpload }> =
    [];
  readonly textureReleases: string[] = [];
  readonly materialReleases: string[] = [];
  frame: PackedFrame | undefined;
  layers: Array<{
    frame: PackedFrame;
    clearColor?: boolean;
    clearDepth?: boolean;
  }> = [];
  destroyed = false;
  post: PostProcessSettings = { exposure: 1, toneMapping: "aces" };

  async initialize(): Promise<void> {}
  uploadMesh(id: string, mesh: MeshUpload): void {
    this.uploads.push({ id, mesh });
  }
  releaseMesh(id: string): boolean {
    this.releases.push(id);
    return true;
  }
  uploadTexture(id: string, texture: TextureUpload): void {
    this.textureUploads.push({ id, texture });
  }
  releaseTexture(id: string): boolean {
    this.textureReleases.push(id);
    return true;
  }
  defineMaterial(id: string, material: MaterialUpload): void {
    this.materialUploads.push({ id, material });
  }
  releaseMaterial(id: string): boolean {
    this.materialReleases.push(id);
    return true;
  }
  setPostProcess(settings: PostProcessSettings): void {
    this.post = { ...this.post, ...settings };
  }
  postProcess(): Readonly<PostProcessSettings> {
    return this.post;
  }
  submitFrame(frame: PackedFrame): void {
    this.frame = cloneFrame(frame);
  }
  submitLayers(layers: readonly RenderLayerSubmission[]): void {
    this.layers = layers.map((layer) => ({
      frame: cloneFrame(layer.frame),
      ...(layer.clearColor === undefined
        ? {}
        : { clearColor: layer.clearColor }),
      ...(layer.clearDepth === undefined
        ? {}
        : { clearDepth: layer.clearDepth }),
    }));
    this.frame = this.layers[0]?.frame;
  }
  renderFrame(): RenderStats {
    return {
      fps: 60,
      frameTimeMs: 16.67,
      cpuEncodeMs: 0.4,
      drawCalls: 1,
      triangles: 12,
    };
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function cloneFrame(frame: PackedFrame): PackedFrame {
  return {
    meshTable: [...frame.meshTable],
    meshIndices: frame.meshIndices.slice(),
    materialTable: [...frame.materialTable],
    materialIndices: frame.materialIndices.slice(),
    matrices: frame.matrices.slice(),
    baseColors: frame.baseColors.slice(),
    materialParams: frame.materialParams.slice(),
    camera: frame.camera.slice(),
    light: frame.light.slice(),
    ...(frame.environment === undefined
      ? {}
      : { environment: frame.environment.slice() }),
  };
}

function fixture(): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mesh: THREE.Mesh;
} {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.1, 500);
  camera.position.set(2, 3, 8);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 3, 4),
    new THREE.MeshStandardMaterial({
      color: 0x336699,
      roughness: 0.4,
      metalness: 0.25,
    }),
  );
  mesh.position.set(4, 5, 6);
  scene.add(mesh);
  return { scene, camera, mesh };
}

describe("ThreeSceneBridge", () => {
  it("extracts geometry, camera, material, and world transform into one packed frame", () => {
    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    const { scene, camera } = fixture();
    expect(bridge.render(scene, camera, 100)?.drawCalls).toBe(1);
    expect(host.uploads).toHaveLength(1);
    expect(host.uploads[0]!.mesh.positions.length).toBeGreaterThan(0);
    expect(host.uploads[0]!.mesh.indices.length % 3).toBe(0);
    expect(host.frame?.meshTable).toHaveLength(1);
    expect(host.frame?.meshIndices).toEqual(new Uint32Array([0]));
    expect(host.frame?.matrices.slice(12, 15)).toEqual(
      new Float32Array([4, 5, 6]),
    );
    expect(host.frame?.camera[16]).toBe(0);
    expect(host.frame?.camera[17]).toBe(72);
    expect(host.frame?.baseColors[3]).toBe(1);
    expect(host.frame?.materialParams.slice(0, 2)).toEqual(
      new Float32Array([0.25, 0.4]),
    );
  });

  it("translates scene background and distance fog into the frame environment", () => {
    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    const { scene, camera } = fixture();
    scene.background = new THREE.Color().setRGB(0.2, 0.4, 0.8);
    scene.fog = new THREE.Fog(new THREE.Color().setRGB(0.3, 0.5, 0.7), 12, 180);
    bridge.render(scene, camera);

    expect(host.frame?.environment).toHaveLength(24);
    expect(host.frame?.environment?.slice(0, 4)).toEqual(
      new Float32Array([0.2, 0.4, 0.8, 1]),
    );
    expect(host.frame?.environment?.[7]).toBe(1);
    expect(host.frame?.environment?.slice(8, 10)).toEqual(
      new Float32Array([12, 180]),
    );
  });

  it("extracts independent cameras into one layered presentation", () => {
    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    const world = fixture();
    const hands = fixture();
    hands.camera.fov = 50;
    hands.mesh.name = "Hands";
    bridge.renderLayers(
      [
        { scene: world.scene, camera: world.camera },
        {
          scene: hands.scene,
          camera: hands.camera,
          clearColor: false,
          clearDepth: true,
        },
      ],
      100,
    );

    expect(host.layers).toHaveLength(2);
    expect(host.layers[0]?.frame.camera[17]).toBe(72);
    expect(host.layers[1]?.frame.camera[17]).toBe(50);
    expect(host.layers[1]).toMatchObject({
      clearColor: false,
      clearDepth: true,
    });
    expect(host.uploads).toHaveLength(2);
  });

  it("reuses unchanged geometry and replaces a mutated buffer", () => {
    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    const { scene, camera, mesh } = fixture();
    bridge.render(scene, camera);
    bridge.render(scene, camera);
    expect(host.uploads).toHaveLength(1);
    const position = mesh.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    position.setX(0, position.getX(0) + 1);
    position.needsUpdate = true;
    bridge.render(scene, camera);
    expect(host.uploads).toHaveLength(2);
    expect(host.uploads[1]!.id).toBe(host.uploads[0]!.id);
  });

  it("uploads Three data textures and binds stable material assets", () => {
    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    const texture = new THREE.DataTexture(pixels, 2, 1, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.8,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    material.userData.vapourAtlas = {
      columns: 2,
      rows: 1,
      inset: 0.01,
      origin: "top-left",
    };
    const geometry = new THREE.PlaneGeometry();
    geometry.setAttribute(
      "aTile",
      new THREE.Float32BufferAttribute([1, 1, 1, 1], 1),
    );
    geometry.setAttribute(
      "aAO",
      new THREE.Float32BufferAttribute([3, 2, 1, 0], 1),
    );
    scene.add(new THREE.Mesh(geometry, material));
    bridge.render(scene, camera);
    expect(host.textureUploads).toHaveLength(1);
    expect(host.textureUploads[0]?.texture).toMatchObject({
      width: 2,
      height: 1,
      colorSpace: "srgb",
    });
    expect(host.textureUploads[0]?.texture.pixels).toEqual(pixels);
    expect(host.materialUploads).toHaveLength(1);
    expect(host.materialUploads[0]?.material.textures?.baseColor).toBe(
      host.textureUploads[0]?.id,
    );
    expect(host.materialUploads[0]?.material.atlas).toEqual({
      columns: 2,
      rows: 1,
      inset: 0.01,
      origin: "top-left",
    });
    expect(host.materialUploads[0]?.material).toMatchObject({
      alphaMode: "blend",
      doubleSided: true,
      depthWrite: false,
    });
    expect(host.uploads[0]?.mesh.textureLayers).toEqual(
      new Float32Array([1, 1, 1, 1]),
    );
    expect(host.uploads[0]?.mesh.colors?.[0]).toBeCloseTo(1);
    expect(host.uploads[0]?.mesh.colors?.[12]).toBeCloseTo(0.35);
    expect(host.frame?.materialIndices).toEqual(new Uint32Array([1]));
    bridge.render(scene, camera);
    expect(host.textureUploads).toHaveLength(1);
    expect(host.materialUploads).toHaveLength(1);
  });

  it("expands instanced meshes into packed instance transforms", () => {
    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const instances = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
      3,
    );
    for (let index = 0; index < 3; index += 1)
      instances.setMatrixAt(
        index,
        new THREE.Matrix4().makeTranslation(index, 0, 0),
      );
    scene.add(instances);
    bridge.render(scene, camera);
    expect(host.frame?.meshIndices).toEqual(new Uint32Array([0, 0, 0]));
    expect(host.frame?.matrices).toHaveLength(48);
    expect(host.frame?.matrices[44]).toBe(2);
  });

  it("releases geometry after it remains absent for two frames", () => {
    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    const { scene, camera, mesh } = fixture();
    bridge.render(scene, camera);
    scene.remove(mesh);
    bridge.render(scene, camera);
    expect(host.releases).toHaveLength(0);
    bridge.render(scene, camera);
    expect(host.releases).toEqual([host.uploads[0]!.id]);
  });

  it("reports unsupported primitives once and does not pretend to draw them", () => {
    const diagnostics: string[] = [];
    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, {
      host,
      onDiagnostic: (value) => diagnostics.push(value),
    });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(1, 0, 0),
        ]),
      ),
    );
    bridge.render(scene, camera);
    bridge.render(scene, camera);
    expect(host.frame?.meshIndices).toHaveLength(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatch(/Line rendering/);
  });

  it("destroys its host and releases retained geometry", () => {
    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    const { scene, camera } = fixture();
    bridge.render(scene, camera);
    bridge.destroy();
    bridge.destroy();
    expect(host.releases).toHaveLength(1);
    expect(host.destroyed).toBe(true);
    expect(() => bridge.render(scene, camera)).toThrow(/destroyed/);
  });

  it("carries every light kind across, not just the first directional one", () => {
    // A scene's readable brightness usually comes from its ambient and
    // hemisphere fill. Dropping those renders a correctly shaded world almost
    // black, which is what a single-directional bridge did.
    const { scene, camera } = fixture();
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    scene.add(new THREE.HemisphereLight(0x8899ff, 0x332211, 0.3));
    const sun = new THREE.DirectionalLight(0xfff0dd, 1.2);
    sun.position.set(10, 20, 5);
    scene.add(sun);
    const torch = new THREE.PointLight(0xffa500, 1.6, 12);
    torch.position.set(3, 1.5, -2);
    scene.add(torch);
    const lamp = new THREE.SpotLight(0xffffff, 2, 25, Math.PI / 5, 0.4);
    lamp.position.set(0, 8, 0);
    scene.add(lamp);

    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    bridge.render(scene, camera);

    const light = host.frame!.light;
    expect(light.length % LIGHT_STRIDE).toBe(0);
    const kinds = [];
    for (let index = 0; index < light.length; index += LIGHT_STRIDE)
      kinds.push(light[index]);
    expect(kinds).toEqual([
      LIGHT_KIND_AMBIENT,
      LIGHT_KIND_HEMISPHERE,
      LIGHT_KIND_DIRECTIONAL,
      LIGHT_KIND_POINT,
      LIGHT_KIND_SPOT,
    ]);
  });

  it("gives a point light its world position and range", () => {
    const { scene, camera } = fixture();
    const torch = new THREE.PointLight(0xffa500, 1.6, 12);
    torch.position.set(3, 1.5, -2);
    scene.add(torch);

    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    bridge.render(scene, camera);

    const light = host.frame!.light;
    expect([...light.subarray(1, 4)]).toEqual([3, 1.5, -2]);
    expect(light[11]).toBe(12);
  });

  it("resolves a directional light's travel direction from its target", () => {
    // Three states a light by position and target; the renderer wants the
    // direction light travels, which is the difference between them.
    const { scene, camera } = fixture();
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(0, 10, 0);
    scene.add(sun);

    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    bridge.render(scene, camera);

    expect([...host.frame!.light.subarray(1, 4)]).toEqual([0, -1, 0]);
  });

  it("lights a scene that declares no lights at all", () => {
    // Submitting an empty rig would render the scene black.
    const { scene, camera } = fixture();
    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    bridge.render(scene, camera);
    expect(host.frame!.light.length).toBeGreaterThanOrEqual(LIGHT_STRIDE);
  });

  it("skips a light that is not visible", () => {
    const { scene, camera } = fixture();
    const hidden = new THREE.AmbientLight(0xffffff, 0.4);
    hidden.visible = false;
    scene.add(hidden);

    const host = new RecordingHost();
    const bridge = new ThreeSceneBridge({} as HTMLCanvasElement, { host });
    bridge.render(scene, camera);

    const light = host.frame!.light;
    const kinds = [];
    for (let index = 0; index < light.length; index += LIGHT_STRIDE)
      kinds.push(light[index]);
    expect(kinds).not.toContain(LIGHT_KIND_AMBIENT);
  });
});
