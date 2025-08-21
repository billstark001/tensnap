import { ContainerView, AnchoredView, AnyView } from '../types/ui';
import { Environment, Parameter, ChartData } from '../types';

const SIDEBAR_WIDTH = 300;
const HEADER_HEIGHT = 60;
const ENVIRONMENT_CARD_WIDTH = 400;
const ENVIRONMENT_CARD_HEIGHT = 300;
const PARAMETER_CARD_WIDTH = 280;
const PARAMETER_CARD_HEIGHT = 200;
const CHART_CARD_WIDTH = 500;
const CHART_CARD_HEIGHT = 300;
const MARGIN = 20;

export function createAutoLayout(
  environments: Environment[],
  parameters: Parameter[],
  charts: ChartData[]
): ContainerView {
  const views: AnyView[] = [];
  
  // Create parameter container on the left sidebar
  if (parameters.length > 0) {
    const parameterViews: AnchoredView[] = parameters.map((param, index) => ({
      id: `parameter-${param.id}`,
      type: 'parameter',
      left: MARGIN,
      top: MARGIN + index * (PARAMETER_CARD_HEIGHT + MARGIN),
      width: PARAMETER_CARD_WIDTH - 2 * MARGIN,
      height: PARAMETER_CARD_HEIGHT,
      expanded: true,
      data: {
        id: param.id,
        title: param.label,
      },
    }));

    views.push({
      id: 'parameters-container',
      type: 'container',
      left: 0,
      top: HEADER_HEIGHT,
      width: SIDEBAR_WIDTH,
      height: Math.max(600, parameterViews.length * (PARAMETER_CARD_HEIGHT + MARGIN) + MARGIN),
      expanded: true,
      data: {
        title: 'Parameters',
      },
      views: parameterViews,
    });
  }

  // Create environment views in the main content area
  const envViews: AnchoredView[] = environments.map((env, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    
    return {
      id: `environment-${env.id}`,
      type: 'environment',
      left: SIDEBAR_WIDTH + MARGIN + col * (ENVIRONMENT_CARD_WIDTH + MARGIN),
      top: HEADER_HEIGHT + MARGIN + row * (ENVIRONMENT_CARD_HEIGHT + MARGIN),
      width: ENVIRONMENT_CARD_WIDTH,
      height: ENVIRONMENT_CARD_HEIGHT,
      expanded: true,
      data: {
        id: env.id.toString(),
        title: `Environment ${env.id}`,
      },
    };
  });

  views.push(...envViews);

  // Create chart views below environments
  const chartViews: AnchoredView[] = charts.map((chart, index) => {
    const envRows = Math.ceil(environments.length / 2);
    const col = index % 2;
    const row = Math.floor(index / 2);
    
    return {
      id: `chart-${chart.id}`,
      type: 'chart',
      left: SIDEBAR_WIDTH + MARGIN + col * (CHART_CARD_WIDTH + MARGIN),
      top: HEADER_HEIGHT + MARGIN + envRows * (ENVIRONMENT_CARD_HEIGHT + MARGIN) + row * (CHART_CARD_HEIGHT + MARGIN),
      width: CHART_CARD_WIDTH,
      height: CHART_CARD_HEIGHT,
      expanded: true,
      data: {
        id: chart.id,
        title: chart.label,
      },
    };
  });

  views.push(...chartViews);

  // Calculate total container size
  const totalEnvRows = Math.ceil(environments.length / 2);
  const totalChartRows = Math.ceil(charts.length / 2);
  const contentHeight = HEADER_HEIGHT + MARGIN + 
    (totalEnvRows * (ENVIRONMENT_CARD_HEIGHT + MARGIN)) +
    (totalChartRows * (CHART_CARD_HEIGHT + MARGIN)) +
    MARGIN;

  return {
    id: 'main-container',
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
