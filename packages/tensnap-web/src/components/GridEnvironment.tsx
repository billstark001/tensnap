import React, { useRef, useEffect, useCallback, useState } from 'react';
import { GridEnvironment, Agent } from '../types';
import { NPYParser } from '../utils/npy-parser';
import { renderNumpyBackground } from '../utils/numpy-renderer';
import * as styles from './GridEnvironmentView.css';

interface GridEnvironmentViewProps {
  environment: GridEnvironment;
}

export function GridEnvironmentView({ environment }: GridEnvironmentViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  
  // High-DPI canvas setup
  const setupHighDPICanvas = useCallback((canvas: HTMLCanvasElement, width: number, height: number) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    const devicePixelRatio = window.devicePixelRatio || 1;
    
    // Set display size (CSS pixels)
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    
    // Set actual size in memory (scaled up for high DPI)
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    
    // Scale the drawing context so everything draws at the correct size
    ctx.scale(devicePixelRatio, devicePixelRatio);
    
    return ctx;
  }, []);
  
  const drawAgent = useCallback((
    ctx: CanvasRenderingContext2D,
    agent: Agent,
    cellWidth: number,
    cellHeight: number
  ) => {
    if (agent.x === undefined || agent.y === undefined) return;
    
    const x = agent.x * cellWidth + cellWidth / 2;
    const y = agent.y * cellHeight + cellHeight / 2;
    const size = agent.size || 10;
    
    ctx.save();
    ctx.translate(x, y);
    
    if (agent.heading !== undefined) {
      ctx.rotate(agent.heading);
    }
    
    ctx.fillStyle = agent.color || '#333333';
    
    switch (agent.icon) {
      case 'arrow':
        ctx.beginPath();
        ctx.moveTo(size, 0);
        ctx.lineTo(-size / 2, -size / 2);
        ctx.lineTo(-size / 2, size / 2);
        ctx.closePath();
        ctx.fill();
        break;
      
      case 'square':
        ctx.fillRect(-size / 2, -size / 2, size, size);
        break;
      
      case 'triangle':
        ctx.beginPath();
        ctx.moveTo(0, -size / 2);
        ctx.lineTo(-size / 2, size / 2);
        ctx.lineTo(size / 2, size / 2);
        ctx.closePath();
        ctx.fill();
        break;
      
      default: // circle
        ctx.beginPath();
        ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Draw trajectory if exists
    if (agent.trajectory && agent.trajectory.length > 1) {
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = agent.color || '#333333';
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      
      agent.trajectory.forEach((point, i) => {
        const px = point.x * cellWidth + cellWidth / 2;
        const py = point.y * cellHeight + cellHeight / 2;
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      });
      
      ctx.stroke();
    }
    
    ctx.restore();
  }, []);
  
  const drawBackground = useCallback((
    ctx: CanvasRenderingContext2D,
    background: ArrayBuffer | string | undefined,
    width: number,
    height: number
  ) => {
    if (!background) {
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, width, height);
      return;
    }
    
    if (background instanceof ArrayBuffer) {
      try {
        const numpyData = NPYParser.parse(background);
        renderNumpyBackground(ctx, numpyData, width, height);
      } catch (error) {
        console.error('Error parsing or rendering NPY data:', error);
        // Fallback to default background
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, width, height);
      }
    } else if (typeof background === 'string') {
      // Assume it's a base64 image
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
      };
      img.src = background;
    }
  }, []);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const displayWidth = 600;
    const displayHeight = 600;
    
    const ctx = setupHighDPICanvas(canvas, displayWidth, displayHeight);
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    
    // Draw background
    drawBackground(ctx, environment.background, displayWidth, displayHeight);
    
    // Draw grid lines
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 1;
    
    const cellWidth = displayWidth / environment.width;
    const cellHeight = displayHeight / environment.height;
    
    for (let i = 0; i <= environment.width; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cellWidth, 0);
      ctx.lineTo(i * cellWidth, displayHeight);
      ctx.stroke();
    }
    
    for (let j = 0; j <= environment.height; j++) {
      ctx.beginPath();
      ctx.moveTo(0, j * cellHeight);
      ctx.lineTo(displayWidth, j * cellHeight);
      ctx.stroke();
    }
    
    // Draw agents
    environment.agents.forEach(agent => {
      drawAgent(ctx, agent, cellWidth, cellHeight);
    });
  }, [environment, drawAgent, drawBackground, setupHighDPICanvas]);
  
  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Use display dimensions for calculations
    const displayWidth = 600;
    const displayHeight = 600;
    
    const cellWidth = displayWidth / environment.width;
    const cellHeight = displayHeight / environment.height;
    
    const gridX = Math.floor(x / cellWidth);
    const gridY = Math.floor(y / cellHeight);
    
    // Find agent at this position
    const agent = environment.agents.find(
      a => a.x === gridX && a.y === gridY
    );
    
    if (event.detail === 2 && agent) {
      // Double click - show agent details
      setSelectedAgent(agent);
    }
  }, [environment]);
  
  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);
  
  const handleCloseModal = useCallback(() => {
    setSelectedAgent(null);
  }, []);
  
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);
  
  return (
    <div className={styles.container}>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onContextMenu={handleContextMenu}
        className={styles.canvas}
      />
      
      {selectedAgent && (
        <div className={styles.modal}>
          <h3 className={styles.modalTitle}>Agent Details</h3>
          <p className={styles.modalText}>ID: {selectedAgent.id}</p>
          <p className={styles.modalText}>Position: ({selectedAgent.x}, {selectedAgent.y})</p>
          {selectedAgent.heading !== undefined && (
            <p className={styles.modalText}>
              Heading: {(selectedAgent.heading * 180 / Math.PI).toFixed(1)}°
            </p>
          )}
          <p className={styles.modalText}>Color: {selectedAgent.color || 'default'}</p>
          {selectedAgent.data && (
            <div>
              <h4>Custom Data:</h4>
              <pre className={styles.modalPre}>
                {JSON.stringify(selectedAgent.data, null, 2)}
              </pre>
            </div>
          )}
          <button className={styles.modalButton} onClick={handleCloseModal}>
            Close
          </button>
        </div>
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