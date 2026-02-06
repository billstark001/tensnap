import { NumpyArrayData } from "./npy-parser";

const validateShape = (shape: number[], expectedChannels: number[] = [1, 3, 4]) => {
  if (shape.length !== 3) {
    throw new Error(`Invalid shape: expected 3 dimensions [h, w, c], got ${shape.length} dimensions`);
  }
  const [, , c] = shape;
  if (!expectedChannels.includes(c)) {
    throw new Error(`Invalid number of channels: expected ${expectedChannels.join(', ')}, got ${c}`);
  }
};

// int16 range: -32768 to 32767 -> normalize to 0-255
const normalizeInt16 = (val: number) => Math.max(0, Math.min(255, Math.floor((val + 32768) / 257.003921568627)));
// int32 range: -2147483648 to 2147483647 -> normalize to 0-255
const normalizeInt32 = (val: number) => Math.max(0, Math.min(255, Math.floor((val + 2147483648) / 16843009.00392157)));
// For floating point types (float32, float64), assume values are in [0, 1] range
// Values outside this range will be clamped
const normalizeFloat = (val: number) => Math.max(0, Math.min(255, Math.floor(val * 255)));
/**
 * Convert numpy array data to RGBA format based on dtype
 * - uint8: direct copy (0-255)
 * - int16/int32: normalize from dtype range to 0-255
 * - float32/float64: assume normalized [0, 1] range and scale to 0-255
 */
const convertToRGBA = (data: NumpyArrayData['data'], h: number, w: number, c: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(h * w * 4);
  const totalPixels = h * w;

  // Handle BigInt64Array separately
  if (data instanceof BigInt64Array) {
    throw new Error('int64 is not supported for image rendering');
  }

  // Fast path for uint8 (most common case)
  if (data instanceof Uint8Array) {
    for (let i = 0; i < totalPixels; i++) {
      const dataIndex = i * c;
      const pixelIndex = i * 4;

      const r = data[dataIndex];
      const g = c === 1 ? r : data[dataIndex + 1];
      const b = c === 1 ? r : data[dataIndex + 2];
      const a = c === 4 ? data[dataIndex + 3] : 255;

      pixels[pixelIndex] = r;
      pixels[pixelIndex + 1] = g;
      pixels[pixelIndex + 2] = b;
      pixels[pixelIndex + 3] = a;
    }
    return pixels;
  }

  // For integer types (int16, int32), normalize from their range to 0-255
  if (data instanceof Int16Array) {

    for (let i = 0; i < totalPixels; i++) {
      const dataIndex = i * c;
      const pixelIndex = i * 4;

      const r = normalizeInt16(data[dataIndex]);
      const g = c === 1 ? r : normalizeInt16(data[dataIndex + 1]);
      const b = c === 1 ? r : normalizeInt16(data[dataIndex + 2]);
      const a = c === 4 ? normalizeInt16(data[dataIndex + 3]) : 255;

      pixels[pixelIndex] = r;
      pixels[pixelIndex + 1] = g;
      pixels[pixelIndex + 2] = b;
      pixels[pixelIndex + 3] = a;
    }
    return pixels;
  }

  if (data instanceof Int32Array) {

    for (let i = 0; i < totalPixels; i++) {
      const dataIndex = i * c;
      const pixelIndex = i * 4;

      const r = normalizeInt32(data[dataIndex]);
      const g = c === 1 ? r : normalizeInt32(data[dataIndex + 1]);
      const b = c === 1 ? r : normalizeInt32(data[dataIndex + 2]);
      const a = c === 4 ? normalizeInt32(data[dataIndex + 3]) : 255;

      pixels[pixelIndex] = r;
      pixels[pixelIndex + 1] = g;
      pixels[pixelIndex + 2] = b;
      pixels[pixelIndex + 3] = a;
    }
    return pixels;
  }


  for (let i = 0; i < totalPixels; i++) {
    const dataIndex = i * c;
    const pixelIndex = i * 4;

    const r = normalizeFloat(data[dataIndex]);
    const g = c === 1 ? r : normalizeFloat(data[dataIndex + 1]);
    const b = c === 1 ? r : normalizeFloat(data[dataIndex + 2]);
    const a = c === 4 ? normalizeFloat(data[dataIndex + 3]) : 255;

    pixels[pixelIndex] = r;
    pixels[pixelIndex + 1] = g;
    pixels[pixelIndex + 2] = b;
    pixels[pixelIndex + 3] = a;
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

export const createNumpyBackground = (numpyData: NumpyArrayData): HTMLImageElement | null => {
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

  // Clean up temporary canvas to prevent memory leak
  canvas.width = 0;
  canvas.height = 0;

  return img;
};

export const renderNumpyBackground = (
  ctx: CanvasRenderingContext2D,
  numpyData: NumpyArrayData,
  canvasWidth: number,
  canvasHeight: number
): void => {
  const { data, shape } = numpyData;

  validateShape(shape);

  const [h, w, c] = shape;
  const pixels = convertToRGBA(data, h, w, c);
  const tempCanvas = createCanvasWithImageData(pixels, w, h);

  // Disable image smoothing for pixel-perfect rendering
  ctx.imageSmoothingEnabled = false;

  // Draw scaled image to main canvas
  ctx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight);

  // Clean up temporary canvas to prevent memory leak
  ctx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
  tempCanvas.width = 0;
  tempCanvas.height = 0;
};