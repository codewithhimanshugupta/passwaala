#!/usr/bin/env python3
"""
Generate per-app PWA home-screen icons in each app's own brand colour, so the
four PassWaala apps are visually distinct once installed on a phone.

Each icon = a solid brand-colour square + a bold white "P" + a small accent dot.
Renders real PNGs (manifest points to PNGs) at the sizes the manifest/index use:
  icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png (180), favicon.png (48).
Also rewrites the matching SVGs so the vector source stays in sync.

Uses only Pillow (PIL) + a system font — no external SVG rasterizer needed.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = "/Users/c5354358/passwala/apps"
FONT_PATH = "/System/Library/Fonts/HelveticaNeue.ttc"

# app dir -> (background hex, accent-dot hex, label for logs)
APPS = {
    "customer-app":  ("#0B7A4B", "#F59E0B", "Customer (green + saffron)"),
    "shopkeeper-app":("#3F51D6", "#FFFFFF", "Shopkeeper (indigo)"),
    "rider-app":     ("#F2711C", "#FFFFFF", "Rider (orange)"),
    "admin":         ("#1E293B", "#2563EB", "Admin (navy + blue)"),
}

# PNG outputs: filename -> pixel size
PNG_SIZES = {
    "icons/icon-192.png": 192,
    "icons/icon-512.png": 512,
    "icons/apple-touch-icon.png": 180,
    "favicon.png": 48,
}


def hx(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def render_png(path, size, bg, accent, rounded):
    # Supersample 4x for crisp edges, then downscale.
    ss = 4
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        radius = int(S * 0.23)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=hx(bg))
    else:
        d.rectangle([0, 0, S, S], fill=hx(bg))

    # Bold "P" centred; font sized to ~62% of the icon.
    font = ImageFont.truetype(FONT_PATH, int(S * 0.62), index=0)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", int(S * 0.62), index=8)  # bold face
    except Exception:
        pass
    tb = d.textbbox((0, 0), "P", font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    tx = (S - tw) / 2 - tb[0]
    ty = (S - th) / 2 - tb[1]
    d.text((tx, ty), "P", font=font, fill=hx("#FFFFFF"))

    # Accent dot upper-right (skip when accent is white on a dark letter area).
    dot_r = int(S * 0.058)
    cx, cy = int(S * 0.62), int(S * 0.30)
    d.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=hx(accent))

    img = img.resize((size, size), Image.LANCZOS)
    img.save(path)


def write_svg(path, viewport, bg, accent, rounded):
    v = viewport
    rx = f' rx="{int(v*0.23)}"' if rounded else ""
    dot_r = v * 0.058
    cx, cy = v * 0.62, v * 0.30
    font_size = int(v * 0.62)
    baseline = v * 0.70
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {v} {v}" width="{v}" height="{v}">
  <rect width="{v}" height="{v}"{rx} fill="{bg}"/>
  <text x="{v/2:.0f}" y="{baseline:.0f}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="{font_size}" font-weight="900" fill="#FFFFFF" letter-spacing="-{int(v*0.02)}">P</text>
  <circle cx="{cx:.0f}" cy="{cy:.0f}" r="{dot_r:.0f}" fill="{accent}"/>
</svg>
'''
    with open(path, "w") as f:
        f.write(svg)


for app, (bg, accent, label) in APPS.items():
    base = os.path.join(ROOT, app, "public")
    if not os.path.isdir(base):
        print(f"SKIP {app}: no public dir")
        continue
    os.makedirs(os.path.join(base, "icons"), exist_ok=True)
    for rel, size in PNG_SIZES.items():
        rounded = rel == "favicon.png"  # favicon rounded, home-screen icons full-bleed
        render_png(os.path.join(base, rel), size, bg, accent, rounded)
    # SVG sources (full-bleed 192/512, rounded 48 favicon)
    write_svg(os.path.join(base, "icons/icon-192.svg"), 192, bg, accent, False)
    write_svg(os.path.join(base, "icons/icon-512.svg"), 512, bg, accent, False)
    write_svg(os.path.join(base, "favicon.svg"), 48, bg, accent, True)
    print(f"OK {app}: {label}")

print("done")
