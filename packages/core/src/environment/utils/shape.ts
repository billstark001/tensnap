/**
 * environment/utils/shape.ts
 *
 * Leafer-UI shape factories shared between AgentLayer and EdgeLayer.
 */

import { Rect, Ellipse, Polygon, Line, Text, UI } from '@leafer-ui/core';
import { BuiltinAgentIcon } from '../types';

const polygonPoints = (sides: number, radius: number, startDeg = -90): number[] => {
  const points: number[] = [];
  const start = (startDeg * Math.PI) / 180;
  for (let i = 0; i < sides; i++) {
    const angle = start + (i * 2 * Math.PI) / sides;
    points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  return points;
};

const starPoints = (outerRadius: number, innerRadius: number): number[] => {
  const points: number[] = [];
  const start = -Math.PI / 2;
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = start + (i * Math.PI) / 5;
    points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  return points;
};

// ---------------------------------------------------------------------------
// Shape config map — returns the property bag for each icon type
// ---------------------------------------------------------------------------

export const SHAPE_CONFIGS: Record<BuiltinAgentIcon, (size: number) => Record<string, unknown>> = {
  arrow:    (s) => ({ points: [s, 0, -s / 2, -s / 2, -s / 2, s / 2] }),
  square:   (s) => ({ width: s, height: s, x: -s / 2, y: -s / 2 }),
  circle:   (s) => ({ width: s, height: s, x: -s / 2, y: -s / 2 }),
  triangle: (s) => ({ points: [0, -s / 2, -s / 2, s / 2, s / 2, s / 2] }),
  diamond:  (s) => ({ points: [0, -s / 2, s / 2, 0, 0, s / 2, -s / 2, 0] }),
  star:     (s) => ({ points: starPoints(s / 2, s / 4) }),
  hexagon:  (s) => ({ points: polygonPoints(6, s / 2, -90) }),
  pentagon: (s) => ({ points: polygonPoints(5, s / 2, -90) }),
  plus:     (s) => {
    const w = s / 2;
    const t = s / 6;
    return {
      points: [-t, -w, t, -w, t, -t, w, -t, w, t, t, t, t, w, -t, w, -t, t, -w, t, -w, -t, -t, -t],
    };
  },
  cross:    (s) => {
    const w = s / 2;
    const t = s / 6;
    return {
      points: [-w, -w, -w + t, -w, 0, -t, w - t, -w, w, -w, t, 0, w, w, w - t, w, 0, t, -w + t, w, -w, w, -t, 0],
    };
  },
};

export const SHAPE_CLASSES: Record<BuiltinAgentIcon, new (props?: any) => UI> = {
  arrow:    Polygon,
  square:   Rect,
  triangle: Polygon,
  circle:   Ellipse,
  diamond:  Polygon,
  star:     Polygon,
  hexagon:  Polygon,
  cross:    Polygon,
  plus:     Polygon,
  pentagon: Polygon,
};

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function createAgentShape(
  icon: BuiltinAgentIcon = 'circle',
  size: number,
  color: string
): UI {
  const Cls = SHAPE_CLASSES[icon];
  return new Cls({ ...SHAPE_CONFIGS[icon](size), fill: color });
}

export function createAgentLabel(id: string | number, size: number): Text {
  const fontSize = Math.max(8, size * 0.6);
  return new Text({
    text: String(id),
    fontSize,
    fill: 'white',
    textAlign: 'center',
    verticalAlign: 'middle',
    x: -size,
    y: -fontSize / 2,
    width: size * 2,
    height: fontSize,
    hitTest: false,
  });
}

export function createArrowhead(color: string, size: number = 1): Polygon {
  return new Polygon({
    points: [0, 0, -size, size / 2, -size, -size / 2],
    fill: color,
    rotation: 0,
  });
}

export function createEdgeLine(
  color: string,
  width: number,
  style?: 'solid' | 'dashed' | 'dotted'
): Line {
  let dashPattern: number[] | undefined;
  if (style === 'dashed') dashPattern = [5, 5];
  else if (style === 'dotted') dashPattern = [2, 2];

  return new Line({
    points: [0, 0, 1, 1],
    stroke: color,
    strokeWidth: width,
    ...(dashPattern ? { dashPattern } : {}),
  });
}

/** Apply canvas pixel-perfect settings to a <canvas> element. */
export function disableCanvasSmoothing(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    (ctx as any).webkitImageSmoothingEnabled = false;
    (ctx as any).mozImageSmoothingEnabled = false;
    (ctx as any).msImageSmoothingEnabled = false;
  }
  canvas.style.imageRendering = 'pixelated';
  canvas.style.setProperty('image-rendering', '-webkit-crisp-edges', '');
  canvas.style.setProperty('image-rendering', '-moz-crisp-edges', '');
  canvas.style.setProperty('image-rendering', 'crisp-edges', '');
}
