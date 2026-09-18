"""AMCP — Art Model Context Protocol. A layered 2D canvas LLMs can actually paint on."""
from __future__ import annotations

import io
import re
import uuid

import numpy as np
from mcp.server.mcpserver import Image, MCPServer
from PIL import Image as PImage, ImageChops, ImageColor, ImageDraw, ImageFilter

INSTRUCTIONS = """AMCP is a layered art canvas. You are the artist; the output must match the user's goal exactly.
1. Call set_goal first: restate the exact subject, style, size and palette. Attach a reference image if the user gave one.
2. Plan the whole piece before drawing: list every part back-to-front with coordinates. Then draw it all.
3. Use draw_path with smooth C curves for organic shapes, `repeat` for rows of things, clip= for shading.
4. Call render ONCE when done, check it against the goal checklist, fix only real defects, export.
Pixel art: new_document(pixel_art=True) makes every op crisp; draw shapes with paths, not hand grids."""
mcp = MCPServer("amcp", instructions=INSTRUCTIONS)
SS = 4  # supersample factor for anti-aliasing; ponytail: global constant, per-op arg if perf matters

DOCS: dict[str, dict] = {}


# ---------- helpers ----------
def _doc(doc_id):
    if doc_id not in DOCS:
        raise ValueError(f"unknown doc {doc_id}")
    return DOCS[doc_id]


def _layer(doc_id, name):
    for l in _doc(doc_id)["layers"]:
        if l["name"] == name:
            return l
    raise ValueError(f"unknown layer {name!r}; have {[l['name'] for l in _doc(doc_id)['layers']]}")


def _rgba(c):
    if c is None:
        return None
    r, g, b, *a = ImageColor.getcolor(c, "RGBA")
    return (r, g, b, a[0] if a else 255)


_TOK = re.compile(r"[MLCQZmlcqz]|-?\d*\.?\d+(?:e-?\d+)?")


def _flatten_path(d, scale=1.0, steps=24):
    """SVG-subset path (M L C Q Z, absolute or relative) -> list of polygons (point lists)."""
    toks = _TOK.findall(d)
    polys, cur, pos, start = [], [], (0.0, 0.0), (0.0, 0.0)
    i, cmd = 0, None

    def nums(n):
        nonlocal i
        v = [float(t) for t in toks[i : i + n]]
        i += n
        return v

    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            if cmd in "Zz":
                if cur:
                    polys.append(cur)
                cur, pos = [], start
                continue
        rel = cmd.islower()
        c = cmd.upper()
        if c == "M":
            x, y = nums(2)
            if rel:
                x, y = pos[0] + x, pos[1] + y
            if cur:
                polys.append(cur)
            cur, pos, start = [(x, y)], (x, y), (x, y)
            cmd = "l" if rel else "L"
        elif c == "L":
            x, y = nums(2)
            if rel:
                x, y = pos[0] + x, pos[1] + y
            cur.append((x, y))
            pos = (x, y)
        elif c in "CQ":
            n = 6 if c == "C" else 4
            p = nums(n)
            if rel:
                p = [p[k] + pos[k % 2] for k in range(n)]
            pts = [pos] + [(p[k], p[k + 1]) for k in range(0, n, 2)]
            for s in range(1, steps + 1):
                u = s / steps
                if c == "C":
                    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = pts
                    v = 1 - u
                    x = v**3 * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u**3 * x3
                    y = v**3 * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u**3 * y3
                else:
                    (x0, y0), (x1, y1), (x2, y2) = pts
                    v = 1 - u
                    x = v * v * x0 + 2 * v * u * x1 + u * u * x2
                    y = v * v * y0 + 2 * v * u * y1 + u * u * y2
                cur.append((x, y))
            pos = pts[-1]
        else:
            raise ValueError(f"unsupported path command {cmd}")
    if cur:
        polys.append(cur)
    return [[(x * scale, y * scale) for x, y in p] for p in polys]


def _mask_from_path(w, h, path, stroke_width=0, fill=True, crisp=False):
    """Anti-aliased L mask (doc resolution) from a path. fill=False -> stroke outline only. crisp: no AA."""
    m = PImage.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(m)
    for poly in _flatten_path(path, SS):
        if fill and len(poly) >= 3:
            d.polygon(poly, fill=255)
        if stroke_width > 0 and len(poly) >= 2:
            d.line(poly, fill=255, width=max(1, round(stroke_width * SS)), joint="curve")
            r = stroke_width * SS / 2
            for x, y in (poly[0], poly[-1]):  # round caps
                d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    m = m.resize((w, h), PImage.LANCZOS)
    return m.point(lambda v: 255 if v >= 128 else 0) if crisp else m


def _gradient(w, h, g):
    """g = {"type":"linear"|"radial", "from":[x,y], "to":[x,y], "stops":[[t,color],...]}"""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    x0, y0 = g["from"]
    x1, y1 = g["to"]
    dx, dy = x1 - x0, y1 - y0
    if g.get("type", "linear") == "radial":
        t = np.hypot(xs - x0, ys - y0) / max(np.hypot(dx, dy), 1e-6)
    else:
        t = ((xs - x0) * dx + (ys - y0) * dy) / max(dx * dx + dy * dy, 1e-6)
    t = np.clip(t, 0, 1)
    stops = sorted((float(s), np.array(_rgba(c), np.float32)) for s, c in g["stops"])
    out = np.zeros((h, w, 4), np.float32)
    ts = [s for s, _ in stops]
    for ch in range(4):
        out[..., ch] = np.interp(t, ts, [c[ch] for _, c in stops])
    return PImage.fromarray(out.astype(np.uint8), "RGBA")


def _paint(layer, mask, color=None, gradient=None, clip=None, doc=None):
    """Composite a colour/gradient through `mask` onto layer (RGBA). clip = layer name whose alpha clips."""
    w, h = layer["img"].size
    if clip:
        mask = ImageChops.multiply(mask, _layer(doc, clip)["img"].getchannel("A"))
    src = _gradient(w, h, gradient) if gradient else PImage.new("RGBA", (w, h), _rgba(color))
    src.putalpha(ImageChops.multiply(src.getchannel("A"), mask))
    layer["img"] = PImage.alpha_composite(layer["img"], src)


def _blend(base, top, mode, opacity):
    b = np.asarray(base, np.float32) / 255
    t = np.asarray(top, np.float32) / 255
    a = t[..., 3:4] * opacity
    bc, tc = b[..., :3], t[..., :3]
    if mode == "multiply":
        c = bc * tc
    elif mode == "screen":
        c = 1 - (1 - bc) * (1 - tc)
    elif mode == "overlay":
        c = np.where(bc < 0.5, 2 * bc * tc, 1 - 2 * (1 - bc) * (1 - tc))
    elif mode == "add":
        c = np.clip(bc + tc, 0, 1)
    else:
        c = tc
    out_a = a + b[..., 3:4] * (1 - a)
    out_c = (c * a + bc * b[..., 3:4] * (1 - a)) / np.maximum(out_a, 1e-6)
    return PImage.fromarray((np.dstack([out_c, out_a]) * 255).astype(np.uint8), "RGBA")


def _flatten(doc_id):
    d = _doc(doc_id)
    out = PImage.new("RGBA", (d["w"], d["h"]), (0, 0, 0, 0))
    for l in d["layers"]:
        if l["visible"]:
            out = _blend(out, l["img"], l["blend"], l["opacity"])
    return out


def _png(img):
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


# ---------- tools ----------
@mcp.tool()
def new_document(width: int, height: int, background: str | None = None, pixel_art: bool = False) -> str:
    """Create a canvas. Returns doc_id. background: CSS colour or None for transparent.
    Coordinates everywhere are in document pixels, origin top-left, y down.
    pixel_art=True: small canvas (e.g. 64x64), every op renders crisp with no anti-aliasing, export with
    integer scale. Draw shapes with paths/ellipses as usual — do not hand-type pixel grids."""
    doc_id = uuid.uuid4().hex[:8]
    DOCS[doc_id] = {"w": width, "h": height, "layers": [], "pixel": pixel_art, "goal": "", "ref": None}
    if background:
        add_layer(doc_id, "background")
        _layer(doc_id, "background")["img"] = PImage.new("RGBA", (width, height), _rgba(background))
    return doc_id


@mcp.tool()
def set_goal(doc_id: str, goal: str, reference_image: str | None = None) -> str:
    """Lock in what this image must be (subject, style, composition, palette). Echoed back on every
    render so you never drift. reference_image: path to an image to match — shown beside your render."""
    d = _doc(doc_id)
    d["goal"] = goal
    if reference_image:
        d["ref"] = PImage.open(reference_image).convert("RGBA")
    return "goal set. Now plan every part back-to-front with coordinates, then draw all of it before rendering."


def _goal_text(d):
    if not d["goal"]:
        return ""
    return (f"\nGOAL: {d['goal']}\nCHECK: silhouette reads at a glance? proportions match the goal/reference? "
            "palette and lighting consistent? nothing missing from the goal? Fix real defects only, then export.")


@mcp.tool()
def add_layer(doc_id: str, name: str, opacity: float = 1.0, blend: str = "normal") -> str:
    """Add a transparent layer on top. blend: normal|multiply|screen|overlay|add."""
    d = _doc(doc_id)
    d["layers"].append({"name": name, "img": PImage.new("RGBA", (d["w"], d["h"]), (0, 0, 0, 0)),
                        "opacity": opacity, "blend": blend, "visible": True})
    return f"layer {name!r} added (index {len(d['layers']) - 1})"


@mcp.tool()
def set_layer(doc_id: str, name: str, opacity: float | None = None, blend: str | None = None,
              visible: bool | None = None, move_to: int | None = None, rename: str | None = None) -> str:
    """Change layer properties or z-order (move_to = new index, 0 = bottom)."""
    d = _doc(doc_id)
    l = _layer(doc_id, name)
    if opacity is not None: l["opacity"] = opacity
    if blend is not None: l["blend"] = blend
    if visible is not None: l["visible"] = visible
    if rename: l["name"] = rename
    if move_to is not None:
        d["layers"].remove(l)
        d["layers"].insert(move_to, l)
    return list_layers(doc_id)


@mcp.tool()
def list_layers(doc_id: str) -> str:
    d = _doc(doc_id)
    return "\n".join(f"{i}: {l['name']} opacity={l['opacity']} blend={l['blend']} visible={l['visible']}"
                     for i, l in enumerate(d["layers"])) or "(no layers)"


@mcp.tool()
def draw_path(doc_id: str, layer: str, path: str, fill: str | None = None, stroke: str | None = None,
              stroke_width: float = 0, gradient: dict | None = None, clip: str | None = None,
              repeat: list | None = None) -> str:
    """Draw an SVG path (M L C Q Z, absolute or relative) with anti-aliasing.
    fill: CSS colour. gradient: {"type":"linear"|"radial","from":[x,y],"to":[x,y],"stops":[[0,"#f00"],[1,"#00f"]]}
    (used as fill instead of a flat colour). stroke/stroke_width draw the outline with round caps/joins.
    clip: name of another layer — paint only where that layer is opaque (clipping mask, e.g. shading
    a 'skin' layer without spilling). Use smooth C curves for organic shapes, not polylines.
    repeat: [count, dx, dy, scale_step] draws the path count times, shifting by (dx,dy) and multiplying
    size by scale_step each time (about the path's first point) — rows of desks, windows, tiles, fences."""
    l = _layer(doc_id, layer)
    w, h = l["img"].size
    crisp = _doc(doc_id)["pixel"]
    for pth in _repeat(path, repeat):
        if fill or gradient:
            _paint(l, _mask_from_path(w, h, pth, crisp=crisp), fill, gradient, clip, doc_id)
        if stroke and stroke_width > 0:
            _paint(l, _mask_from_path(w, h, pth, stroke_width, fill=False, crisp=crisp), stroke, None, clip, doc_id)
    return "ok"


def _repeat(path, repeat):
    if not repeat:
        return [path]
    count, dx, dy, *rest = repeat
    k = rest[0] if rest else 1.0
    nums = [float(t) for t in _TOK.findall(path) if not t.isalpha()]
    ox, oy = nums[0], nums[1]
    out, sc = [], 1.0
    for n in range(int(count)):
        i = -1
        def sub(m):
            nonlocal i
            if m.group(0).isalpha():
                return m.group(0)
            i += 1
            v = float(m.group(0))
            if m.group(0).lower() in "z":
                return m.group(0)
            return f"{(v - (ox if i % 2 == 0 else oy)) * sc + (ox if i % 2 == 0 else oy) + (dx if i % 2 == 0 else dy) * n:.3f}"
        out.append(_TOK.sub(sub, path))
        sc *= k
    return out


@mcp.tool()
def draw_ellipse(doc_id: str, layer: str, cx: float, cy: float, rx: float, ry: float,
                 fill: str | None = None, stroke: str | None = None, stroke_width: float = 0,
                 rotation: float = 0, gradient: dict | None = None, clip: str | None = None,
                 repeat: list | None = None) -> str:
    """Ellipse centred at (cx,cy). rotation in degrees. gradient/repeat as in draw_path."""
    import math
    k = 0.5523  # bezier circle constant
    pts = [(rx, 0), (rx, ry * k), (rx * k, ry), (0, ry), (-rx * k, ry), (-rx, ry * k), (-rx, 0),
           (-rx, -ry * k), (-rx * k, -ry), (0, -ry), (rx * k, -ry), (rx, -ry * k), (rx, 0)]
    a = math.radians(rotation)
    rot = [(cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)) for x, y in pts]
    p = f"M {rot[0][0]} {rot[0][1]} " + " ".join(
        f"C {rot[i][0]} {rot[i][1]} {rot[i+1][0]} {rot[i+1][1]} {rot[i+2][0]} {rot[i+2][1]}"
        for i in range(1, 12, 3)) + " Z"
    return draw_path(doc_id, layer, p, fill, stroke, stroke_width, gradient, clip, repeat)


@mcp.tool()
def draw_poly3d(doc_id: str, layer: str, points: list, fill: str | None = None, stroke: str | None = None,
                stroke_width: float = 0, gradient: dict | None = None, camera: dict | None = None) -> str:
    """Backgrounds/rooms/props with correct one-point perspective, no math. points = [[x,y,z],...] in metres:
    x right, y up (floor = 0), z into the scene. camera = {"focal": 720, "height": 1.45, "z": -1.2,
    "horizon": 0.47} (defaults shown; horizon = fraction of canvas height). A room is 5 quads
    (floor, ceiling, walls); a desk is a top quad + front quad + 4 thin leg quads."""
    d = _doc(doc_id)
    c = {"focal": 720, "height": 1.45, "z": -1.2, "horizon": 0.47, **(camera or {})}

    def P(x, y, z):
        k = c["focal"] / (z - c["z"])
        return d["w"] / 2 + x * k, d["h"] * c["horizon"] - (y - c["height"]) * k

    path = "M " + " L ".join("%.1f %.1f" % P(*pt) for pt in points) + " Z"
    return draw_path(doc_id, layer, path, fill, stroke, stroke_width, gradient)


@mcp.tool()
def soft_shade(doc_id: str, layer: str, path: str, color: str, softness: float = 12,
               clip: str | None = None, opacity: float = 1.0) -> str:
    """Airbrush: fill a path then blur its edges by `softness` px. Use with clip= for shading/blush/
    highlights that stay inside a shape. Put shading on a 'multiply' layer for natural darkening."""
    l = _layer(doc_id, layer)
    w, h = l["img"].size
    m = _mask_from_path(w, h, path).filter(ImageFilter.GaussianBlur(softness))
    if _doc(doc_id)["pixel"]:  # pixel art: dither-free 2-tone shading instead of blur
        m = m.point(lambda v: 255 if v >= 128 else 0)
    if opacity < 1:
        m = m.point(lambda v: int(v * opacity))
    _paint(l, m, color, None, clip, doc_id)
    return "ok"


@mcp.tool()
def fill_layer(doc_id: str, layer: str, color: str | None = None, gradient: dict | None = None,
               clip: str | None = None) -> str:
    """Fill whole layer with a colour or gradient (optionally clipped to another layer's alpha)."""
    l = _layer(doc_id, layer)
    w, h = l["img"].size
    _paint(l, PImage.new("L", (w, h), 255), color, gradient, clip, doc_id)
    return "ok"


@mcp.tool()
def filter_layer(doc_id: str, layer: str, blur: float = 0, noise: float = 0, seed: int = 0) -> str:
    """Post-process a layer: gaussian blur (px) and/or monochrome noise (0-1 strength, alpha-preserving)."""
    l = _layer(doc_id, layer)
    if blur > 0:
        l["img"] = l["img"].filter(ImageFilter.GaussianBlur(blur))
    if noise > 0:
        a = np.asarray(l["img"], np.float32)
        rng = np.random.default_rng(seed)
        n = rng.normal(0, 255 * noise, a.shape[:2] + (1,))
        a[..., :3] = np.clip(a[..., :3] + n, 0, 255)
        l["img"] = PImage.fromarray(a.astype(np.uint8), "RGBA")
    return "ok"


@mcp.tool()
def paint_pixels(doc_id: str, layer: str, rows: list[str], palette: dict, x: int = 0, y: int = 0) -> str:
    """Pixel art: paste a character grid at (x,y). rows = ["..KK..", ".KWWK."]; palette = {"K": "#000",
    "W": "#fff"}; "." (or any char not in palette) is transparent. Use a small document (e.g. 64x64) and
    export with scale=8 for crisp 8x pixels."""
    l = _layer(doc_id, layer)
    px = l["img"].load()
    w, h = l["img"].size
    cols = {k: _rgba(v) for k, v in palette.items()}
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch in cols and 0 <= x + i < w and 0 <= y + j < h:
                px[x + i, y + j] = cols[ch]
    return "ok"


@mcp.tool()
def render(doc_id: str, max_size: int = 768) -> list:
    """Look at the composite (with the reference image beside it, if set) plus the goal checklist.
    Draw the whole plan first, then render once and fix real defects only."""
    d = _doc(doc_id)
    img = _flatten(doc_id)
    if d["ref"] is not None:
        ref = d["ref"].resize((round(d["ref"].width * img.height / d["ref"].height), img.height), PImage.NEAREST)
        both = PImage.new("RGBA", (img.width + ref.width + 8, img.height), (40, 40, 40, 255))
        both.paste(img, (0, 0)); both.paste(ref, (img.width + 8, 0))
        img = both
    if d["pixel"] or img.width < max_size // 2:  # tiny (pixel-art) docs: upscale crisp so the model can see them
        k = max_size // img.width
        img = img.resize((img.width * k, img.height * k), PImage.NEAREST)
    img.thumbnail((max_size, max_size), PImage.LANCZOS)
    return [Image(data=_png(img), format="png"), "LEFT: your render" + (" | RIGHT: reference" if d["ref"] is not None else "") + _goal_text(d)]


@mcp.tool()
def export(doc_id: str, file_path: str, scale: float = 1.0) -> str:
    """Save the flattened PNG to disk. Integer scale > 1 uses nearest-neighbour (crisp pixel art)."""
    img = _flatten(doc_id)
    if scale != 1:
        crisp = scale > 1 and float(scale).is_integer()
        img = img.resize((round(img.width * scale), round(img.height * scale)),
                         PImage.NEAREST if crisp else PImage.LANCZOS)
    img.save(file_path)
    return f"saved {file_path} ({img.width}x{img.height})" + _goal_text(_doc(doc_id))


if __name__ == "__main__":
    mcp.run()
