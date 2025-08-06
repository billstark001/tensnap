/**
 * A robust NPY (NumPy binary format) parser for browser environments
 * Supports uint8, int16, int32, int64, float32, and float64 data types
 */
export class NPYParser {
  // Magic string for NPY files
  private static readonly MAGIC = '\x93NUMPY';
  
  // Data type mappings for NumPy format descriptors
  private static readonly DTYPE_MAP = {
    '|u1': { type: Uint8Array, size: 1, name: 'uint8' },
    '<u1': { type: Uint8Array, size: 1, name: 'uint8' },
    '>u1': { type: Uint8Array, size: 1, name: 'uint8' },
    '<i2': { type: Int16Array, size: 2, name: 'int16' },
    '>i2': { type: Int16Array, size: 2, name: 'int16' },
    '<i4': { type: Int32Array, size: 4, name: 'int32' },
    '>i4': { type: Int32Array, size: 4, name: 'int32' },
    '<i8': { type: BigInt64Array, size: 8, name: 'int64' },
    '>i8': { type: BigInt64Array, size: 8, name: 'int64' },
    '<f4': { type: Float32Array, size: 4, name: 'float32' },
    '>f4': { type: Float32Array, size: 4, name: 'float32' },
    '<f8': { type: Float64Array, size: 8, name: 'float64' },
    '>f8': { type: Float64Array, size: 8, name: 'float64' },
  } as const;

  private static readonly SUPPORTED_TYPES = [
    Uint8Array, Int16Array, Int32Array, BigInt64Array, Float32Array, Float64Array
  ];

  /**
   * Validates if the buffer contains a valid NPY file
   */
  private static validateMagic(bytes: Uint8Array): void {
    if (bytes.length < 8) {
      throw new Error('Invalid NPY file: buffer too small');
    }
    
    const magic = String.fromCharCode(...bytes.slice(0, 6));
    if (magic !== this.MAGIC) {
      throw new Error(`Invalid NPY file: incorrect magic string. Expected '${this.MAGIC}', got '${magic}'`);
    }
  }

  /**
   * Validates NPY version and returns header information
   */
  private static parseVersionAndHeaderLength(buffer: ArrayBuffer): {
    majorVersion: number;
    minorVersion: number;
    headerLength: number;
    headerStart: number;
  } {
    const bytes = new Uint8Array(buffer);
    const majorVersion = bytes[6];
    const minorVersion = bytes[7];
    
    // Support NPY format versions 1.0, 2.0, and 3.0
    if (majorVersion < 1 || majorVersion > 3) {
      throw new Error(`Unsupported NPY version: ${majorVersion}.${minorVersion}`);
    }
    
    let headerLength: number;
    let headerStart: number;
    
    if (majorVersion === 1) {
      if (buffer.byteLength < 10) {
        throw new Error('Invalid NPY file: insufficient data for version 1.0 header');
      }
      headerLength = new DataView(buffer, 8, 2).getUint16(0, true);
      headerStart = 10;
    } else {
      if (buffer.byteLength < 12) {
        throw new Error(`Invalid NPY file: insufficient data for version ${majorVersion}.0 header`);
      }
      headerLength = new DataView(buffer, 8, 4).getUint32(0, true);
      headerStart = 12;
    }
    
    if (headerStart + headerLength > buffer.byteLength) {
      throw new Error('Invalid NPY file: header length exceeds buffer size');
    }
    
    return { majorVersion, minorVersion, headerLength, headerStart };
  }

  /**
   * Parses the NPY header dictionary
   */
  private static parseHeaderDict(headerStr: string): {
    shape: number[];
    dtype: string;
    fortranOrder: boolean;
  } {
    try {
      // More robust regex patterns
      const shapeMatch = headerStr.match(/'shape':\s*\(([^)]*)\)/)
        ?? headerStr.match(/"shape":\s*\(([^)]*)\)/);
      const dtypeMatch = headerStr.match(/'descr':\s*['"]([^'"]*)['"]/)
        ?? headerStr.match(/"descr":\s*['"]([^'"]*)['"]/);
      const orderMatch = headerStr.match(/'fortran_order':\s*(True|False)/)
        ?? headerStr.match(/"fortran_order":\s*(True|False)/);
      
      if (!shapeMatch || !dtypeMatch) {
        throw new Error('Required header fields missing (shape or descr)');
      }
      
      // Parse shape with better error handling
      const shapeStr = shapeMatch[1].trim();
      let shape: number[];
      
      if (shapeStr === '') {
        shape = []; // Scalar
      } else {
        shape = shapeStr
          .split(',')
          .map(s => s.trim())
          .filter(s => s !== '')
          .map(s => {
            const num = parseInt(s, 10);
            if (isNaN(num) || num < 0) {
              throw new Error(`Invalid dimension in shape: ${s}`);
            }
            return num;
          });
      }
      
      const dtype = dtypeMatch[1];
      const fortranOrder = orderMatch ? orderMatch[1] === 'True' : false;
      
      return { shape, dtype, fortranOrder };
    } catch (error) {
      throw new Error(`Failed to parse NPY header: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  /**
   * Creates typed array from buffer based on dtype
   */
  private static createTypedArray(
    buffer: ArrayBuffer,
    dtype: string,
    expectedLength: number
  ): Uint8Array | Int16Array | Int32Array | BigInt64Array | Float32Array | Float64Array {
    const typeInfo = this.DTYPE_MAP[dtype as keyof typeof this.DTYPE_MAP];
    
    if (!typeInfo) {
      throw new Error(`Unsupported dtype: ${dtype}. Supported types: ${Object.keys(this.DTYPE_MAP).join(', ')}`);
    }
    
    const expectedBytes = expectedLength * typeInfo.size;
    if (buffer.byteLength < expectedBytes) {
      throw new Error(
        `Insufficient data: expected ${expectedBytes} bytes for ${expectedLength} elements of type ${dtype}, got ${buffer.byteLength} bytes`
      );
    }
    
    // Handle endianness for multi-byte types
    const isLittleEndian = dtype.startsWith('<') || dtype.startsWith('|');
    const needsByteSwap = !isLittleEndian && typeInfo.size > 1;
    
    if (needsByteSwap) {
      // Create a copy and swap bytes for big-endian data
      const swappedBuffer = this.swapBytes(buffer.slice(0, expectedBytes), typeInfo.size);
      return new typeInfo.type(swappedBuffer) as any;
    }
    
    return new typeInfo.type(buffer, 0, expectedLength) as any;
  }

  /**
   * Swaps bytes for endianness conversion
   */
  private static swapBytes(buffer: ArrayBuffer, elementSize: number): ArrayBuffer {
    const view = new Uint8Array(buffer);
    const swapped = new Uint8Array(buffer.byteLength);
    
    for (let i = 0; i < view.length; i += elementSize) {
      for (let j = 0; j < elementSize; j++) {
        swapped[i + j] = view[i + elementSize - 1 - j];
      }
    }
    
    return swapped.buffer;
  }

  /**
   * Handles Fortran order (column-major) to C order (row-major) conversion
   */
  private static transposeIfNeeded<T extends ArrayLike<any>>(
    data: T,
    shape: number[],
    fortranOrder: boolean
  ): T {
    if (!fortranOrder || shape.length <= 1) {
      return data;
    }
    
    // For simplicity, we'll throw an error for Fortran order arrays
    // Full implementation would require complex multi-dimensional transposition
    throw new Error('Fortran order arrays are not currently supported. Please use C order (row-major) arrays.');
  }

  /**
   * Parses NPY file header and returns metadata
   */
  static parseHeader(buffer: ArrayBuffer): {
    shape: number[];
    dtype: string;
    fortranOrder: boolean;
    headerLength: number;
    majorVersion: number;
    minorVersion: number;
  } {
    if (!buffer || buffer.byteLength === 0) {
      throw new Error('Invalid input: empty or null buffer');
    }
    
    const bytes = new Uint8Array(buffer);
    
    // Validate magic string
    this.validateMagic(bytes);
    
    // Parse version and header length
    const { majorVersion, minorVersion, headerLength, headerStart } = 
      this.parseVersionAndHeaderLength(buffer);
    
    // Extract and parse header string
    const headerBytes = bytes.slice(headerStart, headerStart + headerLength);
    const headerStr = new TextDecoder('utf-8').decode(headerBytes);
    
    const { shape, dtype, fortranOrder } = this.parseHeaderDict(headerStr);
    
    return {
      shape,
      dtype,
      fortranOrder,
      headerLength: headerStart + headerLength,
      majorVersion,
      minorVersion
    };
  }
  
  /**
   * Parses complete NPY file and returns data with shape information
   */
  static parse(buffer: ArrayBuffer): {
    data: Uint8Array | Int16Array | Int32Array | BigInt64Array | Float32Array | Float64Array;
    shape: number[];
    dtype: string;
  } {
    const { shape, dtype, fortranOrder, headerLength } = this.parseHeader(buffer);
    
    // Calculate expected number of elements
    const totalElements = shape.length === 0 ? 1 : shape.reduce((a, b) => a * b, 1);
    
    if (totalElements === 0) {
      throw new Error('Invalid shape: contains zero dimensions');
    }
    
    // Extract data portion
    const dataBuffer = buffer.slice(headerLength);
    
    // Create appropriate typed array
    const data = this.createTypedArray(dataBuffer, dtype, totalElements);
    
    // Handle Fortran order if needed
    const finalData = this.transposeIfNeeded(data, shape, fortranOrder);
    
    return { data: finalData, shape, dtype };
  }
  
  /**
   * Converts typed array data to NPY format buffer
   */
  static toBuffer(
    data: Uint8Array | Int16Array | Int32Array | BigInt64Array | Float32Array | Float64Array,
    shape: number[]
  ): ArrayBuffer {
    // Validate input
    if (!this.SUPPORTED_TYPES.some(Type => data instanceof Type)) {
      throw new Error('Unsupported data type. Must be one of: Uint8Array, Int16Array, Int32Array, BigInt64Array, Float32Array, Float64Array');
    }
    
    if (shape.some(dim => dim < 0 || !Number.isInteger(dim))) {
      throw new Error('Shape must contain non-negative integers');
    }
    
    const expectedElements = shape.length === 0 ? 1 : shape.reduce((a, b) => a * b, 1);
    if (data.length !== expectedElements) {
      throw new Error(`Data length (${data.length}) doesn't match shape (${shape.join('×')} = ${expectedElements})`);
    }
    
    // Determine dtype string
    let dtype: string;
    if (data instanceof Uint8Array) dtype = '|u1';
    else if (data instanceof Int16Array) dtype = '<i2';
    else if (data instanceof Int32Array) dtype = '<i4';
    else if (data instanceof BigInt64Array) dtype = '<i8';
    else if (data instanceof Float32Array) dtype = '<f4';
    else if (data instanceof Float64Array) dtype = '<f8';
    else throw new Error('Unsupported array type');
    
    // Create header string
    const shapeStr = shape.length === 0 ? '' : shape.join(', ') + (shape.length === 1 ? ',' : '');
    const headerStr = `{'descr': '${dtype}', 'fortran_order': False, 'shape': (${shapeStr}), }`;
    
    // Calculate padding to align to 64-byte boundary (NPY specification)
    const baseHeaderLength = 10 + headerStr.length;
    const paddingLength = (64 - (baseHeaderLength % 64)) % 64;
    const paddedHeader = headerStr + ' '.repeat(paddingLength) + '\n';
    
    // Create output buffer
    const totalSize = 10 + paddedHeader.length + data.byteLength;
    const buffer = new ArrayBuffer(totalSize);
    const view = new Uint8Array(buffer);
    
    // Write magic string
    for (let i = 0; i < this.MAGIC.length; i++) {
      view[i] = this.MAGIC.charCodeAt(i);
    }
    
    // Write version (1.0)
    view[6] = 1;
    view[7] = 0;
    
    // Write header length (little-endian)
    new DataView(buffer, 8, 2).setUint16(0, paddedHeader.length, true);
    
    // Write header
    const encoder = new TextEncoder();
    const headerBytes = encoder.encode(paddedHeader);
    view.set(headerBytes, 10);
    
    // Write data
    const dataView = new Uint8Array(buffer, 10 + paddedHeader.length);
    dataView.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    
    return buffer;
  }

  /**
   * Utility method to get dtype information
   */
  static getDtypeInfo(dtype: string): { type: string; size: number; name: string } | null {
    const info = this.DTYPE_MAP[dtype as keyof typeof this.DTYPE_MAP];
    return info ? { type: info.type.name, size: info.size, name: info.name } : null;
  }

  /**
   * Utility method to validate if a dtype is supported
   */
  static isSupportedDtype(dtype: string): boolean {
    return dtype in this.DTYPE_MAP;
  }
}