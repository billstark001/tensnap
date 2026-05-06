/**
 * environment/utils/viewport.ts
 *
 * Shared viewport normalization, scene-bounds calculation, and image-size
 * resolution helpers used by both browser and headless hosts.
 *
 * These utilities are platform-neutral and belong in `@tensnap/core` so that
 * `EnvironmentView` and `HeadlessEnvironmentView` share the same viewport
 * semantics without duplication.
 */

import type { Viewport } from '../types';
import type { AgentRenderState } from '../storages/AgentStorage';
import type { RenderData } from '../../scenario/render-plan';

const MIN_VIEWPORT_SIZE = 1e-6;

/**
 * Normalize a viewport so that width and height are finite and above a
 * minimum extent.
 */
export function normalizeViewport(viewport: Partial<Viewport>): Viewport {
	return {
		x: Number.isFinite(viewport.x) ? (viewport.x as number) : 0,
		y: Number.isFinite(viewport.y) ? (viewport.y as number) : 0,
		width: Number.isFinite(viewport.width) ? Math.max(viewport.width as number, MIN_VIEWPORT_SIZE) : 1,
		height: Number.isFinite(viewport.height) ? Math.max(viewport.height as number, MIN_VIEWPORT_SIZE) : 1,
	};
}

/**
 * Compute scene bounds from a collection of agents.
 * Each agent contributes a square extent of `size/2` around its centre.
 * A 10% padding is added to all sides.
 */
export function worldBoundsFromAgents(agents: AgentRenderState[]): Viewport {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let validAgentCount = 0;

	for (const agent of agents) {
		const x = Number.isFinite(agent.x) ? agent.x : undefined;
		const y = Number.isFinite(agent.y) ? agent.y : undefined;
		if (x === undefined || y === undefined) {
			continue;
		}

		const size = Number.isFinite(agent.size) ? Math.max(agent.size ?? 1, MIN_VIEWPORT_SIZE) : 1;
		const halfSize = size / 2;
		minX = Math.min(minX, x - halfSize);
		minY = Math.min(minY, y - halfSize);
		maxX = Math.max(maxX, x + halfSize);
		maxY = Math.max(maxY, y + halfSize);
		validAgentCount += 1;
	}

	if (validAgentCount === 0) {
		return { x: 0, y: 0, width: 1, height: 1 };
	}

	const padX = Math.max((maxX - minX) * 0.1, 1);
	const padY = Math.max((maxY - minY) * 0.1, 1);
	return {
		x: minX - padX,
		y: minY - padY,
		width: Math.max(maxX - minX + padX * 2, 1),
		height: Math.max(maxY - minY + padY * 2, 1),
	};
}

/**
 * Resolve a viewport from render data, using an explicit override if provided.
 * Falls back to environment width/height, then to agent-derived bounds.
 */
export function resolveViewport(environment: RenderData, explicit?: Viewport): Viewport {
	if (explicit) {
		return normalizeViewport(explicit);
	}

	if (typeof environment.width === 'number' && typeof environment.height === 'number') {
		return normalizeViewport({ x: 0, y: 0, width: environment.width, height: environment.height });
	}

	return normalizeViewport(worldBoundsFromAgents(environment.agents));
}

function toPixelCount(value: number | undefined): number | undefined {
	return Number.isFinite(value) && (value as number) > 0 ? Math.max(1, Math.round(value as number)) : undefined;
}

export interface ImageSizeDefaults {
	defaultWidth?: number;
	defaultHeight?: number;
}

/**
 * Resolve the output image size from a viewport and optional explicit dimensions.
 *
 * Priority:
 *   1. explicit width + height
 *   2. explicit width only → derive height from viewport aspect ratio
 *   3. explicit height only → derive width from viewport aspect ratio
 *   4. environment has grid width/height → compute cell-based size
 *   5. fall back to defaults
 */
export function resolveImageSize(
	viewport: Viewport,
	environment: Pick<RenderData, 'width' | 'height'>,
	requestedWidth: number | undefined,
	requestedHeight: number | undefined,
	defaults: ImageSizeDefaults = {},
): { width: number; height: number } {
	const width = toPixelCount(requestedWidth);
	const height = toPixelCount(requestedHeight);

	if (width && height) {
		return { width, height };
	}

	if (width) {
		return {
			width,
			height: Math.max(1, Math.round((width / viewport.width) * viewport.height)),
		};
	}

	if (height) {
		return {
			width: Math.max(1, Math.round((height / viewport.height) * viewport.width)),
			height,
		};
	}

	if (typeof environment.width === 'number' && typeof environment.height === 'number') {
		const cellSize = Math.max(12, Math.min(32, Math.floor(960 / Math.max(environment.width, environment.height, 1))));
		return {
			width: Math.max(1, Math.round(environment.width * cellSize)),
			height: Math.max(1, Math.round(environment.height * cellSize)),
		};
	}

	const defaultWidth = Math.max(1, Math.round(defaults.defaultWidth ?? 1024));
	const defaultHeight = toPixelCount(defaults.defaultHeight)
		?? Math.max(1, Math.round((defaultWidth / viewport.width) * viewport.height));
	return { width: defaultWidth, height: defaultHeight };
}
