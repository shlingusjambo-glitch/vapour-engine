"""Smallest check that fails if the pipeline breaks: python test_amcp.py"""
from amcp import server as s

d = s.new_document(64, 64)
s.add_layer(d, "a")
s.draw_path(d, "a", "M 8 8 L 56 8 L 56 56 L 8 56 Z", fill="#ff0000")
s.add_layer(d, "b", blend="multiply")
s.soft_shade(d, "b", "M 0 32 L 64 32 L 64 64 L 0 64 Z", "#0000ff", softness=2, clip="a")
img = s._flatten(d)
assert img.getpixel((32, 16)) == (255, 0, 0, 255), img.getpixel((32, 16))
assert img.getpixel((32, 50))[:3] == (0, 0, 0), "multiply red*blue should be black"
assert img.getpixel((2, 50))[3] == 0, "clip must keep shading off transparent area"
assert 0 < s._mask_from_path(64, 64, "M 10.5 10 L 30.5 10 L 30.5 30 L 10.5 30 Z").getpixel((10, 20)) < 255, "edge should be anti-aliased"
print("ok")

d = s.new_document(16, 16, pixel_art=True)
s.add_layer(d, "a")
s.draw_ellipse(d, "a", 8, 8, 6, 6, fill="#ff0000")
assert set(s._layer(d, "a")["img"].getchannel("A").getdata()) <= {0, 255}, "pixel_art must be crisp"
print("pixel ok")
