import { Rect, Ellipse, Polygon, Line, Group, Leafer, ILeafer, PointerEvent, UI } from 'leafer-ui';
import { GridAgent, AgentIcon, AgentId, GridEnvironmentCoordOffset, AgentTrajectoryPoint } from '@/types/model';
import { NPYParser } from '@/utils/npy-parser';
import { createNumpyBackground } from '@/utils/numpy-renderer';
import { uint8ArrayToArrayBuffer } from '@/utils/msgpack';

interface GridEnvironmentProps {
  width: number;
  height: number;
  background?: string | Uint8Array;
  coordOffset?: GridEnvironmentCoordOffset;
}

interface ShapeCache {
  envWidth: number;
  envHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  cellSize: number;
}

interface AgentShape {
  group: Group;
  shape: UI;
  agent: GridAgent;
  icon: AgentIcon;
  size: number;
  color: string;
}

interface TrajectoryCache {
  group: Group;
  lastRenderedIndex: number;
  color: string;
}

const SHAPE_CONFIGS: Record<AgentIcon, (size: number) => any> = {
  arrow: (size) => ({ points: [size, 0, -size / 2, -size / 2, -size / 2, size / 2] }),
  square: (size) => ({ width: size, height: size, x: -size / 2, y: -size / 2 }),
  circle: (size) => ({ width: size, height: size, x: -size / 2, y: -size / 2 }),
  triangle: (size) => ({ points: [0, -size / 2, -size / 2, size / 2, size / 2, size / 2] }),
};

const SHAPE_CLASSES: Record<AgentIcon, typeof UI> = {
  arrow: Polygon,
  square: Rect,
  triangle: Polygon,
  circle: Ellipse,
};

export class GridVisualizer {
  private container: HTMLElement;
  private leafer: ILeafer | null = null;
  private layers: { bg?: Rect; grid?: Group; trajectories?: Group; agents?: Group } = {};
  private agentCache: Record<AgentId, GridAgent> = {};
  private agentShapes: Map<string, AgentShape> = new Map();
  private trajectoryCache: Map<string, TrajectoryCache> = new Map();
  private trajectoryData: Record<string, AgentTrajectoryPoint[]> = {};
  private shapeCache: ShapeCache;
  private envProps: GridEnvironmentProps;
  private resizeObserver: ResizeObserver | null = null;
  private coordOffset: GridEnvironmentCoordOffset = 'int';

  // Event callbacks
  private onAgentClick?: (agent: GridAgent, event: any) => void;
  private onAgentContextMenu?: (agent: GridAgent, event: any) => void;

  constructor(container: HTMLElement, envProps: GridEnvironmentProps) {
    this.container = container;
    this.envProps = envProps;
    this.coordOffset = envProps.coordOffset || 'int';
    this.shapeCache = this.calculateShapes(envProps, container.clientWidth, container.clientHeight);
    this.initialize();
  }

  private calculateShapes(env: { width: number; height: number }, width: number, height: number): ShapeCache {
    const cellWidth = width / env.width;
    const cellHeight = height / env.height;
    const cellSize = Math.max(Math.min(cellWidth, cellHeight), 4);
    const canvasWidth = cellSize * env.width;
    const canvasHeight = cellSize * env.height;

    return {
      envWidth: env.width,
      envHeight: env.height,
      canvasWidth,
      canvasHeight,
      cellSize,
    };
  }

  private initialize(): void {
    const { canvasWidth, canvasHeight } = this.shapeCache;

    this.leafer = new Leafer({
      view: this.container,
      width: canvasWidth,
      height: canvasHeight,
    });

    // Initialize layers in correct order: bg -> grid -> trajectories -> agents
    this.layers.bg = new Rect({ width: canvasWidth, height: canvasHeight, fill: '#f0f0f0', cornerSmoothing: 0 });
    this.layers.grid = new Group();
    this.layers.trajectories = new Group();
    this.layers.agents = new Group();

    this.leafer.add(this.layers.bg);
    this.leafer.add(this.layers.grid);
    this.leafer.add(this.layers.trajectories);
    this.leafer.add(this.layers.agents);

    this.updateGridSize();
    this.setupResizeObserver();

    // Disable image smoothing on the underlying canvas for pixel-perfect rendering
    // Use setTimeout to ensure canvas is created
    setTimeout(() => this.disableCanvasSmoothing(), 0);
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.handleResize();
    });
    this.resizeObserver.observe(this.container);
  }

  private handleResize(): void {
    const rect = this.container.getBoundingClientRect();
    this.setCanvasSize(rect.width, rect.height);
    this.updateGridSize();
    this.refreshAllAgents();
    // Rebuild all trajectories with new cell size
    this.rebuildAllTrajectories();
  }

  private rebuildAllTrajectories(): void {
    const trajectoriesLayer = this.layers.trajectories;
    if (!trajectoriesLayer) return;

    // Clear all trajectory groups and reset cache
    this.trajectoryCache.forEach((cached) => {
      cached.group.clear();
      cached.lastRenderedIndex = -1;
    });

    // Redraw all trajectories from stored data
    Object.entries(this.trajectoryData).forEach(([agentId, points]) => {
      if (points && points.length > 0) {
        const agent = this.agentCache[agentId];
        this.updateAgentTrajectory(agentId, points, agent?.trajectory_color);
      }
    });
  }

  private setCanvasSize(width: number, height: number): void {
    this.shapeCache = this.calculateShapes(this.envProps, width, height);
    const { canvasWidth, canvasHeight } = this.shapeCache;

    if (this.leafer) {
      const x = (width - canvasWidth) / 2;
      const y = (height - canvasHeight) / 2;
      this.leafer.set({ width: canvasWidth + x, height: canvasHeight + y, x, y });
    }

    if (this.layers.bg) {
      this.layers.bg.set({ width: canvasWidth, height: canvasHeight });
    }
  }

  private updateGridSize(): void {
    const gridGroup = this.layers.grid;
    if (!gridGroup) return;

    gridGroup.clear();
    const { canvasWidth, canvasHeight, cellSize } = this.shapeCache;
    const { width, height } = this.envProps;

    for (let i = 0; i <= width; i++) {
      gridGroup.add(new Line({
        points: [i * cellSize, 0, i * cellSize, canvasHeight],
        stroke: '#dddddd',
        strokeWidth: 1
      }));
    }
    for (let j = 0; j <= height; j++) {
      gridGroup.add(new Line({
        points: [0, j * cellSize, canvasWidth, j * cellSize],
        stroke: '#dddddd',
        strokeWidth: 1
      }));
    }
  }

  private createShape(icon: AgentIcon = 'circle', size: number, color: string): UI {
    const ShapeClass = SHAPE_CLASSES[icon];
    return new ShapeClass({ ...SHAPE_CONFIGS[icon]?.(size), fill: color });
  }

  private updateAgentDisplay(agent: GridAgent): void {
    if (agent.x === undefined || agent.y === undefined) return;

    const { cellSize } = this.shapeCache;
    const agentId = String(agent.id);
    const icon = agent.icon || 'circle';
    const size = (agent.size || 10) * (cellSize / 10);
    const posDiff = this.coordOffset === 'int' ? cellSize / 2 : 0;
    const x = agent.x * cellSize + posDiff;
    const y = agent.y * cellSize + posDiff;
    const color = agent.color || '#333333';
    const rotation = agent.heading ? (agent.heading * 180 / Math.PI) : 0;

    let cached = this.agentShapes.get(agentId);

    if (cached) {
      // Update existing
      cached.group.set({ x, y, rotation });
      if (cached.icon !== icon || cached.size !== size) {
        cached.shape.set(SHAPE_CONFIGS[icon]?.(size));
        cached.icon = icon;
        cached.size = size;
      }
      if (cached.color !== color) {
        cached.shape.set({ fill: color });
        cached.color = color;
      }
      cached.agent = agent;
    } else {
      // Create new
      const group = new Group({ x, y, rotation });
      const shape = this.createShape(icon, size, color);

      shape.on(PointerEvent.CLICK, (e: any) => {
        const agent = this.agentShapes.get(agentId)?.agent;
        if (agent) {
          this.onAgentClick?.(agent, e);
        }
      });
      shape.on(PointerEvent.MENU, (e: any) => {
        const agent = this.agentShapes.get(agentId)?.agent;
        if (agent) {
          this.onAgentContextMenu?.(agent, e);
        }
      });

      group.add(shape);

      this.layers.agents?.add(group);
      this.agentShapes.set(agentId, { group, shape, icon, agent, size, color });
    }
  }

  private refreshAllAgents(): void {
    Object.values(this.agentCache).forEach(agent => {
      this.updateAgentDisplay(agent);
    });
  }

  private async loadImageAsync(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve) => {
      const img = new Image();
      // Disable image smoothing for pixel-perfect rendering
      img.style.imageRendering = 'pixelated';
      img.style.setProperty('image-rendering', '-moz-crisp-edges', '');
      img.style.setProperty('image-rendering', 'crisp-edges', '');
      img.onload = () => resolve(img);
      img.src = src;
    });
  }

  private disableCanvasSmoothing(): void {
    // Find the canvas element and disable image smoothing
    const canvas = this.container.querySelector('canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
      }
    }
  }

  private updateAgentTrajectory(agentId: string, trajectoryPoints: AgentTrajectoryPoint[], color?: string): void {
    const trajectoriesLayer = this.layers.trajectories;
    if (!trajectoriesLayer) return;

    const { cellSize } = this.shapeCache;
    const agentIdStr = String(agentId);

    // Default trajectory color: semi-transparent blue
    const trajectoryColor = color || 'rgba(66, 133, 244, 0.5)';

    let cached = this.trajectoryCache.get(agentIdStr);

    // If no cache or color changed, recreate
    if (!cached || cached.color !== trajectoryColor) {
      // Remove old trajectory if exists
      if (cached) {
        cached.group.remove();
      }

      // Create new group
      const posDiff = this.coordOffset === 'int' ? cellSize / 2 : 0;
      cached = {
        group: new Group({ x: posDiff, y: posDiff }),
        lastRenderedIndex: -1,
        color: trajectoryColor,
      };
      
      trajectoriesLayer.add(cached.group);
      this.trajectoryCache.set(agentIdStr, cached);
    }

    // Render only new points (incremental)
    const startIdx = Math.max(0, cached.lastRenderedIndex);
    let maxTime = trajectoryPoints[trajectoryPoints.length - 1]?.time ?? startIdx;
    for (let i = trajectoryPoints.length - 2; i > - 1; --i) {
      const p1 = trajectoryPoints[i];
      const p2 = trajectoryPoints[i + 1];

      const currentTime = p2.time;
      if (currentTime <= startIdx) {
        break;
      }

      
      const x1 = p1.x * cellSize;
      const y1 = p1.y * cellSize;
      const x2 = p2.x * cellSize;
      const y2 = p2.y * cellSize;

      // Use point color if available, otherwise use trajectory color
      const lineColor = p1.color || trajectoryColor;

      const line = new Line({
        points: [x1, y1, x2, y2],
        stroke: lineColor,
        strokeWidth: 2,
      });

      cached.group.add(line);
      if (cached.group.children.length > trajectoryPoints.length) {
        const linesToRemove = cached.group.children.slice(0, cached.group.children.length - trajectoryPoints.length);
        for (const l of linesToRemove) {
          cached.group.remove(l);
        }
      }
    }

    // Update last rendered index
    cached.lastRenderedIndex = maxTime;
  }

  // Public methods

  public setEventHandlers(handlers: {
    onAgentClick?: (agent: GridAgent, event: any) => void;
    onAgentContextMenu?: (agent: GridAgent, event: any) => void;
  }): void {
    this.onAgentClick = handlers.onAgentClick;
    this.onAgentContextMenu = handlers.onAgentContextMenu;
  }

  public async updateBackground(background?: string | Uint8Array): Promise<void> {
    const bgLayer = this.layers.bg;
    if (!bgLayer) return;

    if (typeof background === 'string') {
      const img = await this.loadImageAsync(background);
      bgLayer.set({ fill: { type: 'image', url: img.src } });
    } else if (background instanceof Uint8Array) {
      const parsed = NPYParser.parse(uint8ArrayToArrayBuffer(background));
      const bgImg = createNumpyBackground(parsed);
      if (bgImg) {
        await this.loadImageAsync(bgImg.src);
        bgLayer.set({ fill: { type: 'image', url: bgImg.src } });
      } else {
        bgLayer.set({ fill: '#f0f0f0' });
      }
    } else {
      bgLayer.set({ fill: '#f0f0f0' });
    }
  }

  public updateEnvironment(envProps: GridEnvironmentProps): void {
    const dimensionsChanged =
      this.envProps.width !== envProps.width ||
      this.envProps.height !== envProps.height;

    this.envProps = envProps;
    this.coordOffset = envProps.coordOffset || 'int';

    if (dimensionsChanged) {
      const rect = this.container.getBoundingClientRect();
      this.setCanvasSize(rect.width, rect.height);
      this.updateGridSize();
    }

    void this.updateBackground(envProps.background);
  }

  public updateAgents(agents: Record<string, GridAgent>): void {
    const agentsGroup = this.layers.agents;
    if (!agentsGroup) return;

    const currentAgentIds = new Set(Object.keys(agents).map(String));
    const previousAgentIds = new Set(this.agentShapes.keys());

    // Remove deleted agents
    previousAgentIds.forEach(id => {
      if (!currentAgentIds.has(id)) {
        this.agentShapes.get(id)?.group.remove();
        this.agentShapes.delete(id);
        // Also remove trajectory
        const trajCache = this.trajectoryCache.get(id);
        if (trajCache) {
          trajCache.group.remove();
          this.trajectoryCache.delete(id);
        }
      }
    });

    // Update or create agents
    this.agentCache = agents;
    this.refreshAllAgents();
  }

  public updateTrajectories(trajectories: Record<string, AgentTrajectoryPoint[]>): void {
    if (!this.layers.trajectories) return;

    // Store trajectory data for later rebuilding
    this.trajectoryData = trajectories;

    // Remove trajectories for agents no longer present
    const currentAgentIds = new Set(Object.keys(trajectories).map(String));
    this.trajectoryCache.forEach((cached, agentId) => {
      if (!currentAgentIds.has(agentId)) {
        cached.group.remove();
        this.trajectoryCache.delete(agentId);
      }
    });

    // Update trajectories incrementally
    Object.entries(trajectories).forEach(([agentId, points]) => {
      if (points && points.length > 0) {
        const agent = this.agentCache[agentId];
        this.updateAgentTrajectory(agentId, points, agent?.trajectory_color);
      }
    });
  }

  public destroy(): void {
    this.resizeObserver?.disconnect();
    this.leafer?.destroy();
    this.leafer = null;
    this.layers = {};
    this.agentShapes.clear();
    this.trajectoryCache.clear();
  }
}