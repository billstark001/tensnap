
/**
 * 将 Blob 转换为 Uint8Array
 */
export async function blobToUint8Array(blob: Blob, maxBytes: number = 16): Promise<Uint8Array> {
  const slice = blob.slice(0, maxBytes);
  const arrayBuffer = await slice.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * 标准化输入为 Uint8Array
 */
export async function normalizeInput(
  input: Blob | Uint8Array | ArrayBuffer | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array
): Promise<Uint8Array> {
  if (input instanceof Blob) {
    return await blobToUint8Array(input);
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  if (input instanceof Uint8Array) {
    return input;
  }

  // 处理其他 TypedArray
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

export async function base64ToBlob2(base64Data: string) {
  if (!base64Data.startsWith('data:')) {
    throw new Error('Invalid base64 data URL');
  }
  const response = await fetch(base64Data);
  return await response.blob();
}