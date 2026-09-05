export type ProceduralSeed = number | string | bigint;

export interface FractalNoiseOptions {
  /** Number of frequency layers. Defaults to 5. */
  readonly octaves?: number;
  /** Frequency multiplier between layers. Defaults to 2. */
  readonly lacunarity?: number;
  /** Amplitude multiplier between layers. Defaults to 0.5. */
  readonly gain?: number;
  /** Input frequency applied before the first layer. Defaults to 1. */
  readonly frequency?: number;
}

/** Stable 32-bit seed hashing shared by random streams and noise fields. */
export function hashProceduralSeed(seed: ProceduralSeed): number {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) throw new Error("A procedural seed must be finite.");
    seed = String(seed);
  } else if (typeof seed === "bigint") {
    seed = seed.toString();
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small deterministic PRNG for gameplay generation. It never touches
 * `Math.random`, so a seed produces identical output in browsers and workers. */
export class SeededRandom {
  readonly seed: number;
  #state: number;

  constructor(seed: ProceduralSeed) {
    this.seed = hashProceduralSeed(seed);
    this.#state = this.seed;
  }

  /** Uniform unsigned 32-bit integer. */
  nextUint32(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let value = this.#state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  /** Uniform value in [0, 1). */
  next(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  /** Uniform value in [minimum, maximum). */
  range(minimum: number, maximum: number): number {
    requireFiniteRange(minimum, maximum);
    return minimum + this.next() * (maximum - minimum);
  }

  /** Uniform integer from minimum through maximum, inclusive. */
  integer(minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) {
      throw new Error("SeededRandom.integer requires an ordered range of safe integers.");
    }
    return minimum + Math.floor(this.next() * (maximum - minimum + 1));
  }

  /** Independent deterministic substream. Creating one does not advance this
   * stream, which keeps unrelated generators from changing each other. */
  fork(label: ProceduralSeed): SeededRandom {
    return new SeededRandom(`${String(this.seed)}:${String(label)}`);
  }
}

/** Coherent improved-gradient noise in two and three dimensions. Coordinates
 * are global and stateless, so neighbouring worker-generated chunks meet
 * without seams regardless of generation order. */
export class GradientNoise {
  readonly seed: number;
  readonly #permutation = new Uint8Array(512);

  constructor(seed: ProceduralSeed) {
    this.seed = hashProceduralSeed(seed);
    const random = new SeededRandom(this.seed);
    const values = Uint8Array.from({ length: 256 }, (_, index) => index);
    for (let index = 255; index > 0; index -= 1) {
      const other = random.integer(0, index);
      const value = values[index]!;
      values[index] = values[other]!;
      values[other] = value;
    }
    for (let index = 0; index < 512; index += 1) this.#permutation[index] = values[index & 255]!;
  }

  noise2D(x: number, y: number): number {
    requireFiniteCoordinates(x, y);
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const cellX = floorX & 255;
    const cellY = floorY & 255;
    const localX = x - floorX;
    const localY = y - floorY;
    const u = fade(localX);
    const v = fade(localY);
    const a = this.#permutation[cellX]! + cellY;
    const b = this.#permutation[cellX + 1]! + cellY;
    return lerp(
      v,
      lerp(u, gradient2(this.#permutation[a]!, localX, localY), gradient2(this.#permutation[b]!, localX - 1, localY)),
      lerp(u, gradient2(this.#permutation[a + 1]!, localX, localY - 1), gradient2(this.#permutation[b + 1]!, localX - 1, localY - 1)),
    ) * 0.7071067811865476;
  }

  noise3D(x: number, y: number, z: number): number {
    requireFiniteCoordinates(x, y, z);
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const floorZ = Math.floor(z);
    const cellX = floorX & 255;
    const cellY = floorY & 255;
    const cellZ = floorZ & 255;
    const localX = x - floorX;
    const localY = y - floorY;
    const localZ = z - floorZ;
    const u = fade(localX);
    const v = fade(localY);
    const w = fade(localZ);
    const a = this.#permutation[cellX]! + cellY;
    const aa = this.#permutation[a]! + cellZ;
    const ab = this.#permutation[a + 1]! + cellZ;
    const b = this.#permutation[cellX + 1]! + cellY;
    const ba = this.#permutation[b]! + cellZ;
    const bb = this.#permutation[b + 1]! + cellZ;
    return lerp(
      w,
      lerp(v,
        lerp(u, gradient3(this.#permutation[aa]!, localX, localY, localZ), gradient3(this.#permutation[ba]!, localX - 1, localY, localZ)),
        lerp(u, gradient3(this.#permutation[ab]!, localX, localY - 1, localZ), gradient3(this.#permutation[bb]!, localX - 1, localY - 1, localZ))),
      lerp(v,
        lerp(u, gradient3(this.#permutation[aa + 1]!, localX, localY, localZ - 1), gradient3(this.#permutation[ba + 1]!, localX - 1, localY, localZ - 1)),
        lerp(u, gradient3(this.#permutation[ab + 1]!, localX, localY - 1, localZ - 1), gradient3(this.#permutation[bb + 1]!, localX - 1, localY - 1, localZ - 1))),
    );
  }

  fbm2D(x: number, y: number, options: FractalNoiseOptions = {}): number {
    return fractal(options, (frequency) => this.noise2D(x * frequency, y * frequency));
  }

  fbm3D(x: number, y: number, z: number, options: FractalNoiseOptions = {}): number {
    return fractal(options, (frequency) => this.noise3D(x * frequency, y * frequency, z * frequency));
  }
}

/** Versioned permutation noise used to preserve terrain generated by engines
 * whose permutation shuffle was based on a sine sequence. New projects should
 * prefer `GradientNoise`; migration tools may select this algorithm so an
 * existing seed never changes its mountains, caves, or saved chunk diffs. */
export class SinePermutationNoise {
  readonly algorithm = "sine-permutation-v1";
  readonly #permutation = new Uint8Array(512);

  constructor(seed: number | string) {
    let numericSeed = 0;
    if (typeof seed === "string") {
      for (let index = 0; index < seed.length; index += 1) {
        numericSeed = ((numericSeed << 5) - numericSeed + seed.charCodeAt(index)) | 0;
      }
    } else {
      if (!Number.isFinite(seed)) throw new Error("A procedural seed must be finite.");
      numericSeed = Math.floor(seed);
    }
    const random = (): number => {
      const value = Math.sin(numericSeed++) * 10_000;
      return value - Math.floor(value);
    };
    const values = Uint8Array.from({ length: 256 }, (_, index) => index);
    for (let index = 255; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      const value = values[index]!;
      values[index] = values[other]!;
      values[other] = value;
    }
    for (let index = 0; index < 512; index += 1) this.#permutation[index] = values[index & 255]!;
  }

  noise2D(x: number, y: number): number {
    requireFiniteCoordinates(x, y);
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const cellX = floorX & 255;
    const cellY = floorY & 255;
    const localX = x - floorX;
    const localY = y - floorY;
    const u = fade(localX);
    const v = fade(localY);
    const a = this.#permutation[cellX]! + cellY;
    const b = this.#permutation[cellX + 1]! + cellY;
    const grad = (hash: number, gx: number, gy: number): number => {
      const code = hash & 7;
      const first = code < 4 ? gx : gy;
      const second = code < 4 ? gy : gx;
      return ((code & 1) !== 0 ? -first : first) + ((code & 2) !== 0 ? -2 * second : 2 * second);
    };
    return lerp(v,
      lerp(u, grad(this.#permutation[a]!, localX, localY), grad(this.#permutation[b]!, localX - 1, localY)),
      lerp(u, grad(this.#permutation[a + 1]!, localX, localY - 1), grad(this.#permutation[b + 1]!, localX - 1, localY - 1)),
    );
  }

  noise3D(x: number, y: number, z: number): number {
    requireFiniteCoordinates(x, y, z);
    const floorX = Math.floor(x); const floorY = Math.floor(y); const floorZ = Math.floor(z);
    const cellX = floorX & 255; const cellY = floorY & 255; const cellZ = floorZ & 255;
    const localX = x - floorX; const localY = y - floorY; const localZ = z - floorZ;
    const u = fade(localX); const v = fade(localY); const w = fade(localZ);
    const a = this.#permutation[cellX]! + cellY;
    const aa = this.#permutation[a]! + cellZ;
    const ab = this.#permutation[a + 1]! + cellZ;
    const b = this.#permutation[cellX + 1]! + cellY;
    const ba = this.#permutation[b]! + cellZ;
    const bb = this.#permutation[b + 1]! + cellZ;
    return lerp(w,
      lerp(v,
        lerp(u, gradient3(this.#permutation[aa]!, localX, localY, localZ), gradient3(this.#permutation[ba]!, localX - 1, localY, localZ)),
        lerp(u, gradient3(this.#permutation[ab]!, localX, localY - 1, localZ), gradient3(this.#permutation[bb]!, localX - 1, localY - 1, localZ))),
      lerp(v,
        lerp(u, gradient3(this.#permutation[aa + 1]!, localX, localY, localZ - 1), gradient3(this.#permutation[ba + 1]!, localX - 1, localY, localZ - 1)),
        lerp(u, gradient3(this.#permutation[ab + 1]!, localX, localY - 1, localZ - 1), gradient3(this.#permutation[bb + 1]!, localX - 1, localY - 1, localZ - 1))),
    );
  }

  fbm2D(x: number, y: number, octaves = 4): number {
    return fractal({ octaves }, (frequency) => this.noise2D(x * frequency, y * frequency));
  }
}

function fractal(options: FractalNoiseOptions, sample: (frequency: number) => number): number {
  const octaves = options.octaves ?? 5;
  const lacunarity = options.lacunarity ?? 2;
  const gain = options.gain ?? 0.5;
  let frequency = options.frequency ?? 1;
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > 32) throw new Error("Fractal noise octaves must be an integer from 1 through 32.");
  if (!(lacunarity > 0) || !(gain > 0) || !Number.isFinite(frequency) || frequency <= 0) {
    throw new Error("Fractal noise frequency, lacunarity, and gain must be positive finite numbers.");
  }
  let amplitude = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += sample(frequency) * amplitude;
    weight += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return total / weight;
}

function fade(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

function gradient2(hash: number, x: number, y: number): number {
  switch (hash & 7) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

function gradient3(hash: number, x: number, y: number, z: number): number {
  const code = hash & 15;
  const first = code < 8 ? x : y;
  const second = code < 4 ? y : code === 12 || code === 14 ? x : z;
  return ((code & 1) === 0 ? first : -first) + ((code & 2) === 0 ? second : -second);
}

function requireFiniteCoordinates(...coordinates: number[]): void {
  if (coordinates.some((value) => !Number.isFinite(value))) throw new Error("Noise coordinates must be finite.");
}

function requireFiniteRange(minimum: number, maximum: number): void {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum < minimum) {
    throw new Error("A random range needs ordered finite bounds.");
  }
}
