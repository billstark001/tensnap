import React from 'react';
import { GuideLine } from '@/utils/layout/guideline';
import * as styles from './GuideLines.css';
import clsx from 'clsx';


export interface GuidelinesProps {
  guidelines: GuideLine[];
  className?: string;
  style?: React.CSSProperties;
  color?: string;
  opacity?: number;
  leftShift?: number;
  topShift?: number;
}

export const Guidelines: React.FC<GuidelinesProps> = ({
  guidelines,
  className,
  style: customStyle,
  color = '#007AFF',
  opacity = 0.8,
  leftShift = 0,
  topShift = 0,
}) => {


  const containerClassName = clsx(
    styles.guidelinesContainer,
    className,
  )
  return (
    <div className={containerClassName} style={customStyle}>
      {guidelines.map((guideline, index) => {
        const isVertical = guideline.type === 'vertical';
        const lineStyle: React.CSSProperties = isVertical
          ? { left: `${leftShift + guideline.position}px` }
          : { top: `${topShift + guideline.position}px` };

        return (
          <div
            key={`${guideline.type}-${guideline.position}-${index}`}
            className={isVertical ? styles.verticalGuideline : styles.horizontalGuideline}
            style={lineStyle}
          >
            {guideline.relatedSegments.map((segment, segIndex) => {
              const segmentStyle: React.CSSProperties = isVertical
                ? {
                  top: `${topShift + segment.start}px`,
                  height: `${segment.end - segment.start}px`,
                  backgroundColor: color,
                  opacity,
                }
                : {
                  left: `${leftShift + segment.start}px`,
                  width: `${segment.end - segment.start}px`,
                  backgroundColor: color,
                  opacity,
                };

              return (
                <div
                  key={`segment-${segIndex}`}
                  className={isVertical ? styles.verticalSegment : styles.horizontalSegment}
                  style={segmentStyle}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
