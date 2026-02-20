/**
 * environment/utils/shape.ts
 *
 * Leafer-UI shape factories shared between AgentLayer and EdgeLayer.
 */

import { Rect, Ellipse, Polygon, Line, Text, UI } from 'leafer-ui';
import { AgentIcon } from '../types';

// ---------------------------------------------------------------------------
// Shape config map — returns the property bag for each icon type
// ---------------------------------------------------------------------------

export const SHAPE_CONFIGS: Record<AgentIcon, (size: number) => Record<string, unknown>> = {
  arrow:    (s) => ({ points: [s, 0, -s / 2, -s / 2, -s / 2, s / 2] }),
  square:   (s) => ({ width: s, height: s, x: -s / 2, y: -s / 2 }),
  circle:   (s) => ({ width: s, height: s, x: -s / 2, y: -s / 2 }),
  triangle: (s) => ({ points: [0, -s / 2, -s / 2, s / 2, s / 2, s / 2] }),
};

export const SHAPE_CLASSES: Record<AgentIcon, new (props?: any) => UI> = {
  arrow:    Polygon,
  square:   Rect,
  triangle: Polygon,
  circle:   Ellipse,
};

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function createAgentShape(
  icon: AgentIcon = 'circle',
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

export function createArrowhead(color: string): Polygon {
  return new Polygon({
    points: [0, 0, -8, 4, -8, -4],
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
