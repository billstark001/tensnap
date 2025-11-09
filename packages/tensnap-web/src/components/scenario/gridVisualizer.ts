import { Rect, Ellipse, Polygon, Line, Group, Leafer, ILeafer, PointerEvent, UI } from 'leafer-ui';
import { TrajectoryPoint, GridAgent, AgentIcon, AgentId } from '@/types/model';
import { NPYParser } from '@/utils/npy-parser';
import { createNumpyBackground } from '@/utils/numpy-renderer';
import { uint8ArrayToArrayBuffer } from '@/utils/msgpack';

interface GridEnvironmentProps {
  width: number;
  height: number;
  background?: string | Uint8Array;
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
  icon: AgentIcon;
  size: number;
  color: string;
}

const SHAPE_CONFIGS: Record<AgentIcon, (size: number) => any> = {
  arrow: (size) => ({ points: [size, 0, -size / 2, -size / 2, -size / 2, size / 2] }),
  square: (size) => ({ width: size, height: size, x: -size / 2, y: -size / 2 }),
  triangle: (size) => ({ points: [0, -size / 2, -size / 2, size / 2, size / 2, size / 2] }),
  circle: (size) => ({ width: size, height: size }),
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
  private layers: { bg?: Rect; grid?: Group; agents?: Group } = {};
  private agentCache: Record<AgentId, GridAgent> = {};
  private agentShapes: Map<string, AgentShape> = new Map();
  private shapeCache: ShapeCache;
  private envProps: GridEnvironmentProps;
  private resizeObserver: ResizeObserver | null = null;
  
  // Event callbacks
  private onAgentClick?: (agent: GridAgent, event: any) => void;
  private onAgentContextMenu?: (agent: GridAgent, event: any) => void;

  constructor(container: HTMLElement, envProps: GridEnvironmentProps) {
    this.container = container;
    this.envProps = envProps;
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

    // Initialize layers in correct order
    this.layers.bg = new Rect({ width: canvasWidth, height: canvasHeight, fill: '#f0f0f0' });
    this.layers.grid = new Group();
    this.layers.agents = new Group();

    this.leafer.add(this.layers.bg);
    this.leafer.add(this.layers.grid);
    this.leafer.add(this.layers.agents);

    this.updateGridSize();
    this.setupResizeObserver();
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
    return new ShapeClass({ ...SHAPE_CONFIGS[icon](size), fill: color });
  }

  private createTrajectory(
    trajectory: TrajectoryPoint[] | null | undefined,
    cellWidth: number,
    cellHeight: number,
    x: number,
    y: number,
    color: string
  ): Line | null {
    if (!trajectory || trajectory.length <= 1) return null;

    return new Line({
      points: trajectory.flatMap(p => [
        p.x * cellWidth + cellWidth / 2 - x,
        p.y * cellHeight + cellHeight / 2 - y
      ]),
      stroke: color,
      strokeWidth: 1,
      opacity: 0.3,
    });
  }

  private updateAgentDisplay(agent: GridAgent): void {
    if (agent.x === undefined || agent.y === undefined) return;

    const { cellSize } = this.shapeCache;
    const agentId = String(agent.id);
    const icon = agent.icon || 'circle';
    const size = (agent.size || 10) * (cellSize / 10);
    const posDiff = (cellSize - size) / 2;
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

      // Update trajectory
      const oldTrajectory = cached.group.children?.find(child => child instanceof Line);
      if (oldTrajectory) oldTrajectory.remove();

      const trajectory = this.createTrajectory(agent.trajectory, cellSize, cellSize, x, y, color);
      if (trajectory) cached.group.add(trajectory);
    } else {
      // Create new
      const group = new Group({ x, y, rotation });
      const shape = this.createShape(icon, size, color);

      shape.on(PointerEvent.CLICK, (e: any) => {
        this.onAgentClick?.(agent, e);
      });
      shape.on(PointerEvent.MENU, (e: any) => {
        this.onAgentContextMenu?.(agent, e);
      });

      group.add(shape);

      const trajectory = this.createTrajectory(agent.trajectory, cellSize, cellSize, x, y, color);
      if (trajectory) {
        group.add(trajectory);
      }

      this.layers.agents?.add(group);
      this.agentShapes.set(agentId, { group, shape, icon, size, color });
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
      img.onload = () => resolve(img);
      img.src = src;
    });
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
      }
    });

    // Update or create agents
    this.agentCache = agents;
    this.refreshAllAgents();
  }

  public destroy(): void {
    this.resizeObserver?.disconnect();
    this.leafer?.destroy();
    this.leafer = null;
    this.layers = {};
    this.agentShapes.clear();
  }
}