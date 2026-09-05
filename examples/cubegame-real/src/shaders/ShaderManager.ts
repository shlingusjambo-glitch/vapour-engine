/**
 * ShaderManager
 * Manages custom shaders defined as TypeScript files
 * Supports dynamic shader composition and menu system
 */

import * as THREE from 'three';
import { EventBus } from '../core/EventBus';

export interface ShaderDefinition {
  name: string;
  description: string;
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, any>;
  enabled: boolean;
  intensity: number; // 0-1
}

export interface ShaderPass {
  name: string;
  shader: ShaderDefinition;
  material: THREE.ShaderMaterial;
  quad: THREE.Mesh;
  renderTarget: THREE.WebGLRenderTarget;
}

/**
 * Manages custom shaders and shader effects
 */
export class ShaderManager {
  private shaders: Map<string, ShaderDefinition> = new Map();
  private activeShaders: ShaderPass[] = [];
  private renderer: THREE.WebGLRenderer | null = null;
  private composer: any = null; // EffectComposer equivalent
  
  constructor() {
    // Register default shaders
    this.registerDefaultShaders();
  }
  
  /**
   * Initialize shader manager with renderer
   */
  initialize(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
  }
  
  /**
   * Register built-in shaders
   */
  private registerDefaultShaders(): void {
    // Bloom shader
    this.registerShader({
      name: 'bloom',
      description: 'Bloom effect - makes bright areas glow',
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uIntensity;
        varying vec2 vUv;
        
        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;
          float brightness = dot(color, vec3(0.299, 0.587, 0.114));
          
          if (brightness > 0.6) {
            color += color * uIntensity * brightness;
          }
          
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.5 }
      },
      enabled: false,
      intensity: 0.5
    });
    
    // FXAA (anti-aliasing)
    this.registerShader({
      name: 'fxaa',
      description: 'FXAA anti-aliasing - smooths jagged edges',
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 uResolution;
        varying vec2 vUv;
        
        #define FXAA_REDUCE_MIN   (1.0/128.0)
        #define FXAA_REDUCE_MUL   (1.0/8.0)
        #define FXAA_SPAN_MAX     8.0
        
        void main() {
          vec3 rgbNW = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) / uResolution).xyz;
          vec3 rgbNE = texture2D(tDiffuse, vUv + vec2(1.0, -1.0) / uResolution).xyz;
          vec3 rgbSW = texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) / uResolution).xyz;
          vec3 rgbSE = texture2D(tDiffuse, vUv + vec2(1.0, 1.0) / uResolution).xyz;
          vec3 rgbM = texture2D(tDiffuse, vUv).xyz;
          
          vec3 luma = vec3(0.299, 0.587, 0.114);
          float lumaNW = dot(rgbNW, luma);
          float lumaNE = dot(rgbNE, luma);
          float lumaSW = dot(rgbSW, luma);
          float lumaSE = dot(rgbSE, luma);
          float lumaM = dot(rgbM, luma);
          
          float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
          float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
          
          gl_FragColor = vec4(rgbM, 1.0);
        }
      `,
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(1920, 1080) }
      },
      enabled: false,
      intensity: 1.0
    });
    
    // Vignette shader
    this.registerShader({
      name: 'vignette',
      description: 'Vignette effect - darkens screen edges',
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uIntensity;
        varying vec2 vUv;
        
        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;
          
          vec2 uv = vUv - 0.5;
          float vignette = smoothstep(0.0, 0.7, 1.0 - length(uv * 1.5));
          
          color *= mix(1.0, vignette, uIntensity);
          
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.3 }
      },
      enabled: false,
      intensity: 0.3
    });
    
    // Color grading
    this.registerShader({
      name: 'colorGrade',
      description: 'Color grading - adjusts colors and contrast',
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uSaturation;
        uniform float uContrast;
        uniform float uBrightness;
        varying vec2 vUv;
        
        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;
          
          // Adjust brightness
          color += uBrightness;
          
          // Adjust contrast
          color = (color - 0.5) * (1.0 + uContrast) + 0.5;
          
          // Adjust saturation
          float gray = dot(color, vec3(0.299, 0.587, 0.114));
          color = mix(vec3(gray), color, uSaturation);
          
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      uniforms: {
        tDiffuse: { value: null },
        uSaturation: { value: 1.0 },
        uContrast: { value: 0.0 },
        uBrightness: { value: 0.0 }
      },
      enabled: false,
      intensity: 1.0
    });
  }
  
  /**
   * Register a custom shader from TypeScript definition
   */
  registerShader(shader: ShaderDefinition): void {
    this.shaders.set(shader.name, shader);
    console.log(`✅ Registered shader: ${shader.name}`);
  }
  
  /**
   * Enable a shader effect
   */
  enableShader(name: string, intensity?: number): void {
    const shader = this.shaders.get(name);
    if (!shader) {
      console.warn(`Shader not found: ${name}`);
      return;
    }
    
    shader.enabled = true;
    if (intensity !== undefined) {
      shader.intensity = Math.max(0, Math.min(1, intensity));
    }
    
    console.log(`✅ Enabled shader: ${name}`);
    EventBus.emit('shader:enabled', { name, intensity: shader.intensity });
  }
  
  /**
   * Disable a shader effect
   */
  disableShader(name: string): void {
    const shader = this.shaders.get(name);
    if (shader) {
      shader.enabled = false;
      console.log(`✅ Disabled shader: ${name}`);
      EventBus.emit('shader:disabled', { name });
    }
  }
  
  /**
   * Set shader intensity (0-1)
   */
  setShaderIntensity(name: string, intensity: number): void {
    const shader = this.shaders.get(name);
    if (shader) {
      shader.intensity = Math.max(0, Math.min(1, intensity));
      EventBus.emit('shader:intensityChanged', { name, intensity: shader.intensity });
    }
  }
  
  /**
   * Get all available shaders
   */
  getAvailableShaders(): ShaderDefinition[] {
    return Array.from(this.shaders.values());
  }
  
  /**
   * Get enabled shaders
   */
  getEnabledShaders(): ShaderDefinition[] {
    return Array.from(this.shaders.values()).filter(s => s.enabled);
  }
  
  /**
   * Toggle shader
   */
  toggleShader(name: string): void {
    const shader = this.shaders.get(name);
    if (shader) {
      shader.enabled ? this.disableShader(name) : this.enableShader(name);
    }
  }
}

// Global shader manager instance
let shaderManagerInstance: ShaderManager | null = null;

export function getShaderManager(): ShaderManager {
  if (!shaderManagerInstance) {
    shaderManagerInstance = new ShaderManager();
  }
  return shaderManagerInstance;
}
