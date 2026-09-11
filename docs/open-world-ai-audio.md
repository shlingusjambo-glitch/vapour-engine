# Open-world AI and audio

Vapour's open-world support composes small runtime systems rather than introducing a second gameplay framework.

`SpatialEntityIndex` is the broad phase for pedestrians, vehicles, perception targets, and local spawners. Update an entry after moving it and query a radius around the player or an agent. `SimulationLodScheduler` then assigns full, reduced, or dormant simulation from distance. Reduced updates are deterministically staggered by entity ID, avoiding a periodic frame spike when a large population wakes on the same frame.

Use `Crowd` for actual pedestrian path following and local avoidance. Feed only decisions whose scheduler result has `shouldTick: true`, using the returned `deltaSeconds`; it preserves elapsed time across reduced-rate updates. `TrafficSignalController` provides deterministic green, yellow, and all-red phases suitable for lane stop-line logic.

`mixVehicleAudio` converts normalized drivetrain telemetry into continuous parameters for idle, low engine, high engine, tire, and wind loops. Author these as seamless recorded loops and apply each returned gain and pitch to a persistent `AudioSource`. The interior flag supplies a low-pass target for an interior/exterior transition.

`AmbienceEmitter` schedules deterministic weighted one-shots without owning playback. This separation lets a game pass events through `VoiceLimiter` before playing them on the ambience bus. Save its seed/configuration alongside persistent world state when exact replay is required.

`drawAiAgent` shows state, heading, field of view, and perceived targets through the shared `DebugDraw` queue. `recordOpenWorldStats` publishes population, simulation tier, and audio voice counts into `Diagnostics` for the runtime overlay and JSON captures.

Audio recordings are deliberately not bundled with these engine systems. Game projects should keep the original download URL, creator, license text, and retrieval date beside each recording and should only distribute assets whose license was verified at acquisition time.
