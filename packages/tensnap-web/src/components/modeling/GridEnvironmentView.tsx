import { useRef, useEffect, useCallback, useState } from 'react';
import { Rect, Ellipse, Polygon, Line, Group, Leafer, ILeafer, PointerEvent } from 'leafer-ui';
import * as Dialog from '@radix-ui/react-dialog';
import { GridEnvironment, TrajectoryPoint, GridAgent, AgentIcon } from '@/types/modeling';
import { NPYParser } from '@/utils/npy-parser';
import { createNumpyBackground } from '@/utils/numpy-renderer';
import * as styles from './GridEnvironmentView.css';
import * as dialogStyles from '@/styles/dialog.css';
import { uint8ArrayToArrayBuffer } from '@/utils/msgpack';

interface GridEnvironmentViewProps {
  environment: GridEnvironment;
}

const createShapeByIcon = (icon: AgentIcon | undefined | null, size: number, color: string) => {
  switch (icon) {
    case 'arrow':
      return new Polygon({
        points: [size, 0, -size / 2, -size / 2, -size / 2, size / 2],
        fill: color,
      });
    case 'square':
      return new Rect({
        width: size,
        height: size,
        x: -size / 2,
        y: -size / 2,
        fill: color,
      });
    case 'triangle':
      return new Polygon({
        points: [0, -size / 2, -size / 2, size / 2, size / 2, size / 2],
        fill: color,
      });
    default: // circle
      return new Ellipse({
        width: size,
        height: size,
        fill: color,
      });
  }
};

const createTrajectoryLine = (trajectory: TrajectoryPoint[] | null | undefined, cellWidth: number, cellHeight: number, x: number, y: number, color: string) => {
  if (!trajectory || trajectory.length <= 1) return null;

  const trajectoryPoints = trajectory.flatMap(point => [
    point.x * cellWidth + cellWidth / 2 - x,
    point.y * cellHeight + cellHeight / 2 - y
  ]);

  return new Line({
    points: trajectoryPoints,
    stroke: color,
    strokeWidth: 1,
    opacity: 0.3,
  });
};

const createAgentShape = (agent: GridAgent, cellWidth: number, cellHeight: number) => {
  if (agent.x === undefined || agent.y === undefined) return { group: null, shape: null };

  const x = agent.x * cellWidth + cellWidth / 2;
  const y = agent.y * cellHeight + cellHeight / 2;
  const size = agent.size || 10;
  const color = agent.color || '#333333';

  const group = new Group({
    x,
    y,
    rotation: agent.heading ? (agent.heading * 180 / Math.PI) : 0,
  });

  const shape = createShapeByIcon(agent.icon, size, color);
  group.add(shape);

  const trajectoryLine = createTrajectoryLine(agent.trajectory, cellWidth, cellHeight, x, y, color);
  if (trajectoryLine) {
    group.add(trajectoryLine);
  }

  return { group, shape };
};

const createBackground = (environment: GridEnvironment, displayWidth: number, displayHeight: number) => {
  const { background } = environment;

  if (typeof background === 'string') {
    const img = new Image();
    img.src = background;
    return new Promise<Rect>((resolve) => {
      img.onload = () => {
        resolve(new Rect({
          width: displayWidth,
          height: displayHeight,
          fill: { type: 'image', url: img.src },
        }));
      };
    });
  }

  if (background instanceof Uint8Array) {
    // do not consider shared buffer
    const parsedNumpyData = NPYParser.parse(uint8ArrayToArrayBuffer(background));
    const backgroundImg = createNumpyBackground(parsedNumpyData);
    if (backgroundImg) {
      return new Promise<Rect>((resolve) => {
        backgroundImg.onload = () => {
          resolve(new Rect({
            width: displayWidth,
            height: displayHeight,
            fill: { type: 'image', url: backgroundImg.src },
          }));
        };
      });
    }
  }

  // Default background
  return Promise.resolve(new Rect({
    width: displayWidth,
    height: displayHeight,
    fill: '#f0f0f0',
  }));
};

const createGrid = (environment: GridEnvironment, displayWidth: number, displayHeight: number) => {
  const cellWidth = displayWidth / environment.width;
  const cellHeight = displayHeight / environment.height;
  const gridGroup = new Group();

  // Create vertical and horizontal lines
  for (let i = 0; i <= environment.width; i++) {
    gridGroup.add(new Line({
      points: [i * cellWidth, 0, i * cellWidth, displayHeight],
      stroke: '#dddddd',
      strokeWidth: 1,
    }));
  }

  for (let j = 0; j <= environment.height; j++) {
    gridGroup.add(new Line({
      points: [0, j * cellHeight, displayWidth, j * cellHeight],
      stroke: '#dddddd',
      strokeWidth: 1,
    }));
  }

  return gridGroup;
};

const createAgents = (environment: GridEnvironment, displayWidth: number, displayHeight: number, onAgentClick: (agent: GridAgent, event: any) => void) => {
  const cellWidth = displayWidth / environment.width;
  const cellHeight = displayHeight / environment.height;
  const agentsGroup = new Group();

  environment.agents.forEach(agent => {
    const { group: agentShapeGroup, shape: agentShape } = createAgentShape(agent, cellWidth, cellHeight);
    if (agentShapeGroup) {
      agentsGroup.add(agentShapeGroup);
    }
    if (agentShape) {
      agentShape.on(PointerEvent.CLICK, (e: any) => onAgentClick(agent, e));
      agentShape.on(PointerEvent.MENU, (e: any) => onAgentClick(agent, e));
    }
  });

  return agentsGroup;
};

export function GridEnvironmentView({ environment }: GridEnvironmentViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leaferAppRef = useRef<ILeafer | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<GridAgent | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const displayWidth = 600;
  const displayHeight = 600;

  const handleAgentClick = useCallback((agent: GridAgent, e: any) => {
    if (e.type === PointerEvent.CLICK) {
      setSelectedAgent(agent);
    } else if (e.type === PointerEvent.MENU) {
      setContextMenu({ x: e.x, y: e.y });
    }
  }, []);

  // Initialize LeaferJS app
  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous app
    if (leaferAppRef.current) {
      leaferAppRef.current.destroy();
    }

    // Create new LeaferJS app
    const app = new Leafer({
      view: containerRef.current,
      width: displayWidth,
      height: displayHeight,
    });

    leaferAppRef.current = app;

    return () => {
      if (leaferAppRef.current) {
        leaferAppRef.current.destroy();
        leaferAppRef.current = null;
      }
    };
  }, [displayWidth, displayHeight]);

  // Update visualization when environment changes
  useEffect(() => void (async () => {
    const appTree = leaferAppRef.current;
    if (!appTree) return;

    // Clear previous content
    appTree.clear();

    // // Add background
    const bgRect = await createBackground(environment, displayWidth, displayHeight);
    appTree.add(bgRect);

    // Add grid
    appTree.add(createGrid(environment, displayWidth, displayHeight));

    // Add agents
    appTree.add(createAgents(environment, displayWidth, displayHeight, handleAgentClick));
  })(), [environment, displayWidth, displayHeight, handleAgentClick]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return (
    <div className={styles.container}>
      <div
        ref={containerRef}
        className={styles.canvas}
        style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}
      />

      {selectedAgent && (
        <Dialog.Root open={!!selectedAgent} onOpenChange={(open) => !open && setSelectedAgent(null)}>
          <Dialog.Portal>
            <Dialog.Overlay className={dialogStyles.dialogOverlay} />
            <Dialog.Content className={dialogStyles.dialogContent}>
              <Dialog.Title className={dialogStyles.dialogTitle}>Agent Details</Dialog.Title>
              <Dialog.Description className={dialogStyles.dialogDescription}>
                View detailed information about the selected agent
              </Dialog.Description>

              <div>
                <p style={{ margin: '8px 0', fontSize: '14px' }}>ID: {selectedAgent.id}</p>
                <p style={{ margin: '8px 0', fontSize: '14px' }}>Position: ({selectedAgent.x}, {selectedAgent.y})</p>
                {selectedAgent.heading !== undefined && (
                  <p style={{ margin: '8px 0', fontSize: '14px' }}>
                    Heading: {(selectedAgent.heading * 180 / Math.PI).toFixed(1)}°
                  </p>
                )}
                <p style={{ margin: '8px 0', fontSize: '14px' }}>Color: {selectedAgent.color || 'default'}</p>
                {selectedAgent.data && (
                  <div>
                    <h4 style={{ margin: '16px 0 8px 0' }}>Custom Data:</h4>
                    <pre style={{
                      background: '#f5f5f5',
                      padding: '8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      overflow: 'auto',
                      maxHeight: '200px'
                    }}>
                      {JSON.stringify(selectedAgent.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              <div className={dialogStyles.dialogFooter}>
                <Dialog.Close asChild>
                  <button className={dialogStyles.dialogButton}>
                    Close
                  </button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {contextMenu && (
        <div
          className={styles.contextMenu}
          style={{
            left: contextMenu.x,
            top: contextMenu.y
          }}
          onMouseLeave={handleCloseContextMenu}
        >
          <div className={styles.contextMenuItem}>Save Snapshot</div>
          <div className={styles.contextMenuItem}>Export as Image</div>
          <div className={styles.contextMenuItem}>View Settings</div>
        </div>
      )}
    </div>
  );
}
