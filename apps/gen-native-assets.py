#!/usr/bin/env python3
"""
Generate native (iOS/Android) app assets for the three PassWaala native apps.
Produces, per app, under apps/<app>/assets/:
  - icon.png          1024x1024  full-bleed brand square + white "P" + accent dot
  - adaptive-icon.png 1024x1024  transparent bg, centered logo inside the Android
                                 adaptive-icon safe zone (~66%); paired with
                                 android.adaptiveIcon.backgroundColor = brand bg
  - splash.png        1284x2778  brand bg + centered white "P" (portrait splash)

Reuses the brand palette + "P + accent dot" mark from apps/gen-icons.py.
Pillow only.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = "/Users/c5354358/passwala/apps"
FONT_PATH = "/System/Library/Fonts/HelveticaNeue.ttc"

# app dir -> (background hex, accent-dot hex)
APPS = {
    "customer-app":   ("#0B7A4B", "#F59E0B"),
    "shopkeeper-app": ("#3F51D6", "#FFFFFF"),
    "rider-app":      ("#F2711C", "#FFFFFF"),
}


def hx(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def load_font(px):
    try:
        return ImageFont.truetype(FONT_PATH, px, index=0)
    except Exception:
        return ImageFont.load_default()


def draw_mark(img, size, fg, accent, dot=True):
    """Draw a centered bold white 'P' + a small accent dot, scaled to `size`."""
    d = ImageDraw.Draw(img)
    font = load_font(int(size * 0.62))
    text = "P"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1]
    d.text((x, y), text, font=font, fill=fg)
    if dot:
        r = max(6, int(size * 0.055))
        cx = x + tw + int(size * 0.02)
        cy = y + int(size * 0.10)
        d.ellipse([cx, cy, cx + 2 * r, cy + 2 * r], fill=accent)


def gen_icon(path, bg, accent):
    size = 1024
    img = Image.new("RGBA", (size, size), hx(bg) + (255,))
    draw_mark(img, size, (255, 255, 255, 255), hx(accent) + (255,))
    img.save(path)


def gen_adaptive(path, accent):
    # Transparent full canvas; logo confined to the center ~66% safe zone.
    size = 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    safe = int(size * 0.66)
    layer = Image.new("RGBA", (safe, safe), (0, 0, 0, 0))
    draw_mark(layer, safe, (255, 255, 255, 255), hx(accent) + (255,))
    img.paste(layer, ((size - safe) // 2, (size - safe) // 2), layer)
    img.save(path)


def gen_splash(path, bg, accent):
    w, h = 1284, 2778
    img = Image.new("RGBA", (w, h), hx(bg) + (255,))
    logo = int(w * 0.42)
    layer = Image.new("RGBA", (logo, logo), (0, 0, 0, 0))
    draw_mark(layer, logo, (255, 255, 255, 255), hx(accent) + (255,))
    img.paste(layer, ((w - logo) // 2, (h - logo) // 2), layer)
    img.save(path)


for app, (bg, accent) in APPS.items():
    assets = os.path.join(ROOT, app, "assets")
    os.makedirs(assets, exist_ok=True)
    gen_icon(os.path.join(assets, "icon.png"), bg, accent)
    gen_adaptive(os.path.join(assets, "adaptive-icon.png"), accent)
    gen_splash(os.path.join(assets, "splash.png"), bg, accent)
    print(f"{app}: icon.png, adaptive-icon.png, splash.png -> {assets}")

print("done")
