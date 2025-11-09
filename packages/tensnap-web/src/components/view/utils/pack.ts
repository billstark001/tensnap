import { ContainerView, AnchoredView, AnyView, ButtonView } from '@/types/ui';
import { Parameter, ActionParameter, NumberParameter, EnumParameter, EnvironmentId, EnvironmentType, BooleanParameter, StringParameter } from '@/types/model';
import { pack } from '@/utils/layout/pack';
import { MAIN_VIEW_PADDING, viewConstants } from '../constants';

const ENVIRONMENT_GRID_WIDTH = 16;
const ENVIRONMENT_CARD_WIDTH = 600;
const ENVIRONMENT_CARD_HEIGHT = 600;

const CHART_CARD_WIDTH = 500;
const CHART_CARD_HEIGHT = 400;

const PADDING = 10;
// 确保窗口增量是整数
const WINDOW_X_DELTA = Math.ceil(viewConstants.windowBorderWidth * 2);
const WINDOW_Y_DELTA = Math.ceil(viewConstants.windowBorderWidth + viewConstants.windowHeaderHeight);

const PARAMETER_CARD_HEIGHT = 40 + WINDOW_Y_DELTA;

export const preservedViewIds = Object.freeze({
  buttonsContainer: 'buttons-container',
  parametersContainer: 'parameters-container',
  mainContainer: 'main-container',
});


type ObjectWithEnvironmentMetadata = {
  id: EnvironmentId;
  type: EnvironmentType;
  label: string;
  width?: number;
  height?: number;
};

type ObjectWithChartMetadata = {
  id: string;
  label: string;
};

// #region object creation functions

export function createDefaultRootLayout(
  views?: AnyView[],
): ContainerView {
  views ??= [];
  return {
    id: preservedViewIds.mainContainer,
    type: 'container',
    left: 0,
    top: 0,
    width: 1200,
    height: 800,
    expanded: true,
    data: {
      title: 'TenSnap Visualization',
    },
    views,
  };
}

/**
 * Creates a generic container with vertically packed views
 */
function createVerticalContainer(
  id: string,
  title: string,
  containerLeft: number,
  containerTop: number,
): ContainerView {
  return {
    id,
    type: 'container',
    left: containerLeft,
    top: containerTop,
    width: 100,
    height: 100,
    expanded: true,
    data: { title },
    views: [],
  };
}

/**
 * Creates views for buttons from parameters
 */
function createButtonViews(parameters: Parameter[]): ButtonView[] {
  return parameters.map((param) => ({
    id: `button-${param.id}`,
    type: 'button',
    left: 0,
    top: 0,
    width: 200,
    height: 50,
    expanded: true,
    data: {
      id: param.id,
      text: param.label,
    },
  }));
}

/**
 * Creates views for parameters
 */
function createParameterViews(parameters: Parameter[]): AnchoredView[] {
  return parameters.map((param) => ({
    id: `parameter-${param.id}`,
    type: 'parameter',
    left: 0,
    top: 0,
    width: 240,
    height: PARAMETER_CARD_HEIGHT,
    expanded: true,
    data: {
      id: param.id,
      title: param.label,
      type: param.type,
    },
  }));
}

/**
 * Creates views for environments
 */
function createEnvironmentViews(environments: ObjectWithEnvironmentMetadata[]): AnchoredView[] {
  return environments.map((env) => ({
    id: `environment-${env.id}`,
    type: 'environment',
    left: 0,
    top: 0,
    // 确保宽度和高度是整数
    width: Math.ceil((env.width ? env.width * ENVIRONMENT_GRID_WIDTH : ENVIRONMENT_CARD_WIDTH) + WINDOW_X_DELTA),
    height: Math.ceil((env.height ? env.height * ENVIRONMENT_GRID_WIDTH : ENVIRONMENT_CARD_HEIGHT) + WINDOW_Y_DELTA),
    expanded: true,
    data: {
      id: env.id.toString(),
      title: `Environment ${env.label}`,
    },
  }));
}

/**
 * Creates views for charts
 */
function createChartViews(charts: ObjectWithChartMetadata[]): AnchoredView[] {
  return charts.map((chart) => ({
    id: `chart-${chart.id}`,
    type: 'chart',
    left: 0,
    top: 0,
    width: CHART_CARD_WIDTH,
    height: CHART_CARD_HEIGHT,
    expanded: true,
    data: {
      id: chart.id,
      title: chart.label,
    },
  }));
}

// #endregion


// #region other utility functions

const _walkHalt = Symbol();

function _walk(
  view: AnyView,
  condition: (view: AnyView) => boolean,
  haltOnFirstTrue: boolean,
  found: WeakMap<AnyView | Symbol, boolean>,
  result: AnyView[],
): AnyView[] {

  if (found.has(view) || found.has(_walkHalt)) {
    return result;
  }

  if (condition(view)) {
    result.push(view);
    found.set(view, true);
    if (haltOnFirstTrue) {
      found.set(_walkHalt, true);
      return result;
    }
  }

  if (view.type === 'container' && view.views) {
    for (const child of view.views) {
      _walk(child, condition, haltOnFirstTrue, found, result);
    }
  }

  return result;
}


function walkAndFilter(view: AnyView | null | undefined, condition: (view: AnyView) => boolean): AnyView[] {
  if (!view) {
    return [];
  }
  const found = new WeakMap<AnyView, boolean>();
  const result: AnyView[] = [];
  _walk(view, condition, false, found, result);
  return result;
}

function walkAndFind(view: AnyView | null | undefined, condition: (view: AnyView) => boolean): AnyView | undefined {
  if (!view) {
    return undefined;
  }
  const found = new WeakMap<AnyView, boolean>();
  let result: AnyView[] = [];
  _walk(view, condition, true, found, result);
  return result[0];
}

function getParameterSignature(param: { id: string, type?: string }): string {
  return `param:${param.type}:${param.id}`;
}

function getEnvironmentSignature(env: ObjectWithEnvironmentMetadata): string {
  return `env:${env.id}`;
}

function getChartSignature(chart: ObjectWithChartMetadata): string {
  return `chart:${chart.id}`;
}

// #endregion

// #region module entry

if (!window.structuredClone) {
  window.structuredClone = (obj: any) => JSON.parse(JSON.stringify(obj));
}


export function adjustForMainViewPadding(currentView: ContainerView) {
  let maxWidth = 0;
  let maxHeight = 0;
  for (const view of currentView.views) {
    const rightEdge = view.left + view.width;
    const bottomEdge = view.top + view.height;
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

export interface LayoutOptions {
  currentView?: ContainerView;
  inPlace?: boolean;
  preserveExisting?: boolean;
}

export function createAutoLayout(
  environments: ObjectWithEnvironmentMetadata[],
  parameters: Parameter[],
  charts: ObjectWithChartMetadata[],
  options: LayoutOptions = {}
): ContainerView {
  const { currentView: _currentView, inPlace = false, preserveExisting = false } = options;
  const currentView = _currentView
    ? inPlace ? _currentView : structuredClone(_currentView)
    : createDefaultRootLayout();

  const statesFound = new Map<string, boolean>();

  parameters.forEach(p => statesFound.set(getParameterSignature(p), false));
  environments.forEach(e => statesFound.set(getEnvironmentSignature(e), false));
  charts.forEach(c => statesFound.set(getChartSignature(c), false));

  // this maintains statesFound and viewsShouldDisable
  const viewsShouldDisable = walkAndFilter(currentView, (view) => {
    if (view.type === 'container' || !view.type) {
      return false;
    }
    const sign = view.type === 'parameter' ? getParameterSignature(view.data) :
      view.type === 'environment' ? getEnvironmentSignature(view.data as ObjectWithEnvironmentMetadata) :
        view.type === 'chart' ? getChartSignature(view.data as ObjectWithChartMetadata) :
          view.type === 'button' ? getParameterSignature({ id: view.data.id, type: 'action' }) : undefined;
    if (!sign) {
      return false;
    }
    if (statesFound.has(sign)) {
      statesFound.set(sign, true);
      delete view.data.disabled;
      return false;
    } else {
      return true;
    }
  });

  // Find existing containers
  let buttonsContainer = walkAndFind(currentView, view => view.id === preservedViewIds.buttonsContainer) as ContainerView | undefined;
  let parametersContainer = walkAndFind(currentView, view => view.id === preservedViewIds.parametersContainer) as ContainerView | undefined;

  const buttonsContainerIsNew = !buttonsContainer;
  const parametersContainerIsNew = !parametersContainer;

  if (!buttonsContainer) {
    buttonsContainer = createVerticalContainer(
      preservedViewIds.buttonsContainer,
      'Buttons',
      10,
      10
    );
    currentView.views.push(buttonsContainer);
  }
  if (!parametersContainer) {
    parametersContainer = createVerticalContainer(
      preservedViewIds.parametersContainer,
      'Parameters',
      10,
      10
    );
    currentView.views.push(parametersContainer);
  }

  // Separate parameters into buttons and other types
  const [newButtonParameters, newOtherParameters] = parameters.reduce(
    ([actions, others], param) => {
      if (!statesFound.get(getParameterSignature(param))) {
        (param.type === 'action' ? actions : others).push(param as any);
      }
      return [actions, others];
    }, [[], []] as [ActionParameter[], (NumberParameter | EnumParameter | BooleanParameter | StringParameter)[]]
  );

  let rootViewNeedsAdjust = false;

  // Process buttons container
  // Add new button views if any
  if (newButtonParameters.length > 0) {
    const newButtonViews = createButtonViews(newButtonParameters);
    buttonsContainer.views.push(...newButtonViews);
    rootViewNeedsAdjust = true;
  }
  // Re-layout buttons container if it has views (handles both new and existing overlapping views)
  if (buttonsContainer.views.length > 0) {
    const { suggestedContainerWidth, suggestedContainerHeight } = pack(buttonsContainer.views, {
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
    const { suggestedContainerWidth, suggestedContainerHeight } = pack(parametersContainer.views, {
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
    currentView.views.push(...newEnvironmentViews);
    rootViewNeedsAdjust = true;
  }

  // Process charts
  const newCharts = charts.filter(chart => !statesFound.get(getChartSignature(chart)));
  if (newCharts.length > 0) {
    const newChartViews = createChartViews(newCharts);
    currentView.views.push(...newChartViews);
    rootViewNeedsAdjust = true;
  }

  // Handle views that should be removed
  if (!preserveExisting && viewsShouldDisable.length > 0) {
    const viewsToRemoveSet = new Set(viewsShouldDisable);

    // Remove from root level
    currentView.views = currentView.views.filter(view => !viewsToRemoveSet.has(view));

    // Remove from containers
    if (buttonsContainer) {
      buttonsContainer.views = buttonsContainer.views.filter(view => !viewsToRemoveSet.has(view));
    }
    if (parametersContainer) {
      parametersContainer.views = parametersContainer.views.filter(view => !viewsToRemoveSet.has(view));
    }

    rootViewNeedsAdjust = true;
  } else if (preserveExisting) {
    // Mark views as disabled instead of removing them
    viewsShouldDisable.forEach(view => {
      if (view.type !== 'container' && view.type) {
        view.data.disabled = true;
      }
    });
  }

  // Adjust root layout
  // Always re-layout if it's a new view or if there are changes
  if (!_currentView) {
    // New layout: use area-based sorting for optimal initial placement
    pack(currentView.views, {
      inPlace: true,
      targetAspectRatio: 4 / 3,
      padding: PADDING,
      paddingBorder: PADDING,
      sortBy: 'area',
    });
  } else if (rootViewNeedsAdjust || currentView.views.length > 0) {
    // Existing layout: use position-based sorting to preserve user's layout intent
    pack(currentView.views, {
      inPlace: true,
      targetAspectRatio: 4 / 3,
      padding: PADDING,
      paddingBorder: PADDING,
      sortBy: 'position',
      preservePosition: true,
    });
  }

  adjustForMainViewPadding(currentView);

  return currentView;
}
