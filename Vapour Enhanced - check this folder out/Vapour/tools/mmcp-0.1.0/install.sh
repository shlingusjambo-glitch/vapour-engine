#!/bin/sh
# One-shot setup: python venv + deps + fluidsynth + soundfont (if missing). Run from the MMCP folder.
set -e
cd "$(dirname "$0")"
PY=$(command -v python3.12 || command -v python3.11 || command -v python3.10 || command -v python3)
$PY -c 'import sys; assert sys.version_info >= (3,10), "need Python >= 3.10"'
[ -d .venv ] || $PY -m venv .venv
.venv/bin/pip install -q -e .
if ! command -v fluidsynth >/dev/null; then
  if command -v brew >/dev/null; then brew install fluid-synth
  elif command -v apt-get >/dev/null; then sudo apt-get install -y fluidsynth
  else echo "install fluidsynth manually: https://www.fluidsynth.org"; exit 1; fi
fi
SF=soundfonts/MuseScore_General.sf2
[ -f "$SF" ] || { mkdir -p soundfonts; curl -L -o "$SF" https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf2; }
.venv/bin/python test_mmcp.py
echo
echo "MMCP ready."
echo "  MCP server : $(pwd)/.venv/bin/python -m mmcp serve"
echo "  CLI        : .venv/bin/mmcp render spec.json out.wav"
echo "  Python     : import mmcp; mmcp.render_to_file(spec, 'out.wav')"
