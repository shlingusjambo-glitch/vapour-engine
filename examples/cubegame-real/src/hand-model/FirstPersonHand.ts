/**
 * FirstPersonHandModel
 * Professional first-person hand with proper positioning, animations, and item holding
 * Designed to look good and feel responsive in the player's view
 */

import * as THREE from 'three';

export interface HandModelConfig {
  scale: number;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  followSmoothing: number;
  swingSpeed: number;
  swingAmount: number;
}

export class FirstPersonHandModel {
  private handGroup: THREE.Group;
  private leftHand: THREE.Group;
  private rightHand: THREE.Group;
  private heldItemSlot: THREE.Object3D | null = null;
  
  private config: HandModelConfig;
  
  // Animation state
  private isSwinging = false;
  private swingProgress = 0;
  private swingDirection = 1; // 1 or -1
  private basePosition: THREE.Vector3;
  private baseRotation: THREE.Euler;
  
  // Bob/sway animation for idle
  private bobOffset = 0;
  private swayOffset = 0;
  private bobTime = 0;
  
  constructor(config: Partial<HandModelConfig> = {}) {
    this.config = {
      scale: 1.0,
      position: new THREE.Vector3(0.5, -0.5, -1.0),
      rotation: new THREE.Euler(0, 0, 0),
      followSmoothing: 0.15,
      swingSpeed: 0.15,
      swingAmount: 0.3,
      ...config
    };
    
    this.basePosition = this.config.position.clone();
    this.baseRotation = new THREE.Euler(
      this.config.rotation.x,
      this.config.rotation.y,
      this.config.rotation.z
    );
    
    // Create main hand group
    this.handGroup = new THREE.Group();
    this.handGroup.position.copy(this.config.position);
    this.handGroup.rotation.order = 'YXZ';
    
    // Create left and right hands (both for convenience, one visible at a time)
    this.leftHand = this.createHand('left');
    this.rightHand = this.createHand('right');
    
    this.handGroup.add(this.rightHand); // Right hand is default
    this.rightHand.visible = true;
    this.leftHand.visible = false;
  }
  
  /**
   * Create a hand mesh (left or right)
   */
  private createHand(side: 'left' | 'right'): THREE.Group {
    const handGroup = new THREE.Group();
    
    // Forearm
    const forearmGeometry = new THREE.BoxGeometry(0.15, 0.3, 0.12);
    const skinMaterial = new THREE.MeshStandardMaterial({
      color: 0xdbB89D,
      roughness: 0.7,
      metalness: 0.0
    });
    const forearm = new THREE.Mesh(forearmGeometry, skinMaterial);
    forearm.position.set(0, -0.15, -0.2);
    forearm.castShadow = true;
    forearm.receiveShadow = true;
    handGroup.add(forearm);
    
    // Palm
    const palmGeometry = new THREE.BoxGeometry(0.13, 0.12, 0.15);
    const palm = new THREE.Mesh(palmGeometry, skinMaterial);
    palm.position.set(0, 0, 0);
    palm.castShadow = true;
    palm.receiveShadow = true;
    handGroup.add(palm);
    
    // Thumb
    const thumbGeometry = new THREE.BoxGeometry(0.04, 0.06, 0.05);
    const thumb = new THREE.Mesh(thumbGeometry, skinMaterial);
    thumb.position.set(side === 'right' ? -0.08 : 0.08, -0.02, -0.02);
    thumb.castShadow = true;
    thumb.receiveShadow = true;
    handGroup.add(thumb);
    
    // Four fingers (simplified as boxes)
    for (let i = 0; i < 4; i++) {
      const fingerGeometry = new THREE.BoxGeometry(0.03, 0.08, 0.04);
      const finger = new THREE.Mesh(fingerGeometry, skinMaterial);
      finger.position.set(
        -0.04 + (i * 0.03),
        0.04,
        -0.01
      );
      finger.castShadow = true;
      finger.receiveShadow = true;
      handGroup.add(finger);
    }
    
    // Item slot (where held items attach)
    const itemSlot = new THREE.Group();
    itemSlot.position.set(0, 0, 0);
    itemSlot.name = 'itemSlot';
    handGroup.add(itemSlot);
    
    return handGroup;
  }
  
  /**
   * Attach the hand to a scene
   */
  attachToScene(scene: THREE.Scene): void {
    scene.add(this.handGroup);
  }
  
  /**
   * Update hand position and animation
   */
  update(deltaTime: number, cameraRotation: THREE.Euler): void {
    // Update bob animation
    this.bobTime += deltaTime;
    this.bobOffset = Math.sin(this.bobTime * 2.5) * 0.01;
    this.swayOffset = Math.cos(this.bobTime * 1.8) * 0.015;
    
    // Apply swinging animation if active
    if (this.isSwinging) {
      this.swingProgress += this.config.swingSpeed;
      
      if (this.swingProgress >= 1.0) {
        this.swingProgress = 0;
        this.isSwinging = false;
      }
      
      // Swing arc
      const swingAngle = Math.sin(this.swingProgress * Math.PI) * this.config.swingAmount;
      this.rightHand.rotation.z = swingAngle;
      this.leftHand.rotation.z = swingAngle;
    } else {
      // Idle position
      this.rightHand.rotation.z = 0;
      this.leftHand.rotation.z = 0;
    }
    
    // Update main group position with bob and sway
    const targetPos = new THREE.Vector3(
      this.basePosition.x + this.swayOffset,
      this.basePosition.y + this.bobOffset,
      this.basePosition.z
    );
    this.handGroup.position.lerp(targetPos, this.config.followSmoothing);
    
    // Match camera rotation
    this.handGroup.rotation.copy(cameraRotation);
  }
  
  /**
   * Perform attack swing animation
   */
  swing(): void {
    this.isSwinging = true;
    this.swingProgress = 0;
  }
  
  /**
   * Attach an item to the hand
   */
  attachItem(item: THREE.Object3D): void {
    // Remove previous item if exists
    if (this.heldItemSlot) {
      const itemSlot = this.rightHand.getObjectByName('itemSlot');
      if (itemSlot) {
        itemSlot.children.forEach(child => child.removeFromParent());
      }
    }
    
    // Attach new item
    const itemSlot = this.rightHand.getObjectByName('itemSlot');
    if (itemSlot) {
      item.position.set(0, -0.08, 0.1);
      item.scale.set(0.08, 0.08, 0.08);
      itemSlot.add(item);
      this.heldItemSlot = item;
    }
  }
  
  /**
   * Remove held item
   */
  removeItem(): void {
    if (this.heldItemSlot && this.heldItemSlot.parent) {
      this.heldItemSlot.removeFromParent();
      this.heldItemSlot = null;
    }
  }
  
  /**
   * Switch between left and right hand
   */
  setHand(side: 'left' | 'right'): void {
    this.rightHand.visible = side === 'right';
    this.leftHand.visible = side === 'left';
  }
  
  /**
   * Get the hand group for scene attachment
   */
  getGroup(): THREE.Group {
    return this.handGroup;
  }
  
  /**
   * Show or hide the hand
   */
  setVisible(visible: boolean): void {
    this.handGroup.visible = visible;
  }
}
