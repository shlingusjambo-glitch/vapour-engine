# Vapour Hub

The Hub is the default browser entry point. It separates project and editor
lifecycle from a running game and from the authoring workspace.

## Creating a project

Choose **New project**, enter a name, choose a template and installed editor
version, then select storage:

- **Browser workspace** uses the Origin Private File System. It requires no
  folder prompt and remains private to the site's origin and browser profile.
- **Disk folder** uses the File System Access API. The Hub creates an ordinary
  source-controlled project folder beneath the selected directory.

Both modes create `.vapourproject`, `Assets/Scenes/`, `Scripts/`, `Settings/`,
`Plugins/`, `.gitignore`, and `AGENTS.md`. Generated cache and build directories
are not source assets.

## Opening and saving

**Open** selects a disk project and validates its `.vapourproject` manifest.
Recent project directory handles are stored in IndexedDB. Browsers may request
write permission again after a restart; denial is reported without removing the
project from disk.

The editor loads the manifest's `startupScene` through the retained directory
handle. Save and autosave write deterministic JSON back to that scene file and
also retain a local recovery copy. Returning to Projects prompts before leaving
unsaved work. **Forget** removes only the recent-project entry; it never deletes
the underlying browser or disk project.

## Editor versions

Every project pins `editorVersion`, and the Hub displays installed versions.
This prevents a project from silently opening under a different serialization
or import pipeline. The development build currently ships one built-in editor,
`0.2.0-alpha`; downloading, verifying, and retaining additional release bundles
is still release-gated work and is not represented by a fake install action.

## Browser support

Origin-private projects use standardized storage APIs available in current
browsers. Disk folders require the File System Access API and currently work
best in Chromium-based browsers. When disk access is unavailable, the Hub
explains the limitation and keeps browser-workspace creation available.
