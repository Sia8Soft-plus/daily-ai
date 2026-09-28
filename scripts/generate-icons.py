from pathlib import Path
from PIL import Image, ImageDraw
import io
import struct

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

def render(size):
    scale = size * 4 / 512
    image = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(tuple(round(v * scale) for v in (16, 16, 496, 496)), radius=round(140 * scale), fill="#272521")
    draw.polygon([(round(x * scale), round(y * scale)) for x, y in [(116, 320), (216, 96), (260, 236), (396, 164), (240, 416), (196, 278)]], fill="#f8f5ee")
    return image.resize((size, size), Image.Resampling.LANCZOS)

render(1024).save(ASSETS / "icon.png", optimize=True)
# Each frame is drawn at its own resolution, including common Windows DPI scales.
sizes = [16, 20, 24, 28, 32, 40, 48, 64, 96, 128, 256]
frames = []
for size in sizes:
    buffer = io.BytesIO()
    render(size).save(buffer, format="PNG", optimize=True)
    frames.append(buffer.getvalue())
offset = 6 + 16 * len(sizes)
entries = []
for size, frame in zip(sizes, frames):
    entries.append(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(frame), offset))
    offset += len(frame)
(ASSETS / "icon.ico").write_bytes(struct.pack("<HHH", 0, 1, len(sizes)) + b"".join(entries) + b"".join(frames))
