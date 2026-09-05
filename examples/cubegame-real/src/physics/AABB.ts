import * as THREE from 'three';

export class AABB {
  public min: THREE.Vector3;
  public max: THREE.Vector3;

  constructor(min: THREE.Vector3, max: THREE.Vector3) {
    this.min = min.clone();
    this.max = max.clone();
  }

  public clone(): AABB {
    return new AABB(this.min, this.max);
  }

  public set(min: THREE.Vector3, max: THREE.Vector3): void {
    this.min.copy(min);
    this.max.copy(max);
  }

  public intersects(other: AABB): boolean {
    return (
      this.min.x < other.max.x &&
      this.max.x > other.min.x &&
      this.min.y < other.max.y &&
      this.max.y > other.min.y &&
      this.min.z < other.max.z &&
      this.max.z > other.min.z
    );
  }

  public expand(x: number, y: number, z: number): AABB {
    const min = this.min.clone();
    const max = this.max.clone();
    if (x < 0) min.x += x; else max.x += x;
    if (y < 0) min.y += y; else max.y += y;
    if (z < 0) min.z += z; else max.z += z;
    return new AABB(min, max);
  }

  /**
   * Ray-AABB Intersection
   * Returns distance to intersection or null
   */
  public intersectRay(rayOrigin: THREE.Vector3, rayDir: THREE.Vector3): number | null {
    let tmin = (this.min.x - rayOrigin.x) / rayDir.x;
    let tmax = (this.max.x - rayOrigin.x) / rayDir.x;

    if (tmin > tmax) {
      const temp = tmin;
      tmin = tmax;
      tmax = temp;
    }

    let tymin = (this.min.y - rayOrigin.y) / rayDir.y;
    let tymax = (this.max.y - rayOrigin.y) / rayDir.y;

    if (tymin > tymax) {
      const temp = tymin;
      tymin = tymax;
      tymax = temp;
    }

    if ((tmin > tymax) || (tymin > tmax)) return null;

    if (tymin > tmin) tmin = tymin;
    if (tymax < tmax) tmax = tymax;

    let tzmin = (this.min.z - rayOrigin.z) / rayDir.z;
    let tzmax = (this.max.z - rayOrigin.z) / rayDir.z;

    if (tzmin > tzmax) {
      const temp = tzmin;
      tzmin = tzmax;
      tzmax = temp;
    }

    if ((tmin > tzmax) || (tzmin > tmax)) return null;

    if (tzmin > tmin) tmin = tzmin;
    if (tzmax < tmax) tmax = tzmax;

    if (tmin < 0) {
      if (tmax < 0) return null;
      return 0; // Origin inside box
    }

    return tmin;
  }
}
