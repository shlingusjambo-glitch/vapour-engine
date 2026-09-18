"""CLI: `amcp script.json` (or `python -m amcp script.json`) runs a list of ops so any agent can make art
without MCP. `amcp serve` starts the MCP server (stdio).
Script = [{"op": "new_document", "width": 512, "height": 512, "as": "doc"}, {"op": "draw_path", "doc_id": "$doc", ...}]
"$name" references a value saved with "as"."""
import json
import sys

from . import server


def run(ops):
    vars_ = {}
    for op in ops:
        kw = {k: (vars_[v[1:]] if isinstance(v, str) and v.startswith("$") else v)
              for k, v in op.items() if k not in ("op", "as")}
        out = getattr(server, op["op"])(**kw)
        if "as" in op:
            vars_[op["as"]] = out
        if not isinstance(out, (server.Image, list)):
            print(f"{op['op']}: {out}")


def main():
    if len(sys.argv) < 2 or sys.argv[1] == "serve":
        server.mcp.run()
    else:
        with open(sys.argv[1]) as f:
            run(json.load(f))


if __name__ == "__main__":
    main()
