import { pack, groupRectanglesByType, calculateBounds, Rectangle, PlacedRectangle } from './pack';

describe('Rectangle Packing with MaxRects', () => {
  describe('Basic Packing', () => {
    it('should pack rectangles without overlap', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 30, height: 40 },
        { type: 'B', width: 20, height: 30 },
        { type: 'C', width: 25, height: 35 },
      ];

      const result = pack(rectangles, { padding: 5 });

      // 检查没有重叠
      for (let i = 0; i < result.rectangles.length; i++) {
        for (let j = i + 1; j < result.rectangles.length; j++) {
          const a = result.rectangles[i];
          const b = result.rectangles[j];

          const noOverlap =
            a.left + a.width <= b.left ||
            b.left + b.width <= a.left ||
            a.top + a.height <= b.top ||
            b.top + b.height <= a.top;

          expect(noOverlap).toBe(true);
        }
      }

      expect(result.rectangles.length).toBe(3);
    });

    it('should pack empty array', () => {
      const result = pack([]);
      expect(result.rectangles.length).toBe(0);
      expect(result.actualBounds.width).toBe(0);
      expect(result.actualBounds.height).toBe(0);
    });

    it('should handle single rectangle', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 50, height: 60 },
      ];

      const result = pack(rectangles);
      expect(result.rectangles.length).toBe(1);
      expect(result.rectangles[0].left).toBe(0);
      expect(result.rectangles[0].top).toBe(0);
    });
  });

  describe('Consistency', () => {
    it('should produce consistent results across multiple calls', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 30, height: 40 },
        { type: 'B', width: 20, height: 30 },
        { type: 'C', width: 25, height: 35 },
        { type: 'D', width: 15, height: 25 },
      ];

      const result1 = pack(rectangles);
      const result2 = pack(rectangles);
      const result3 = pack(rectangles);

      expect(result1.rectangles).toEqual(result2.rectangles);
      expect(result2.rectangles).toEqual(result3.rectangles);
    });

    it('should produce consistent results with many rectangles', () => {
      const rectangles: Rectangle[] = Array.from({ length: 50 }, (_, i) => ({
        type: `rect${i % 5}`,
        width: 10 + (i % 10),
        height: 10 + (i % 8),
      }));

      const result1 = pack(rectangles);
      const result2 = pack(rectangles);
      const result3 = pack(rectangles);

      expect(result1.rectangles).toEqual(result2.rectangles);
      expect(result2.rectangles).toEqual(result3.rectangles);
    });

    it('should produce consistent results with same-sized rectangles', () => {
      const rectangles: Rectangle[] = Array.from({ length: 10 }, (_, i) => ({
        type: `rect${i}`,
        width: 20,
        height: 20,
      }));

      const result1 = pack(rectangles);
      const result2 = pack(rectangles);
      const result3 = pack(rectangles);

      expect(result1.rectangles).toEqual(result2.rectangles);
      expect(result2.rectangles).toEqual(result3.rectangles);
    });

    it('should produce consistent results with groupByType across multiple calls', () => {
      const rectangles: Rectangle[] = [
        { type: 'B', width: 30, height: 40 },
        { type: 'A', width: 20, height: 30 },
        { type: 'B', width: 25, height: 35 },
        { type: 'A', width: 15, height: 25 },
        { type: 'C', width: 35, height: 45 },
      ];

      const options = { groupByType: true, sortBy: 'area' as const };
      const result1 = pack(rectangles, options);
      const result2 = pack(rectangles, options);
      const result3 = pack(rectangles, options);

      expect(result1.rectangles).toEqual(result2.rectangles);
      expect(result2.rectangles).toEqual(result3.rectangles);
    });

    it('should produce consistent results with different padding values', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 30, height: 40 },
        { type: 'B', width: 20, height: 30 },
        { type: 'C', width: 25, height: 35 },
      ];

      for (const padding of [0, 5, 10, 20]) {
        const result1 = pack(rectangles, { padding });
        const result2 = pack(rectangles, { padding });
        const result3 = pack(rectangles, { padding });

        expect(result1.rectangles).toEqual(result2.rectangles);
        expect(result2.rectangles).toEqual(result3.rectangles);
      }
    });

    it('should not modify original rectangles in non-inPlace mode', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 30, height: 40 },
        { type: 'B', width: 20, height: 30 },
      ];

      const original = JSON.parse(JSON.stringify(rectangles));
      pack(rectangles);

      expect(rectangles).toEqual(original);
    });

    it('should modify rectangles in inPlace mode', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 30, height: 40 },
        { type: 'B', width: 20, height: 30 },
      ];

      const result = pack(rectangles, { inPlace: true });

      expect(rectangles[0]).toBe(result.rectangles[0]);
      expect(rectangles[0].left).toBeDefined();
      expect(rectangles[0].top).toBeDefined();
    });
  });

  describe('Padding', () => {
    it('should respect padding between rectangles', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 30, height: 40 },
        { type: 'B', width: 20, height: 30 },
      ];

      const padding = 10;
      const result = pack(rectangles, { padding });

      // 检查间距
      for (let i = 0; i < result.rectangles.length; i++) {
        for (let j = i + 1; j < result.rectangles.length; j++) {
          const a = result.rectangles[i];
          const b = result.rectangles[j];

          const horizontalGap = Math.min(
            Math.abs(a.left + a.width - b.left),
            Math.abs(b.left + b.width - a.left)
          );
          const verticalGap = Math.min(
            Math.abs(a.top + a.height - b.top),
            Math.abs(b.top + b.height - a.top)
          );

          const minGap = Math.min(horizontalGap, verticalGap);

          // 如果矩形在同一行或同一列，检查间距
          if (minGap < 1) {
            expect(Math.max(horizontalGap, verticalGap)).toBeGreaterThanOrEqual(padding - 0.01);
          }
        }
      }
    });

    it('should respect paddingBorder', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 30, height: 40 },
      ];

      const result = pack(rectangles, { paddingBorder: 10 });

      expect(result.rectangles[0].left).toBe(10);
      expect(result.rectangles[0].top).toBe(10);
      expect(result.actualBounds.width).toBe(50);
      expect(result.actualBounds.height).toBe(60);
    });

    it('should respect asymmetric paddingBorder', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 30, height: 40 },
      ];

      const result = pack(rectangles, { paddingBorder: [5, 15] });

      expect(result.rectangles[0].left).toBe(15);
      expect(result.rectangles[0].top).toBe(5);
    });
  });

  describe('Grouping', () => {
    it('should group rectangles by type when groupByType is true', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 30, height: 40 },
        { type: 'B', width: 20, height: 30 },
        { type: 'A', width: 25, height: 35 },
        { type: 'B', width: 15, height: 25 },
      ];

      const grouped = groupRectanglesByType(rectangles);

      // 检查同类型的矩形是否相邻
      expect(grouped[0].type).toBe(grouped[1].type);
      expect(grouped[2].type).toBe(grouped[3].type);
    });

    it('should pack grouped rectangles', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 30, height: 40 },
        { type: 'B', width: 20, height: 30 },
        { type: 'A', width: 25, height: 35 },
      ];

      const result = pack(rectangles, { groupByType: true, sortBy: 'area' });

      expect(result.rectangles.length).toBe(3);
    });
  });

  describe('Position Preservation', () => {
    it('should preserve relative positions when preservePosition is true', () => {
      const rectangles: PlacedRectangle[] = [
        { type: 'A', width: 30, height: 40, left: 10, top: 10 },
        { type: 'B', width: 20, height: 30, left: 60, top: 10 },
        { type: 'C', width: 25, height: 35, left: 10, top: 70 },
      ];

      const result = pack(rectangles, {
        preservePosition: true,
        sortBy: 'position',
        paddingBorder: 0
      });

      // 检查所有矩形都被打包了
      expect(result.rectangles.length).toBe(rectangles.length);

      // 检查相对位置关系是否大致保留
      // A应该在B的左边
      const rectA = result.rectangles.find(r => r.type === 'A')!;
      const rectB = result.rectangles.find(r => r.type === 'B')!;
      const rectC = result.rectangles.find(r => r.type === 'C')!;

      expect(rectA.left).toBeLessThanOrEqual(rectB.left);
      
      // C应该在A下方
      expect(rectC.top).toBeGreaterThanOrEqual(rectA.top);
    });

    it('should try to keep rectangles near their original positions', () => {
      const rectangles: PlacedRectangle[] = [
        { type: 'A', width: 30, height: 40, left: 100, top: 100 },
        { type: 'B', width: 20, height: 30, left: 150, top: 100 },
      ];

      const result = pack(rectangles, {
        preservePosition: true,
        sortBy: 'position',
        containerWidth: 300,
        containerHeight: 300
      });

      // 矩形不应该被移动到容器的左上角（0,0）
      // 它们应该尝试保持在原来的区域附近
      const rectA = result.rectangles.find(r => r.type === 'A')!;
      const rectB = result.rectangles.find(r => r.type === 'B')!;

      // B应该在A的右边
      expect(rectB.left).toBeGreaterThan(rectA.left);
    });

    it('should work with groupByType and preservePosition', () => {
      const rectangles: PlacedRectangle[] = [
        { type: 'A', width: 30, height: 40, left: 0, top: 0 },
        { type: 'B', width: 20, height: 30, left: 50, top: 0 },
        { type: 'A', width: 25, height: 35, left: 0, top: 60 },
        { type: 'B', width: 15, height: 25, left: 70, top: 0 },
      ];

      const result = pack(rectangles, {
        preservePosition: true,
        groupByType: true,
        sortBy: 'position'
      });

      expect(result.rectangles.length).toBe(4);
      
      // 同类型的矩形应该大致保持相对位置
      const typeA = result.rectangles.filter(r => r.type === 'A');
      const typeB = result.rectangles.filter(r => r.type === 'B');

      expect(typeA.length).toBe(2);
      expect(typeB.length).toBe(2);
    });
  });

  describe('Sorting', () => {
    it('should sort by area in descending order', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 10, height: 10 },
        { type: 'B', width: 30, height: 30 },
        { type: 'C', width: 20, height: 20 },
      ];

      const result = pack(rectangles, { sortBy: 'area' });

      // 最大的矩形应该在左上角
      const largest = result.rectangles.find(r => r.width === 30);
      expect(largest).toBeDefined();
      expect(largest!.left).toBeLessThanOrEqual(10);
      expect(largest!.top).toBeLessThanOrEqual(10);
    });
  });

  describe('Container Size Adjustment', () => {
    it('should expand container if rectangles do not fit', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 100, height: 100 },
        { type: 'B', width: 100, height: 100 },
        { type: 'C', width: 100, height: 100 },
      ];

      const result = pack(rectangles, {
        containerWidth: 50,
        containerHeight: 50
      });

      expect(result.suggestedContainerWidth).toBeGreaterThan(50);
      expect(result.rectangles.length).toBe(3);
    });

    it('should respect targetAspectRatio when expanding', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 100, height: 100 },
        { type: 'B', width: 100, height: 100 },
      ];

      const result = pack(rectangles, {
        containerWidth: 50,
        containerHeight: 50,
        targetAspectRatio: 2 // width:height = 2:1
      });

      const ratio = result.suggestedContainerWidth / result.suggestedContainerHeight;
      expect(ratio).toBeCloseTo(2, 0);
    });
  });

  describe('Bounds Calculation', () => {
    it('should calculate actual bounds correctly', () => {
      const rectangles: PlacedRectangle[] = [
        { type: 'A', width: 30, height: 40, left: 0, top: 0 },
        { type: 'B', width: 20, height: 30, left: 50, top: 0 },
      ];

      const bounds = calculateBounds(rectangles, 0, 0);

      expect(bounds.width).toBe(70); // 50 + 20
      expect(bounds.height).toBe(40);
    });

    it('should include padding border in bounds', () => {
      const rectangles: PlacedRectangle[] = [
        { type: 'A', width: 30, height: 40, left: 10, top: 10 },
      ];

      const bounds = calculateBounds(rectangles, 10, 10);

      expect(bounds.width).toBe(50); // 10 + 30 + 10
      expect(bounds.height).toBe(60); // 10 + 40 + 10
    });
  });

  describe('Large Rectangles Positioning', () => {
    it('should place large rectangles towards top-left', () => {
      const rectangles: Rectangle[] = [
        { type: 'small', width: 10, height: 10 },
        { type: 'small', width: 10, height: 10 },
        { type: 'large', width: 50, height: 50 },
        { type: 'small', width: 10, height: 10 },
      ];

      const result = pack(rectangles, { sortBy: 'area' });

      const large = result.rectangles.find(r => r.width === 50);
      const smallRects = result.rectangles.filter(r => r.width === 10);

      expect(large).toBeDefined();

      // 大矩形应该比大部分小矩形更靠近左上角
      const largeDistance = large!.left + large!.top;
      const avgSmallDistance = smallRects.reduce((sum, r) => sum + r.left + r.top, 0) / smallRects.length;

      expect(largeDistance).toBeLessThan(avgSmallDistance);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large rectangles', () => {
      const rectangles: Rectangle[] = [
        { type: 'huge', width: 1000, height: 1000 },
        { type: 'small', width: 10, height: 10 },
      ];

      const result = pack(rectangles);

      expect(result.rectangles.length).toBe(2);
      expect(result.suggestedContainerWidth).toBeGreaterThanOrEqual(1000);
    });

    it('should handle many small rectangles', () => {
      const rectangles: Rectangle[] = Array.from({ length: 100 }, (_, i) => ({
        type: `rect${i}`,
        width: 10 + (i % 5),
        height: 10 + (i % 5),
      }));

      const result = pack(rectangles);

      expect(result.rectangles.length).toBe(100);

      // 检查没有重叠
      for (let i = 0; i < result.rectangles.length; i++) {
        for (let j = i + 1; j < result.rectangles.length; j++) {
          const a = result.rectangles[i];
          const b = result.rectangles[j];

          const noOverlap =
            a.left + a.width <= b.left ||
            b.left + b.width <= a.left ||
            a.top + a.height <= b.top ||
            b.top + b.height <= a.top;

          expect(noOverlap).toBe(true);
        }
      }
    });

    it('should handle rectangles with various aspect ratios', () => {
      const rectangles: Rectangle[] = [
        { type: 'wide', width: 100, height: 10 },
        { type: 'tall', width: 10, height: 100 },
        { type: 'square', width: 50, height: 50 },
        { type: 'wide2', width: 80, height: 15 },
        { type: 'tall2', width: 15, height: 80 },
      ];

      const result = pack(rectangles);

      expect(result.rectangles.length).toBe(5);

      // 检查没有重叠
      for (let i = 0; i < result.rectangles.length; i++) {
        for (let j = i + 1; j < result.rectangles.length; j++) {
          const a = result.rectangles[i];
          const b = result.rectangles[j];

          const noOverlap =
            a.left + a.width <= b.left ||
            b.left + b.width <= a.left ||
            a.top + a.height <= b.top ||
            b.top + b.height <= a.top;

          expect(noOverlap).toBe(true);
        }
      }
    });

    it('should handle zero padding', () => {
      const rectangles: Rectangle[] = [
        { type: 'A', width: 30, height: 40 },
        { type: 'B', width: 20, height: 30 },
      ];

      const result = pack(rectangles, { padding: 0 });

      expect(result.rectangles.length).toBe(2);

      // 矩形可以紧密相邻但不能重叠
      const a = result.rectangles[0];
      const b = result.rectangles[1];

      const noOverlap =
        a.left + a.width <= b.left ||
        b.left + b.width <= a.left ||
        a.top + a.height <= b.top ||
        b.top + b.height <= a.top;

      expect(noOverlap).toBe(true);
    });

    it('should handle very small rectangles', () => {
      const rectangles: Rectangle[] = Array.from({ length: 20 }, (_, i) => ({
        type: `tiny${i}`,
        width: 1,
        height: 1,
      }));

      const result = pack(rectangles, { padding: 1 });

      expect(result.rectangles.length).toBe(20);

      // 检查没有重叠
      for (let i = 0; i < result.rectangles.length; i++) {
        for (let j = i + 1; j < result.rectangles.length; j++) {
          const a = result.rectangles[i];
          const b = result.rectangles[j];

          const noOverlap =
            a.left + a.width <= b.left ||
            b.left + b.width <= a.left ||
            a.top + a.height <= b.top ||
            b.top + b.height <= a.top;

          expect(noOverlap).toBe(true);
        }
      }
    });

    it('should handle mixed sizes with extreme differences', () => {
      const rectangles: Rectangle[] = [
        { type: 'huge', width: 500, height: 500 },
        { type: 'tiny', width: 5, height: 5 },
        { type: 'medium', width: 50, height: 50 },
        { type: 'tiny2', width: 3, height: 3 },
        { type: 'large', width: 200, height: 200 },
      ];

      const result = pack(rectangles);

      expect(result.rectangles.length).toBe(5);

      // 检查没有重叠
      for (let i = 0; i < result.rectangles.length; i++) {
        for (let j = i + 1; j < result.rectangles.length; j++) {
          const a = result.rectangles[i];
          const b = result.rectangles[j];

          const noOverlap =
            a.left + a.width <= b.left ||
            b.left + b.width <= a.left ||
            a.top + a.height <= b.top ||
            b.top + b.height <= a.top;

          expect(noOverlap).toBe(true);
        }
      }
    });
  });
});