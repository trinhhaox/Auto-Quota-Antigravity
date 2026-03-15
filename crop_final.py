import sys
import os
from PIL import Image, ImageDraw

def process(in_path, out_path):
    img = Image.open(in_path).convert("RGBA")
    w, h = img.size
    
    # We will crop exactly the central portion. Through manual tuning for AI icons,
    # the glowing circle is usually the central ~90% of the image.
    # The image is 1024x1024. The gauge seems to take up from x=70 to x=954.
    # We will calculate a dynamic crop percentage based on the circle boundaries.
    
    data = img.load()
    cx, cy = w // 2, h // 2
    
    # Let's find the circle bounds from center outwards looking at the alpha or color
    # Actually, let's just use a hardcoded 8% margin based on visual inspection
    margin = int(w * float(sys.argv[3])) if len(sys.argv) > 3 else int(w * 0.06)
    left, top, right, bottom = margin, margin, w - margin, h - margin
    
    # crop it
    cropped = img.crop((left, top, right, bottom))
    
    final_size = 512
    # Apply anti-aliased circular mask the size of the whole image
    mask = Image.new('L', (final_size * 4, final_size * 4), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, final_size * 4, final_size * 4), fill=255)
    mask = mask.resize((final_size, final_size), Image.Resampling.LANCZOS)
    
    # Create final result
    cropped = cropped.resize((final_size, final_size), Image.Resampling.LANCZOS)
    result = Image.new("RGBA", (final_size, final_size), (0,0,0,0))
    result.paste(cropped, (0, 0), mask)
    
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    result.save(out_path, "PNG")
    
    # Copy to original icon.png to avoid VSCode caching issue too
    result.save(os.path.join(os.path.dirname(out_path), '..', 'icon.png'), "PNG")
    print("Done")

if __name__ == "__main__":
    process(sys.argv[1], sys.argv[2])
