import * as THREE from 'three';
import { VapourRendererControls } from './VapourRendererControls';
import { EventBus } from '../core/EventBus';
import { InputManager } from '../core/InputManager';
import { BlockRegistry } from '../world/BlockRegistry';
import { ItemRegistry } from '../items/ItemRegistry';
import { StorageManager } from '../storage/StorageManager';
import { createDefaultSteveSkinDataUrl } from '../player/DefaultSteveSkin';
import { isSkinDataUrl, setBoxSkin, skinPartRects } from '../player/MinecraftSkin';

export class Renderer {
  public renderer: VapourRendererControls;
  public camera: THREE.PerspectiveCamera;
  public scene: THREE.Scene;
  private usePostProcessing = false;
  public shadowsEnabled = true;
  private viewModelScene: THREE.Scene = new THREE.Scene();
  private viewModelCamera!: THREE.PerspectiveCamera;
  private viewModelVisible = true;
  private viewModelFill!: THREE.HemisphereLight;
  private viewModelKey!: THREE.DirectionalLight;
  private viewModelRim!: THREE.DirectionalLight;
  private playerShadowGroup: THREE.Group = new THREE.Group();
  private shadowConfiguredObjects = new WeakSet<THREE.Object3D>();
  private lastShadowConfigureTime = 0;

  // Visual effects nodes
  public cameraGroup: THREE.Group; // Group containing the camera to apply bobbing independently
  public handGroup: THREE.Group = new THREE.Group(); // Back-compat alias for the right arm/tool pivot
  public bodyGroup: THREE.Group = new THREE.Group();
  private heldItemGroup: THREE.Group = new THREE.Group();
  private heldItemTemplateCache = new Map<number, THREE.Object3D>();
  private currentHeldItemId = -1;
  private headGroup: THREE.Group = new THREE.Group();
  private torsoGroup: THREE.Group = new THREE.Group();
  private leftArmGroup: THREE.Group = new THREE.Group();
  private thirdPersonRightArmGroup: THREE.Group = new THREE.Group();
  private rightArmGroup: THREE.Group = new THREE.Group();
  private leftLegGroup: THREE.Group = new THREE.Group();
  private rightLegGroup: THREE.Group = new THREE.Group();
  private leftFootGroup: THREE.Group = new THREE.Group();
  private rightFootGroup: THREE.Group = new THREE.Group();
  private thirdPersonBodyVisible = false;
  private localPlayerSkinUrl = '';
  private textureAtlas: THREE.Texture | null = null;
  private crackMesh!: THREE.Mesh;
  private selectionBox!: THREE.LineSegments;

  // Hand bobbing / sway values
  private bobTime: number = 0;
  private bodyTargetRot = new THREE.Euler(0, 0, 0);
  private lastGrounded = false;
  private landingKick = 0;
  private cameraInertia = new THREE.Vector2();

  // Mining swing variables
  private isSwinging: boolean = false;
  private swingTime: number = 0;
  private swingSpeed: number = 15.5; // radians/sec for a smooth constant punch loop

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Renderer container #${containerId} was not found`);
    }

    // 1. Scene Setup
    this.scene = new THREE.Scene();

    // 2. Camera setup inside groups
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.cameraGroup = new THREE.Group();
    this.cameraGroup.add(this.camera);
    this.scene.add(this.cameraGroup);

    // Dedicated view-model scene. The arm/tool is rendered after the world with a
    // fresh depth buffer, so terrain, water, or leaves can never hide it.
    this.viewModelCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 10);
    this.viewModelScene.add(this.viewModelCamera);

    this.viewModelFill = new THREE.HemisphereLight(0xffffff, 0x2b355a, 0.92);
    this.viewModelScene.add(this.viewModelFill);

    this.viewModelKey = new THREE.DirectionalLight(0xffffff, 1.0);
    this.viewModelKey.position.set(-0.42, 0.85, 1.18);
    this.viewModelKey.castShadow = true;
    this.viewModelKey.shadow.mapSize.set(512, 512);
    this.viewModelKey.shadow.camera.near = 0.01;
    this.viewModelKey.shadow.camera.far = 8;
    this.viewModelKey.shadow.camera.left = -2;
    this.viewModelKey.shadow.camera.right = 2;
    this.viewModelKey.shadow.camera.top = 2;
    this.viewModelKey.shadow.camera.bottom = -2;
    this.viewModelKey.shadow.bias = -0.00012;
    this.viewModelKey.shadow.normalBias = 0.01;
    (this.viewModelKey.shadow.camera as THREE.OrthographicCamera).updateProjectionMatrix();
    this.viewModelKey.target.position.set(0.36, -0.18, -0.72);
    this.viewModelScene.add(this.viewModelKey);
    this.viewModelScene.add(this.viewModelKey.target);

    this.viewModelRim = new THREE.DirectionalLight(0x9fc6ff, 0.14);
    this.viewModelRim.position.set(0.8, -0.05, -1.2);
    this.viewModelScene.add(this.viewModelRim);

    if (typeof window !== 'undefined') {
      window.addEventListener('voxel:globalLighting', this.handleGlobalLighting as EventListener);
    }

    // 3. Vapour owns the WebGPU surface. Three remains temporarily as the
    // application's object graph and geometry authoring format only.
    this.renderer = new VapourRendererControls();
    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || window.innerHeight);
    // Set drawing buffer & CSS size to match container to prevent zoom/scale mismatch
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.setSize(width, height, true); // update style so canvas CSS size equals container size
    this.renderer.domElement.style.width = width + 'px';
    this.renderer.domElement.style.height = height + 'px';

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    // Enable object sorting to respect renderOrder for transparency layers
    this.renderer.sortObjects = true;
    container.appendChild(this.renderer.domElement);

    // Handle high-DPI and browser zoom/visual viewport changes (Mac retina/zoom)
    if ((window as any).visualViewport) {
      (window as any).visualViewport.addEventListener('resize', () => this.onWindowResize());
    }
    window.addEventListener('resize', () => this.onWindowResize());

    // 4. Create first-person body and an invisible local-player shadow caster
    this.createFirstPersonBody();
    this.createPlayerShadowCaster();

    // 5. Initialize cracks overlay mesh for block mining
    const crackGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const crackMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    this.crackMesh = new THREE.Mesh(crackGeo, crackMat);
    this.crackMesh.visible = false;
    this.scene.add(this.crackMesh);

    // 6. Initialize targeted block selection outline
    const outlineGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(outlineGeo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
    this.selectionBox = new THREE.LineSegments(edges, lineMat);
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    // Resize listener
    window.addEventListener('resize', () => this.onWindowResize());

    // Listen to mouse actions for hand swing
    EventBus.on('mouse:leftClick', () => this.triggerSwing());
  }

  public async initialize(): Promise<void> {
    await this.renderer.initialize();
  }

  // Arm skin texture reference — updated when player imports a skin
  private armSkinTexture: THREE.Texture | null = null;
  private upperArmMesh: THREE.Mesh | null = null;
  private forearmMesh: THREE.Mesh | null = null;
  private handMesh: THREE.Mesh | null = null;

  private createFirstPersonBody(): void {
    this.cameraGroup.add(this.bodyGroup);
    this.viewModelCamera.add(this.rightArmGroup);

    const placeholder = this.viewModelMaterial(0xffffff, 0.82, 0.0);
    const outerPlaceholder = this.viewModelMaterial(0xffffff, 0.82, 0.0);
    outerPlaceholder.transparent = true;
    outerPlaceholder.alphaTest = 0.08;

    const unit = 1.8 / 32;
    const head = 8 * unit;
    const bodyW = 8 * unit;
    const bodyH = 12 * unit;
    const bodyD = 4 * unit;
    const limbW = 4 * unit;
    const limbH = 12 * unit;
    const limbD = 4 * unit;
    const outerPad = 0.012;

    // The model is built in Minecraft's 32px-tall proportions, with feet at y=0.
    // The body group is parented under the camera group for local third-person/F5.
    // Keep the F5 body head locked under the camera pivot instead of feeling detached.
    this.bodyGroup.position.set(0, -1.575, -0.02);
    this.bodyGroup.add(this.headGroup, this.torsoGroup, this.leftArmGroup, this.thirdPersonRightArmGroup, this.leftLegGroup, this.rightLegGroup);

    const headY = limbH + bodyH + head / 2;
    const torsoY = limbH + bodyH / 2;
    const armPivotY = limbH + bodyH;
    const legPivotY = limbH;

    this.headGroup.position.set(0, headY, 0);
    const localHead = this.box(head, head, head, placeholder.clone());
    localHead.name = 'localHead';
    localHead.position.set(0, 0, 0);
    const localHeadOuter = this.box(head + outerPad, head + outerPad, head + outerPad, outerPlaceholder.clone());
    localHeadOuter.name = 'localHeadOuter';
    localHeadOuter.position.copy(localHead.position);
    localHeadOuter.renderOrder = 2;
    this.headGroup.add(localHead, localHeadOuter);

    const localTorso = this.box(bodyW, bodyH, bodyD, placeholder.clone());
    localTorso.name = 'localTorso';
    localTorso.position.set(0, torsoY, 0);
    const localTorsoOuter = this.box(bodyW + outerPad, bodyH + outerPad, bodyD + outerPad, outerPlaceholder.clone());
    localTorsoOuter.name = 'localTorsoOuter';
    localTorsoOuter.position.copy(localTorso.position);
    localTorsoOuter.renderOrder = 2;
    this.torsoGroup.add(localTorso, localTorsoOuter);

    this.leftArmGroup.position.set(-(bodyW / 2 + limbW / 2), armPivotY, 0);
    const localLeftArm = this.box(limbW, limbH, limbD, placeholder.clone());
    localLeftArm.name = 'localLeftArm';
    localLeftArm.position.y = -limbH / 2;
    const localLeftArmOuter = this.box(limbW + outerPad, limbH + outerPad, limbD + outerPad, outerPlaceholder.clone());
    localLeftArmOuter.name = 'localLeftArmOuter';
    localLeftArmOuter.position.copy(localLeftArm.position);
    localLeftArmOuter.renderOrder = 2;
    this.leftArmGroup.add(localLeftArm, localLeftArmOuter);

    this.thirdPersonRightArmGroup.position.set(bodyW / 2 + limbW / 2, armPivotY, 0);
    const localRightArm = this.box(limbW, limbH, limbD, placeholder.clone());
    localRightArm.name = 'localRightArm';
    localRightArm.position.y = -limbH / 2;
    const localRightArmOuter = this.box(limbW + outerPad, limbH + outerPad, limbD + outerPad, outerPlaceholder.clone());
    localRightArmOuter.name = 'localRightArmOuter';
    localRightArmOuter.position.copy(localRightArm.position);
    localRightArmOuter.renderOrder = 2;
    this.thirdPersonRightArmGroup.add(localRightArm, localRightArmOuter);

    this.leftLegGroup.position.set(-limbW / 2, legPivotY, 0);
    const localLeftLeg = this.box(limbW, limbH, limbD, placeholder.clone());
    localLeftLeg.name = 'localLeftLeg';
    localLeftLeg.position.y = -limbH / 2;
    const localLeftLegOuter = this.box(limbW + outerPad, limbH + outerPad, limbD + outerPad, outerPlaceholder.clone());
    localLeftLegOuter.name = 'localLeftLegOuter';
    localLeftLegOuter.position.copy(localLeftLeg.position);
    localLeftLegOuter.renderOrder = 2;
    this.leftLegGroup.add(localLeftLeg, localLeftLegOuter);

    this.rightLegGroup.position.set(limbW / 2, legPivotY, 0);
    const localRightLeg = this.box(limbW, limbH, limbD, placeholder.clone());
    localRightLeg.name = 'localRightLeg';
    localRightLeg.position.y = -limbH / 2;
    const localRightLegOuter = this.box(limbW + outerPad, limbH + outerPad, limbD + outerPad, outerPlaceholder.clone());
    localRightLegOuter.name = 'localRightLegOuter';
    localRightLegOuter.position.copy(localRightLeg.position);
    localRightLegOuter.renderOrder = 2;
    this.rightLegGroup.add(localRightLeg, localRightLegOuter);

    // First-person view model is now one single right-arm cuboid. The old
    // upper/forearm/hand stack was why the same skin strip appeared 3 times.
    this.rightArmGroup.position.set(0.58, -0.30, -0.68);
    this.rightArmGroup.rotation.set(0.92, -0.20, -0.07);
    this.rightArmGroup.scale.set(1.0, 1.0, 1.0);
    this.rightArmGroup.renderOrder = 999;
    this.handGroup = this.rightArmGroup;

    const fpArm = this.box(limbW, 0.74, limbD, placeholder.clone());
    fpArm.name = 'fpRightArm';
    fpArm.position.set(0, -0.37, 0);
    fpArm.renderOrder = 999;
    this.upperArmMesh = fpArm;
    this.forearmMesh = null;
    this.handMesh = null;
    this.rightArmGroup.add(fpArm);

    // Held item pivot
    this.heldItemGroup.position.set(0.03, -0.56, -0.18);
    this.heldItemGroup.rotation.set(0.50, -0.30, 0.08);
    this.heldItemGroup.renderOrder = 999;
    this.rightArmGroup.add(this.heldItemGroup);
    this.configureViewModelObject(this.rightArmGroup);

    // Try to load the saved skin immediately if one was imported previously.
    StorageManager.getGlobalData<string>('player_skin_data_url', '').then(url => {
      this.localPlayerSkinUrl = url || createDefaultSteveSkinDataUrl();
      this.applyArmSkin(this.localPlayerSkinUrl);
    }).catch(() => {
      this.localPlayerSkinUrl = createDefaultSteveSkinDataUrl();
      this.applyArmSkin(this.localPlayerSkinUrl);
    });

    EventBus.on('player:skinChanged', (dataUrl: string) => {
      this.localPlayerSkinUrl = dataUrl || createDefaultSteveSkinDataUrl();
      this.applyArmSkin(this.localPlayerSkinUrl);
    });

    this.headGroup.visible = false;
    this.torsoGroup.visible = false;
    this.leftArmGroup.visible = false;
    this.thirdPersonRightArmGroup.visible = false;
    this.leftLegGroup.visible = false;
    this.rightLegGroup.visible = false;
    this.rightArmGroup.visible = true;
    this.bodyGroup.visible = false;
  }

  /** Applies a 64×64 or legacy 64×32 Minecraft skin to the whole local model and
   * to the first-person arm. No FBX, no extra hidden meshes, no triple texture. */
  private applyArmSkin(skinDataUrl: string): void {
    if (!isSkinDataUrl(skinDataUrl)) return;

    const img = new Image();
    img.onload = () => {
      try {
        const legacy = img.height <= 32;
        const base = (objectName: string, part: Parameters<typeof skinPartRects>[0], mirror = false) => {
          setBoxSkin(this.bodyGroup, objectName, img, skinPartRects(part, legacy), mirror, { standard: true });
        };
        const overlay = (objectName: string, part: Parameters<typeof skinPartRects>[0], mirror = false) => {
          const obj = this.bodyGroup.getObjectByName(objectName);
          if (obj) obj.visible = !legacy;
          if (!legacy) setBoxSkin(this.bodyGroup, objectName, img, skinPartRects(part, legacy, true), mirror, { outer: true, standard: true });
        };

        base('localHead', 'head');
        base('localTorso', 'body');
        base('localRightArm', 'rightArm');
        base('localLeftArm', legacy ? 'rightArm' : 'leftArm', legacy);
        base('localRightLeg', 'rightLeg');
        base('localLeftLeg', legacy ? 'rightLeg' : 'leftLeg', legacy);

        overlay('localHeadOuter', 'head');
        overlay('localTorsoOuter', 'body');
        overlay('localRightArmOuter', 'rightArm');
        overlay('localLeftArmOuter', 'leftArm');
        overlay('localRightLegOuter', 'rightLeg');
        overlay('localLeftLegOuter', 'leftLeg');

        setBoxSkin(this.rightArmGroup, 'fpRightArm', img, skinPartRects('rightArm', legacy), false, { standard: true });
      } catch (e) {
        console.warn('[Renderer] Failed to apply player skin:', e);
      }
    };
    img.src = skinDataUrl;
  }

  private viewModelMaterial(color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      envMapIntensity: 0.12
    });
  }

  private box(width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  private configureViewModelObject(root: THREE.Object3D): void {
    root.traverse((child) => {
      child.frustumCulled = false;
      child.renderOrder = 999;

      const mesh = child as THREE.Mesh;
      const mats = mesh.material
        ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        : [];

      for (const mat of mats as THREE.Material[]) {
        mat.depthTest = true;
        mat.depthWrite = true;
        mat.needsUpdate = true;
      }
    });
  }

  private handleGlobalLighting = (event: Event): void => {
    const detail = (event as CustomEvent).detail || {};
    const sunLight = THREE.MathUtils.clamp(Number(detail.sunLight ?? 1.0), 0, 1);
    const dirIntensity = Number(detail.dirLightIntensity ?? 1.0);
    const ambientIntensity = Number(detail.ambientLightIntensity ?? 0.3);
    const dayAmount = THREE.MathUtils.smoothstep(sunLight, 0.02, 0.75);

    const dirColor = new THREE.Color(detail.dirLightColor ?? 0xffffff);
    const ambientColor = new THREE.Color(detail.ambientLightColor ?? 0xffffff);
    const fogColor = new THREE.Color(detail.fogColor ?? 0x90a0c0);

    this.viewModelKey.color.copy(dirColor);
    this.viewModelKey.intensity = THREE.MathUtils.clamp(dirIntensity * 0.62, 0.018, 1.05);

    this.viewModelFill.color.copy(ambientColor);
    this.viewModelFill.groundColor.copy(fogColor).multiplyScalar(0.55);
    this.viewModelFill.intensity = THREE.MathUtils.clamp(ambientIntensity * 0.95, 0.018, 0.48);

    this.viewModelRim.color.copy(fogColor).lerp(new THREE.Color(0xffffff), dayAmount * 0.22);
    this.viewModelRim.intensity = THREE.MathUtils.lerp(0.025, 0.15, dayAmount);

    const sunDirection = detail.sunDirection;
    if (sunDirection) {
      const localSun = new THREE.Vector3(
        Number(sunDirection.x ?? 0.35),
        Number(sunDirection.y ?? 0.8),
        Number(sunDirection.z ?? 0.25)
      ).normalize();
      this.viewModelKey.position.set(-localSun.x * 1.1, Math.max(0.22, localSun.y * 1.0), Math.abs(localSun.z) * 1.15 + 0.45);
      this.viewModelKey.target.position.set(0.36, -0.18, -0.72);
      this.viewModelKey.target.updateMatrixWorld();
    }
  };

  private createPlayerShadowCaster(): void {
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    shadowMat.colorWrite = false;
    shadowMat.depthWrite = false;

    this.playerShadowGroup.name = 'LocalPlayerShadowCaster';
    this.playerShadowGroup.userData.shadowOnlyPlayer = true;
    this.playerShadowGroup.position.set(0, -1.42, 0.08);
    this.playerShadowGroup.frustumCulled = false;

    const addPart = (name: string, size: THREE.Vector3, pos: THREE.Vector3): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), shadowMat);
      mesh.name = name;
      mesh.position.copy(pos);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.userData.shadowOnlyPlayer = true;
      this.playerShadowGroup.add(mesh);
    };

    addPart('shadow_head', new THREE.Vector3(0.34, 0.34, 0.34), new THREE.Vector3(0, 1.46, 0));
    addPart('shadow_torso', new THREE.Vector3(0.48, 0.62, 0.28), new THREE.Vector3(0, 0.96, 0.02));
    addPart('shadow_left_arm', new THREE.Vector3(0.16, 0.56, 0.16), new THREE.Vector3(-0.35, 0.95, 0.02));
    addPart('shadow_right_arm', new THREE.Vector3(0.16, 0.56, 0.16), new THREE.Vector3(0.35, 0.95, 0.02));
    addPart('shadow_left_leg', new THREE.Vector3(0.19, 0.66, 0.18), new THREE.Vector3(-0.13, 0.32, 0.02));
    addPart('shadow_right_leg', new THREE.Vector3(0.19, 0.66, 0.18), new THREE.Vector3(0.13, 0.32, 0.02));

    this.cameraGroup.add(this.playerShadowGroup);
  }

  private forceWorldShadowFlags(): void {
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || this.shadowConfiguredObjects.has(mesh)) return;

      if (mesh === this.crackMesh || obj === this.selectionBox || obj.userData.noWorldShadow) {
        this.shadowConfiguredObjects.add(mesh);
        return;
      }

      const isChunkMesh = !!obj.userData.chunkMesh;
      const isOpaqueChunk = !!obj.userData.isOpaqueChunk;

      if (this.shadowsEnabled) {
        mesh.castShadow = isOpaqueChunk || !isChunkMesh;
        mesh.receiveShadow = isOpaqueChunk || (!isChunkMesh && !obj.userData.shadowOnlyPlayer);
      } else {
        mesh.castShadow = !isChunkMesh;
        mesh.receiveShadow = !isChunkMesh && !obj.userData.shadowOnlyPlayer;
      }
      mesh.frustumCulled = !obj.userData.shadowOnlyPlayer;

      const mats = mesh.material
        ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        : [];
      for (const mat of mats as THREE.Material[]) {
        mat.needsUpdate = true;
      }

      this.shadowConfiguredObjects.add(mesh);
    });
  }

  public setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    this.renderer.shadowMap.enabled = enabled;
    this.shadowConfiguredObjects = new WeakSet<THREE.Object3D>();
    this.forceWorldShadowFlags();
  }


  public setTextureAtlas(texture: THREE.Texture): void {
    this.textureAtlas = texture;
    this.heldItemTemplateCache.clear();
    this.currentHeldItemId = -1;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    if (this.crackMesh) {
      (this.crackMesh.material as THREE.MeshBasicMaterial).map = texture;
    }
  }

  public updateHandMeshBlock(blockId: number): void {
    if (blockId === this.currentHeldItemId && this.heldItemGroup.children.length > 0) return;

    this.heldItemGroup.clear();
    this.currentHeldItemId = blockId;
    if (blockId === 0) {
      if (this.upperArmMesh) this.upperArmMesh.visible = true;
      return;
    }

    const obj = this.getHeldObjectTemplate(blockId).clone(true);
    
    obj.renderOrder = 999;
    obj.traverse((child) => {
      child.renderOrder = 999;
      child.frustumCulled = false;
    });
    this.heldItemGroup.add(obj);

    if (this.upperArmMesh) {
      if (this.isWeaponViewModelItem(blockId)) {
        this.upperArmMesh.visible = false;
        this.upperArmMesh.position.set(0.08, -0.49, 0.04);
        this.upperArmMesh.scale.set(0.68, 0.76, 0.68);
      } else {
        this.upperArmMesh.visible = true;
        this.upperArmMesh.position.set(0, -0.37, 0);
        this.upperArmMesh.scale.set(1, 1, 1);
      }
    }
  }

  public playGunRecoil(strength = 1): void {
    this.heldItemGroup.position.z += 0.05 * strength;
    this.heldItemGroup.position.y -= 0.025 * strength;
    this.rightArmGroup.rotation.x -= 0.10 * strength;
  }

  public applyProceduralWeaponPose(position: THREE.Vector3, rotation: THREE.Euler, scale: THREE.Vector3): void {
    this.heldItemGroup.position.copy(position);
    this.heldItemGroup.rotation.copy(rotation);
    this.heldItemGroup.scale.copy(scale);
  }

  public applyWeaponInspect(progress: number): void {
    const t = Math.max(0, Math.min(1, progress));
    if (t <= 0) return;
    const flip = Math.sin(t * Math.PI);
    const roll = Math.sin(t * Math.PI * 2);
    this.heldItemGroup.position.x += 0.16 * flip;
    this.heldItemGroup.position.y += 0.10 * flip;
    this.heldItemGroup.position.z -= 0.10 * flip;
    this.heldItemGroup.rotation.x += 0.42 * flip;
    this.heldItemGroup.rotation.y += 0.95 * flip + 0.18 * roll;
    this.heldItemGroup.rotation.z += 0.55 * flip;
    this.rightArmGroup.rotation.x += 0.22 * flip;
    this.rightArmGroup.rotation.y += 0.18 * flip;
  }

  private getHeldObjectTemplate(itemId: number): THREE.Object3D {
    const cached = this.heldItemTemplateCache.get(itemId);
    if (cached) return cached;

    const obj = ItemRegistry.shouldRenderAsBlock(itemId) && BlockRegistry.isPlaceableBlock(itemId)
      ? this.createHeldBlock(itemId)
      : this.createHeldItem(itemId);

    obj.traverse((child) => {
      child.renderOrder = 999;
      child.frustumCulled = false;
    });
    this.heldItemTemplateCache.set(itemId, obj);
    return obj;
  }

  private createHeldBlockMaterial(): THREE.MeshStandardMaterial {
    return this.textureAtlas
      ? new THREE.MeshStandardMaterial({ map: this.textureAtlas, roughness: 0.82, metalness: 0.0 })
      : new THREE.MeshStandardMaterial({ color: 0x8f8f8f, roughness: 0.82, metalness: 0.0 });
  }

  private createHeldBlock(blockId: number): THREE.Object3D {
    if (BlockRegistry.getRenderShape(blockId) !== 'cube') {
      return this.createHeldPostBlock(blockId);
    }

    const size = 0.28;
    const geometry = new THREE.BoxGeometry(size, size, size);
    this.applyBlockUVs(geometry, blockId);

    const material = this.createHeldBlockMaterial();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0.035, 0.015, -0.055);
    // Classic Minecraft diamond-angle look
    mesh.rotation.set(0.35, 0.55, 0.12);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createHeldPostBlock(blockId: number): THREE.Object3D {
    const group = new THREE.Group();
    const material = this.createHeldBlockMaterial();

    const stemGeo = new THREE.BoxGeometry(0.075, 0.38, 0.075);
    this.applyBlockUVs(stemGeo, blockId);
    const stem = new THREE.Mesh(stemGeo, material);
    stem.position.set(0, -0.025, 0);

    const capGeo = new THREE.BoxGeometry(0.13, 0.085, 0.13);
    this.applyBlockUVs(capGeo, blockId);
    const cap = new THREE.Mesh(capGeo, material);
    cap.position.set(0, 0.205, 0);

    group.add(stem, cap);
    group.position.set(0.035, 0.0, -0.07);
    group.rotation.set(0.42, 0.48, 0.16);
    group.scale.setScalar(0.95);
    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return group;
  }

  private createCbgoWeaponViewModel(itemId: number): THREE.Object3D {
    const group = new THREE.Group();
    const palette = {
      receiver: new THREE.MeshStandardMaterial({ color: itemId === 623 ? 0x171c21 : 0x20272e, roughness: 0.42, metalness: 0.62 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0b0f13, roughness: 0.78, metalness: 0.18 }),
      rail: new THREE.MeshStandardMaterial({ color: 0x3c4852, roughness: 0.48, metalness: 0.58 }),
      tan: new THREE.MeshStandardMaterial({ color: 0x74684c, roughness: 0.66, metalness: 0.12 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x6f3f22, roughness: 0.72, metalness: 0.04 }),
      accent: new THREE.MeshStandardMaterial({
        color: itemId === 621 ? 0x69d6ff : itemId === 622 ? 0xd1a35e : itemId === 623 ? 0xff5a72 : itemId === 624 ? 0xe8edf2 : 0xaeb8c2,
        roughness: 0.38,
        metalness: 0.42
      }),
    };

    const addBox = (
      name: string,
      size: [number, number, number],
      pos: [number, number, number],
      mat: THREE.Material,
      rot: [number, number, number] = [0, 0, 0]
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
      mesh.name = name;
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    const addGripHands = (longGun: boolean): void => {
      const glove = new THREE.MeshStandardMaterial({ color: 0x171a1e, roughness: 0.92, metalness: 0.04 });
      const skin = new THREE.MeshStandardMaterial({ color: 0xb8794f, roughness: 0.82, metalness: 0.0 });
      const wrist = addBox('triggerWrist', [0.13, 0.11, 0.13], [0.20, -0.31, -0.06], skin, [0.08, 0.02, -0.24]);
      const trigger = addBox('triggerGlove', [0.16, 0.13, 0.14], [0.12, -0.22, -0.07], glove, [0.04, 0.02, -0.24]);
      const knuckles = addBox('triggerKnuckles', [0.12, 0.045, 0.14], [0.04, -0.15, -0.12], glove, [0, 0, -0.1]);
      wrist.renderOrder = trigger.renderOrder = knuckles.renderOrder = 1000;
      if (longGun) {
        const supportForearm = addBox('supportForearm', [0.13, 0.12, 0.34], [-0.28, -0.26, -0.02], skin, [0.08, -0.26, 0.18]);
        const supportPalm = addBox('supportGlove', [0.19, 0.12, 0.16], [-0.30, -0.12, -0.09], glove, [0.02, -0.06, 0.12]);
        const supportFingers = addBox('supportFingers', [0.18, 0.055, 0.20], [-0.39, -0.08, -0.13], glove, [0, 0.06, 0.04]);
        supportForearm.renderOrder = supportPalm.renderOrder = supportFingers.renderOrder = 1000;
      }
    };

    if (itemId === 620) {
      addBox('slide', [0.42, 0.10, 0.12], [-0.06, 0.05, -0.08], palette.receiver);
      addBox('frame', [0.28, 0.08, 0.12], [-0.02, -0.01, -0.06], palette.dark);
      addBox('barrel', [0.18, 0.045, 0.055], [-0.38, 0.06, -0.08], palette.rail);
      addBox('grip', [0.095, 0.27, 0.09], [0.10, -0.18, -0.03], palette.dark, [0, 0, 0.18]);
      addBox('frontSight', [0.035, 0.045, 0.035], [-0.24, 0.13, -0.08], palette.accent);
      addGripHands(false);
      group.position.set(0.10, -0.31, -0.38);
      group.rotation.set(0.05, -0.05, -0.10);
      group.scale.setScalar(1.16);
      return group;
    }

    const isSmg = itemId === 621;
    const isRifle = itemId === 622;
    const isSniper = itemId === 623;
    const isShotgun = itemId === 624;
    const length = isSniper ? 0.84 : isShotgun ? 0.68 : isRifle ? 0.70 : 0.52;
    const receiverMat = isRifle ? palette.wood : palette.receiver;

    addBox('receiver', [length * 0.54, 0.14, 0.16], [-0.05, 0.04, -0.10], receiverMat);
    addBox('topRail', [length * 0.50, 0.035, 0.16], [-0.07, 0.135, -0.10], palette.rail);
    addBox('barrel', [length * 0.58, 0.055, 0.055], [-0.45, 0.05, -0.10], palette.dark);
    addBox('muzzle', [0.08, 0.08, 0.08], [-0.78, 0.05, -0.10], palette.rail);
    addBox('grip', [0.09, 0.26, 0.10], [0.12, -0.18, -0.08], palette.dark, [0, 0, 0.18]);
    addBox('triggerGuard', [0.11, 0.055, 0.10], [0.03, -0.075, -0.08], palette.rail);

    if (isSmg) {
      addBox('magazine', [0.075, 0.28, 0.08], [-0.06, -0.18, -0.08], palette.accent, [0, 0, -0.12]);
      addBox('foldingStock', [0.30, 0.055, 0.11], [0.33, 0.02, -0.10], palette.rail);
    } else if (isRifle) {
      addBox('magazine', [0.11, 0.25, 0.09], [-0.02, -0.17, -0.08], palette.dark, [0, 0, -0.10]);
      addBox('stock', [0.32, 0.11, 0.14], [0.38, 0.02, -0.10], palette.wood);
      addBox('handguard', [0.28, 0.105, 0.14], [-0.33, 0.01, -0.10], palette.wood);
    } else if (isSniper) {
      addBox('scope', [0.28, 0.095, 0.14], [-0.05, 0.22, -0.10], palette.accent);
      addBox('scopeTube', [0.46, 0.105, 0.105], [-0.08, 0.22, -0.10], palette.dark);
      addBox('bipod', [0.035, 0.20, 0.035], [-0.42, -0.08, -0.10], palette.rail, [0, 0, 0.34]);
      addBox('bipod2', [0.035, 0.20, 0.035], [-0.34, -0.08, -0.10], palette.rail, [0, 0, -0.34]);
      addBox('stock', [0.34, 0.13, 0.16], [0.42, 0.00, -0.10], palette.tan);
      addBox('magazine', [0.10, 0.19, 0.08], [0.04, -0.16, -0.08], palette.dark);
    } else if (isShotgun) {
      addBox('pump', [0.28, 0.09, 0.16], [-0.34, -0.02, -0.10], palette.accent);
      addBox('tube', [0.50, 0.06, 0.07], [-0.38, -0.045, -0.10], palette.dark);
      addBox('stock', [0.30, 0.12, 0.15], [0.39, 0.00, -0.10], palette.dark);
      addBox('shellPort', [0.12, 0.035, 0.10], [0.12, 0.055, -0.02], palette.accent);
    }

    addGripHands(true);
    group.position.set(0.06, -0.31, -0.45);
    group.rotation.set(0.04, -0.05, -0.08);
    group.scale.setScalar(isSniper ? 1.16 : 1.22);
    return group;
  }

  private createTf2WeaponViewModel(itemId: number): THREE.Object3D {
    const group = new THREE.Group();
    const teamRed = new THREE.MeshStandardMaterial({ color: 0x9b3f32, roughness: 0.64, metalness: 0.08 });
    const teamBlue = new THREE.MeshStandardMaterial({ color: 0x3f617b, roughness: 0.64, metalness: 0.08 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x191713, roughness: 0.76, metalness: 0.14 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x6f6a60, roughness: 0.48, metalness: 0.42 });
    const brightMetal = new THREE.MeshStandardMaterial({ color: 0xb8afa0, roughness: 0.34, metalness: 0.62 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb58a42, roughness: 0.46, metalness: 0.28 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x7b4a2b, roughness: 0.78, metalness: 0.02 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0f0f0f, roughness: 0.9, metalness: 0.02 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0bd85, roughness: 0.72, metalness: 0.0 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2b2722, roughness: 0.88, metalness: 0.04 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x78d1ff, emissive: 0x2d7da7, emissiveIntensity: 0.75, roughness: 0.32, metalness: 0.18 });

    const addBox = (
      name: string,
      size: [number, number, number],
      pos: [number, number, number],
      mat: THREE.Material,
      rot: [number, number, number] = [0, 0, 0]
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
      mesh.name = name;
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    const addCylinder = (
      name: string,
      radius: number,
      length: number,
      pos: [number, number, number],
      mat: THREE.Material,
      axis: 'x' | 'y' | 'z' = 'x',
      segments = 18
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), mat);
      mesh.name = name;
      mesh.position.set(pos[0], pos[1], pos[2]);
      if (axis === 'x') mesh.rotation.z = Math.PI / 2;
      if (axis === 'z') mesh.rotation.x = Math.PI / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    const addHands = (style: 'one' | 'two' | 'melee' | 'fists' = 'two'): void => {
      if (style === 'fists') {
        addBox('rightForearm', [0.14, 0.13, 0.28], [0.24, -0.29, -0.02], skin, [0.03, 0, -0.18]);
        addBox('rightGlove', [0.20, 0.17, 0.18], [0.15, -0.12, -0.09], glove, [0.04, 0, -0.1]);
        addBox('leftForearm', [0.14, 0.13, 0.28], [-0.22, -0.27, -0.02], skin, [0.03, 0, 0.18]);
        addBox('leftGlove', [0.20, 0.17, 0.18], [-0.12, -0.10, -0.09], glove, [0.04, 0, 0.1]);
        return;
      }
      addBox('triggerWrist', [0.13, 0.11, 0.14], [0.20, -0.31, -0.06], skin, [0.08, 0.02, -0.24]);
      addBox('triggerGlove', [0.16, 0.13, 0.14], [0.12, -0.22, -0.07], glove, [0.04, 0.02, -0.24]);
      addBox('triggerFingers', [0.13, 0.045, 0.14], [0.03, -0.15, -0.12], glove, [0, 0, -0.1]);
      if (style === 'two') {
        addBox('supportForearm', [0.13, 0.12, 0.34], [-0.28, -0.26, -0.02], skin, [0.08, -0.26, 0.18]);
        addBox('supportGlove', [0.19, 0.12, 0.16], [-0.30, -0.12, -0.09], glove, [0.02, -0.06, 0.12]);
        addBox('supportFingers', [0.18, 0.055, 0.20], [-0.39, -0.08, -0.13], glove, [0, 0.06, 0.04]);
      }
      if (style === 'melee') {
        addBox('wrapHand', [0.18, 0.12, 0.15], [0.00, -0.08, -0.08], glove, [0, 0.05, -0.18]);
      }
    };

    const longStock = (): void => {
      addBox('stock', [0.34, 0.13, 0.15], [0.40, 0.00, -0.10], wood);
      addBox('grip', [0.09, 0.25, 0.10], [0.12, -0.18, -0.08], dark, [0, 0, 0.17]);
      addBox('triggerGuard', [0.11, 0.05, 0.10], [0.03, -0.07, -0.08], metal);
    };

    const finish = (
      pos: [number, number, number] = [0.06, -0.31, -0.45],
      rot: [number, number, number] = [0.04, -0.05, -0.08],
      scale = 1.18
    ): THREE.Group => {
      group.position.set(pos[0] + 0.06, pos[1] - 0.05, pos[2] - 0.03);
      group.rotation.set(rot[0], rot[1], rot[2]);
      group.scale.setScalar(scale * 0.78);
      return group;
    };

    switch (itemId) {
      case 700:
        addBox('scatterReceiver', [0.42, 0.15, 0.18], [-0.04, 0.04, -0.10], teamRed);
        addCylinder('scatterBarrelTop', 0.035, 0.58, [-0.43, 0.08, -0.13], dark);
        addCylinder('scatterBarrelLow', 0.035, 0.58, [-0.43, 0.02, -0.08], dark);
        addBox('scatterLever', [0.17, 0.04, 0.04], [0.10, -0.08, -0.01], brass, [0, 0, -0.45]);
        longStock();
        addHands('two');
        return finish([0.06, -0.32, -0.44], [0.04, -0.04, -0.08], 1.16);
      case 701:
        addBox('pistolSlide', [0.40, 0.10, 0.12], [-0.07, 0.05, -0.08], metal);
        addBox('pistolFrame', [0.24, 0.08, 0.12], [0.00, -0.01, -0.06], dark);
        addBox('pistolGrip', [0.09, 0.24, 0.09], [0.10, -0.17, -0.03], rubber, [0, 0, 0.18]);
        addCylinder('pistolBarrel', 0.024, 0.20, [-0.34, 0.06, -0.08], brightMetal);
        addHands('one');
        return finish([0.10, -0.31, -0.38], [0.05, -0.05, -0.10], 1.14);
      case 702:
        addCylinder('batHandle', 0.035, 0.72, [-0.05, 0.03, -0.06], wood, 'y', 14);
        addCylinder('batEnd', 0.060, 0.30, [-0.05, 0.31, -0.06], wood, 'y', 14);
        addBox('batTape', [0.09, 0.15, 0.09], [-0.05, -0.28, -0.06], dark);
        addHands('melee');
        return finish([0.12, -0.36, -0.35], [0.25, -0.35, -0.38], 1.10);
      case 703:
        addCylinder('rocketTube', 0.105, 0.82, [-0.25, 0.04, -0.10], teamRed, 'x', 24);
        addCylinder('rocketMuzzle', 0.125, 0.11, [-0.73, 0.04, -0.10], dark, 'x', 24);
        addBox('rocketSight', [0.20, 0.06, 0.06], [-0.17, 0.17, -0.10], brightMetal);
        addBox('rocketShoulder', [0.28, 0.13, 0.17], [0.31, -0.02, -0.10], dark);
        addBox('rocketGrip', [0.09, 0.24, 0.10], [0.07, -0.18, -0.08], rubber, [0, 0, 0.16]);
        addHands('two');
        return finish([0.06, -0.32, -0.48], [0.03, -0.04, -0.07], 1.20);
      case 704:
        addBox('shotgunReceiver', [0.42, 0.14, 0.16], [-0.04, 0.04, -0.10], metal);
        addCylinder('shotgunBarrel', 0.045, 0.64, [-0.44, 0.08, -0.10], dark);
        addCylinder('shotgunTube', 0.035, 0.52, [-0.40, -0.02, -0.10], brass);
        addBox('shotgunPump', [0.25, 0.09, 0.17], [-0.30, -0.02, -0.10], wood);
        longStock();
        addHands('two');
        return finish([0.06, -0.32, -0.44], [0.04, -0.04, -0.08], 1.18);
      case 705:
        addCylinder('shovelHandle', 0.025, 0.70, [-0.05, 0.02, -0.06], wood, 'y', 12);
        addBox('shovelHead', [0.17, 0.21, 0.04], [-0.05, 0.36, -0.06], metal, [0, 0, 0.04]);
        addBox('shovelSocket', [0.09, 0.08, 0.06], [-0.05, 0.22, -0.06], brightMetal);
        addHands('melee');
        return finish([0.12, -0.36, -0.35], [0.27, -0.34, -0.38], 1.06);
      case 706:
        addCylinder('flameFuelTank', 0.105, 0.38, [0.14, 0.02, -0.11], teamRed, 'x', 24);
        addBox('flameBody', [0.36, 0.15, 0.20], [-0.12, 0.03, -0.10], metal);
        addCylinder('flameNozzle', 0.052, 0.56, [-0.48, 0.05, -0.10], dark, 'x', 18);
        addCylinder('pilotLight', 0.018, 0.24, [-0.70, 0.10, -0.06], brass, 'x', 12);
        addBox('flameGrip', [0.09, 0.25, 0.10], [0.10, -0.18, -0.08], rubber, [0, 0, 0.15]);
        addBox('flameValve', [0.12, 0.07, 0.08], [-0.03, 0.17, -0.10], brass);
        addHands('two');
        return finish([0.06, -0.32, -0.46], [0.04, -0.05, -0.08], 1.17);
      case 707:
        addBox('flareFrame', [0.35, 0.12, 0.13], [-0.05, 0.04, -0.08], teamRed);
        addCylinder('flareBarrel', 0.052, 0.34, [-0.29, 0.05, -0.08], dark, 'x', 18);
        addBox('flareGrip', [0.10, 0.25, 0.10], [0.11, -0.16, -0.05], rubber, [0, 0, 0.20]);
        addCylinder('flareCap', 0.060, 0.04, [-0.48, 0.05, -0.08], brass, 'x', 18);
        addHands('one');
        return finish([0.10, -0.31, -0.38], [0.05, -0.05, -0.10], 1.14);
      case 708:
        addCylinder('axeHandle', 0.025, 0.68, [-0.03, 0.00, -0.06], wood, 'y', 12);
        addBox('axeHead', [0.23, 0.15, 0.05], [-0.03, 0.34, -0.06], brightMetal);
        addBox('axePick', [0.07, 0.20, 0.05], [-0.17, 0.31, -0.06], brightMetal, [0, 0, -0.34]);
        addHands('melee');
        return finish([0.12, -0.36, -0.35], [0.25, -0.35, -0.38], 1.08);
      case 709:
        addCylinder('grenadeBarrel', 0.065, 0.55, [-0.35, 0.08, -0.10], dark, 'x', 18);
        addCylinder('grenadeDrum', 0.135, 0.18, [-0.05, -0.02, -0.10], teamBlue, 'x', 20);
        addBox('grenadeReceiver', [0.26, 0.14, 0.17], [0.08, 0.04, -0.10], metal);
        longStock();
        addHands('two');
        return finish([0.06, -0.32, -0.45], [0.04, -0.05, -0.08], 1.18);
      case 710:
        addBox('stickyBox', [0.40, 0.18, 0.22], [-0.04, 0.03, -0.10], teamBlue);
        addCylinder('stickyDrum', 0.125, 0.20, [-0.22, -0.03, -0.10], dark, 'x', 18);
        addCylinder('stickyBarrel', 0.050, 0.46, [-0.48, 0.06, -0.10], metal, 'x', 18);
        addBox('stickyDial', [0.08, 0.08, 0.04], [0.10, 0.17, -0.10], brass);
        longStock();
        addHands('two');
        return finish([0.06, -0.32, -0.45], [0.04, -0.05, -0.08], 1.17);
      case 711:
        addCylinder('bottleBody', 0.070, 0.38, [-0.04, 0.06, -0.06], teamBlue, 'y', 18);
        addCylinder('bottleNeck', 0.032, 0.20, [-0.04, 0.35, -0.06], dark, 'y', 14);
        addBox('bottleLabel', [0.11, 0.08, 0.02], [-0.04, 0.09, -0.13], brass);
        addHands('melee');
        return finish([0.10, -0.35, -0.35], [0.20, -0.34, -0.32], 1.10);
      case 712:
        addCylinder('miniCore', 0.120, 0.42, [-0.08, 0.02, -0.10], dark, 'x', 24);
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2;
          addCylinder(
            `miniBarrel${i}`,
            0.018,
            0.62,
            [-0.47, 0.03 + Math.cos(angle) * 0.055, -0.10 + Math.sin(angle) * 0.055],
            brightMetal,
            'x',
            10
          );
        }
        addCylinder('miniAmmoDrum', 0.135, 0.18, [0.12, -0.12, -0.10], teamRed, 'x', 20);
        addBox('miniHandle', [0.09, 0.27, 0.11], [0.14, -0.19, -0.08], rubber, [0, 0, 0.18]);
        addBox('miniTopGrip', [0.24, 0.05, 0.09], [-0.08, 0.19, -0.10], rubber);
        addHands('two');
        return finish([0.05, -0.33, -0.48], [0.03, -0.04, -0.06], 1.22);
      case 713:
        addHands('fists');
        return finish([0.05, -0.31, -0.37], [0.00, -0.03, -0.03], 1.18);
      case 714:
        addCylinder('wrenchHandle', 0.028, 0.62, [-0.04, 0.00, -0.06], metal, 'y', 12);
        addBox('wrenchJawA', [0.14, 0.08, 0.05], [-0.08, 0.32, -0.06], brightMetal, [0, 0, 0.25]);
        addBox('wrenchJawB', [0.14, 0.08, 0.05], [0.02, 0.32, -0.06], brightMetal, [0, 0, -0.25]);
        addBox('wrenchGrip', [0.08, 0.18, 0.08], [-0.04, -0.24, -0.06], rubber);
        addHands('melee');
        return finish([0.12, -0.36, -0.35], [0.25, -0.35, -0.38], 1.08);
      case 715:
        addBox('medigunBody', [0.34, 0.17, 0.20], [-0.06, 0.03, -0.10], teamRed);
        addCylinder('medigunEmitter', 0.070, 0.36, [-0.36, 0.05, -0.10], glow, 'x', 24);
        addCylinder('medigunCanister', 0.075, 0.26, [0.14, 0.12, -0.10], brightMetal, 'x', 18);
        addBox('medigunGauge', [0.11, 0.06, 0.04], [-0.10, 0.18, -0.02], brass);
        addBox('medigunGrip', [0.09, 0.24, 0.10], [0.11, -0.18, -0.08], rubber, [0, 0, 0.16]);
        addHands('two');
        return finish([0.06, -0.32, -0.45], [0.04, -0.05, -0.08], 1.17);
      case 716:
        addCylinder('bonesawHandle', 0.025, 0.44, [0.00, -0.03, -0.06], wood, 'y', 12);
        addBox('bonesawBlade', [0.12, 0.32, 0.035], [-0.08, 0.20, -0.06], brightMetal, [0, 0, -0.12]);
        addBox('bonesawTeeth', [0.04, 0.28, 0.045], [-0.15, 0.18, -0.06], metal, [0, 0, -0.12]);
        addHands('melee');
        return finish([0.12, -0.36, -0.35], [0.25, -0.35, -0.38], 1.08);
      case 717:
        addBox('sniperReceiver', [0.40, 0.13, 0.15], [-0.05, 0.04, -0.10], teamBlue);
        addCylinder('sniperBarrel', 0.030, 0.86, [-0.55, 0.07, -0.10], dark, 'x', 18);
        addCylinder('sniperScope', 0.060, 0.42, [-0.08, 0.22, -0.10], dark, 'x', 20);
        addCylinder('sniperScopeFront', 0.074, 0.06, [-0.31, 0.22, -0.10], brightMetal, 'x', 20);
        addBox('sniperBolt', [0.07, 0.04, 0.15], [0.13, 0.10, -0.02], brightMetal);
        longStock();
        addHands('two');
        return finish([0.06, -0.32, -0.47], [0.035, -0.045, -0.075], 1.17);
      case 718:
        addBox('smgBody', [0.36, 0.13, 0.15], [-0.05, 0.04, -0.10], metal);
        addCylinder('smgBarrel', 0.030, 0.40, [-0.34, 0.07, -0.10], dark, 'x', 14);
        addBox('smgMag', [0.08, 0.27, 0.08], [-0.04, -0.18, -0.08], teamBlue, [0, 0, -0.08]);
        addBox('smgStock', [0.26, 0.06, 0.10], [0.28, 0.03, -0.10], dark);
        addBox('smgGrip', [0.09, 0.24, 0.10], [0.11, -0.17, -0.08], rubber, [0, 0, 0.16]);
        addHands('two');
        return finish([0.07, -0.32, -0.42], [0.045, -0.05, -0.08], 1.14);
      case 719:
        addCylinder('kukriHandle', 0.030, 0.28, [0.04, -0.08, -0.06], wood, 'y', 12);
        addBox('kukriBladeBase', [0.07, 0.30, 0.04], [-0.05, 0.12, -0.06], brightMetal, [0, 0, -0.22]);
        addBox('kukriBladeTip', [0.07, 0.24, 0.04], [-0.12, 0.29, -0.06], brightMetal, [0, 0, -0.50]);
        addHands('melee');
        return finish([0.12, -0.36, -0.35], [0.25, -0.35, -0.38], 1.08);
      case 720:
        addCylinder('revolverCylinder', 0.075, 0.12, [-0.07, 0.03, -0.08], brightMetal, 'x', 20);
        addBox('revolverFrame', [0.25, 0.12, 0.13], [-0.02, 0.03, -0.08], metal);
        addCylinder('revolverBarrel', 0.034, 0.34, [-0.32, 0.06, -0.08], dark, 'x', 16);
        addBox('revolverGrip', [0.10, 0.25, 0.10], [0.11, -0.16, -0.05], wood, [0, 0, 0.20]);
        addBox('revolverHammer', [0.06, 0.08, 0.04], [0.10, 0.13, -0.08], dark, [0, 0, -0.2]);
        addHands('one');
        return finish([0.10, -0.31, -0.38], [0.05, -0.05, -0.10], 1.14);
      case 721:
        addBox('sapperBody', [0.24, 0.18, 0.08], [-0.02, 0.02, -0.08], dark);
        addBox('sapperScreen', [0.16, 0.09, 0.02], [-0.02, 0.04, -0.13], glow);
        addBox('sapperDialA', [0.05, 0.05, 0.025], [-0.10, -0.06, -0.13], brass);
        addBox('sapperDialB', [0.05, 0.05, 0.025], [0.06, -0.06, -0.13], brass);
        addCylinder('sapperWire', 0.012, 0.25, [-0.16, 0.12, -0.08], brightMetal, 'z', 8);
        addHands('one');
        return finish([0.10, -0.31, -0.38], [0.10, -0.10, -0.16], 1.10);
      case 722:
        addBox('knifeHandle', [0.08, 0.24, 0.07], [0.02, -0.06, -0.06], dark, [0, 0, -0.16]);
        addBox('knifeBlade', [0.06, 0.36, 0.025], [-0.04, 0.22, -0.06], brightMetal, [0, 0, -0.16]);
        addBox('knifeGuard', [0.16, 0.04, 0.06], [0.00, 0.06, -0.06], brass, [0, 0, -0.16]);
        addHands('melee');
        return finish([0.12, -0.36, -0.35], [0.25, -0.35, -0.38], 1.08);
      case 723:
        addBox('syringeBody', [0.32, 0.13, 0.15], [-0.06, 0.04, -0.10], teamBlue);
        addCylinder('syringeBarrel', 0.035, 0.45, [-0.35, 0.07, -0.10], brightMetal, 'x', 16);
        addBox('syringeNeedle', [0.20, 0.018, 0.018], [-0.66, 0.07, -0.10], metal);
        addBox('syringeClip', [0.10, 0.18, 0.08], [0.01, -0.13, -0.08], glow);
        addBox('syringeGrip', [0.09, 0.24, 0.10], [0.10, -0.17, -0.08], rubber, [0, 0, 0.16]);
        addHands('two');
        return finish([0.07, -0.32, -0.42], [0.045, -0.05, -0.08], 1.13);
      default:
        addBox('fallbackReceiver', [0.38, 0.14, 0.16], [-0.05, 0.04, -0.10], metal);
        addCylinder('fallbackBarrel', 0.035, 0.46, [-0.38, 0.06, -0.10], dark);
        addBox('fallbackGrip', [0.09, 0.24, 0.10], [0.10, -0.18, -0.08], rubber, [0, 0, 0.16]);
        addHands('two');
        return finish();
    }
  }

  private isCbgoWeaponItem(itemId = this.currentHeldItemId): boolean {
    return itemId >= 620 && itemId <= 624;
  }

  private isTf2WeaponItem(itemId = this.currentHeldItemId): boolean {
    return itemId >= 700 && itemId <= 723;
  }

  private isWeaponViewModelItem(itemId = this.currentHeldItemId): boolean {
    return this.isCbgoWeaponItem(itemId) || this.isTf2WeaponItem(itemId);
  }

  private createHeldItem(itemId: number): THREE.Object3D {
    const group = new THREE.Group();
    const matWood = new THREE.MeshStandardMaterial({ color: 0x7b4b2a, roughness: 0.75 });

    const getTierColor = (tier: number): number => {
      switch (tier) {
        case 0: return 0x866043;
        case 1: return 0x8b8b8b;
        case 2: return 0xe2e2e2;
        case 3: return 0xf4c430;
        case 4: return 0x4ee2ec;
        default: return 0xffffff;
      }
    };

    if (itemId >= 620 && itemId <= 624) {
      return this.createCbgoWeaponViewModel(itemId);
    } else if (itemId >= 700 && itemId <= 723) {
      return this.createTf2WeaponViewModel(itemId);
    } else if (itemId >= 220 && itemId <= 264) {
      const toolType = Math.floor((itemId - 220) / 5);
      const tier = (itemId - 220) % 5;
      const headColor = getTierColor(tier);
      const headMat = new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.68, metalness: tier >= 2 ? 0.4 : 0.0 });

      if (toolType === 0) {
        // Pickaxe — longer handle, T-shaped head, diagonal hold
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), matWood);
        handle.rotation.z = -0.48;
        handle.position.set(0.02, -0.04, 0);
        handle.castShadow = true;
        group.add(handle);

        // T-shaped head: wide horizontal bar
        const headBar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.08), headMat);
        headBar.rotation.z = -0.48;
        headBar.position.set(-0.02, 0.18, 0);
        headBar.castShadow = true;
        group.add(headBar);

        // Left pick tip
        const tipL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), headMat);
        tipL.position.set(-0.13, -0.05, 0);
        headBar.add(tipL);

        // Right pick tip
        const tipR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), headMat);
        tipR.position.set(0.13, -0.05, 0);
        headBar.add(tipR);
      } else if (toolType === 1) {
        // Axe
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.40, 0.05), matWood);
        handle.rotation.z = -0.50;
        handle.position.set(0.02, -0.02, 0);
        handle.castShadow = true;
        group.add(handle);

        const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.08), headMat);
        head.rotation.z = -0.50;
        head.position.set(-0.07, 0.15, 0);
        head.castShadow = true;
        group.add(head);
      } else if (toolType === 2) {
        // Shovel
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), matWood);
        handle.rotation.z = -0.48;
        handle.position.set(0.02, -0.02, 0);
        handle.castShadow = true;
        group.add(handle);

        const head = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, 0.06), headMat);
        head.rotation.z = -0.48;
        head.position.set(-0.06, 0.19, 0);
        head.castShadow = true;
        group.add(head);
      } else if (toolType === 3) {
        // Sword — prominent blade + guard, angled for visibility
        const swordHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), matWood);
        swordHandle.rotation.z = -0.50;
        swordHandle.position.set(-0.02, -0.08, 0);
        group.add(swordHandle);

        const guardMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.8 });
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.06, 0.07), guardMat);
        guard.rotation.z = -0.50;
        guard.position.set(0.02, 0.03, 0);
        group.add(guard);

        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.04), headMat);
        blade.rotation.z = -0.50;
        blade.position.set(0.12, 0.20, 0);
        group.add(blade);
      } else if (toolType === 4) {
        // Hoe
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.40, 0.05), matWood);
        handle.rotation.z = -0.48;
        handle.position.set(0.02, -0.02, 0);
        handle.castShadow = true;
        group.add(handle);

        const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.06), headMat);
        head.rotation.z = -0.48;
        head.position.set(-0.05, 0.18, 0);
        head.castShadow = true;
        group.add(head);
      }
    } else if (itemId === 200) {
      const stick = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.38, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x8d5a2b, roughness: 0.75 })
      );
      stick.rotation.z = -0.45;
      stick.castShadow = true;
      group.add(stick);
    } else if (itemId === 280 || itemId === 285) {
      const appleColor = itemId === 285 ? 0xffd700 : 0xd83a2e;
      const apple = new THREE.Mesh(
        new THREE.BoxGeometry(0.17, 0.17, 0.17),
        new THREE.MeshStandardMaterial({ color: appleColor, roughness: 0.58 })
      );
      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.03, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x6dae39, roughness: 0.65 })
      );
      leaf.position.set(0.04, 0.10, 0);
      apple.castShadow = true;
      leaf.castShadow = true;
      group.add(apple, leaf);
    } else {
      let color = 0x8f8f8f;
      if (itemId === 201) color = 0x111111;
      else if (itemId === 202) color = 0xc0c0c0;
      else if (itemId === 203) color = 0xffd700;
      else if (itemId === 204) color = 0x4ee2ec;

      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
      const itemMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.06), mat);
      itemMesh.rotation.set(0.58, 0.46, -0.12);
      group.add(itemMesh);
    }

    group.position.set(0.035, 0.015, -0.07);
    group.rotation.set(0.58, 0.46, -0.12);
    return group;
  }

  private applyBlockUVs(geometry: THREE.BufferGeometry, blockId: number): void {
    const cols = 16;
    const rows = 96;
    const tileUv = (faceIndex: number, flipY = false): number[] => {
      const texIdx = BlockRegistry.getFaceTextureIndex(blockId, faceIndex);
      const uMin = (texIdx % cols) / cols;
      const uMax = uMin + 1 / cols;
      const vMax = 1.0 - Math.floor(texIdx / cols) / rows;
      const vMin = vMax - 1 / rows;
      return flipY
        ? [uMin, vMin, uMax, vMin, uMax, vMax, uMin, vMax]
        : [uMax, vMax, uMin, vMax, uMin, vMin, uMax, vMin];
    };

    // BoxGeometry face order is +X, -X, +Y, -Y, +Z, -Z.
    // BlockRegistry face order is Top, Bottom, -X, +X, +Z, -Z.
    // This fixes grass/log held blocks showing the top texture on every side and
    // keeps side textures upright instead of sideways in inventory/hand models.
    const uvs = new Float32Array([
      ...tileUv(3),       // +X right
      ...tileUv(2),       // -X left
      ...tileUv(0),       // +Y top
      ...tileUv(1, true), // -Y bottom
      ...tileUv(4),       // +Z front
      ...tileUv(5),       // -Z back
    ]);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }

  private onWindowResize(): void {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth || window.innerWidth);
    const height = Math.max(1, parent?.clientHeight || window.innerHeight);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // Update pixel ratio in case of display/window zoom changes (e.g., mac retina scale)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));

    // Update drawing buffer and CSS size
    this.renderer.setSize(width, height, true);
    this.renderer.domElement.style.width = width + 'px';
    this.renderer.domElement.style.height = height + 'px';

    this.viewModelCamera.aspect = width / height;
    this.viewModelCamera.updateProjectionMatrix();

  }

  public setPostProcessingEnabled(enabled: boolean): void {
    this.usePostProcessing = enabled;
  }

  public setViewModelVisible(visible: boolean): void {
    this.viewModelVisible = visible;
    this.refreshPlayerViewVisibility();
  }

  public setThirdPersonBodyVisible(visible: boolean): void {
    this.thirdPersonBodyVisible = visible;
    this.refreshPlayerViewVisibility();
  }

  private refreshPlayerViewVisibility(): void {
    const activeEffects = (window as any).gamePlayerController?.activeEffects;
    const isInvisible = activeEffects && activeEffects.has('invisibility');

    const showBody = this.thirdPersonBodyVisible && !isInvisible;
    const showViewModel = this.viewModelVisible && !this.thirdPersonBodyVisible;
    
    this.bodyGroup.visible = showBody;
    this.rightArmGroup.visible = showViewModel;
    if (this.upperArmMesh) {
      this.upperArmMesh.visible = showViewModel && !isInvisible;
    }
    this.heldItemGroup.visible = showViewModel;

    this.headGroup.visible = showBody;
    this.torsoGroup.visible = showBody;
    this.leftArmGroup.visible = showBody;
    this.thirdPersonRightArmGroup.visible = showBody;
    this.leftLegGroup.visible = showBody;
    this.rightLegGroup.visible = showBody;
  }

  public setWorldViewDistance(renderDistanceChunks: number): void {
    const chunkDistance = Math.max(2, Math.min(16, renderDistanceChunks)) * 16;
    this.camera.far = Math.max(260, chunkDistance + 56);
    this.camera.updateProjectionMatrix();
  }

  public setVisualQuality(options: { bloom?: boolean; exposure?: number; pixelRatioCap?: number }): void {
    if (typeof options.bloom === 'boolean') {
      this.setPostProcessingEnabled(options.bloom);
    }
    if (Number.isFinite(options.exposure)) {
      this.renderer.toneMappingExposure = THREE.MathUtils.clamp(options.exposure!, 0.65, 1.2);
    }
    if (Number.isFinite(options.pixelRatioCap)) {
      const parent = this.renderer.domElement.parentElement;
      const width = Math.max(1, parent?.clientWidth || window.innerWidth);
      const height = Math.max(1, parent?.clientHeight || window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, THREE.MathUtils.clamp(options.pixelRatioCap!, 1, 2)));
      this.renderer.setSize(width, height, true);
    }
  }

  public triggerSwing(): void {
    // Restarting from 0 on every click caused a hitchy “up, slow down, pause”
    // look. Let the frame loop advance the curve at a constant speed; clicks
    // only ensure at least one full punch cycle plays.
    if (!this.isSwinging) {
      this.isSwinging = true;
      this.swingTime = 0;
    }
  }

  /**
   * Updates animations, head bobbing, hand sway, and swings
   */
  public updateEffects(
    dt: number,
    isMoving: boolean,
    isSprinting: boolean,
    mouseDeltaX: number,
    mouseDeltaY: number,
    isSwimming = false,
    grounded = true,
    verticalVelocity = 0,
    isCrouching = false
  ): void {
    if (grounded && !this.lastGrounded && verticalVelocity < -6) {
      this.landingKick = Math.min(0.12, Math.abs(verticalVelocity) * 0.008);
    }
    this.lastGrounded = grounded;
    this.landingKick += (0 - this.landingKick) * Math.min(1, dt * 8);

    // 1. Camera Head Bobbing and inertia
    const isMining = (window as any).gamePlayerController?.isMining || false;
    const attackHeld = InputManager.isActionDown('attack');
    if (attackHeld && !this.isSwinging) {
      this.triggerSwing();
    }
    let shakeY = 0;
    if (isMining) {
      const time = performance.now() / 1000;
      shakeY = Math.sin(time * 30) * 0.004;
    }

    if (isMoving) {
      const bobFreq = isSwimming ? 5.0 : (isSprinting ? 14 : 9.5);
      const bobAmp = isSwimming ? 0.025 : (isSprinting ? 0.08 : 0.04);
      
      this.bobTime += dt * bobFreq;
      
      this.camera.position.y = Math.sin(this.bobTime) * bobAmp - this.landingKick + shakeY;
      this.camera.position.x = Math.cos(this.bobTime * 0.5) * bobAmp * 0.5;
    } else {
      this.camera.position.x += (0 - this.camera.position.x) * 10 * dt;
      this.camera.position.y += (-this.landingKick + shakeY - this.camera.position.y) * 10 * dt;
      this.bobTime = 0;
    }

    // Apply mining shake to pitch (X rotation)
    if (isMining) {
      const time = performance.now() / 1000;
      this.camera.rotation.x += Math.sin(time * 30) * 0.004;
    }

    this.cameraInertia.x += (THREE.MathUtils.clamp(-mouseDeltaX * 0.0006, -0.035, 0.035) - this.cameraInertia.x) * Math.min(1, dt * 8);
    this.cameraInertia.y += (THREE.MathUtils.clamp(mouseDeltaY * 0.0005, -0.025, 0.025) - this.cameraInertia.y) * Math.min(1, dt * 8);
    // Preserve any roll applied by CameraController (tilt) and add mouse inertia
    this.camera.rotation.z = (this.camera.rotation.z || 0) + this.cameraInertia.x;

    // 2. Procedural body, limb, and held-item motion
    const swayAmount = 0.0015;
    const maxSway = 0.08;
    const swayX = THREE.MathUtils.clamp(-mouseDeltaX * swayAmount, -maxSway, maxSway);
    const swayY = THREE.MathUtils.clamp(mouseDeltaY * swayAmount, -maxSway, maxSway);

    const time = performance.now() / 1000;
    const idleBreath = Math.sin(time * 1.35) * 0.045;
    const walk = Math.sin(this.bobTime);
    const walkOpposite = Math.sin(this.bobTime + Math.PI);
    const moveWeight = isMoving ? 1 : 0;
    const sprintWeight = isSprinting ? 1.65 : 1;
    const armSprintWeight = isSprinting ? 1.85 : 1;
    const swimPose = isSwimming ? 0.55 : 0;

    this.bodyTargetRot.set(
      isSwimming ? -0.18 : 0,
      0,
      THREE.MathUtils.clamp(-mouseDeltaX * 0.0008, -0.08, 0.08)
    );
    this.bodyGroup.rotation.x += (this.bodyTargetRot.x - this.bodyGroup.rotation.x) * dt * 8;
    this.bodyGroup.rotation.z += (this.bodyTargetRot.z - this.bodyGroup.rotation.z) * dt * 8;
    const crouchScale = isCrouching ? 0.82 : 1;
    this.bodyGroup.scale.y += (crouchScale - this.bodyGroup.scale.y) * Math.min(1, dt * 12);

    this.headGroup.rotation.x = THREE.MathUtils.clamp(this.camera.rotation.x * 0.55, -0.78, 0.78);
    this.headGroup.rotation.y = THREE.MathUtils.clamp(-mouseDeltaX * 0.00045, -0.10, 0.10);

    this.leftLegGroup.rotation.x = walk * 0.58 * moveWeight * sprintWeight - swimPose;
    this.rightLegGroup.rotation.x = walkOpposite * 0.58 * moveWeight * sprintWeight - swimPose;
    this.leftFootGroup.rotation.x = -0.18 + Math.max(0, -walk) * (isSprinting ? 0.34 : 0.22) * moveWeight;
    this.rightFootGroup.rotation.x = -0.18 + Math.max(0, walk) * (isSprinting ? 0.34 : 0.22) * moveWeight;
    this.leftArmGroup.rotation.x = walkOpposite * 0.38 * moveWeight * armSprintWeight - swimPose * 0.35 + idleBreath * (1 - moveWeight);
    this.thirdPersonRightArmGroup.rotation.x = walk * 0.38 * moveWeight * armSprintWeight - swimPose * 0.35 - idleBreath * (1 - moveWeight);
    this.leftArmGroup.rotation.z = THREE.MathUtils.lerp(this.leftArmGroup.rotation.z, idleBreath * 0.3, Math.min(1, dt * 6));
    this.thirdPersonRightArmGroup.rotation.z = THREE.MathUtils.lerp(this.thirdPersonRightArmGroup.rotation.z, -idleBreath * 0.3, Math.min(1, dt * 6));
    this.torsoGroup.rotation.x = THREE.MathUtils.lerp(this.torsoGroup.rotation.x, isSprinting && moveWeight ? -0.08 : 0, Math.min(1, dt * 8));

    if (this.isSwinging) {
      this.swingTime += dt * this.swingSpeed;
      const twoPi = Math.PI * 2;
      if (attackHeld) {
        this.swingTime %= twoPi;
      } else if (this.swingTime >= twoPi) {
        this.isSwinging = false;
        this.swingTime = 0;
      }

      // Constant, looping Minecraft-like punch: no rebound state, no pause.
      const phase = this.swingTime % twoPi;
      const swingAngle = 0.5 - Math.cos(phase) * 0.5;
      const snap = Math.sin(phase) * 0.08;
      this.rightArmGroup.rotation.x = 0.86 - swingAngle * 1.52 + snap;
      this.rightArmGroup.rotation.y = -0.28 - swingAngle * 0.36 + swayX;
      this.rightArmGroup.rotation.z = -0.10 - swingAngle * 0.36;
      this.thirdPersonRightArmGroup.rotation.x = -0.28 - swingAngle * 1.35 + snap;
      this.thirdPersonRightArmGroup.rotation.y = -0.12 - swingAngle * 0.18;
      this.thirdPersonRightArmGroup.rotation.z = -0.05 - swingAngle * 0.22;
    } else {
      // Normal arm animation when not swinging — idle breathing using sin/cos
      const breathY = Math.sin(time * 1.4) * 0.012;
      const breathZ = Math.cos(time * 0.9) * 0.008;

      const targetArmX = 0.85 + walk * 0.16 * moveWeight - swimPose * 0.14 + swayY + breathY;
      const targetArmY = -0.28 + swayX * 0.72;
      const targetArmZ = -0.10 + this.cameraInertia.x * 1.55 + breathZ;

      this.rightArmGroup.rotation.x += (targetArmX - this.rightArmGroup.rotation.x) * dt * 10;
      this.rightArmGroup.rotation.y += (targetArmY - this.rightArmGroup.rotation.y) * dt * 10;
      this.rightArmGroup.rotation.z += (targetArmZ - this.rightArmGroup.rotation.z) * dt * 10;

      const weaponHeld = this.isWeaponViewModelItem();
      const heldTargetY = weaponHeld ? (this.isTf2WeaponItem() ? -0.64 : -0.56) : -0.52;

      // Add vertical bobbing to hand when moving
      if (isMoving) {
        this.heldItemGroup.position.y = heldTargetY + Math.sin(this.bobTime) * (weaponHeld ? 0.018 : 0.035);
      } else {
        this.heldItemGroup.position.y += (heldTargetY - this.heldItemGroup.position.y) * dt * 8;
      }
    }

    const weaponHeld = this.isWeaponViewModelItem();
    const tf2WeaponHeld = this.isTf2WeaponItem();
    const heldTargetX = weaponHeld ? (tf2WeaponHeld ? 0.10 : 0.04) : 0.03;
    const heldTargetY = weaponHeld ? (tf2WeaponHeld ? -0.64 : -0.56) : -0.52;
    const heldTargetZ = weaponHeld ? (tf2WeaponHeld ? -0.26 : -0.22) : -0.18;
    const heldTargetRotX = weaponHeld ? (tf2WeaponHeld ? 0.38 : 0.46) : 0.50;
    const heldTargetRotY = weaponHeld ? (tf2WeaponHeld ? -0.18 : -0.24) : -0.30;
    const heldTargetRotZ = weaponHeld ? (tf2WeaponHeld ? 0.035 : 0.06) : 0.08;

    if (this.isSwinging) {
      this.heldItemGroup.position.y += (heldTargetY - this.heldItemGroup.position.y) * Math.min(1, dt * 12);
    }
    this.heldItemGroup.position.x += (heldTargetX - this.heldItemGroup.position.x) * Math.min(1, dt * 12);
    this.heldItemGroup.position.z += (heldTargetZ - this.heldItemGroup.position.z) * Math.min(1, dt * 14);
    this.heldItemGroup.rotation.x += (heldTargetRotX - this.heldItemGroup.rotation.x) * Math.min(1, dt * 10);
    this.heldItemGroup.rotation.y += (heldTargetRotY - this.heldItemGroup.rotation.y) * Math.min(1, dt * 10);
    this.heldItemGroup.rotation.z += (heldTargetRotZ - this.heldItemGroup.rotation.z) * Math.min(1, dt * 10);

    this.updateCloakTransparency();
    this.updateSpyDisguiseMesh();
    this.refreshPlayerViewVisibility();
  }

  private updateCloakTransparency(): void {
    const tf2 = (window as any).tf2Manager;
    const isSpyCloaked = tf2 && tf2.currentClass && tf2.currentClass.profile.id === 'spy' && tf2.currentClass.state.cloakActive;

    const setOpacity = (object: THREE.Object3D) => {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
          const m = mat as THREE.MeshStandardMaterial;
          if (m.userData.originalOpacity === undefined) {
            m.userData.originalOpacity = m.opacity;
            m.userData.originalTransparent = m.transparent;
          }
          if (isSpyCloaked) {
            m.opacity = 0.22;
            m.transparent = true;
          } else {
            m.opacity = m.userData.originalOpacity;
            m.transparent = m.userData.originalTransparent;
          }
        }
      });
    };

    setOpacity(this.bodyGroup);
    setOpacity(this.rightArmGroup);
    setOpacity(this.heldItemGroup);
  }

  private updateSpyDisguiseMesh(): void {
    const tf2 = (window as any).tf2Manager;
    if (!tf2 || !tf2.currentClass) return;
    const isSpy = tf2.currentClass.profile.id === 'spy';
    const disguiseClass = tf2.currentClass.state.disguiseClass;
    const disguiseTeam = tf2.currentClass.state.disguiseTeam;

    const disguiseColor = disguiseTeam === 'RED' ? 0x9b3f32 : disguiseTeam === 'BLU' ? 0x3f617b : null;

    const setMaterialColor = (object: THREE.Object3D) => {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
          const m = mat as THREE.MeshStandardMaterial;
          if (m.userData.originalColor === undefined) {
            if (m.color) m.userData.originalColor = m.color.clone();
          }
          if (isSpy && disguiseClass && disguiseColor !== null) {
            if (m.color) m.color.setHex(disguiseColor);
          } else {
            if (m.color && m.userData.originalColor) m.color.copy(m.userData.originalColor);
          }
        }
      });
    };

    setMaterialColor(this.bodyGroup);
  }

  public updateSelectionBox(targetBlock: { x: number; y: number; z: number } | null): void {
    if (targetBlock) {
      this.selectionBox.position.set(targetBlock.x + 0.5, targetBlock.y + 0.5, targetBlock.z + 0.5);
      this.selectionBox.visible = true;
    } else {
      this.selectionBox.visible = false;
    }
  }

  public updateCrackMesh(x: number, y: number, z: number, stage: number): void {
    if (stage <= 0 || stage > 6) {
      this.crackMesh.visible = false;
      return;
    }

    this.crackMesh.position.set(x + 0.5, y + 0.5, z + 0.5);

    // Update UVs for the crack stage (indices 16 to 21)
    const texIdx = 16 + (stage - 1);
    const cols = 16;
    const rows = 96;
    const uMin = (texIdx % cols) / cols + 0.0005;
    const uMax = (texIdx % cols + 1) / cols - 0.0005;
    const vMax = 1.0 - Math.floor(texIdx / cols) / rows - 0.0005;
    const vMin = 1.0 - (Math.floor(texIdx / cols) + 1) / rows + 0.0005;

    // Apply to all 6 faces of the BoxGeometry
    const uvs = new Float32Array([
      // Right face
      uMax, vMax, uMin, vMax, uMin, vMin, uMax, vMin,
      // Left face
      uMin, vMax, uMax, vMax, uMax, vMin, uMin, vMin,
      // Top face
      uMin, vMax, uMax, vMax, uMax, vMin, uMin, vMin,
      // Bottom face
      uMin, vMin, uMax, vMin, uMax, vMax, uMin, vMax,
      // Front face
      uMin, vMax, uMax, vMax, uMax, vMin, uMin, vMin,
      // Back face
      uMax, vMax, uMin, vMax, uMin, vMin, uMax, vMin
    ]);
    this.crackMesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.crackMesh.geometry.attributes.uv.needsUpdate = true;
    this.crackMesh.visible = true;
  }

  public render(): void {
    const now = performance.now();
    if (now - this.lastShadowConfigureTime > 750) {
      this.lastShadowConfigureTime = now;
      this.forceWorldShadowFlags();
    }

    if (this.viewModelVisible && this.rightArmGroup.visible) {
      this.renderer.renderLayers([
        { scene: this.scene, camera: this.camera },
        {
          scene: this.viewModelScene,
          camera: this.viewModelCamera,
          clearColor: false,
          clearDepth: true,
        },
      ]);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
