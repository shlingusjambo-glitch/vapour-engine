"""CLI: python -m mmcp render spec.json out.wav | python -m mmcp analyze file.wav | python -m mmcp serve"""
import json
import sys


def main(argv=sys.argv[1:]):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return
    cmd, *rest = argv
    if cmd == "render":
        from .song import render_to_file
        spec = json.load(open(rest[0])) if rest[0] != "-" else json.load(sys.stdin)
        print(json.dumps(render_to_file(spec, rest[1]), indent=2))
    elif cmd == "analyze":
        from .server import analyze_wav
        print(json.dumps(analyze_wav(rest[0], float(rest[1]) if len(rest) > 1 else 120), indent=2))
    elif cmd == "serve":
        from .server import mcp
        mcp.run()
    elif cmd == "spec":
        from .server import SPEC_DOC
        print(SPEC_DOC)
    else:
        sys.exit(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
