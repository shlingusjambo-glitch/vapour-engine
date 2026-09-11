"""Fetch pinned CC0 field recordings; validate hash before replacing a local asset."""
import hashlib
import json
import pathlib
import urllib.request

root = pathlib.Path(__file__).resolve().parents[2]
asset_dir = root / 'examples/coastal-city/public/assets/audio'
sources = json.loads((asset_dir / 'sources.json').read_text())
for asset in sources['assets']:
    target = asset_dir / asset['file']
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == asset['sha256']:
        print('verified', asset['file'])
        continue
    request = urllib.request.Request(asset['downloadUrl'], headers={'User-Agent': 'VapourAssetBuilder/1.0'})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    digest = hashlib.sha256(data).hexdigest()
    if len(data) != asset['bytes'] or digest != asset['sha256']:
        raise RuntimeError(f"{asset['file']}: source changed; review source/license and checksum before accepting")
    temporary = target.with_suffix('.download')
    temporary.write_bytes(data)
    temporary.replace(target)
    print('downloaded and verified', asset['file'])
