import clsx from 'clsx';
import { AgentIcon } from '@/types/model';
import * as styles from './AgentDetailsDialog.css';

export function createIconElement(
  icon: AgentIcon | undefined | null,
  size: number,
  color: string,
  assetUrl?: string,
) {
  const commonStyle = {
    width: `${size}px`,
    height: `${size}px`,
    color,
  };

  if (icon?.startsWith('asset:') && assetUrl) {
    return (
      <img
        src={assetUrl}
        alt={icon}
        style={{ width: `${size}px`, height: `${size}px`, objectFit: 'contain' }}
      />
    );
  }

  switch (icon) {
    case 'arrow':
      return (
        <div className={clsx(styles.iconWrapper, styles.iconArrow)} style={commonStyle}>
          ▲
        </div>
      );
    case 'square':
      return (
        <div className={clsx(styles.iconWrapper, styles.iconSquare)} style={commonStyle}>
          ■
        </div>
      );
    case 'triangle':
      return (
        <div
          className={clsx(styles.iconWrapper, styles.iconTriangle)}
          style={{
            width: 0,
            height: 0,
            backgroundColor: 'transparent',
            borderLeft: `${size / 2}px solid transparent`,
            borderRight: `${size / 2}px solid transparent`,
            borderBottom: `${size}px solid ${color}`,
          }}
        />
      );
    case 'diamond':
      return (
        <div className={clsx(styles.iconWrapper, styles.iconSquare)} style={commonStyle}>
          ◆
        </div>
      );
    case 'star':
      return (
        <div className={clsx(styles.iconWrapper, styles.iconSquare)} style={commonStyle}>
          ★
        </div>
      );
    case 'hexagon':
      return (
        <div className={clsx(styles.iconWrapper, styles.iconSquare)} style={commonStyle}>
          ⬢
        </div>
      );
    case 'cross':
      return (
        <div className={clsx(styles.iconWrapper, styles.iconSquare)} style={commonStyle}>
          ✕
        </div>
      );
    case 'plus':
      return (
        <div className={clsx(styles.iconWrapper, styles.iconSquare)} style={commonStyle}>
          ✚
        </div>
      );
    case 'pentagon':
      return (
        <div className={clsx(styles.iconWrapper, styles.iconSquare)} style={commonStyle}>
          ⬟
        </div>
      );
    default:
      return (
        <div className={clsx(styles.iconWrapper, styles.iconCircle)} style={commonStyle}>
          ●
        </div>
      );
  }
}