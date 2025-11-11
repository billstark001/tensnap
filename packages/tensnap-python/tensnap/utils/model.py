import io
import numpy as np
import PIL.Image


def img_to_npy_bytes(img: np.ndarray):
    buffer = io.BytesIO()
    np.save(buffer, img)
    img_bytes = buffer.getvalue()
    return img_bytes


def img_to_png_bytes(img: np.ndarray):
    pil_img = PIL.Image.fromarray(img)
    buffer = io.BytesIO()
    pil_img.save(buffer, format="PNG")
    img_bytes = buffer.getvalue()
    return img_bytes
