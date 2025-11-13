import io
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False
try:
    import PIL.Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def img_to_npy_bytes(img: np.ndarray):
    if not HAS_NUMPY:
        raise ImportError("NumPy is not installed.")
    buffer = io.BytesIO()
    np.save(buffer, img)
    img_bytes = buffer.getvalue()
    return img_bytes


def img_to_png_bytes(img: np.ndarray):
    if not HAS_PIL:
        raise ImportError("PIL (Pillow) is not installed.")
    pil_img = PIL.Image.fromarray(img)
    buffer = io.BytesIO()
    pil_img.save(buffer, format="PNG")
    img_bytes = buffer.getvalue()
    return img_bytes
