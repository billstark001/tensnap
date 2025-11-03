import { useRef, useEffect, useCallback, useState } from 'react';
import { Rect, Ellipse, Polygon, Line, Group, Leafer, ILeafer, PointerEvent, UI } from 'leafer-ui';
import { TrajectoryPoint, GridAgent, AgentIcon, AgentId } from '@/types/model';
import { NPYParser } from '@/utils/npy-parser';
import { createNumpyBackground } from '@/utils/numpy-renderer';
import * as styles from './GridEnvironmentView.css';
import { uint8ArrayToArrayBuffer } from '@/utils/msgpack';
import { InstantiatedGridEnvironment } from '@/store/scenario-inst';
import { AgentDetailsDialog } from './AgentDetailsDialog';

interface GridEnvironmentViewProps {
  environment: InstantiatedGridEnvironment;
}

const DISPLAY_SIZE = 600;

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
  return new ShapeClass({ ...SHAPE_CONFIGS[icon](size), fill: color });
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

export function GridEnvironmentView({ environment }: GridEnvironmentViewProps) {
  const { props: envProps, agents } = environment;
  const containerRef = useRef<HTMLDivElement>(null);
  const leaferRef = useRef<ILeafer | null>(null);
  const layersRef = useRef<{ bg?: Rect; grid?: Group; agents?: Group }>({});
  const agentShapesRef = useRef<Map<AgentId, { group: Group; shape: UI }>>(new Map());
  
  const [selectedAgent, setSelectedAgent] = useState<GridAgent | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const cellWidth = DISPLAY_SIZE / envProps.width;
  const cellHeight = DISPLAY_SIZE / envProps.height;

  const handleAgentClick = useCallback((agent: GridAgent, e: any) => {
    e.type === PointerEvent.CLICK ? setSelectedAgent(agent) : setContextMenu({ x: e.x, y: e.y });
  }, []);

  // Initialize Leafer
  useEffect(() => {
    if (!containerRef.current) return;

    leaferRef.current?.destroy();
    leaferRef.current = new Leafer({
      view: containerRef.current,
      width: DISPLAY_SIZE,
      height: DISPLAY_SIZE,
    });

    return () => {
      leaferRef.current?.destroy();
      leaferRef.current = null;
    };
  }, []);

  // Update background
  useEffect(() => void (async () => {
    const leafer = leaferRef.current;
    if (!leafer) return;

    const { background } = envProps;
    let bgRect: Rect;

    if (typeof background === 'string') {
      const img = await loadImageAsync(background);
      bgRect = new Rect({ width: DISPLAY_SIZE, height: DISPLAY_SIZE, fill: { type: 'image', url: img.src } });
    } else if (background instanceof Uint8Array) {
      const parsed = NPYParser.parse(uint8ArrayToArrayBuffer(background));
      const bgImg = createNumpyBackground(parsed);
      if (bgImg) {
        await loadImageAsync(bgImg.src);
        bgRect = new Rect({ width: DISPLAY_SIZE, height: DISPLAY_SIZE, fill: { type: 'image', url: bgImg.src } });
      } else {
        bgRect = new Rect({ width: DISPLAY_SIZE, height: DISPLAY_SIZE, fill: '#f0f0f0' });
      }
    } else {
      bgRect = new Rect({ width: DISPLAY_SIZE, height: DISPLAY_SIZE, fill: '#f0f0f0' });
    }

    if (layersRef.current.bg) {
      layersRef.current.bg.remove();
    }
    layersRef.current.bg = bgRect;
    leafer.add(bgRect);
  })(), [envProps.background]);

  // Update grid (only when dimensions change)
  useEffect(() => {
    const leafer = leaferRef.current;
    if (!leafer) return;

    if (layersRef.current.grid) {
      layersRef.current.grid.remove();
    }

    const gridGroup = new Group();
    for (let i = 0; i <= envProps.width; i++) {
      gridGroup.add(new Line({ points: [i * cellWidth, 0, i * cellWidth, DISPLAY_SIZE], stroke: '#dddddd', strokeWidth: 1 }));
    }
    for (let j = 0; j <= envProps.height; j++) {
      gridGroup.add(new Line({ points: [0, j * cellHeight, DISPLAY_SIZE, j * cellHeight], stroke: '#dddddd', strokeWidth: 1 }));
    }

    layersRef.current.grid = gridGroup;
    leafer.add(gridGroup);
  }, [envProps.width, envProps.height, cellWidth, cellHeight]);

  // Update agents (reuse existing shapes)
  useEffect(() => {
    const leafer = leaferRef.current;
    if (!leafer) return;

    if (!layersRef.current.agents) {
      layersRef.current.agents = new Group();
      leafer.add(layersRef.current.agents);
    }

    const agentsGroup = layersRef.current.agents;
    const currentAgentIds = new Set(Object.keys(agents));
    const previousAgentIds = new Set(agentShapesRef.current.keys());

    // Remove deleted agents
    previousAgentIds.forEach(id => {
      if (!currentAgentIds.has(typeof id === 'string' ? id : String(id))) {
        agentShapesRef.current.get(id)?.group.remove();
        agentShapesRef.current.delete(id);
      }
    });

    // Update or create agents
    Object.entries(agents).forEach(([id, agent]) => {
      if (agent.x === undefined || agent.y === undefined) return;

      const x = agent.x * cellWidth + cellWidth / 2;
      const y = agent.y * cellHeight + cellHeight / 2;
      const size = agent.size || 10;
      const color = agent.color || '#333333';
      const rotation = agent.heading ? (agent.heading * 180 / Math.PI) : 0;

      let cached = agentShapesRef.current.get(id);

      if (cached) {
        // Update existing
        cached.group.set({ x, y, rotation });
        cached.shape.set({ fill: color });
        
        // Update trajectory
        const oldTrajectory = cached.group.children?.find(child => child instanceof Line);
        if (oldTrajectory) oldTrajectory.remove();
        
        const trajectory = createTrajectory(agent.trajectory, cellWidth, cellHeight, x, y, color);
        if (trajectory) cached.group.add(trajectory);
      } else {
        // Create new
        const group = new Group({ x, y, rotation });
        const shape = createShape(agent.icon || 'circle', size, color);
        
        shape.on(PointerEvent.CLICK, (e: any) => handleAgentClick(agent, e));
        shape.on(PointerEvent.MENU, (e: any) => handleAgentClick(agent, e));
        
        group.add(shape);
        
        const trajectory = createTrajectory(agent.trajectory, cellWidth, cellHeight, x, y, color);
        if (trajectory) group.add(trajectory);
        
        agentsGroup.add(group);
        agentShapesRef.current.set(id, { group, shape });
      }
    });
  }, [agents, cellWidth, cellHeight, handleAgentClick]);

  return (
    <div className={styles.container}>
      <div ref={containerRef} className={styles.canvas} style={{ width: DISPLAY_SIZE, height: DISPLAY_SIZE }} />
      
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