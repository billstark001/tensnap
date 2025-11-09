import React from 'react';
import { AlignType, GuideLine } from '@/utils/layout/guideline';
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
  spacingColor?: string;
  sizeColor?: string;
  showLabels?: boolean;
}

const getGuidelineColor = (
  alignType: AlignType,
  defaultColor: string,
  spacingColor?: string,
  sizeColor?: string
): string => {
  if (alignType.startsWith('spacing-')) {
    return spacingColor || '#FF9500';
  }
  if (alignType.startsWith('size-')) {
    return sizeColor || '#34C759';
  }
  return defaultColor;
};

const getDashedStyle = (
  alignType: AlignType,
  isVertical: boolean
): React.CSSProperties => {
  if (alignType.startsWith('spacing-')) {
    return {
      backgroundImage: isVertical
        ? 'repeating-linear-gradient(to bottom, currentColor 0, currentColor 4px, transparent 4px, transparent 8px)'
        : 'repeating-linear-gradient(to right, currentColor 0, currentColor 4px, transparent 4px, transparent 8px)',
      backgroundColor: 'transparent',
    };
  }
  if (alignType.startsWith('size-')) {
    return {
      backgroundImage: isVertical
        ? 'repeating-linear-gradient(to bottom, currentColor 0, currentColor 2px, transparent 2px, transparent 4px)'
        : 'repeating-linear-gradient(to right, currentColor 0, currentColor 2px, transparent 2px, transparent 4px)',
      backgroundColor: 'transparent',
    };
  }
  return {};
};

export const Guidelines: React.FC<GuidelinesProps> = ({
  guidelines,
  className,
  style: customStyle,
  color = '#007AFF',
  opacity = 0.8,
  leftShift = 0,
  topShift = 0,
  spacingColor,
  sizeColor,
  showLabels = true,
}) => {
  const containerClassName = clsx(
    styles.guidelinesContainer,
    className,
  );

  return (
    <div className={containerClassName} style={customStyle}>
      {guidelines.map((guideline, index) => {
        const isVertical = guideline.type === 'vertical';
        const guidelineColor = getGuidelineColor(
          guideline.alignType,
          color,
          spacingColor,
          sizeColor
        );
        const lineStyle: React.CSSProperties = isVertical
          ? { left: `${leftShift + guideline.position}px` }
          : { top: `${topShift + guideline.position}px` };

        const isSpacing = guideline.alignType.startsWith('spacing-');
        const isSize = guideline.alignType.startsWith('size-');
        const dashedStyle = getDashedStyle(guideline.alignType, isVertical);

        return (
          <div
            key={`${guideline.type}-${guideline.position}-${guideline.alignType}-${index}`}
            className={isVertical ? styles.verticalGuideline : styles.horizontalGuideline}
            style={lineStyle}
          >
            {guideline.relatedSegments.map((segment, segIndex) => {
              const segmentStyle: React.CSSProperties = isVertical
                ? {
                    top: `${topShift + segment.start}px`,
                    height: `${segment.end - segment.start}px`,
                    color: guidelineColor,
                    backgroundColor: guidelineColor,
                    opacity,
                    ...dashedStyle,
                  }
                : {
                    left: `${leftShift + segment.start}px`,
                    width: `${segment.end - segment.start}px`,
                    color: guidelineColor,
                    backgroundColor: guidelineColor,
                    opacity,
                    ...dashedStyle,
                  };

              return (
                <div
                  key={`segment-${segIndex}`}
                  className={isVertical ? styles.verticalSegment : styles.horizontalSegment}
                  style={segmentStyle}
                />
              );
            })}

            {/* 显示间距或尺寸标签 */}
            {showLabels && (isSpacing || isSize) && guideline.spacingInfo && (
              <div
                className={styles.guidelineLabel}
                style={{
                  ...(isVertical
                    ? {
                        left: '4px',
                        top: `${topShift + guideline.relatedSegments[0].start}px`,
                        transform: 'translateY(-50%)',
                      }
                    : {
                        top: '4px',
                        left: `${leftShift + guideline.relatedSegments[0].start}px`,
                        transform: 'translateX(-50%)',
                      }),
                  backgroundColor: guidelineColor,
                }}
              >
                {Math.round(guideline.spacingInfo.distance)}
                {isSize ? (isVertical ? 'w' : 'h') : ''}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
