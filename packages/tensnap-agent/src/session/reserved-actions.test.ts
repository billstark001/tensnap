import { describe, expect, it } from 'vitest';
import {
  getReservedSceneActionAlias,
  getReservedSceneActionId,
  isReservedSceneActionId,
} from './reserved-actions';

describe('reserved scene actions', () => {
  it('maps aliases to simulator action ids', () => {
    expect(getReservedSceneActionId('reset')).toBe('reset');
    expect(getReservedSceneActionId('step')).toBe('step');
  });

  it('maps simulator action ids back to aliases', () => {
    expect(getReservedSceneActionAlias('start')).toBe('start');
    expect(getReservedSceneActionAlias('unknown')).toBeUndefined();
  });

  it('recognizes reserved ids', () => {
    expect(isReservedSceneActionId('reset')).toBe(true);
    expect(isReservedSceneActionId('custom_action')).toBe(false);
  });
});