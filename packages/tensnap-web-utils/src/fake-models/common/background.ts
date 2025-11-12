/**
 * Utility functions for generating background images
 */

/**
 * Type for patch color
 */
export type PatchColor = "green" | "brown";

/**
 * Interface for patches with color information
 */
export interface IPatch {
  color: PatchColor;
}

/**
 * Generate a simple grass pattern background as a valid BMP file
 * Format: Complete BMP file with header (24-bit RGB)
 * 
 * @param patches 2D array of patches with color information
 * @returns Uint8Array containing a complete BMP file
 */
export function generateGrassBackground(
  patches: ReadonlyArray<ReadonlyArray<IPatch>>
): Uint8Array {
  const height = patches.length;
  const width = patches[0]?.length ?? 0;

  if (height === 0 || width === 0) {
    throw new Error('Patches array must not be empty');
  }

  // BMP rows must be padded to multiples of 4 bytes
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize; // 14 (file header) + 40 (DIB header) + pixel data

  const bmp = new Uint8Array(fileSize);
  const view = new DataView(bmp.buffer);

  // BMP File Header (14 bytes)
  bmp[0] = 0x42; // 'B'
  bmp[1] = 0x4D; // 'M'
  view.setUint32(2, fileSize, true);      // File size
  view.setUint32(6, 0, true);              // Reserved
  view.setUint32(10, 54, true);            // Pixel data offset

  // DIB Header (BITMAPINFOHEADER - 40 bytes)
  view.setUint32(14, 40, true);            // DIB header size
  view.setInt32(18, width, true);          // Width
  view.setInt32(22, height, true);         // Height (positive = bottom-up)
  view.setUint16(26, 1, true);             // Color planes
  view.setUint16(28, 24, true);            // Bits per pixel (24-bit RGB)
  view.setUint32(30, 0, true);             // Compression (0 = none)
  view.setUint32(34, pixelDataSize, true); // Image size
  view.setInt32(38, 2835, true);           // Horizontal resolution (72 DPI)
  view.setInt32(42, 2835, true);           // Vertical resolution (72 DPI)
  view.setUint32(46, 0, true);             // Colors in palette
  view.setUint32(50, 0, true);             // Important colors

  // Pixel data (BGR format, bottom-up)
  for (let y = 0; y < height; y++) {
    const rowOffset = 54 + (height - 1 - y) * rowSize; // Bottom-up
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + x * 3;
      const patch = patches[y][x];
      const isGreen = patch.color === "green";

      if (isGreen) {
        // Green grass: #7EC850 (BGR order)
        bmp[pixelOffset] = 0x50;     // B
        bmp[pixelOffset + 1] = 0xC8; // G
        bmp[pixelOffset + 2] = 0x7E; // R
      } else {
        // Brown dirt: #8B7355 (BGR order)
        bmp[pixelOffset] = 0x55;     // B
        bmp[pixelOffset + 1] = 0x73; // G
        bmp[pixelOffset + 2] = 0x8B; // R
      }
    }
    // Padding is already zeroed by Uint8Array initialization
  }

  return bmp;
}

/**
 * Encode RGB data as base64 string for transmission
 * 
 * @param data Uint8Array containing RGB data
 * @returns Base64 encoded string
 */
export function encodeBackgroundToBase64(data: Uint8Array): string {
  // Convert Uint8Array to base64
  let binary = '';
  const len = data.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

/**
 * Generate and encode grass background in one step
 */
export function createGrassBackgroundData(
  patches: ReadonlyArray<ReadonlyArray<IPatch>>
): Uint8Array {
  return generateGrassBackground(patches);
}
