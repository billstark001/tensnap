import { ContainerView, AnchoredView, AnyView, ButtonView } from '@/types/ui';
import { Environment, Parameter, ChartData, ButtonParameter, SliderParameter, EnumParameter } from '@/types/modeling';
import { adjustLayout, initialPack } from './pack';

const SIDEBAR_WIDTH = 300;
const HEADER_HEIGHT = 60;
const ENVIRONMENT_CARD_WIDTH = 600;
const ENVIRONMENT_CARD_HEIGHT = 600;
const PARAMETER_CARD_WIDTH = 280;
const PARAMETER_CARD_HEIGHT = 80;
const BUTTON_HEIGHT = 40;
const CHART_CARD_WIDTH = 500;
const CHART_CARD_HEIGHT = 400;
const MARGIN = 20;

export const preservedViewIds = Object.freeze({
  buttonsContainer: 'buttons-container',
  parametersContainer: 'parameters-container',
  mainContainer: 'main-container',
});

export interface LayoutOptions {
  currentView?: ContainerView;
  preserveExisting?: boolean;
}

// #region object creation functions

export function createDefaultRootLayout(
  views?: AnyView[],
  contentHeight = 800,
): ContainerView {
  views ??= [];
  return {
    id: preservedViewIds.mainContainer,
    type: 'container',
    left: 0,
    top: 0,
    width: Math.max(1200, SIDEBAR_WIDTH + 2 * (ENVIRONMENT_CARD_WIDTH + MARGIN) + MARGIN),
    height: Math.max(800, contentHeight),
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
  containerWidth: number,
): ContainerView {
  return {
    id,
    type: 'container',
    left: containerLeft,
    top: containerTop,
    width: containerWidth,
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
    width: PARAMETER_CARD_WIDTH - 2 * MARGIN,
    height: BUTTON_HEIGHT,
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
    width: PARAMETER_CARD_WIDTH - 2 * MARGIN,
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
function createEnvironmentViews(environments: Environment[]): AnchoredView[] {
  return environments.map((env) => ({
    id: `environment-${env.id}`,
    type: 'environment',
    left: 0,
    top: 0,
    width: ENVIRONMENT_CARD_WIDTH,
    height: ENVIRONMENT_CARD_HEIGHT,
    expanded: true,
    data: {
      id: env.id.toString(),
      title: `Environment ${env.id}`,
    },
  }));
}

/**
 * Creates views for charts
 */
function createChartViews(charts: ChartData[]): AnchoredView[] {
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

function getEnvironmentSignature(env: Pick<Environment, 'id'>): string {
  return `env:${env.id}`;
}

function getChartSignature(chart: Pick<ChartData, 'id'>): string {
  return `chart:${chart.id}`;
}

// #endregion

// #region module entry

if (!window.structuredClone) {
  window.structuredClone = (obj: any) => JSON.parse(JSON.stringify(obj));
}

export function createAutoLayout(
  environments: Environment[],
  parameters: Parameter[],
  charts: ChartData[],
  options: LayoutOptions = {}
): ContainerView {
  const { currentView: _currentView, preserveExisting = false } = options;
  const currentView = _currentView
    ? structuredClone(_currentView)
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
      view.type === 'environment' ? getEnvironmentSignature(view.data) :
        view.type === 'chart' ? getChartSignature(view.data) :
          view.type === 'button' ? getParameterSignature({ id: view.data.id, type: 'button' }) : undefined;
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

  if (!buttonsContainer) {
    buttonsContainer = createVerticalContainer(
      preservedViewIds.buttonsContainer,
      'Buttons',
      0,
      HEADER_HEIGHT,
      SIDEBAR_WIDTH,
    );
    currentView.views.push(buttonsContainer);
  }
  if (!parametersContainer) {
    parametersContainer = createVerticalContainer(
      preservedViewIds.parametersContainer,
      'Parameters',
      0,
      HEADER_HEIGHT + 100, // for layout hint
      SIDEBAR_WIDTH,
    );
    currentView.views.push(parametersContainer);
  }

  // Separate parameters into buttons and other types
  const [newButtonParameters, newOtherParameters] = parameters.reduce(
    ([buttons, others], param) => {
      if (!statesFound.get(getParameterSignature(param))) {
        (param.type === 'button' ? buttons : others).push(param as any);
      }
      return [buttons, others];
    }, [[], []] as [ButtonParameter[], (SliderParameter | EnumParameter)[]]
  );

  let rootViewNeedsAdjust = false;

  // Process buttons container
  if (newButtonParameters.length > 0) {
    // Create new button views and combine with existing
    const newButtonViews = createButtonViews(newButtonParameters);
    buttonsContainer.views.push(...newButtonViews);
    const { suggestedContainerWidth, suggestedContainerHeight } = adjustLayout(buttonsContainer.views, {
      inPlace: true,
      targetAspectRatio: 0.1,
    });
    buttonsContainer.width = suggestedContainerWidth;
    buttonsContainer.height = suggestedContainerHeight;
    rootViewNeedsAdjust = true;
  }

  // Process parameters container
  if (newOtherParameters.length > 0) {
    // Create new parameter views and combine with existing
    const newParameterViews = createParameterViews(newOtherParameters);
    parametersContainer.views.push(...newParameterViews);
    const { suggestedContainerWidth, suggestedContainerHeight } = adjustLayout(parametersContainer.views, {
      inPlace: true,
      targetAspectRatio: 0.1,
    });
    parametersContainer.width = suggestedContainerWidth;
    parametersContainer.height = suggestedContainerHeight;
    rootViewNeedsAdjust = true;
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
  // Adjust root layout
  if (!_currentView) {
    initialPack(currentView.views, {
      inPlace: true,
      targetAspectRatio: 4 / 3,
    });
  } else if (rootViewNeedsAdjust) {
    const { suggestedContainerWidth, suggestedContainerHeight } = adjustLayout(currentView.views, {
      inPlace: true,
      targetAspectRatio: 4 / 3,
    });
    currentView.width = suggestedContainerWidth;
    currentView.height = suggestedContainerHeight;
  }

  if (preserveExisting) {
    viewsShouldDisable.forEach(view => {
      if (view.type !== 'container' && view.type) {
        view.data.disabled = true;
      }
    });
  } else {
    // TODO delete all views in-place
  }

  return currentView;
}
