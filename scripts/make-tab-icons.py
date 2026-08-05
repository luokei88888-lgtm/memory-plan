from PIL import Image, ImageDraw
import os

out = r'D:\work\project\memory-plan\miniprogram\assets'
os.makedirs(out, exist_ok=True)
size = 162


def make(name, draw_fn, active=False):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    color = (47, 111, 106, 255) if active else (154, 168, 180, 255)
    draw_fn(d, color)
    img.save(os.path.join(out, name))


def home(d, c):
    d.polygon([(40, 78), (81, 42), (122, 78), (122, 128), (40, 128)], outline=c, width=8)
    d.rectangle([68, 96, 94, 128], outline=c, width=7)


def chat(d, c):
    d.rounded_rectangle([36, 42, 126, 110], radius=22, outline=c, width=8)
    d.polygon([(54, 110), (54, 136), (78, 110)], fill=c)


def me(d, c):
    d.ellipse([58, 36, 104, 82], outline=c, width=8)
    d.arc([40, 88, 122, 150], 200, 340, fill=c, width=8)


for n, fn in [('tab-home', home), ('tab-chat', chat), ('tab-me', me)]:
    make(f'{n}.png', fn, False)
    make(f'{n}-active.png', fn, True)

print('icons done')
