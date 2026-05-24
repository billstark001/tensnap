import { ContainerView, AnyView } from '@/types/ui';
import { Parameter, Action, NumberParameter, EnumParameter, BooleanParameter, StringParameter } from '@/types/model';
import { pack } from '@/utils/layout/pack';
import type { PackingOptions, PackingResult, PlacedRectangle } from '@/utils/layout/pack';
import { MAIN_VIEW_PADDING, LAYOUT_PADDING as PADDING, WINDOW_X_DELTA, WINDOW_Y_DELTA, preservedViewIds } from '@/components/view/constants';
import { ObjectWithEnvironmentMetadata, ObjectWithChartMetadata } from '@/components/view/types';
import { getEffectiveViewBox } from './geometry';
import { assertValidViewTree } from './container';
import {
  createDefaultRootLayout,
  createVerticalContainer,
  createButtonViews,
  createParameterViews,
  createEnvironmentViews,
  createChartViews,
} from './create-view';

// Re-export for backward compatibility
export { preservedViewIds, createDefaultRootLayout };


// #region other utility functions

interface WalkState {
  halted: boolean;
}

function _walk(
  view: AnyView,
  condition: (view: AnyView) => boolean,
  haltOnFirstTrue: boolean,
  found: WeakSet<AnyView>,
  state: WalkState,
  result: AnyView[],
): AnyView[] {

  if (found.has(view) || state.halted) {
    return result;
  }

  if (condition(view)) {
    result.push(view);
    found.add(view);
    if (haltOnFirstTrue) {
      state.halted = true;
      return result;
    }
  }

  if (view.type === 'container' && view.views) {
    for (const child of view.views) {
      _walk(child, condition, haltOnFirstTrue, found, state, result);
    }
  }

  return result;
}


function walkAndFilter(view: AnyView | null | undefined, condition: (view: AnyView) => boolean): AnyView[] {
  if (!view) {
    return [];
  }
  const found = new WeakSet<AnyView>();
  const state: WalkState = { halted: false };
  const result: AnyView[] = [];
  _walk(view, condition, false, found, state, result);
  return result;
}

function walkAndFind(view: AnyView | null | undefined, condition: (view: AnyView) => boolean): AnyView | undefined {
  if (!view) {
    return undefined;
  }
  const found = new WeakSet<AnyView>();
  const state: WalkState = { halted: false };
  let result: AnyView[] = [];
  _walk(view, condition, true, found, state, result);
  return result[0];
}

function getParameterSignature(param: { id: string, type?: string }): string {
  return `param:${param.type}:${param.id}`;
}

function getActionSignature(action: { id: string }): string {
  return `param:action:${action.id}`;
}

function getEnvironmentSignature(env: ObjectWithEnvironmentMetadata): string {
  return `env:${env.type}:${env.id}`;
}

function getChartSignature(chart: ObjectWithChartMetadata): string {
  return `chart:${chart.id}`;
}

// #endregion

// #region module entry

type EffectivePackingRectangle = PlacedRectangle & {
  viewIndex: number;
};

function packViewsByEffectiveBox(
  views: AnyView[],
  options: PackingOptions,
): PackingResult {
  const rectangles = views.map((view, viewIndex) => {
    const box = getEffectiveViewBox(view);
    return {
      type: view.type,
      viewIndex,
      ...box,
    };
  });

  const result = pack(rectangles, { ...options, inPlace: false });

  for (const rectangle of result.rectangles as EffectivePackingRectangle[]) {
    const view = views[rectangle.viewIndex];
    if (view) {
      view.left = rectangle.left;
      view.top = rectangle.top;
    }
  }

  return result;
}

export function adjustForMainViewPadding(currentView: ContainerView) {
  let maxWidth = 0;
  let maxHeight = 0;
  for (const view of currentView.views) {
    const box = getEffectiveViewBox(view);
    const rightEdge = box.left + box.width;
    const bottomEdge = box.top + box.height;
    if (rightEdge > maxWidth) {
      maxWidth = rightEdge;
    }
    if (bottomEdge > maxHeight) {
      maxHeight = bottomEdge;
    }
  }
  currentView.width = Math.ceil(maxWidth + MAIN_VIEW_PADDING);
  currentView.height = Math.ceil(maxHeight + MAIN_VIEW_PADDING);
}

export interface CreateAutoLayoutOptions {
  /** Whether to modify the currentView in place or create a copy */
  inPlace?: boolean;
  /** If true, views for objects not in the lists will be disabled rather than removed */
  disableMissingViews?: boolean;
}

/**
 * Creates or updates the auto layout for views based on the current state of objects
 * @param currentView The current view to update (or undefined to create new)
 * @param environments List of all active environments
 * @param parameters List of all active parameters
 * @param charts List of all active charts
 * @param options Layout options
 * @param actions List of all active actions (buttons)
 * @returns Updated container view
 */
export function createAutoLayout(
  currentView: ContainerView | undefined,
  environments: ObjectWithEnvironmentMetadata[],
  parameters: Parameter[],
  charts: ObjectWithChartMetadata[],
  options: CreateAutoLayoutOptions = {},
  actions: Action[] = [],
): ContainerView {
  const { inPlace = false, disableMissingViews = false } = options;
  const view = currentView
    ? inPlace ? currentView : structuredClone(currentView)
    : createDefaultRootLayout();

  const statesFound = new Map<string, boolean>();

  actions.forEach(a => statesFound.set(getActionSignature(a), false));
  parameters.forEach(p => statesFound.set(getParameterSignature(p), false));
  environments.forEach(e => statesFound.set(getEnvironmentSignature(e), false));
  charts.forEach(c => statesFound.set(getChartSignature(c), false));

  // this maintains statesFound and viewsShouldDisable
  const viewsShouldDisable = walkAndFilter(view, (v) => {
    if (v.type === 'container' || !v.type) {
      return false;
    }
    const sign = v.type === 'parameter' ? getParameterSignature(v.data) :
      v.type === 'environment' ? getEnvironmentSignature(v.data as ObjectWithEnvironmentMetadata) :
        v.type === 'chart' ? getChartSignature(v.data as ObjectWithChartMetadata) :
          v.type === 'button' ? getActionSignature({ id: v.data.id }) : undefined;
    if (!sign) {
      return false;
    }
    if (statesFound.has(sign)) {
      statesFound.set(sign, true);
      v.disabled = false;
      return false;
    } else {
      return true;
    }
  });

  // Find existing containers
  let buttonsContainer = walkAndFind(view, v => v.id === preservedViewIds.buttonsContainer) as ContainerView | undefined;
  let parametersContainer = walkAndFind(view, v => v.id === preservedViewIds.parametersContainer) as ContainerView | undefined;

  const buttonsContainerIsNew = !buttonsContainer;
  const parametersContainerIsNew = !parametersContainer;

  if (!buttonsContainer) {
    buttonsContainer = createVerticalContainer(
      preservedViewIds.buttonsContainer,
      'Buttons',
      10,
      10
    );
    view.views.push(buttonsContainer);
  }
  if (!parametersContainer) {
    parametersContainer = createVerticalContainer(
      preservedViewIds.parametersContainer,
      'Parameters',
      10,
      10
    );
    view.views.push(parametersContainer);
  }

  // Actions (buttons) - now separate from parameters
  const newActions = actions.filter(a => !statesFound.get(getActionSignature(a)));

  // Parameters (no longer include actions)
  const newOtherParameters = parameters.filter(
    param => !statesFound.get(getParameterSignature(param))
  ) as (NumberParameter | EnumParameter | BooleanParameter | StringParameter)[];

  let rootViewNeedsAdjust = false;

  // Process buttons container
  // Add new button views if any
  if (newActions.length > 0) {
    const newButtonViews = createButtonViews(newActions);
    buttonsContainer.views.push(...newButtonViews);
    rootViewNeedsAdjust = true;
  }
  // Re-layout buttons container if it has views (handles both new and existing overlapping views)
  if (buttonsContainer.views.length > 0) {
    const { suggestedContainerWidth, suggestedContainerHeight } = packViewsByEffectiveBox(buttonsContainer.views, {
      inPlace: true,
      padding: PADDING,
      paddingBorder: PADDING,
      sortBy: 'position',
      preservePosition: !buttonsContainerIsNew,
    });
    // 确保容器尺寸是整数
    buttonsContainer.width = Math.ceil(suggestedContainerWidth + WINDOW_X_DELTA);
    buttonsContainer.height = Math.ceil(suggestedContainerHeight + WINDOW_Y_DELTA);
    if (buttonsContainerIsNew) {
      rootViewNeedsAdjust = true;
    }
  }

  // Process parameters container
  // Add new parameter views if any
  if (newOtherParameters.length > 0) {
    const newParameterViews = createParameterViews(newOtherParameters);
    parametersContainer.views.push(...newParameterViews);
    rootViewNeedsAdjust = true;
  }
  // Re-layout parameters container if it has views (handles both new and existing overlapping views)
  if (parametersContainer.views.length > 0) {
    const { suggestedContainerWidth, suggestedContainerHeight } = packViewsByEffectiveBox(parametersContainer.views, {
      inPlace: true,
      padding: PADDING,
      paddingBorder: PADDING,
      sortBy: 'position',
      preservePosition: !parametersContainerIsNew,
    });
    // 确保容器尺寸是整数
    parametersContainer.width = Math.ceil(suggestedContainerWidth + WINDOW_X_DELTA);
    parametersContainer.height = Math.ceil(suggestedContainerHeight + WINDOW_Y_DELTA);
    if (parametersContainerIsNew) {
      rootViewNeedsAdjust = true;
    }
  }

  // Process environments
  const newEnvironments = environments.filter(env => !statesFound.get(getEnvironmentSignature(env)));
  if (newEnvironments.length > 0) {
    const newEnvironmentViews = createEnvironmentViews(newEnvironments);
    view.views.push(...newEnvironmentViews);
    rootViewNeedsAdjust = true;
  }

  // Process charts
  const newCharts = charts.filter(chart => !statesFound.get(getChartSignature(chart)));
  if (newCharts.length > 0) {
    const newChartViews = createChartViews(newCharts);
    view.views.push(...newChartViews);
    rootViewNeedsAdjust = true;
  }

  // Handle views that should be removed or disabled
  if (!disableMissingViews && viewsShouldDisable.length > 0) {
    const viewsToRemoveSet = new Set(viewsShouldDisable);

    // Remove from root level
    view.views = view.views.filter(v => !viewsToRemoveSet.has(v));

    // Remove from containers
    if (buttonsContainer) {
      buttonsContainer.views = buttonsContainer.views.filter(view => !viewsToRemoveSet.has(view));
    }
    if (parametersContainer) {
      parametersContainer.views = parametersContainer.views.filter(view => !viewsToRemoveSet.has(view));
    }

    rootViewNeedsAdjust = true;
  } else if (disableMissingViews) {
    // Mark views as disabled instead of removing them
    viewsShouldDisable.forEach(v => {
      if (v.type !== 'container' && v.type) {
        v.disabled = true;
      }
    });
  }

  // Adjust root layout
  // Always re-layout if it's a new view or if there are changes
  if (!currentView) {
    // New layout: use area-based sorting for optimal initial placement
    packViewsByEffectiveBox(view.views, {
      inPlace: true,
      targetAspectRatio: 4 / 3,
      padding: PADDING,
      paddingBorder: PADDING,
      sortBy: 'area',
    });
  } else if (rootViewNeedsAdjust || view.views.length > 0) {
    // Existing layout: use position-based sorting to preserve user's layout intent
    packViewsByEffectiveBox(view.views, {
      inPlace: true,
      targetAspectRatio: 4 / 3,
      padding: PADDING,
      paddingBorder: PADDING,
      sortBy: 'position',
      preservePosition: true,
    });
  }

  adjustForMainViewPadding(view);
  assertValidViewTree(view, 'createAutoLayout');

  return view;
}
