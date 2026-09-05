import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { AudioManager } from '../audio/AudioManager';

export class SkySystem {
  private scene: THREE.Scene;
  private dirLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private hemisphereLight: THREE.HemisphereLight;

  // Day/Night time tracker: 0.0 to 1.0
  // 0.0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight
  private timeOfDay: number = 0.15;
  private dayLengthSeconds: number = 240;

  public weatherState: 'clear' | 'rain' | 'thunder' = 'clear';
  private weatherTimer: number = 180 + Math.random() * 180;
  public shadowsEnabled = true;

  private skyColor: THREE.Color = new THREE.Color();
  private fogColor: THREE.Color = new THREE.Color();

  private cloudGroup: THREE.Group = new THREE.Group();
  private cloudMaterial!: THREE.MeshLambertMaterial;
  private cloudScroll = 0;

  private starGroup: THREE.Points | null = null;
  private starMaterial: THREE.PointsMaterial | null = null;

  private sunSprite!: THREE.Sprite;
  private sunGlowSprite!: THREE.Sprite;
  private moonSprite!: THREE.Sprite;
  private moonGlowSprite!: THREE.Sprite;
  private sunMaterial!: THREE.SpriteMaterial;
  private sunGlowMaterial!: THREE.SpriteMaterial;
  private moonMaterial!: THREE.SpriteMaterial;
  private moonGlowMaterial!: THREE.SpriteMaterial;
  private chunkFogNear = 56;
  private chunkFogFar = 96;

  // Reusable scratch objects to avoid garbage collection pressure
  private readonly scratchVector1 = new THREE.Vector3();
  private readonly scratchVector2 = new THREE.Vector3();
  private readonly scratchSunDirection = new THREE.Vector3();
  private readonly scratchMoonDirection = new THREE.Vector3();
  private readonly scratchColor1 = new THREE.Color();
  private readonly scratchColor2 = new THREE.Color();
  private readonly materialArray: THREE.ShaderMaterial[] = [];
  private readonly colorNightSky = new THREE.Color(0x101936);
  private readonly colorSunsetSky = new THREE.Color(0xff9c57);
  private readonly colorDaySky = new THREE.Color(0x91c9ff);

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Ambient safety net. Night should be moody, not a black screen.
    this.ambientLight = new THREE.AmbientLight(0x91a7ff, 0.24);
    this.scene.add(this.ambientLight);

    // Soft sky/ground fill keeps terrain readable at night and prevents the
    // underside of blocks from crushing to pure black.
    this.hemisphereLight = new THREE.HemisphereLight(0x9bb7ff, 0x111827, 0.22);
    this.scene.add(this.hemisphereLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.25);
    this.dirLight.castShadow = false;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 240;

    const d = 56;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.00012;
    this.dirLight.shadow.normalBias = 0.018;
    this.dirLight.shadow.autoUpdate = true;
    this.dirLight.shadow.needsUpdate = true;
    (this.dirLight.shadow as any).radius = 2;
    (this.dirLight.shadow.camera as THREE.OrthographicCamera).updateProjectionMatrix();

    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);
    this.scene.fog = new THREE.Fog(this.fogColor, 80, 180);

    this.createCelestialBodies();
    this.createPuffyClouds();
    this.createStars();
  }

  public setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    this.dirLight.castShadow = enabled;
  }

  public setRenderDistanceChunks(distance: number): void {
    const blocks = Math.max(2, Math.min(16, Math.floor(distance))) * 16;
    this.chunkFogFar = Math.max(42, blocks - 7);
    this.chunkFogNear = Math.max(24, this.chunkFogFar - Math.max(18, Math.min(34, blocks * 0.34)));
  }

  public setTime(time: number): void {
    this.timeOfDay = ((time % 1.0) + 1.0) % 1.0;
  }

  public getTime(): number {
    return this.timeOfDay;
  }

  private createDiscTexture(
    size: number,
    innerColor: string,
    outerColor: string,
    glowColor: string,
    glowPower: number = 1.9,
    crescent: boolean = false
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const center = size / 2;
    const radius = size * 0.36;

    const glow = ctx.createRadialGradient(center, center, radius * 0.55, center, center, size * 0.5);
    glow.addColorStop(0.0, glowColor);
    glow.addColorStop(0.45, glowColor.replace('1)', '0.55)'));
    glow.addColorStop(1.0, glowColor.replace('1)', '0)'));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    const body = ctx.createRadialGradient(center - radius * 0.25, center - radius * 0.28, radius * 0.1, center, center, radius);
    body.addColorStop(0.0, innerColor);
    body.addColorStop(1.0, outerColor);
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    if (crescent) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(center + radius * 0.34, center - radius * 0.05, radius * 0.92, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.86)';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      ctx.fillStyle = 'rgba(205, 222, 255, 0.22)';
      for (let i = 0; i < 9; i++) {
        const a = i * 2.399;
        const rr = radius * (0.12 + (i % 4) * 0.13);
        ctx.beginPath();
        ctx.arc(center + Math.cos(a) * rr * 0.55, center + Math.sin(a) * rr * 0.55, 1.2 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  private makeSkySprite(texture: THREE.Texture, size: number): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      depthTest: true,
      fog: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(size, size, 1);
    sprite.frustumCulled = false;
    sprite.renderOrder = -50;
    this.scene.add(sprite);
    return sprite;
  }

  private createCelestialBodies(): void {
    const sunTexture = this.createDiscTexture(
      128,
      'rgba(255, 255, 232, 1)',
      'rgba(255, 195, 66, 1)',
      'rgba(255, 184, 48, 1)',
      1.8
    );
    const sunGlowTexture = this.createDiscTexture(
      128,
      'rgba(255, 232, 150, 0.28)',
      'rgba(255, 166, 56, 0.08)',
      'rgba(255, 155, 44, 1)',
      1.4
    );
    const moonTexture = this.createDiscTexture(
      128,
      'rgba(235, 242, 255, 1)',
      'rgba(166, 190, 235, 1)',
      'rgba(150, 180, 255, 1)',
      1.7,
      true
    );
    const moonGlowTexture = this.createDiscTexture(
      128,
      'rgba(190, 210, 255, 0.18)',
      'rgba(125, 150, 235, 0.06)',
      'rgba(120, 150, 255, 1)',
      1.3
    );

    this.sunGlowSprite = this.makeSkySprite(sunGlowTexture, 31);
    this.sunSprite = this.makeSkySprite(sunTexture, 14);
    this.moonGlowSprite = this.makeSkySprite(moonGlowTexture, 25);
    this.moonSprite = this.makeSkySprite(moonTexture, 10);

    this.sunMaterial = this.sunSprite.material as THREE.SpriteMaterial;
    this.sunGlowMaterial = this.sunGlowSprite.material as THREE.SpriteMaterial;
    this.moonMaterial = this.moonSprite.material as THREE.SpriteMaterial;
    this.moonGlowMaterial = this.moonGlowSprite.material as THREE.SpriteMaterial;
  }

  private createPuffyClouds(): void {
    this.cloudMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      depthTest: true
    });

    const puffGeo = new THREE.SphereGeometry(1, 12, 8);
    const cloudCount = 12;

    for (let i = 0; i < cloudCount; i++) {
      const cloud = new THREE.Group();
      cloud.userData.baseX = (Math.random() - 0.5) * 320;
      cloud.userData.baseY = 42 + Math.random() * 22;
      cloud.userData.baseZ = (Math.random() - 0.5) * 320;
      cloud.userData.speed = 0.35 + Math.random() * 0.55;

      const puffCount = 5 + Math.floor(Math.random() * 5);
      for (let j = 0; j < puffCount; j++) {
        const puff = new THREE.Mesh(puffGeo, this.cloudMaterial);
        puff.position.set((Math.random() - 0.5) * 13, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 7);
        puff.scale.set(4.8 + Math.random() * 6.2, 1.2 + Math.random() * 1.7, 2.8 + Math.random() * 4.2);
        puff.castShadow = false;
        puff.receiveShadow = false;
        puff.frustumCulled = false;
        cloud.add(puff);
      }

      cloud.frustumCulled = false;
      this.cloudGroup.add(cloud);
    }

    this.cloudGroup.renderOrder = -20;
    this.scene.add(this.cloudGroup);
  }

  private createStars(): void {
    const starCount = 560;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const radius = 130 + Math.random() * 95;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42;
      positions[i * 3] = Math.cos(theta) * Math.cos(phi) * radius;
      positions[i * 3 + 1] = 55 + Math.sin(phi) * radius;
      positions[i * 3 + 2] = Math.sin(theta) * Math.cos(phi) * radius;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMaterial = new THREE.PointsMaterial({
      color: 0xdde8ff,
      size: 0.75,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      sizeAttenuation: true
    });

    this.starGroup = new THREE.Points(geo, this.starMaterial);
    this.starGroup.frustumCulled = false;
    this.scene.add(this.starGroup);
  }

  private wrapCloudOffset(value: number, radius: number): number {
    const diameter = radius * 2;
    return ((((value + radius) % diameter) + diameter) % diameter) - radius;
  }

  private positionSkySprite(sprite: THREE.Sprite, playerPosition: THREE.Vector3, dir: THREE.Vector3, distance: number): void {
    sprite.position.set(
      playerPosition.x + dir.x * distance,
      playerPosition.y + dir.y * distance,
      playerPosition.z + dir.z * distance
    );
  }

  /**
   * Updates light angles, colors, clouds, stars, moon/sun sprites, and shader uniforms.
   */
  public update(
    dt: number,
    playerPosition: THREE.Vector3,
    chunkMaterials: { opaque: THREE.ShaderMaterial; transparent: THREE.ShaderMaterial; water: THREE.ShaderMaterial; foliage: THREE.ShaderMaterial },
    dimension: string = 'overworld'
  ): void {
    if (dimension === 'backrooms') {
      this.weatherState = 'clear';
      const humDirection = this.scratchSunDirection.set(0.18, -0.92, 0.34).normalize();
      this.dirLight.position.set(playerPosition.x + 12, playerPosition.y + 32, playerPosition.z + 18);
      this.dirLight.target.position.copy(playerPosition);
      this.dirLight.target.updateMatrixWorld();
      this.dirLight.color.setRGB(0.94, 0.88, 0.62);
      this.ambientLight.color.setRGB(0.44, 0.42, 0.26);
      this.hemisphereLight.color.setRGB(0.48, 0.45, 0.25);
      this.hemisphereLight.groundColor.setRGB(0.08, 0.07, 0.04);
      this.dirLight.intensity = 0.42;
      this.ambientLight.intensity = 0.22;
      this.hemisphereLight.intensity = 0.12;
      this.skyColor.setRGB(0.030, 0.027, 0.015);
      this.fogColor.setRGB(0.33, 0.30, 0.16);
      this.scene.background = this.skyColor;
      const fog = this.scene.fog as THREE.Fog | null;
      if (fog) {
        fog.color.copy(this.fogColor);
        fog.near = 10;
        fog.far = Math.min(74, this.chunkFogFar);
      }
      this.sunMaterial.opacity = 0;
      this.sunGlowMaterial.opacity = 0;
      this.moonMaterial.opacity = 0;
      this.moonGlowMaterial.opacity = 0;
      this.cloudMaterial.opacity = 0;
      if (this.starMaterial) this.starMaterial.opacity = 0;
      if (this.starGroup) this.starGroup.position.copy(playerPosition);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('voxel:globalLighting', {
          detail: {
            sunLight: 0.36,
            sunDirection: { x: humDirection.x, y: humDirection.y, z: humDirection.z },
            dirLightColor: this.dirLight.color.getHex(),
            ambientLightColor: this.ambientLight.color.getHex(),
            fogColor: this.fogColor.getHex(),
            dirLightIntensity: this.dirLight.intensity,
            ambientLightIntensity: this.ambientLight.intensity
          }
        }));
      }

      this.materialArray[0] = chunkMaterials.opaque;
      this.materialArray[1] = chunkMaterials.transparent;
      this.materialArray[2] = chunkMaterials.water;
      this.materialArray[3] = chunkMaterials.foliage;
      for (let i = 0; i < 4; i++) {
        const mat = this.materialArray[i];
        if (mat && (mat as any).uniforms) {
          (mat as any).uniforms.uFogColor.value.copy(this.fogColor);
          (mat as any).uniforms.uSunLight.value = 0.36;
          (mat as any).uniforms.uSunDirection.value.copy(humDirection);
          (mat as any).uniforms.uTime.value += dt * 0.35;
        }
      }
      return;
    }

    this.timeOfDay += dt / this.dayLengthSeconds;
    if (this.timeOfDay >= 1.0) this.timeOfDay -= 1.0;

    const angle = this.timeOfDay * Math.PI * 2;

    this.scratchVector1.set(
      Math.cos(angle) * 130,
      Math.sin(angle) * 130,
      54
    );
    this.scratchVector2.copy(this.scratchVector1).negate();

    const sunVector = this.scratchVector1;
    const moonVector = this.scratchVector2;

    const sunHeight = THREE.MathUtils.clamp(sunVector.y / 130, -1, 1);
    const moonHeight = THREE.MathUtils.clamp(moonVector.y / 130, -1, 1);
    const sunDirection = this.scratchSunDirection.copy(sunVector).normalize();
    const moonDirection = this.scratchMoonDirection.copy(moonVector).normalize();

    const sunVisible = THREE.MathUtils.smoothstep(sunHeight, -0.08, 0.16);
    const moonVisible = THREE.MathUtils.smoothstep(moonHeight, -0.08, 0.16);
    const noonAmount = THREE.MathUtils.smoothstep(sunHeight, 0.10, 0.95);
    const moonHighAmount = THREE.MathUtils.smoothstep(moonHeight, 0.05, 0.85);
    const twilightBand = 1.0 - Math.abs(THREE.MathUtils.clamp(sunHeight / 0.24, -1, 1));
    const twilightAmount = Math.max(0, twilightBand) * (1.0 - noonAmount);

    const useMoonLight = sunHeight < -0.06 && moonVisible > 0.05;
    const activeDirection = useMoonLight ? moonDirection : sunDirection;
    const activeVector = useMoonLight ? moonVector : sunVector;

    this.dirLight.position.set(
      playerPosition.x + activeVector.x,
      playerPosition.y + activeVector.y,
      playerPosition.z + activeVector.z
    );
    this.dirLight.target.position.copy(playerPosition);
    this.dirLight.target.updateMatrixWorld();

    let dirIntensity = 1.0;
    let ambientIntensity = 0.3;
    let hemiIntensity = 0.22;
    let worldBrightness = 0.3;

    if (sunHeight > 0.12) {
      dirIntensity = THREE.MathUtils.lerp(0.82, 1.72, noonAmount);
      ambientIntensity = THREE.MathUtils.lerp(0.36, 0.52, noonAmount);
      hemiIntensity = THREE.MathUtils.lerp(0.24, 0.38, noonAmount);

      this.skyColor.setHSL(0.575, 0.72, THREE.MathUtils.lerp(0.50, 0.76, noonAmount));
      this.fogColor.copy(this.skyColor).lerp(this.scratchColor1.set(0xd7e6ff), 0.34);
      this.dirLight.color.setRGB(1.0, 0.96, 0.84);
      this.ambientLight.color.setRGB(0.92, 0.97, 1.0);
      this.hemisphereLight.color.setRGB(0.78, 0.88, 1.0);
      this.hemisphereLight.groundColor.setRGB(0.26, 0.30, 0.24);
      worldBrightness = THREE.MathUtils.lerp(0.64, 1.0, noonAmount);
    } else if (sunHeight > -0.12) {
      const t = THREE.MathUtils.smoothstep(sunHeight, -0.12, 0.12);
      dirIntensity = THREE.MathUtils.lerp(0.38, 0.85, t);
      ambientIntensity = THREE.MathUtils.lerp(0.24, 0.36, t);
      hemiIntensity = THREE.MathUtils.lerp(0.22, 0.28, t);

      this.skyColor.copy(this.colorNightSky).lerp(this.colorSunsetSky, twilightAmount * 0.62).lerp(this.colorDaySky, t * 0.48);
      this.fogColor.copy(this.skyColor).lerp(this.scratchColor1.set(0xffbd7a), 0.18 * twilightAmount);

      this.dirLight.color.setRGB(1.0, 0.56, 0.30);
      this.ambientLight.color.setRGB(0.72, 0.62, 0.86);
      this.hemisphereLight.color.setRGB(0.72, 0.68, 0.92);
      this.hemisphereLight.groundColor.setRGB(0.12, 0.10, 0.18);
      worldBrightness = THREE.MathUtils.lerp(0.28, 0.66, t);
    } else {
      // Moonlight: bright enough to play, still blue and night-feeling.
      dirIntensity = THREE.MathUtils.lerp(0.28, 0.48, moonHighAmount);
      ambientIntensity = THREE.MathUtils.lerp(0.22, 0.30, moonHighAmount);
      hemiIntensity = THREE.MathUtils.lerp(0.20, 0.30, moonHighAmount);

      this.skyColor.setRGB(0.036, 0.052, 0.135);
      this.fogColor.copy(this.skyColor).lerp(this.scratchColor1.set(0x253461), 0.42);
      this.dirLight.color.setRGB(0.56, 0.66, 1.0);
      this.ambientLight.color.setRGB(0.36, 0.42, 0.72);
      this.hemisphereLight.color.setRGB(0.42, 0.52, 0.88);
      this.hemisphereLight.groundColor.setRGB(0.06, 0.08, 0.16);
      worldBrightness = THREE.MathUtils.lerp(0.30, 0.42, moonHighAmount);
    }

    // Weather ticking (only on host / mob authority client)
    const nm = (window as any).gameNetworkManager;
    const isAuthority = !nm || nm.isMobAuthority;

    if (isAuthority) {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) {
        const r = Math.random();
        if (r < 0.75) {
          this.weatherState = 'clear';
          this.weatherTimer = 180 + Math.random() * 180;
        } else if (r < 0.92) {
          this.weatherState = 'rain';
          this.weatherTimer = 60 + Math.random() * 120;
        } else {
          this.weatherState = 'thunder';
          this.weatherTimer = 40 + Math.random() * 80;
        }
        EventBus.emit('network:chat', `[System] The weather has changed to ${this.weatherState.toUpperCase()}.`);
        EventBus.emit('network:sendWeather', { weather: this.weatherState, intensity: 1.0 });
      }
    }

    if (this.weatherState === 'rain' || this.weatherState === 'thunder') {
      dirIntensity *= 0.35;
      ambientIntensity *= 0.5;
      hemiIntensity *= 0.5;
      worldBrightness *= 0.45;
      this.skyColor.setRGB(0.24, 0.27, 0.33);
      this.fogColor.copy(this.skyColor);
    }

    if (this.weatherState === 'thunder') {
      if (Math.random() < 0.003) {
        this.skyColor.setRGB(1.0, 1.0, 1.0);
        this.fogColor.setRGB(1.0, 1.0, 1.0);
        dirIntensity = 2.8;
        hemiIntensity = 2.0;
        AudioManager.playArrowHit(); // rumble sound effect
        EventBus.emit('network:chat', `* Thunder rumbles *`);
      }
    }

    this.dirLight.intensity = dirIntensity;
    this.ambientLight.intensity = ambientIntensity;
    this.hemisphereLight.intensity = hemiIntensity;

    this.scene.background = this.skyColor;
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.copy(this.fogColor);
      const baseNear = THREE.MathUtils.lerp(62, 98, Math.max(sunVisible, moonVisible * 0.65));
      const baseFar = THREE.MathUtils.lerp(140, 230, Math.max(sunVisible, moonVisible * 0.48));
      fog.far = Math.max(36, Math.min(baseFar, this.chunkFogFar));
      fog.near = Math.max(12, Math.min(baseNear, this.chunkFogNear, fog.far - 14));
    }

    // Visible rising/setting sun and moon. Their position follows the same orbit
    // as the directional light, so sunrise/sunset and moonrise/moonset line up.
    const skyDistance = 178;
    this.positionSkySprite(this.sunSprite, playerPosition, sunDirection, skyDistance);
    this.positionSkySprite(this.sunGlowSprite, playerPosition, sunDirection, skyDistance - 2);
    this.positionSkySprite(this.moonSprite, playerPosition, moonDirection, skyDistance);
    this.positionSkySprite(this.moonGlowSprite, playerPosition, moonDirection, skyDistance - 2);

    this.sunMaterial.opacity = sunVisible;
    this.sunGlowMaterial.opacity = sunVisible * THREE.MathUtils.lerp(0.22, 0.58, twilightAmount);
    this.moonMaterial.opacity = moonVisible * THREE.MathUtils.lerp(0.55, 1.0, moonHighAmount);
    this.moonGlowMaterial.opacity = moonVisible * THREE.MathUtils.lerp(0.12, 0.36, moonHighAmount);

    // Puffy cloud motion. The cluster follows the player at sky height so the sky
    // never feels empty, while individual offsets wrap to avoid popping.
    this.cloudScroll += dt * 2.25;
    const radius = 170;
    this.cloudGroup.position.set(0, 0, 0);
    this.cloudGroup.children.forEach((cloud) => {
      const x = this.wrapCloudOffset(cloud.userData.baseX + this.cloudScroll * cloud.userData.speed, radius);
      const z = this.wrapCloudOffset(cloud.userData.baseZ + this.cloudScroll * 0.22 * cloud.userData.speed, radius);
      cloud.position.set(playerPosition.x + x, playerPosition.y + cloud.userData.baseY, playerPosition.z + z);
      cloud.rotation.y += dt * 0.01;
    });

    const cloudDay = Math.max(sunVisible, moonVisible * 0.22);
    this.cloudMaterial.color.copy(this.scratchColor1.set(0xffffff).lerp(this.scratchColor2.set(0x6676aa), 1.0 - cloudDay));
    this.cloudMaterial.opacity = THREE.MathUtils.lerp(0.24, 0.84, cloudDay);

    if (this.starGroup && this.starMaterial) {
      this.starGroup.position.copy(playerPosition);
      const starNight = moonVisible * (1.0 - THREE.MathUtils.smoothstep(sunHeight, -0.18, 0.08));
      this.starMaterial.opacity = starNight * 0.82;
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('voxel:globalLighting', {
        detail: {
          sunLight: worldBrightness,
          sunDirection: { x: activeDirection.x, y: activeDirection.y, z: activeDirection.z },
          dirLightColor: this.dirLight.color.getHex(),
          ambientLightColor: this.ambientLight.color.getHex(),
          fogColor: this.fogColor.getHex(),
          dirLightIntensity: this.dirLight.intensity,
          ambientLightIntensity: this.ambientLight.intensity
        }
      }));
    }

    this.materialArray[0] = chunkMaterials.opaque;
    this.materialArray[1] = chunkMaterials.transparent;
    this.materialArray[2] = chunkMaterials.water;
    this.materialArray[3] = chunkMaterials.foliage;
    for (let i = 0; i < 4; i++) {
      const mat = this.materialArray[i];
      if (mat && (mat as any).uniforms) {
        (mat as any).uniforms.uFogColor.value.copy(this.fogColor);
        (mat as any).uniforms.uSunLight.value = worldBrightness;
        (mat as any).uniforms.uSunDirection.value.copy(activeDirection);
        (mat as any).uniforms.uTime.value += dt;
      }
    }
  }
}
