"""DDLC-style classroom background, one-point perspective. Run: PYTHONPATH=. .venv/bin/python examples/classroom.py"""
from amcp import server as s

W, H = 1280, 720
F, CAM_Y, CAM_Z = 720, 1.45, -1.2  # focal px, camera height (m), camera z
RW, RH, RD = 4.2, 3.0, 11.0        # room half-width, height, depth


def P(x, y, z):
    """room metres -> screen px. x right, y up, z into the room."""
    k = F / (z - CAM_Z)
    return W / 2 + x * k, H * 0.47 - (y - CAM_Y) * k


def poly(*pts):
    return "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in pts) + " Z"


def quad3(a, b, c, d):
    return poly(P(*a), P(*b), P(*c), P(*d))


d = s.new_document(W, H, background="#f4ead9")
s.set_goal(d, "DDLC classroom: afternoon, windows on the left, rows of wooden desks, cream walls, warm light")

# --- room shell ---
s.add_layer(d, "room")
s.draw_path(d, "room", quad3((-RW, 0, 0), (RW, 0, 0), (RW, 0, RD), (-RW, 0, RD)),
            gradient={"from": [0, 720], "to": [0, 380], "stops": [[0, "#b8834f"], [1, "#d9a86f"]]})   # floor
s.draw_path(d, "room", quad3((-RW, RH, 0), (RW, RH, 0), (RW, RH, RD), (-RW, RH, RD)),
            gradient={"from": [0, 0], "to": [0, 300], "stops": [[0, "#fbf7ef"], [1, "#ece2d0"]]})     # ceiling
s.draw_path(d, "room", quad3((-RW, 0, 0), (-RW, RH, 0), (-RW, RH, RD), (-RW, 0, RD)), fill="#efe3cc")  # left wall
s.draw_path(d, "room", quad3((RW, 0, 0), (RW, RH, 0), (RW, RH, RD), (RW, 0, RD)), fill="#e6d8bf")     # right wall
s.draw_path(d, "room", quad3((-RW, 0, RD), (RW, 0, RD), (RW, RH, RD), (-RW, RH, RD)), fill="#f1e6d0")  # back wall
# wainscot + baseboards
for x in (-RW, RW):
    s.draw_path(d, "room", quad3((x, 0, 0), (x, 0.9, 0), (x, 0.9, RD), (x, 0, RD)), fill="#cfa877" if x < 0 else "#c49d6e")
    s.draw_path(d, "room", quad3((x, 0.9, 0), (x, 0.96, 0), (x, 0.96, RD), (x, 0.9, RD)), fill="#8b5e3c")
s.draw_path(d, "room", quad3((-RW, 0, RD), (RW, 0, RD), (RW, 0.9, RD), (-RW, 0.9, RD)), fill="#cfa877")
s.draw_path(d, "room", quad3((-RW, 0.9, RD), (RW, 0.9, RD), (RW, 0.96, RD), (-RW, 0.96, RD)), fill="#8b5e3c")
# floor planks (lines converging to VP)
for i in range(-8, 9):
    x = i * RW / 8
    s.draw_path(d, "room", "M %.1f %.1f L %.1f %.1f" % (*P(x, 0, 0), *P(x, 0, RD)), stroke="#a6753f", stroke_width=1.5)
for z in [0.6, 1.4, 2.4, 3.6, 5.0, 6.8, 9.0]:
    s.draw_path(d, "room", "M %.1f %.1f L %.1f %.1f" % (*P(-RW, 0, z), *P(RW, 0, z)), stroke="#a6753f", stroke_width=1)

# --- left windows ---
s.add_layer(d, "windows")
for z0 in (0.8, 3.6, 6.4):
    z1 = z0 + 2.2
    s.draw_path(d, "windows", quad3((-RW, 0.95, z0 - 0.12), (-RW, 2.7, z0 - 0.12), (-RW, 2.7, z1 + 0.12), (-RW, 0.95, z1 + 0.12)), fill="#ffffff")
    s.draw_path(d, "windows", quad3((-RW, 1.05, z0), (-RW, 2.6, z0), (-RW, 2.6, z1), (-RW, 1.05, z1)),
                gradient={"from": [0, 120], "to": [0, 480], "stops": [[0, "#7fc4f5"], [0.6, "#bfe4fb"], [1, "#eaf6fd"]]})
    zm, ym = (z0 + z1) / 2, 1.85
    s.draw_path(d, "windows", "M %.1f %.1f L %.1f %.1f" % (*P(-RW, 1.05, zm), *P(-RW, 2.6, zm)), stroke="#ffffff", stroke_width=5)
    s.draw_path(d, "windows", "M %.1f %.1f L %.1f %.1f" % (*P(-RW, ym, z0), *P(-RW, ym, z1)), stroke="#ffffff", stroke_width=5)
    s.draw_path(d, "windows", quad3((-RW, 0.9, z0 - 0.15), (-RW, 0.98, z0 - 0.15), (-RW, 0.98, z1 + 0.15), (-RW, 0.9, z1 + 0.15)), fill="#d9c9a8")  # sill
    # clouds
    cx, cy = P(-RW, 2.2, zm)
    s.draw_ellipse(d, "windows", cx - 12, cy + 10, 26, 12, fill="#ffffffcc")
    s.draw_ellipse(d, "windows", cx + 10, cy + 4, 20, 14, fill="#ffffffcc")

# --- back wall: chalkboard + door, right wall: notice board ---
s.add_layer(d, "furniture")
s.draw_path(d, "furniture", quad3((-2.6, 1.0, RD), (0.8, 1.0, RD), (0.8, 2.4, RD), (-2.6, 2.4, RD)), fill="#8b5e3c")
s.draw_path(d, "furniture", quad3((-2.5, 1.1, RD), (0.7, 1.1, RD), (0.7, 2.3, RD), (-2.5, 2.3, RD)), fill="#3f6b4f")
s.draw_path(d, "furniture", quad3((-2.5, 1.02, RD), (0.7, 1.02, RD), (0.7, 1.1, RD), (-2.5, 1.1, RD)), fill="#c9a46a")
s.draw_path(d, "furniture", quad3((1.6, 0, RD), (3.0, 0, RD), (3.0, 2.2, RD), (1.6, 2.2, RD)), fill="#a97a4a")   # door
s.draw_path(d, "furniture", quad3((1.75, 1.3, RD), (2.85, 1.3, RD), (2.85, 2.05, RD), (1.75, 2.05, RD)), fill="#cfe7f5")
s.draw_ellipse(d, "furniture", *P(2.8, 1.05, RD), 4, 4, fill="#e8d28a")
s.draw_path(d, "furniture", quad3((RW, 1.2, 3.0), (RW, 2.4, 3.0), (RW, 2.4, 6.0), (RW, 1.2, 6.0)), fill="#b98a5c")   # notice board
s.draw_path(d, "furniture", quad3((RW, 1.28, 3.1), (RW, 2.32, 3.1), (RW, 2.32, 5.9), (RW, 1.28, 5.9)), fill="#d9b48a")
for (y, z, c) in ((1.9, 3.4, "#ffffff"), (1.5, 4.1, "#ffe9a8"), (2.0, 4.8, "#ffffff"), (1.45, 5.3, "#cfe7f5")):
    s.draw_path(d, "furniture", quad3((RW, y, z), (RW, y + 0.35, z), (RW, y + 0.35, z + 0.45), (RW, y, z + 0.45)), fill=c)
# ceiling lights
for z in (2.5, 6.0, 9.5):
    s.draw_path(d, "furniture", quad3((-1.2, RH - 0.02, z), (1.2, RH - 0.02, z), (1.2, RH - 0.02, z + 1.2), (-1.2, RH - 0.02, z + 1.2)), fill="#fffdf2")

# --- desks: 3 columns x 4 rows, back row first ---
DW, DD, DH, LEGW = 0.62, 0.45, 0.72, 0.03
TOP, TOP_D, FRONT, LEG = "#d7a66a", "#b98550", "#8f6a45", "#5a5a60"
for z in (8.4, 6.4, 4.5, 2.7):
    for cx in (-2.4, -0.6, 1.2):
        x0, x1, z0, z1 = cx - DW / 2, cx + DW / 2, z, z + DD
        for lx, lz in ((x0 + 0.04, z0 + 0.04), (x1 - 0.04, z0 + 0.04), (x0 + 0.04, z1 - 0.04), (x1 - 0.04, z1 - 0.04)):
            s.draw_path(d, "furniture", quad3((lx - LEGW, 0, lz), (lx + LEGW, 0, lz), (lx + LEGW, DH - 0.04, lz), (lx - LEGW, DH - 0.04, lz)), fill=LEG)
        s.draw_path(d, "furniture", quad3((x0, DH - 0.06, z0), (x1, DH - 0.06, z0), (x1, DH, z0), (x0, DH, z0)), fill=FRONT)  # front edge
        s.draw_path(d, "furniture", quad3((x0, DH, z0), (x1, DH, z0), (x1, DH, z1), (x0, DH, z1)), fill=TOP)                    # top
        s.draw_path(d, "furniture", quad3((x0, DH, z0), (x1, DH, z0), (x1, DH, z0 + 0.03), (x0, DH, z0 + 0.03)), fill=TOP_D)
        # chair behind desk
        cz0, cz1 = z1 + 0.12, z1 + 0.5
        s.draw_path(d, "furniture", quad3((x0 + 0.1, 0.45, cz0), (x1 - 0.1, 0.45, cz0), (x1 - 0.1, 0.45, cz1), (x0 + 0.1, 0.45, cz1)), fill="#c48f5a")
        s.draw_path(d, "furniture", quad3((x0 + 0.1, 0.45, cz1), (x1 - 0.1, 0.45, cz1), (x1 - 0.1, 0.9, cz1), (x0 + 0.1, 0.9, cz1)), fill="#b07f4e")
        for lx in (x0 + 0.13, x1 - 0.13):
            s.draw_path(d, "furniture", quad3((lx - 0.02, 0, cz0), (lx + 0.02, 0, cz0), (lx + 0.02, 0.45, cz0), (lx - 0.02, 0.45, cz0)), fill=LEG)

# --- light & atmosphere ---
s.add_layer(d, "light", blend="screen", opacity=0.55)
s.soft_shade(d, "light", quad3((-RW, 0, 0), (0.5, 0, 0), (1.5, 0, RD), (-RW, 0, RD)), "#ffd9a0", softness=60)
s.add_layer(d, "shade", blend="multiply", opacity=0.35)
s.soft_shade(d, "shade", quad3((RW, 0, 0), (RW, RH, 0), (RW, RH, RD), (RW, 0, RD)), "#7d6a8e", softness=40)
s.soft_shade(d, "shade", "M 0 640 L 1280 640 L 1280 720 L 0 720 Z", "#8a6a4a", softness=40)
s.add_layer(d, "vignette", blend="multiply", opacity=0.25)
s.fill_layer(d, "vignette", gradient={"type": "radial", "from": [640, 360], "to": [1280, 720], "stops": [[0.55, "#ffffff"], [1, "#6a5a70"]]})

print(s.export(d, "examples/classroom.png"))
