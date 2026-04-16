import { ContainerView, AnchoredView, AnyView, ButtonView } from '@/types/ui';
import {
  Parameter,
  Action,
  BooleanParameter,
} from '@/types/model';
import { ObjectWithEnvironmentMetadata, ObjectWithChartMetadata, Point } from '../types';
import {
  ENVIRONMENT_GRID_WIDTH,
  ENVIRONMENT_CARD_WIDTH,
  ENVIRONMENT_CARD_HEIGHT,
  CHART_CARD_WIDTH,
  CHART_CARD_HEIGHT,
  WINDOW_X_DELTA,
  WINDOW_Y_DELTA,
  preservedViewIds,
} from '../constants';
import { generateUniqueId } from '@/utils/common';

/**
 * Creates the default root layout container
 */
export function createDefaultRootLayout(views?: AnyView[]): ContainerView {
  views ??= [];
  return {
    id: preservedViewIds.mainContainer,
    type: 'container',
    left: 0,
    top: 0,
    width: 1200,
    height: 800,
    expanded: true,
    disabled: false,
    data: {
      title: 'TenSnap Visualization',
    },
    views,
  };
}

/**
 * Creates a generic container with vertically packed views
 */
export function createVerticalContainer(
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
    disabled: false,
    data: { title },
    views: [],
  };
}


// #region View creation from objects

/**
 * Creates a button view from an action
 * @param action The action object (required)
 * @param position The position for the view (optional, defaults to 0,0)
 */
export function createButtonView(
  action: Action,
  position?: Point,
  randomId = true,
): ButtonView {
  const { x = 0, y = 0 } = position || {};
  return {
    id: randomId ? generateUniqueId() : `button-${action.id}`,
    type: 'button',
    left: x,
    top: y,
    width: 120,
    height: 40,
    expanded: true,
    disabled: false,
    data: {
      id: action.id,
      text: action.label,
      continuous: action.continuous,
    },
  };
}

/**
 * Creates a parameter view from a boolean parameter
 * @param parameter The boolean parameter object (required)
 * @param position The position for the view (optional, defaults to 0,0)
 */
export function createParameterView(
  parameter: BooleanParameter,
  position?: Point,
  randomId = true,
): AnchoredView {
  const { x = 0, y = 0 } = position || {};
  return {
    id: randomId ? generateUniqueId() : `parameter-${parameter.id}`,
    type: 'parameter',
    left: x,
    top: y,
    width: 200,
    height: 80,
    expanded: true,
    disabled: false,
    data: {
      id: parameter.id,
      title: parameter.label,
      type: parameter.type,
    },
  };
}

/**
 * Creates a chart view from a chart group
 * @param chartGroup The chart group object (required)
 * @param position The position for the view (optional, defaults to 0,0)
 */
export function createChartView(
  chartGroup: ObjectWithChartMetadata,
  position?: Point,
  randomId = true,
): AnchoredView {
  const { x = 0, y = 0 } = position || {};
  return {
    id: randomId ? generateUniqueId() : `chart-${chartGroup.id}`,
    type: 'chart',
    left: x,
    top: y,
    width: CHART_CARD_WIDTH,
    height: CHART_CARD_HEIGHT,
    expanded: true,
    disabled: false,
    data: {
      id: chartGroup.id,
      title: chartGroup.label,
    },
  };
}

/**
 * Creates an environment view from an environment object
 * @param environment The environment object (required)
 * @param position The position for the view (optional, defaults to 0,0)
 */
export function createEnvironmentView(
  environment: ObjectWithEnvironmentMetadata,
  position?: Point,
  randomId = true,
): AnchoredView {
  const { x = 0, y = 0 } = position || {};
  return {
    id: randomId ? generateUniqueId() : `environment-${environment.id}`,
    type: 'environment',
    left: x,
    top: y,
    width: Math.ceil((environment.width ? environment.width * ENVIRONMENT_GRID_WIDTH : ENVIRONMENT_CARD_WIDTH) + WINDOW_X_DELTA),
    height: Math.ceil((environment.height ? environment.height * ENVIRONMENT_GRID_WIDTH : ENVIRONMENT_CARD_HEIGHT) + WINDOW_Y_DELTA),
    expanded: true,
    disabled: false,
    data: {
      id: environment.id,
      title: environment.label,
      type: environment.type,
    },
  };
}

// #endregion


/**
 * Creates views for actions (buttons)
 */
export function createButtonViews(actions: Action[]): ButtonView[] {
  return actions.map((action) => createButtonView(action, undefined, false));
}

/**
 * Creates views for parameters
 */
export function createParameterViews(parameters: Parameter[]): AnchoredView[] {
  return parameters.map((param) => createParameterView(param as any, undefined, false));
}

/**
 * Creates views for environments
 */
export function createEnvironmentViews(environments: ObjectWithEnvironmentMetadata[]): AnchoredView[] {
  return environments.map((env) => createEnvironmentView(env, undefined, false));
}

/**
 * Creates views for charts
 */
export function createChartViews(charts: ObjectWithChartMetadata[]): AnchoredView[] {
  return charts.map((chart) => createChartView(chart, undefined, false));
}
