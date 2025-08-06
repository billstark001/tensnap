// utils/numpy-renderer.ts
export interface NumpyData {
  data: Float32Array | Uint8Array | Int32Array | Float64Array | Int16Array | BigInt64Array;
  shape: number[];
}

export function renderNumpyBackground(
  ctx: CanvasRenderingContext2D,
  numpyData: NumpyData,
  canvasWidth: number,
  canvasHeight: number
): void {
  const { data, shape } = numpyData;

  if (data instanceof BigInt64Array) {
    throw new Error('int64 is not implemented');
  }
  
  // Validate shape
  if (shape.length !== 3) {
    throw new Error(`Invalid shape: expected 3 dimensions [h, w, c], got ${shape.length} dimensions`);
  }
  
  const [h, w, c] = shape;
  
  if (c !== 1 && c !== 3 && c !== 4) {
    throw new Error(`Invalid number of channels: expected 1, 3, or 4, got ${c}`);
  }
  
  // Create ImageData
  const imageData = ctx.createImageData(w, h);
  const pixels = imageData.data;
  
  // Convert numpy data to RGBA
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dataIndex = y * w * c + x * c;
      const pixelIndex = (y * w + x) * 4;
      
      if (c === 1) {
        // Grayscale
        const value = Math.floor(data[dataIndex] * 255);
        pixels[pixelIndex] = value;     // R
        pixels[pixelIndex + 1] = value; // G
        pixels[pixelIndex + 2] = value; // B
        pixels[pixelIndex + 3] = 255;   // A
      } else if (c === 3) {
        // RGB
        pixels[pixelIndex] = Math.floor(data[dataIndex] * 255);     // R
        pixels[pixelIndex + 1] = Math.floor(data[dataIndex + 1] * 255); // G
        pixels[pixelIndex + 2] = Math.floor(data[dataIndex + 2] * 255); // B
        pixels[pixelIndex + 3] = 255;   // A
      } else if (c === 4) {
        // RGBA
        pixels[pixelIndex] = Math.floor(data[dataIndex] * 255);     // R
        pixels[pixelIndex + 1] = Math.floor(data[dataIndex + 1] * 255); // G
        pixels[pixelIndex + 2] = Math.floor(data[dataIndex + 2] * 255); // B
        pixels[pixelIndex + 3] = Math.floor(data[dataIndex + 3] * 255); // A
      }
    }
  }
  
  // Create temporary canvas for the image data
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext('2d');
  
  if (!tempCtx) {
    throw new Error('Failed to get 2D context for temporary canvas');
  }
  
  tempCtx.putImageData(imageData, 0, 0);
  
  // Draw scaled image to main canvas
  ctx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight);
}