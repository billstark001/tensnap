import { NPYParser } from './npy-parser';

describe('NPYParser', () => {
  // Helper function to create a minimal valid NPY buffer
  const createMinimalNPYBuffer = (
    data: Uint8Array | Int16Array | Int32Array | BigInt64Array | Float32Array | Float64Array,
    shape: number[]
  ): ArrayBuffer => {
    return NPYParser.toBuffer(data, shape);
  };

  // Helper function to create an invalid buffer with wrong magic
  const createInvalidMagicBuffer = (): ArrayBuffer => {
    const buffer = new ArrayBuffer(10);
    const view = new Uint8Array(buffer);
    // Wrong magic string
    const wrongMagic = 'WRONGM';
    for (let i = 0; i < wrongMagic.length; i++) {
      view[i] = wrongMagic.charCodeAt(i);
    }
    return buffer;
  };

  // Helper function to create buffer with custom header
  const createCustomHeaderBuffer = (headerDict: string, data: ArrayBuffer): ArrayBuffer => {
    const magic = '\x93NUMPY';
    const paddingLength = (64 - (10 + headerDict.length) % 64) % 64;
    const paddedHeader = headerDict + ' '.repeat(paddingLength) + '\n';
    
    const totalSize = 10 + paddedHeader.length + data.byteLength;
    const buffer = new ArrayBuffer(totalSize);
    const view = new Uint8Array(buffer);
    
    // Write magic
    for (let i = 0; i < magic.length; i++) {
      view[i] = magic.charCodeAt(i);
    }
    
    // Write version
    view[6] = 1;
    view[7] = 0;
    
    // Write header length
    new DataView(buffer, 8, 2).setUint16(0, paddedHeader.length, true);
    
    // Write header
    const encoder = new TextEncoder();
    const headerBytes = encoder.encode(paddedHeader);
    view.set(headerBytes, 10);
    
    // Write data
    const dataView = new Uint8Array(buffer, 10 + paddedHeader.length);
    dataView.set(new Uint8Array(data));
    
    return buffer;
  };

  describe('parseHeader', () => {
    it('should parse valid NPY header correctly', () => {
      const data = new Float32Array([1.0, 2.0, 3.0, 4.0]);
      const shape = [2, 2];
      const buffer = createMinimalNPYBuffer(data, shape);
      
      const result = NPYParser.parseHeader(buffer);
      
      expect(result.shape).toEqual(shape);
      expect(result.dtype).toBe('<f4');
      expect(result.fortranOrder).toBe(false);
      expect(result.majorVersion).toBe(1);
      expect(result.minorVersion).toBe(0);
      expect(typeof result.headerLength).toBe('number');
      expect(result.headerLength).toBeGreaterThan(10);
    });

    it('should handle scalar arrays (empty shape)', () => {
      const data = new Float32Array([42.0]);
      const shape: number[] = [];
      const buffer = createMinimalNPYBuffer(data, shape);
      
      const result = NPYParser.parseHeader(buffer);
      
      expect(result.shape).toEqual([]);
      expect(result.dtype).toBe('<f4');
    });

    it('should parse different data types correctly', () => {
      const testCases = [
        { data: new Uint8Array([1, 2, 3]), expectedDtype: '|u1' },
        { data: new Int16Array([1, 2, 3]), expectedDtype: '<i2' },
        { data: new Int32Array([1, 2, 3]), expectedDtype: '<i4' },
        { data: new Float32Array([1.0, 2.0, 3.0]), expectedDtype: '<f4' },
        { data: new Float64Array([1.0, 2.0, 3.0]), expectedDtype: '<f8' },
      ];

      testCases.forEach(({ data, expectedDtype }) => {
        const buffer = createMinimalNPYBuffer(data, [3]);
        const result = NPYParser.parseHeader(buffer);
        expect(result.dtype).toBe(expectedDtype);
      });
    });

    it('should throw error for invalid magic string', () => {
      const buffer = createInvalidMagicBuffer();
      
      expect(() => NPYParser.parseHeader(buffer)).toThrow('Invalid NPY file: incorrect magic string');
    });

    it('should throw error for empty buffer', () => {
      const buffer = new ArrayBuffer(0);
      
      expect(() => NPYParser.parseHeader(buffer)).toThrow('Invalid input: empty or null buffer');
    });

    it('should throw error for buffer too small', () => {
      const buffer = new ArrayBuffer(5);
      
      expect(() => NPYParser.parseHeader(buffer)).toThrow('Invalid NPY file: buffer too small');
    });

    it('should throw error for unsupported version', () => {
      const buffer = new ArrayBuffer(10);
      const view = new Uint8Array(buffer);
      const magic = '\x93NUMPY';
      
      for (let i = 0; i < magic.length; i++) {
        view[i] = magic.charCodeAt(i);
      }
      
      view[6] = 99; // Unsupported version
      view[7] = 0;
      
      expect(() => NPYParser.parseHeader(buffer)).toThrow('Unsupported NPY version: 99.0');
    });

    it('should throw error for insufficient header data', () => {
      const buffer = new ArrayBuffer(8);
      const view = new Uint8Array(buffer);
      const magic = '\x93NUMPY';
      
      for (let i = 0; i < magic.length; i++) {
        view[i] = magic.charCodeAt(i);
      }
      
      view[6] = 1;
      view[7] = 0;
      
      expect(() => NPYParser.parseHeader(buffer)).toThrow('Invalid NPY file: insufficient data for version 1.0 header');
    });

    it('should handle header with single quotes in dtype', () => {
      const headerDict = "{'descr': '<f4', 'fortran_order': False, 'shape': (2,), }";
      const dataBuffer = new Float32Array([1.0, 2.0]).buffer;
      const buffer = createCustomHeaderBuffer(headerDict, dataBuffer);
      
      const result = NPYParser.parseHeader(buffer);
      expect(result.dtype).toBe('<f4');
      expect(result.shape).toEqual([2]);
    });

    it('should handle header with double quotes in dtype', () => {
      const headerDict = '{"descr": "<f4", "fortran_order": False, "shape": (2,), }';
      const dataBuffer = new Float32Array([1.0, 2.0]).buffer;
      const buffer = createCustomHeaderBuffer(headerDict, dataBuffer);
      
      const result = NPYParser.parseHeader(buffer);
      expect(result.dtype).toBe('<f4');
    });
  });

  describe('parse', () => {
    it('should parse complete NPY file correctly', () => {
      const originalData = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
      const shape = [2, 3];
      const buffer = createMinimalNPYBuffer(originalData, shape);
      
      const result = NPYParser.parse(buffer);
      
      expect(result.shape).toEqual(shape);
      expect(result.dtype).toBe('<f4');
      expect(result.data).toBeInstanceOf(Float32Array);
      expect(Array.from(result.data as Float32Array)).toEqual([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    });

    it('should parse all supported data types', () => {
      const testCases = [
        {
          data: new Uint8Array([255, 128, 0]),
          shape: [3],
          expectedType: Uint8Array,
          expectedValues: [255, 128, 0]
        },
        {
          data: new Int16Array([-32768, 0, 32767]),
          shape: [3],
          expectedType: Int16Array,
          expectedValues: [-32768, 0, 32767]
        },
        {
          data: new Int32Array([-2147483648, 0, 2147483647]),
          shape: [3],
          expectedType: Int32Array,
          expectedValues: [-2147483648, 0, 2147483647]
        },
        {
          data: new Float32Array([3.14159, -2.71828, 0.0]),
          shape: [3],
          expectedType: Float32Array,
          expectedValues: [3.14159, -2.71828, 0.0]
        },
        {
          data: new Float64Array([Math.PI, -Math.E, 0.0]),
          shape: [3],
          expectedType: Float64Array,
          expectedValues: [Math.PI, -Math.E, 0.0]
        }
      ];

      testCases.forEach(({ data, shape, expectedType, expectedValues }) => {
        const buffer = createMinimalNPYBuffer(data, shape);
        const result = NPYParser.parse(buffer);
        
        expect(result.data).toBeInstanceOf(expectedType);
        expect(result.shape).toEqual(shape);
        
        const resultArray = Array.from(result.data as any);
        expectedValues.forEach((expectedValue, index) => {
          if (typeof expectedValue === 'number' && isNaN(expectedValue)) {
            expect(resultArray[index]).toBeNaN();
          } else {
            expect(resultArray[index]).toBeCloseTo(expectedValue, 6);
          }
        });
      });
    });

    it('should handle 1D arrays', () => {
      const data = new Float32Array([1, 2, 3, 4, 5]);
      const shape = [5];
      const buffer = createMinimalNPYBuffer(data, shape);
      
      const result = NPYParser.parse(buffer);
      
      expect(result.shape).toEqual([5]);
      expect(Array.from(result.data as Float32Array)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should handle multi-dimensional arrays', () => {
      const data = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const shape = [2, 2, 2];
      const buffer = createMinimalNPYBuffer(data, shape);
      
      const result = NPYParser.parse(buffer);
      
      expect(result.shape).toEqual([2, 2, 2]);
      expect(result.data.length).toBe(8);
    });

    it('should handle scalar values', () => {
      const data = new Float32Array([42.0]);
      const shape: number[] = [];
      const buffer = createMinimalNPYBuffer(data, shape);
      
      const result = NPYParser.parse(buffer);
      
      expect(result.shape).toEqual([]);
      expect(result.data.length).toBe(1);
      expect((result.data as Float32Array)[0]).toBe(42.0);
    });

    it('should throw error for unsupported dtype', () => {
      const headerDict = "{'descr': '<c8', 'fortran_order': False, 'shape': (2,), }";
      const dataBuffer = new ArrayBuffer(16); // 2 complex64 numbers
      const buffer = createCustomHeaderBuffer(headerDict, dataBuffer);
      
      expect(() => NPYParser.parse(buffer)).toThrow('Unsupported dtype: <c8');
    });

    it('should throw error for insufficient data', () => {
      const headerDict = "{'descr': '<f4', 'fortran_order': False, 'shape': (10,), }";
      const dataBuffer = new ArrayBuffer(16); // Only 4 float32 values instead of 10
      const buffer = createCustomHeaderBuffer(headerDict, dataBuffer);
      
      expect(() => NPYParser.parse(buffer)).toThrow('Insufficient data');
    });

    it('should throw error for Fortran order', () => {
      const headerDict = "{'descr': '<f4', 'fortran_order': True, 'shape': (2, 2), }";
      const dataBuffer = new Float32Array([1, 2, 3, 4]).buffer;
      const buffer = createCustomHeaderBuffer(headerDict, dataBuffer);
      
      expect(() => NPYParser.parse(buffer)).toThrow('Fortran order arrays are not currently supported');
    });

    it('should throw error for zero dimensions in shape', () => {
      const headerDict = "{'descr': '<f4', 'fortran_order': False, 'shape': (0, 5), }";
      const dataBuffer = new ArrayBuffer(0);
      const buffer = createCustomHeaderBuffer(headerDict, dataBuffer);
      
      expect(() => NPYParser.parse(buffer)).toThrow('Invalid shape: contains zero dimensions');
    });
  });

  describe('toBuffer', () => {
    it('should create valid NPY buffer from typed array', () => {
      const data = new Float32Array([1.0, 2.0, 3.0, 4.0]);
      const shape = [2, 2];
      
      const buffer = NPYParser.toBuffer(data, shape);
      
      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(buffer.byteLength).toBeGreaterThan(0);
      
      // Verify by parsing back
      const parsed = NPYParser.parse(buffer);
      expect(parsed.shape).toEqual(shape);
      expect(Array.from(parsed.data as Float32Array)).toEqual([1.0, 2.0, 3.0, 4.0]);
    });

    it('should handle all supported data types', () => {
      const testCases = [
        { data: new Uint8Array([1, 2, 3]), shape: [3] },
        { data: new Int16Array([1, 2, 3]), shape: [3] },
        { data: new Int32Array([1, 2, 3]), shape: [3] },
        { data: new Float32Array([1.0, 2.0, 3.0]), shape: [3] },
        { data: new Float64Array([1.0, 2.0, 3.0]), shape: [3] },
      ];

      testCases.forEach(({ data, shape }) => {
        const buffer = NPYParser.toBuffer(data, shape);
        const parsed = NPYParser.parse(buffer);
        
        expect(parsed.shape).toEqual(shape);
        expect(parsed.data.constructor).toBe(data.constructor);
      });
    });

    it('should handle scalar arrays', () => {
      const data = new Float32Array([42.0]);
      const shape: number[] = [];
      
      const buffer = NPYParser.toBuffer(data, shape);
      const parsed = NPYParser.parse(buffer);
      
      expect(parsed.shape).toEqual([]);
      expect((parsed.data as Float32Array)[0]).toBe(42.0);
    });

    it('should handle 1D arrays with single element', () => {
      const data = new Float32Array([42.0]);
      const shape = [1];
      
      const buffer = NPYParser.toBuffer(data, shape);
      const parsed = NPYParser.parse(buffer);
      
      expect(parsed.shape).toEqual([1]);
      expect((parsed.data as Float32Array)[0]).toBe(42.0);
    });

    it('should throw error for unsupported array type', () => {
      const data = new Int8Array([1, 2, 3]) as any;
      const shape = [3];
      
      expect(() => NPYParser.toBuffer(data, shape)).toThrow('Unsupported data type');
    });

    it('should throw error for negative dimensions', () => {
      const data = new Float32Array([1, 2, 3]);
      const shape = [3, -1];
      
      expect(() => NPYParser.toBuffer(data, shape)).toThrow('Shape must contain non-negative integers');
    });

    it('should throw error for non-integer dimensions', () => {
      const data = new Float32Array([1, 2, 3]);
      const shape = [3.5] as any;
      
      expect(() => NPYParser.toBuffer(data, shape)).toThrow('Shape must contain non-negative integers');
    });

    it('should throw error for mismatched data length and shape', () => {
      const data = new Float32Array([1, 2, 3]);
      const shape = [2, 2]; // Expects 4 elements, but data has 3
      
      expect(() => NPYParser.toBuffer(data, shape)).toThrow("Data length (3) doesn't match shape");
    });

    it('should create properly aligned headers', () => {
      const data = new Float32Array([1.0]);
      const shape = [1];
      
      const buffer = NPYParser.toBuffer(data, shape);
      
      // Check that we can parse it back without issues
      expect(() => NPYParser.parse(buffer)).not.toThrow();
    });
  });

  describe('round-trip consistency', () => {
    it('should maintain data integrity through parse/toBuffer cycle', () => {
      const testCases = [
        { data: new Uint8Array([0, 128, 255]), shape: [3] },
        { data: new Int16Array([-1000, 0, 1000]), shape: [3] },
        { data: new Int32Array([-100000, 0, 100000]), shape: [3] },
        { data: new Float32Array([3.14159, -2.71828, 0.0, NaN, Infinity, -Infinity]), shape: [6] },
        { data: new Float64Array([Math.PI, -Math.E, 0.0]), shape: [3] },
      ];

      testCases.forEach(({ data, shape }) => {
        // Original -> Buffer -> Parsed -> Buffer -> Parsed
        const buffer1 = NPYParser.toBuffer(data, shape);
        const parsed1 = NPYParser.parse(buffer1);
        const buffer2 = NPYParser.toBuffer(parsed1.data, parsed1.shape);
        const parsed2 = NPYParser.parse(buffer2);
        
        expect(parsed2.shape).toEqual(shape);
        expect(parsed2.data.constructor).toBe(data.constructor);
        
        const original = Array.from(data);
        const final = Array.from(parsed2.data as any);
        
        original.forEach((value, index) => {
          if (typeof value === 'number' && isNaN(value)) {
            expect(final[index]).toBeNaN();
          } else {
            expect(final[index]).toEqual(value);
          }
        });
      });
    });
  });

  describe('utility methods', () => {
    describe('getDtypeInfo', () => {
      it('should return correct info for supported dtypes', () => {
        const testCases = [
          { dtype: '<f4', expectedName: 'float32', expectedSize: 4 },
          { dtype: '<f8', expectedName: 'float64', expectedSize: 8 },
          { dtype: '|u1', expectedName: 'uint8', expectedSize: 1 },
          { dtype: '<i2', expectedName: 'int16', expectedSize: 2 },
          { dtype: '<i4', expectedName: 'int32', expectedSize: 4 },
          { dtype: '<i8', expectedName: 'int64', expectedSize: 8 },
        ];

        testCases.forEach(({ dtype, expectedName, expectedSize }) => {
          const info = NPYParser.getDtypeInfo(dtype);
          expect(info).not.toBeNull();
          expect(info!.name).toBe(expectedName);
          expect(info!.size).toBe(expectedSize);
          expect(typeof info!.type).toBe('string');
        });
      });

      it('should return null for unsupported dtypes', () => {
        const unsupportedDtypes = ['<c8', '>U10', '<M8', 'invalid'];
        
        unsupportedDtypes.forEach(dtype => {
          expect(NPYParser.getDtypeInfo(dtype)).toBeNull();
        });
      });
    });

    describe('isSupportedDtype', () => {
      it('should return true for supported dtypes', () => {
        const supportedDtypes = ['<f4', '<f8', '|u1', '<i2', '<i4', '<i8', '>f4', '>i2'];
        
        supportedDtypes.forEach(dtype => {
          expect(NPYParser.isSupportedDtype(dtype)).toBe(true);
        });
      });

      it('should return false for unsupported dtypes', () => {
        const unsupportedDtypes = ['<c8', '>U10', '<M8', 'invalid', ''];
        
        unsupportedDtypes.forEach(dtype => {
          expect(NPYParser.isSupportedDtype(dtype)).toBe(false);
        });
      });
    });
  });

  describe('edge cases', () => {
    it('should handle very large arrays', () => {
      const size = 1000000; // 1M elements
      const data = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        data[i] = Math.random();
      }
      const shape = [size];
      
      expect(() => {
        const buffer = NPYParser.toBuffer(data, shape);
        const parsed = NPYParser.parse(buffer);
        expect(parsed.data.length).toBe(size);
      }).not.toThrow();
    });

    it('should handle special float values', () => {
      const data = new Float64Array([
        0.0, -0.0, Infinity, -Infinity, NaN,
        Number.MAX_VALUE, Number.MIN_VALUE,
        Number.EPSILON, Math.PI, Math.E
      ]);
      const shape = [data.length];
      
      const buffer = NPYParser.toBuffer(data, shape);
      const parsed = NPYParser.parse(buffer);
      const result = parsed.data as Float64Array;
      
      expect(result[0]).toBe(0.0);
      expect(Object.is(result[1], -0.0)).toBe(true);
      expect(result[2]).toBe(Infinity);
      expect(result[3]).toBe(-Infinity);
      expect(result[4]).toBeNaN();
      expect(result[5]).toBeCloseTo(Number.MAX_VALUE);
      expect(result[6]).toBeCloseTo(Number.MIN_VALUE);
      expect(result[7]).toBeCloseTo(Number.EPSILON);
      expect(result[8]).toBeCloseTo(Math.PI);
      expect(result[9]).toBeCloseTo(Math.E);
    });

    it('should handle empty arrays with non-zero shape', () => {
      // This should be rejected as invalid
      const data = new Float32Array([]);
      const shape = [0];
      
      // Empty data with shape [0] should work
      expect(() => NPYParser.toBuffer(data, shape)).not.toThrow();
    });
  });
});