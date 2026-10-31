"""Generate PWA icons (PNG) from the PayMesh mesh mark. Run: npm run icons  (needs Pillow)."""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
NAVY, TEAL, BLUE, LINE, WHITE = (20, 43, 74), (20, 184, 166), (37, 99, 235), (127, 166, 245), (255, 255, 255)
N = {"tl": (9, 10.5), "tr": (23, 10.5), "bl": (9, 21.5), "br": (23, 21.5), "c": (16, 16), "t": (16, 7), "b": (16, 25)}
EDGES = [("tl", "t"), ("t", "tr"), ("tl", "bl"), ("tr", "br"), ("bl", "b"), ("b", "br"), ("tl", "br"), ("tr", "bl")]


def draw(size: int, maskable: bool) -> Image.Image:
    ss = 4
    S = size * ss
    img = Image.new("RGBA", (S, S), NAVY + (255,) if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not maskable:
        d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.25), fill=NAVY + (255,))
    scale = (0.56 if maskable else 0.78) * S / 32  # maskable keeps the mark inside the 80% safe zone
    off = (S - 32 * scale) / 2
    p = lambda k: (off + N[k][0] * scale, off + N[k][1] * scale)  # noqa: E731
    for a, b in EDGES:
        d.line([p(a), p(b)], fill=LINE + (200,), width=max(2, int(1.6 * scale)))
    r = 2.7 * scale
    for k, col in (("tl", WHITE), ("tr", WHITE), ("bl", WHITE), ("br", TEAL)):
        x, y = p(k); d.ellipse((x - r, y - r, x + r, y + r), fill=col + (255,))
    x, y = p("c"); rc = 2.4 * scale
    d.ellipse((x - rc, y - rc, x + rc, y + rc), fill=BLUE + (255,), outline=WHITE + (255,), width=max(2, int(1.2 * scale)))
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
draw(192, False).save(OUT / "icon-192.png")
draw(512, False).save(OUT / "icon-512.png")
draw(512, True).save(OUT / "icon-maskable-512.png")
draw(180, True).convert("RGB").save(OUT / "apple-touch-icon.png")
print("icons written to", OUT)
