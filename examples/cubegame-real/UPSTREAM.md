# Upstream provenance

This directory contains the real CubeGame source supplied by its owner for the
purpose of porting it to Vapour Engine.

- Repository: <https://github.com/KiwiOnGit/CubeGame>
- Commit: `125b70ef6a48e84678e46ef583986429daa4be93`
- Imported: 2026-08-29
- Scope: browser source, public assets, mods, server, Cloudflare worker,
  Electron host, and platform build scripts

The repository owner explicitly authorized use and modification of this code in
Vapour Engine. `server_data/`, deployment output, native build output, and Git
metadata were intentionally excluded because they are runtime/user state rather
than source required for the port.

The original project remains mechanically importable. Port changes should be
made in this directory and documented in [`PORT_STATUS.md`](PORT_STATUS.md).
