/** Particles and visual effects.
 *
 * A particle system is a **data layout** problem before it is a visual one.
 * Particles live in flat typed arrays sized once at the emitter's capacity, not
 * in objects: ten thousand particle objects allocate ten thousand times and
 * hand the garbage collector a frame-time spike exactly when the explosion goes
 * off. A running system here allocates nothing.
 *
 * Simulation is deterministic given a seed, so an effect looks the same on
 * every machine and can be replicated by seed rather than by particle.
 */
export * from "./particles.js";
