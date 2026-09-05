# Vapour Script (VS)

Vapour Script is Vapour's concise gameplay language. It uses Python/GDScript-like
indentation and syntax, compiles to browser JavaScript modules, and operates on
the exact same engine objects as TypeScript. VS is not sandboxed, interpreted
with `eval`, or restricted to a smaller engine API.

VS is currently **experimental**. The compiler and build integration are real,
but the language will grow before its syntax is frozen for 1.0.

## Choosing VS or TypeScript

Use VS for scene behavior, interactions, UI flows, dialogue triggers, enemy
behavior, and short gameplay scripts where readability and iteration speed are
most important. Use TypeScript for large reusable systems, complex data models,
server code, libraries, plugins, and code that benefits from advanced static
types and the broader npm ecosystem.

A project may use only VS, only TypeScript, or both. They compile into one ESM
module graph and pass ordinary objects across the language boundary. Both use
the same 2D, 3D, XR, scene, input, physics, UI, audio, save, AI, and networking
APIs as those systems become available.

```sh
pnpm vapour create ./MyGame --template empty-2d --language vs --json
pnpm vapour compile-vs ./MyGame/Scripts/main.vs --out /tmp/main.js
pnpm vapour validate ./MyGame --json
pnpm vapour build ./MyGame --json
```

## Syntax

Indentation is exactly four spaces. Tabs and inconsistent indentation are
compile errors with filenames, line numbers, source lines, and explanations.

```py
from "@vapour/engine" import StateMachine, steerArrive
from "./items.ts" import item_database

const WALK_SPEED = 4.5
var elapsed: number = 0

export func start(context):
    console.info("Ready", context.entityId)

export func update(context, delta_seconds):
    elapsed = elapsed + delta_seconds
    if context.input.held("Move") and not context.input.held("Pause"):
        move_player(delta_seconds)
    elif elapsed > 10:
        console.info("Ten seconds elapsed")
    else:
        pass

func move_player(delta_seconds):
    for index in range(3):
        console.debug(index, delta_seconds)
```

Supported constructs in the current compiler:

- `var`, `const`, assignments, expressions, and optional variable annotations
- `func`, `async func`, `export func`, classes, inheritance, and methods
- `if`, `elif`, `else`, `while`, and `for value in iterable`
- `return`, `break`, `continue`, and `pass`
- `match`, `case`, and `default`
- `and`, `or`, `not`, `True`, `False`, `None`, `self`, and `range()`
- named/side-effect imports and direct interoperability with `.ts`, `.js`, and
  `.vs` modules

Strings retain their contents; Python-style words and `#` inside strings are
not rewritten. Comments begin with `#` outside a string.

## Engine lifecycle

Module entry points may export `start(context)` and `update(context,
delta_seconds)`, matching TypeScript project entries. Component classes can
extend `Behaviour` and implement `initialize`, `start`, `update`, `fixedUpdate`,
`lateUpdate`, `destroy`, collision, and trigger callbacks. Because VS classes
compile to native JavaScript classes, `ScriptScheduler` treats VS and
TypeScript behaviors identically.

## Builds and diagnostics

Project validation compiles every `.vs` file in `Scripts/`, even when it is not
currently imported. Production builds compile `.vs` entry points and imported
VS modules before bundling, minification, hashing, source maps, and service
worker generation. A VS compilation failure stops the build; it is never
silently skipped.

The compiler is available as `compileVapourScript` from `@vapour/engine` for
editors, plugins, language servers, and build integrations. Its structured
diagnostics contain `file`, `line`, `column`, `severity`, `message`, and the
original source line.

## Current limitations

VS does not yet provide a language server, debugger adapter, formatter,
incremental compiler, static type checker, decorators/annotations, typed engine
API completion, automatic file watching, or editor controls for hot reload. At
runtime, `GameRuntime.replaceScript()` does support language-neutral module
replacement with `captureState`/`restoreState` and rollback when replacement
startup fails. The generated source map records
source ownership but does not yet provide statement-accurate mappings. These
are explicit release gates; VS is not yet described as stable.
