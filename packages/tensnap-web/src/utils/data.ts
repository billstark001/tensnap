
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



export const copyCanvas = async (canvas: HTMLCanvasElement) => {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    });
  });
  if (blob) {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);
    return true;
  }
  return false;
};

export const copySVG = async (svgElement: SVGSVGElement) => {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const clipboardItem = new ClipboardItem({ 'image/svg+xml': blob });
  await navigator.clipboard.write([clipboardItem]);
  return true;
};

export const copySvgAsBitmap = async (svgElement: SVGSVGElement) => {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);

  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.src = url;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = svgElement.viewBox.baseVal.width || svgElement.width.baseVal.value || 200;
  canvas.height = svgElement.viewBox.baseVal.height || svgElement.height.baseVal.value || 200;
  const ctx = canvas.getContext("2d");
  ctx!.drawImage(img, 0, 0);

  URL.revokeObjectURL(url);

  const result = await copyCanvas(canvas);

  ctx?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;

  return result;
};
