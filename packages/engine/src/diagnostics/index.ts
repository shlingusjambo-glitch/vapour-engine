/** Diagnostics: counters, timings, categorized logging, and debug drawing.
 *
 * The audit's blunt finding was that nobody could tell why a Vapour game was
 * slow or broken. This subsystem is the shared surface that answers that:
 * every other subsystem reports counters into one registry, logs under one
 * category scheme, and visualizes its state through one debug-draw buffer.
 *
 * All of it is cheap enough to leave enabled and can be switched off without
 * removing call sites, because diagnostics that must be deleted to ship are
 * diagnostics nobody has when they need them.
 */
export * from "./counters.js";
export * from "./logging.js";
export * from "./debug-draw.js";
export * from "./overlay.js";
