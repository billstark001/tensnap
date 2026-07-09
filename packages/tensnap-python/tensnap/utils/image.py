from __future__ import annotations

import io
from typing import Any

try:
    import numpy as np

    HAS_NUMPY = True
except ImportError:
    np = None  # type: ignore[assignment]
    HAS_NUMPY = False
try:
    from PIL import Image

    HAS_PIL = True
except ImportError:
    Image = None  # type: ignore[assignment]
    HAS_PIL = False


def img_to_npy_bytes(img: Any) -> bytes:
    if np is None:
        raise ImportError("NumPy is not installed.")
    buffer = io.BytesIO()
    np.save(buffer, img)
    img_bytes = buffer.getvalue()
    return img_bytes


def img_to_png_bytes(img: Any) -> bytes:
    if Image is None:
        raise ImportError("PIL (Pillow) is not installed.")
    pil_img = Image.fromarray(img)
    buffer = io.BytesIO()
    pil_img.save(buffer, format="PNG")
    img_bytes = buffer.getvalue()
    return img_bytes
