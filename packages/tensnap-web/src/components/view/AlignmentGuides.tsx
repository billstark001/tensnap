import React from 'react';
import { AlignmentGuides as AlignmentGuidesType } from '@/types/ui';
import * as styles from './styles.css';

interface AlignmentGuidesProps {
  guides: AlignmentGuidesType;
  active: { vertical?: number; horizontal?: number };
}

export const AlignmentGuides: React.FC<AlignmentGuidesProps> = ({ active }) => {
  return (
    <>
      {active.vertical !== undefined && (
        <div className={styles.verticalGuide} style={{ left: `${active.vertical}px` }} />
      )}
      {active.horizontal !== undefined && (
        <div className={styles.horizontalGuide} style={{ top: `${active.horizontal}px` }} />
      )}
    </>
  );
};