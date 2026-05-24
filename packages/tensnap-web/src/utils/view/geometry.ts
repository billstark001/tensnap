import type { AnyView } from '@/types/ui';
import type { ViewBox } from '@/utils/layout/guideline';
import { viewConstants } from '@/components/view/constants';

export type ViewBoxOverride = Partial<ViewBox>;

export function getEffectiveViewBox(view: AnyView, override: ViewBoxOverride = {}): ViewBox {
  const height = view.type === 'container' && !view.expanded
    ? viewConstants.windowHeaderHeight
    : override.height ?? view.height;

  return {
    left: override.left ?? view.left,
    top: override.top ?? view.top,
    width: override.width ?? view.width,
    height,
  };
}
