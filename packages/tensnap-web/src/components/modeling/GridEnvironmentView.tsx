import { useRef, useEffect, useCallback, useState } from 'react';
import { Rect, Ellipse, Polygon, Line, Group, Leafer, ILeafer, PointerEvent, UI } from 'leafer-ui';
import { TrajectoryPoint, GridAgent, AgentIcon } from '@/types/model';
import { NPYParser } from '@/utils/npy-parser';
import { createNumpyBackground } from '@/utils/numpy-renderer';
import * as styles from './GridEnvironmentView.css';
import { uint8ArrayToArrayBuffer } from '@/utils/msgpack';
import { InstantiatedGridEnvironment } from '@/store/scenario-inst';
import { AgentDetailsDialog } from './AgentDetailsDialog';
import { throttle } from '@/utils/react';

interface GridEnvironmentViewProps {
  environment: InstantiatedGridEnvironment;
  updateTrigger?: any;
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

const createShape = (icon: AgentIcon = 'circle', size: number, color: string) => {
  const ShapeClass = SHAPE_CLASSES[icon];
  return new ShapeClass({ ...SHAPE_CONFIGS[icon](size), fill: color, });
};

const createTrajectory = (trajectory: TrajectoryPoint[] | null | undefined, cellWidth: number, cellHeight: number, x: number, y: number, color: string) => {
  if (!trajectory || trajectory.length <= 1) return null;

  return new Line({
    points: trajectory.flatMap(p => [p.x * cellWidth + cellWidth / 2 - x, p.y * cellHeight + cellHeight / 2 - y]),
    stroke: color,
    strokeWidth: 1,
    opacity: 0.3,
  });
};

const loadImageAsync = (src: string) => new Promise<HTMLImageElement>((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.src = src;
});

type ShapeCache = {
  envWidth: number;
  envHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  cellSize: number;
};

const calculateShapes = (env: { width: number, height: number }, width: number, height: number): ShapeCache => {
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
};

const defaultShapeCache = calculateShapes({ width: 10, height: 10 }, 400, 400);

type AgentShape = {
  group: Group;
  shape: UI;
  icon: AgentIcon;
  size: number;
  color: string;
};

export function GridEnvironmentView({ environment, updateTrigger }: GridEnvironmentViewProps) {
  const { props: envProps, agents: agentsProps } = environment;
  const envRef = useRef(envProps);
  useEffect(() => {
    envRef.current = envProps;
  }, [envProps]);

  const containerRef = useRef<HTMLDivElement>(null);
  const shapeCacheRef = useRef<ShapeCache>(defaultShapeCache);
  const leaferRef = useRef<ILeafer | null>(null);
  const layersRef = useRef<{ bg?: Rect; grid?: Group; agents?: Group }>({});
  const agentShapesRef = useRef<Map<string, AgentShape>>(new Map());

  const [selectedAgent, setSelectedAgent] = useState<GridAgent | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleAgentClick = useCallback((agent: GridAgent, e: any) => {
    e.type === PointerEvent.CLICK ? setSelectedAgent(agent) : setContextMenu({ x: e.x, y: e.y });
  }, []);

  const setCanvasSize = useCallback((width: number, height: number) => {
    const shapeCache = calculateShapes(envRef.current, width, height);
    shapeCacheRef.current = shapeCache;
    const { canvasWidth, canvasHeight } = shapeCache;
    if (leaferRef.current) {
      leaferRef.current.set({ width: canvasWidth, height: canvasHeight });
    }
    if (layersRef.current?.bg) {
      layersRef.current.bg.set({ width: canvasWidth, height: canvasHeight });
    }
    return shapeCache;
  }, []);

  const updateGridSize = useCallback((env: { width: number; height: number }) => {
    const gridGroup = layersRef.current.grid;
    if (!gridGroup) {
      return;
    }

    // Clear existing grid lines
    gridGroup.clear();
    const { canvasWidth, canvasHeight, cellSize } = shapeCacheRef.current;
    for (let i = 0; i <= env.width; i++) {
      gridGroup.add(new Line({ points: [i * cellSize, 0, i * cellSize, canvasHeight], stroke: '#dddddd', strokeWidth: 1 }));
    }
    for (let j = 0; j <= env.height; j++) {
      gridGroup.add(new Line({ points: [0, j * cellSize, canvasWidth, j * cellSize], stroke: '#dddddd', strokeWidth: 1 }));
    }
  }, []);

  const updateAgentDisplay = useCallback((agent: GridAgent) => {
    if (agent.x === undefined || agent.y === undefined) {
      return;
    }
    const { cellSize } = shapeCacheRef.current;

    const agentId = String(agent.id);
    const icon = agent.icon || 'circle';
    const size = (agent.size || 10) * (cellSize / 10);
    const posDiff = (cellSize - size) / 2;
    const x = agent.x * cellSize + posDiff;
    const y = agent.y * cellSize + posDiff;
    const color = agent.color || '#333333';
    const rotation = agent.heading ? (agent.heading * 180 / Math.PI) : 0;

    let cached = agentShapesRef.current.get(agentId);

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

      const trajectory = createTrajectory(agent.trajectory, cellSize, cellSize, x, y, color);
      if (trajectory) cached.group.add(trajectory);
    } else {
      // Create new
      const group = new Group({ x, y, rotation });
      const shape = createShape(icon, size, color);

      shape.on(PointerEvent.CLICK, (e: any) => handleAgentClick(agent, e));
      shape.on(PointerEvent.MENU, (e: any) => handleAgentClick(agent, e));

      group.add(shape);

      const trajectory = createTrajectory(agent.trajectory, cellSize, cellSize, x, y, color);
      if (trajectory) {
        group.add(trajectory);
      }

      layersRef.current.agents?.add(group);
      agentShapesRef.current.set(agentId, { group, shape, icon, size: size, color });
    }
  }, [handleAgentClick]);

  // Initialize Leafer and create layers
  useEffect(() => {
    if (!containerRef.current) return;

    const shapeCache = setCanvasSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    const { canvasWidth, canvasHeight } = shapeCache;

    leaferRef.current?.destroy();
    leaferRef.current = new Leafer({
      view: containerRef.current,
      width: canvasWidth,
      height: canvasHeight,
    });

    // Initialize layers in correct order
    layersRef.current.bg = new Rect({ width: canvasWidth, height: canvasHeight, fill: '#f0f0f0' });
    layersRef.current.grid = new Group();
    layersRef.current.agents = new Group();

    leaferRef.current.add(layersRef.current.bg);
    leaferRef.current.add(layersRef.current.grid);
    leaferRef.current.add(layersRef.current.agents);

    const refresh = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setCanvasSize(rect.width, rect.height);
        updateGridSize(envRef.current);
        Object.values(agentsProps).forEach((agent) => {
          updateAgentDisplay(agent);
        });
      }
    };

    const throttledRefresh = throttle(refresh, 100);

    updateGridSize(envRef.current);

    const resizeObserver = new ResizeObserver(throttledRefresh);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      leaferRef.current?.destroy();
      leaferRef.current = null;
      layersRef.current = {};
      agentShapesRef.current.clear();
    };
  }, []);

  // Update background
  useEffect(() => {
    void (async () => {
      const leafer = leaferRef.current;
      const bgLayer = layersRef.current.bg;
      if (!leafer || !bgLayer) return;

      const { background } = envRef.current;

      if (typeof background === 'string') {
        const img = await loadImageAsync(background);
        bgLayer.set({ fill: { type: 'image', url: img.src } });
      } else if (background instanceof Uint8Array) {
        const parsed = NPYParser.parse(uint8ArrayToArrayBuffer(background));
        const bgImg = createNumpyBackground(parsed);
        if (bgImg) {
          await loadImageAsync(bgImg.src);
          bgLayer.set({ fill: { type: 'image', url: bgImg.src } });
        } else {
          bgLayer.set({ fill: '#f0f0f0' });
        }
      } else {
        bgLayer.set({ fill: '#f0f0f0' });
      }
    })();
  }, [envRef.current.background]);

  // Update grid (only when dimensions change)
  useEffect(() => {
    updateGridSize(envRef.current);
  }, [envRef.current.width, envRef.current.height]);

  // Update agents (reuse existing shapes)
  useEffect(() => {
    const agentsGroup = layersRef.current.agents;
    if (!agentsGroup) return;

    // Normalize all IDs to strings
    const currentAgentIds = new Set(Object.keys(agentsProps).map(String));
    const previousAgentIds = new Set(agentShapesRef.current.keys());

    // Remove deleted agents
    previousAgentIds.forEach(id => {
      if (!currentAgentIds.has(id)) {
        agentShapesRef.current.get(id)?.group.remove();
        agentShapesRef.current.delete(id);
      }
    });

    // Update or create agents
    Object.entries(agentsProps).forEach(([, agent]) => {
      updateAgentDisplay(agent);
    });
  }, [agentsProps, handleAgentClick, updateTrigger]);

  return (
    <div className={styles.container}>
      <div ref={containerRef} className={styles.canvas} />

      <AgentDetailsDialog agentType='grid' agent={selectedAgent} onClose={() => setSelectedAgent(null)} />

      {contextMenu && (
        <div className={styles.contextMenu} style={{ left: contextMenu.x, top: contextMenu.y }} onMouseLeave={() => setContextMenu(null)}>
          <div className={styles.contextMenuItem}>Save Snapshot</div>
          <div className={styles.contextMenuItem}>Export as Image</div>
          <div className={styles.contextMenuItem}>View Settings</div>
        </div>
      )}
    </div>
  );
}