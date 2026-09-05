export const COB_EPSILON = 0.000001;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function lerp(a: number, b: number, t: number): number {
  const f = clamp(t, 0, 1);
  return a + (b - a) * f;
}

export function wrapRadians(value: number): number {
  let wrapped = value;
  const twoPi = Math.PI * 2;
  while (wrapped > Math.PI) wrapped -= twoPi;
  while (wrapped < -Math.PI) wrapped += twoPi;
  return wrapped;
}

export function lerpAngleRadians(a: number, b: number, t: number): number {
  const delta = wrapRadians(b - a);
  return wrapRadians(a + delta * clamp(t, 0, 1));
}

export class Vector3 {
  public x: number;
  public y: number;
  public z: number;

  public constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = Number.isFinite(x) ? x : 0;
    this.y = Number.isFinite(y) ? y : 0;
    this.z = Number.isFinite(z) ? z : 0;
  }

  public static zero(): Vector3 {
    return new Vector3(0, 0, 0);
  }

  public static up(): Vector3 {
    return new Vector3(0, 1, 0);
  }

  public static forwardFromYawPitch(yaw: number, pitch: number): Vector3 {
    const cp = Math.cos(pitch);
    const x = Math.sin(yaw) * cp;
    const y = Math.sin(pitch);
    const z = Math.cos(yaw) * cp;
    return new Vector3(x, y, z).normalize();
  }

  public clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  public set(x: number, y: number, z: number): this {
    this.x = Number.isFinite(x) ? x : 0;
    this.y = Number.isFinite(y) ? y : 0;
    this.z = Number.isFinite(z) ? z : 0;
    return this;
  }

  public copy(other: Vector3): this {
    this.x = other.x;
    this.y = other.y;
    this.z = other.z;
    return this;
  }

  public add(other: Vector3): Vector3 {
    return new Vector3(this.x + other.x, this.y + other.y, this.z + other.z);
  }

  public addInPlace(other: Vector3): this {
    this.x += other.x;
    this.y += other.y;
    this.z += other.z;
    return this;
  }

  public subtract(other: Vector3): Vector3 {
    return new Vector3(this.x - other.x, this.y - other.y, this.z - other.z);
  }

  public subtractInPlace(other: Vector3): this {
    this.x -= other.x;
    this.y -= other.y;
    this.z -= other.z;
    return this;
  }

  public multiplyScalar(scalar: number): Vector3 {
    const s = Number.isFinite(scalar) ? scalar : 0;
    return new Vector3(this.x * s, this.y * s, this.z * s);
  }

  public multiplyScalarInPlace(scalar: number): this {
    const s = Number.isFinite(scalar) ? scalar : 0;
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  public dot(other: Vector3): number {
    return this.x * other.x + this.y * other.y + this.z * other.z;
  }

  public cross(other: Vector3): Vector3 {
    return new Vector3(
      this.y * other.z - this.z * other.y,
      this.z * other.x - this.x * other.z,
      this.x * other.y - this.y * other.x
    );
  }

  public lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  public length(): number {
    return Math.sqrt(this.lengthSquared());
  }

  public distanceSquaredTo(other: Vector3): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    const dz = this.z - other.z;
    return dx * dx + dy * dy + dz * dz;
  }

  public distanceTo(other: Vector3): number {
    return Math.sqrt(this.distanceSquaredTo(other));
  }

  public normalize(): this {
    const len = this.length();
    if (len <= COB_EPSILON) {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      return this;
    }
    const inv = 1 / len;
    this.x *= inv;
    this.y *= inv;
    this.z *= inv;
    return this;
  }

  public normalized(): Vector3 {
    return this.clone().normalize();
  }

  public clampLength(maxLength: number): this {
    const max = Math.max(0, maxLength);
    const lenSq = this.lengthSquared();
    if (lenSq <= max * max || lenSq <= COB_EPSILON) return this;
    const scale = max / Math.sqrt(lenSq);
    this.x *= scale;
    this.y *= scale;
    this.z *= scale;
    return this;
  }

  public equals(other: Vector3, epsilon: number = COB_EPSILON): boolean {
    return Math.abs(this.x - other.x) <= epsilon
      && Math.abs(this.y - other.y) <= epsilon
      && Math.abs(this.z - other.z) <= epsilon;
  }
}

export class AABB {
  public min: Vector3;
  public max: Vector3;

  public constructor(min: Vector3, max: Vector3) {
    this.min = new Vector3(
      Math.min(min.x, max.x),
      Math.min(min.y, max.y),
      Math.min(min.z, max.z)
    );
    this.max = new Vector3(
      Math.max(min.x, max.x),
      Math.max(min.y, max.y),
      Math.max(min.z, max.z)
    );
  }

  public clone(): AABB {
    return new AABB(this.min.clone(), this.max.clone());
  }

  public center(): Vector3 {
    return new Vector3(
      (this.min.x + this.max.x) * 0.5,
      (this.min.y + this.max.y) * 0.5,
      (this.min.z + this.max.z) * 0.5
    );
  }

  public size(): Vector3 {
    return new Vector3(
      this.max.x - this.min.x,
      this.max.y - this.min.y,
      this.max.z - this.min.z
    );
  }

  public containsPoint(point: Vector3): boolean {
    return point.x >= this.min.x && point.x <= this.max.x
      && point.y >= this.min.y && point.y <= this.max.y
      && point.z >= this.min.z && point.z <= this.max.z;
  }

  public intersects(other: AABB): boolean {
    if (this.max.x < other.min.x || this.min.x > other.max.x) return false;
    if (this.max.y < other.min.y || this.min.y > other.max.y) return false;
    if (this.max.z < other.min.z || this.min.z > other.max.z) return false;
    return true;
  }

  public expanded(amount: number): AABB {
    const a = Math.max(0, amount);
    return new AABB(
      new Vector3(this.min.x - a, this.min.y - a, this.min.z - a),
      new Vector3(this.max.x + a, this.max.y + a, this.max.z + a)
    );
  }

  public distanceSquaredToPoint(point: Vector3): number {
    let dx = 0;
    let dy = 0;
    let dz = 0;

    if (point.x < this.min.x) dx = this.min.x - point.x;
    else if (point.x > this.max.x) dx = point.x - this.max.x;

    if (point.y < this.min.y) dy = this.min.y - point.y;
    else if (point.y > this.max.y) dy = point.y - this.max.y;

    if (point.z < this.min.z) dz = this.min.z - point.z;
    else if (point.z > this.max.z) dz = point.z - this.max.z;

    return dx * dx + dy * dy + dz * dz;
  }

  public intersectsSphere(center: Vector3, radius: number): boolean {
    const r = Math.max(0, radius);
    return this.distanceSquaredToPoint(center) <= r * r;
  }
}

export class Matrix4 {
  public readonly elements: number[];

  public constructor(elements?: number[]) {
    this.elements = new Array<number>(16);
    if (elements && elements.length === 16) {
      for (let i = 0; i < 16; i++) this.elements[i] = Number.isFinite(elements[i]) ? elements[i] : 0;
    } else {
      this.identity();
    }
  }

  public identity(): this {
    for (let i = 0; i < 16; i++) this.elements[i] = 0;
    this.elements[0] = 1;
    this.elements[5] = 1;
    this.elements[10] = 1;
    this.elements[15] = 1;
    return this;
  }

  public clone(): Matrix4 {
    return new Matrix4(this.elements);
  }

  public static compose(position: Vector3, rotationRadians: Vector3, scale: Vector3 = new Vector3(1, 1, 1)): Matrix4 {
    const sx = Math.sin(rotationRadians.x);
    const cx = Math.cos(rotationRadians.x);
    const sy = Math.sin(rotationRadians.y);
    const cy = Math.cos(rotationRadians.y);
    const sz = Math.sin(rotationRadians.z);
    const cz = Math.cos(rotationRadians.z);

    const m00 = cy * cz;
    const m01 = sx * sy * cz - cx * sz;
    const m02 = cx * sy * cz + sx * sz;
    const m10 = cy * sz;
    const m11 = sx * sy * sz + cx * cz;
    const m12 = cx * sy * sz - sx * cz;
    const m20 = -sy;
    const m21 = sx * cy;
    const m22 = cx * cy;

    return new Matrix4([
      m00 * scale.x, m01 * scale.y, m02 * scale.z, 0,
      m10 * scale.x, m11 * scale.y, m12 * scale.z, 0,
      m20 * scale.x, m21 * scale.y, m22 * scale.z, 0,
      position.x, position.y, position.z, 1,
    ]);
  }

  public multiply(other: Matrix4): Matrix4 {
    const a = this.elements;
    const b = other.elements;
    const out = new Array<number>(16);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += a[row * 4 + k] * b[k * 4 + col];
        }
        out[row * 4 + col] = sum;
      }
    }
    return new Matrix4(out);
  }

  public transformPoint(point: Vector3): Vector3 {
    const e = this.elements;
    const x = point.x;
    const y = point.y;
    const z = point.z;
    return new Vector3(
      x * e[0] + y * e[4] + z * e[8] + e[12],
      x * e[1] + y * e[5] + z * e[9] + e[13],
      x * e[2] + y * e[6] + z * e[10] + e[14]
    );
  }
}

export class SeededRandom {
  private state: number;

  public constructor(seed: number) {
    const initial = seed | 0;
    this.state = initial === 0 ? 0x6d2b79f5 : initial;
  }

  public nextUint32(): number {
    let x = this.state | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return x >>> 0;
  }

  public nextFloat(): number {
    return this.nextUint32() / 0xffffffff;
  }

  public nextInt(minInclusive: number, maxInclusive: number): number {
    const min = Math.ceil(minInclusive);
    const max = Math.floor(maxInclusive);
    if (max <= min) return min;
    const span = max - min + 1;
    return min + Math.floor(this.nextFloat() * span);
  }

  public chooseIndex(length: number): number {
    if (length <= 0) return -1;
    return this.nextInt(0, length - 1);
  }
}
