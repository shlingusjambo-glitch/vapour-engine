# Licensing

Vapour Engine is licensed under the **GNU Lesser General Public License,
version 3.0 or later** (LGPL-3.0-or-later). The full text is in
[`COPYING.LESSER`](COPYING.LESSER), which incorporates
[`COPYING`](COPYING) (GPL-3.0) by reference, as the LGPL requires.

## What this means in practice

**Games you make with Vapour are yours.** Using the engine — writing gameplay
scripts, authoring scenes, importing assets, and shipping the result — does not
place any license requirement on your game. Your game's own code, art, audio,
and design can be proprietary, commercial, and closed source. You owe no source
code, no royalties, and no attribution beyond the notice described below.

**Changes to the engine itself must be shared.** If you modify Vapour's own
source — the Rust crates, the WGSL shaders, the TypeScript engine package, the
editor, or the CLI — and you distribute a product containing those
modifications, you must make the modified engine source available to your users
under the LGPL. This is what keeps improvements to the engine flowing back to
everyone using it.

The dividing line is the engine, not your game:

| You do this | Your obligation |
| --- | --- |
| Ship a game built with an unmodified Vapour | Include the engine's license notice. Nothing else. |
| Write gameplay scripts against the Vapour APIs | Nothing. Your scripts are your own work. |
| Write a Vapour plugin that only uses the public plugin API | Nothing. Plugins may be proprietary. |
| Fix a bug or add a feature inside a `vapour-*` crate or package, then ship it | Publish that modified engine source under the LGPL. |
| Fork Vapour into a different engine | Publish the fork's source under the LGPL. |

## The notice your game must carry

A shipped game only needs to state that it uses Vapour Engine under the
LGPL-3.0-or-later and say where the engine source can be obtained. Something
like this, on a credits or legal screen, is enough:

> This game uses Vapour Engine, licensed under the GNU LGPL v3.0 or later.
> Engine source: https://github.com/vapour-engine/vapour

`vapour build` writes this notice into the output directory as
`THIRD-PARTY-NOTICES.txt` so a default build is already compliant.

## Relinking, and why WebAssembly makes this easy

LGPL section 4 says that if you combine the library with your own work, users
must be able to replace the library with a modified version and relink. Native
engines usually satisfy this by shipping a dynamic library; Vapour satisfies it
by construction.

A Vapour build emits the engine as its own artifact — `vapour_runtime.wasm`
plus its JavaScript bindings — which the game loads at runtime rather than
inlining into game code. A user who wants to run your game against a patched
engine replaces that file. You do not need to ship object files, relinking
scripts, or your game's source to comply.

Two things are therefore worth knowing:

- **Do not inline the engine into your game bundle.** The default build keeps
  the runtime separate. If you change the build to bundle the engine into a
  single file, you take on the LGPL section 4 relinking obligation yourself.
- **Keep the engine artifact replaceable.** Hashing the filename for cache
  busting is fine; the build records the mapping so the file can still be
  swapped.

## Third-party components

Vapour depends on Rust crates and npm packages under their own permissive
licenses (largely MIT and Apache-2.0), which are compatible with the LGPL and
impose no additional obligations on your game. `vapour build` collects their
notices into `THIRD-PARTY-NOTICES.txt` alongside the engine notice.

## Contributing

Contributions are accepted under the same LGPL-3.0-or-later terms. By opening a
pull request you agree your contribution may be distributed under that license.

## Not legal advice

This page explains the project's intent in plain language. Where it and
`COPYING.LESSER` disagree, the license text governs.
