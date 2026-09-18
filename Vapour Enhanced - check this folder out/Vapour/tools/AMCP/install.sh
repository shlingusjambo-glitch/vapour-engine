#!/bin/sh
# One-time setup. Works from any directory the folder is moved to.
set -e
cd "$(dirname "$0")"
PY=$(command -v python3.12 || command -v python3.11 || command -v python3.10 || command -v python3)
"$PY" -m venv .venv
.venv/bin/pip install -q -e .
.venv/bin/python test_amcp.py
echo
echo "AMCP installed at $(pwd)"
echo "Register the MCP server with Claude Code:"
echo "  claude mcp add amcp -- $(pwd)/.venv/bin/amcp serve"
echo "Or add to any MCP client config:"
echo "  {\"mcpServers\": {\"amcp\": {\"command\": \"$(pwd)/.venv/bin/amcp\", \"args\": [\"serve\"]}}}"
