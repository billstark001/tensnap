export interface NumpyData {
  data: Float32Array | Uint8Array | Int32Array | Float64Array | Int16Array | BigInt64Array;
  shape: number[];
}

const validateShape = (shape: number[], expectedChannels: number[] = [1, 3, 4]) => {
  if (shape.length !== 3) {
    throw new Error(`Invalid shape: expected 3 dimensions [h, w, c], got ${shape.length} dimensions`);
  }
  const [, , c] = shape;
  if (!expectedChannels.includes(c)) {
    throw new Error(`Invalid number of channels: expected ${expectedChannels.join(', ')}, got ${c}`);
  }
};

const convertToRGBA = (data: NumpyData['data'], h: number, w: number, c: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(h * w * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dataIndex = y * w * c + x * c;
      const pixelIndex = (y * w + x) * 4;

      const channels = Array.from({ length: c }, (_, i) =>
        Math.floor((data[dataIndex + i] as number) * 255)
      );

      // Map channels to RGBA
      pixels[pixelIndex] = channels[0]; // R
      pixels[pixelIndex + 1] = c === 1 ? channels[0] : channels[1]; // G
      pixels[pixelIndex + 2] = c === 1 ? channels[0] : channels[2]; // B
      pixels[pixelIndex + 3] = c === 4 ? channels[3] : 255; // A
    }
  }

  return pixels;
};

const createCanvasWithImageData = (pixels: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context');

  // Disable image smoothing for pixel-perfect rendering
  ctx.imageSmoothingEnabled = false;

  const imageData = ctx.createImageData(w, h);
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);

  return canvas;
};

export const createNumpyBackground = (numpyData: NumpyData): HTMLImageElement | null => {
  const { data, shape } = numpyData;
  validateShape(shape);

  const [h, w, c] = shape;
  const pixels = convertToRGBA(data, h, w, c);
  const canvas = createCanvasWithImageData(pixels, w, h);

  const img = new Image();
  // Disable image smoothing at image level
  img.style.imageRendering = 'pixelated';
  img.style.setProperty('image-rendering', '-moz-crisp-edges', '');
  img.style.setProperty('image-rendering', 'crisp-edges', '');
  img.src = canvas.toDataURL();
  return img;
};

export const renderNumpyBackground = (
  ctx: CanvasRenderingContext2D,
  numpyData: NumpyData,
  canvasWidth: number,
  canvasHeight: number
): void => {
  const { data, shape } = numpyData;

  if (data instanceof BigInt64Array) {
    throw new Error('int64 is not implemented');
  }

  validateShape(shape);

  const [h, w, c] = shape;
  const pixels = convertToRGBA(data, h, w, c);
  const tempCanvas = createCanvasWithImageData(pixels, w, h);

  // Disable image smoothing for pixel-perfect rendering
  ctx.imageSmoothingEnabled = false;

  // Draw scaled image to main canvas
  ctx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight);
};