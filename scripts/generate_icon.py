from PIL import Image, ImageDraw

ACCENT = (108, 92, 231)  # #6c5ce7
WHITE = (255, 255, 255)
KOALA_GREY = (158, 157, 170)
INNER_EAR = (224, 222, 233)
DARK = (58, 55, 70)


def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    corner = round(size * 0.22)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=corner, fill=ACCENT)

    cx, cy = size / 2, size * 0.53

    # Big round side ears - the defining koala trait
    ear_r = size * 0.24
    ear_dx = size * 0.32
    ear_dy = size * 0.04
    inner_r = ear_r * 0.5
    for sign in (-1, 1):
        ex, ey = cx + sign * ear_dx, cy - ear_dy
        draw.ellipse([ex - ear_r, ey - ear_r, ex + ear_r, ey + ear_r], fill=(235, 235, 240))
        draw.ellipse([ex - inner_r, ey - inner_r, ex + inner_r, ey + inner_r], fill=INNER_EAR)

    # Wide round head, overlapping the ears' inner edges
    head_rx = size * 0.28
    head_ry = size * 0.25
    draw.ellipse([cx - head_rx, cy - head_ry, cx + head_rx, cy + head_ry], fill=(235, 235, 240))

    # Eyes
    eye_r = size * 0.02
    eye_dx = size * 0.09
    eye_dy = size * 0.03
    for sign in (-1, 1):
        ex, ey = cx + sign * eye_dx, cy - eye_dy
        draw.ellipse([ex - eye_r, ey - eye_r, ex + eye_r, ey + eye_r], fill=DARK)

    # Big koala nose
    nose_w = size * 0.15
    nose_h = size * 0.10
    ny = cy + size * 0.09
    draw.rounded_rectangle(
        [cx - nose_w / 2, ny - nose_h / 2, cx + nose_w / 2, ny + nose_h / 2],
        radius=nose_h / 2,
        fill=DARK,
    )

    return img


for size in (192, 512):
    icon = make_icon(size)
    icon.save(rf"C:\Users\josep\coding projects\workout-tracker-app\icon-{size}.png")

print("done")
