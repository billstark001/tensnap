import { ContainerView, AnchoredView, AnyView, ButtonView } from '../types/ui';
import { Environment, Parameter, ChartData } from '../types/modeling';

const SIDEBAR_WIDTH = 300;
const HEADER_HEIGHT = 60;
const ENVIRONMENT_CARD_WIDTH = 400;
const ENVIRONMENT_CARD_HEIGHT = 300;
const PARAMETER_CARD_WIDTH = 280;
const PARAMETER_CARD_HEIGHT = 80;
const BUTTON_HEIGHT = 40;
const CHART_CARD_WIDTH = 500;
const CHART_CARD_HEIGHT = 300;
const MARGIN = 20;

interface LayoutOptions {
  currentView?: ContainerView;
  preserveExisting?: boolean;
}

export function createAutoLayout(
  environments: Environment[],
  parameters: Parameter[],
  charts: ChartData[],
  options: LayoutOptions = {}
): ContainerView {
  const { currentView, preserveExisting = false } = options;
  
  // Start with existing view if provided and preserveExisting is true
  const existingViews = preserveExisting && currentView ? [...currentView.views] : [];
  const newViews: AnyView[] = [];
  
  // Separate parameters into buttons and other types
  const buttonParameters = parameters.filter(param => param.type === 'button');
  const otherParameters = parameters.filter(param => param.type !== 'button');

  // Track existing view IDs to avoid duplicates
  const existingViewIds = new Set(existingViews.map(view => view.id));
  
  // Create button views with more reasonable sizing
  let buttonYOffset = MARGIN;
  const buttonViews: ButtonView[] = buttonParameters
    .filter(param => !existingViewIds.has(`button-${param.id}`))
    .map((param) => {
      const view: ButtonView = {
        id: `button-${param.id}`,
        type: 'button',
        left: MARGIN,
        top: buttonYOffset,
        width: PARAMETER_CARD_WIDTH - 2 * MARGIN,
        height: BUTTON_HEIGHT,
        expanded: true,
        data: {
          operation: param.action ?? param.id,
          text: param.label,
        },
      };
      buttonYOffset += BUTTON_HEIGHT + MARGIN / 2;
      return view;
    });
  
  // Create parameter views below buttons
  let parameterYOffset = buttonYOffset;
  const parameterViews: AnchoredView[] = otherParameters
    .filter(param => !existingViewIds.has(`parameter-${param.id}`))
    .map((param) => {
      const view: AnchoredView = {
        id: `parameter-${param.id}`,
        type: 'parameter',
        left: MARGIN,
        top: parameterYOffset,
        width: PARAMETER_CARD_WIDTH - 2 * MARGIN,
        height: PARAMETER_CARD_HEIGHT,
        expanded: true,
        data: {
          id: param.id,
          title: param.label,
        },
      };
      parameterYOffset += PARAMETER_CARD_HEIGHT + MARGIN;
      return view;
    });

  // Create or update parameters container
  if (buttonViews.length > 0 || parameterViews.length > 0) {
    const containerHeight = Math.max(600, parameterYOffset + MARGIN);
    
    // Check if container already exists
    const existingContainer = existingViews.find(view => view.id === 'parameters-container') as ContainerView;
    
    if (existingContainer && preserveExisting) {
      // Update existing container with new views
      existingContainer.views = [
        ...existingContainer.views.filter(view => 
          !view.id.startsWith('button-') && !view.id.startsWith('parameter-')
        ),
        ...buttonViews,
        ...parameterViews
      ];
      existingContainer.height = containerHeight;
    } else {
      // Create new container
      newViews.push({
        id: 'parameters-container',
        type: 'container',
        left: 0,
        top: HEADER_HEIGHT,
        width: SIDEBAR_WIDTH,
        height: containerHeight,
        expanded: true,
        data: {
          title: 'Parameters',
        },
        views: [...buttonViews, ...parameterViews],
      });
    }
  }

  // Create environment views in the main content area
  const envViews: AnchoredView[] = environments
    .filter(env => !existingViewIds.has(`environment-${env.id}`))
    .map((env, index) => {
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

  newViews.push(...envViews);

  // Create chart views below environments
  const chartViews: AnchoredView[] = charts
    .filter(chart => !existingViewIds.has(`chart-${chart.id}`))
    .map((chart, index) => {
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

  newViews.push(...chartViews);

  // 实现删除视图的处理逻辑 - 标记为禁用而不是删除
  // 这样可以在参数/环境暂时不可用时提供更好的用户体验
  const markRemovedViewsAsDisabled = (views: AnyView[], activeIds: Set<string | number>) => {
    return views.map(view => {
      const isStillActive = activeIds.has(view.id);
      // 暂时简化处理，只在日志中记录禁用状态
      // 实际的视觉效果可以在渲染组件中根据数据可用性来处理
      if (!isStillActive) {
        console.log(`View ${view.id} is no longer active from server`);
      }
      return view;
    });
  };

  // 如果需要保留现有视图，则标记已删除的项目为禁用状态
  let processedExistingViews = existingViews;
  if (preserveExisting && existingViews.length > 0) {
    const activeEnvironmentIds = new Set(environments.map(env => env.id));
    const activeParameterIds = new Set(parameters.map(param => param.id));
    const activeChartIds = new Set(charts.map(chart => chart.id));
    
    processedExistingViews = markRemovedViewsAsDisabled(existingViews, 
      new Set([...activeEnvironmentIds, ...activeParameterIds, ...activeChartIds])
    );
  }
  
  // Combine existing and new views
  const allViews = preserveExisting ? [...processedExistingViews, ...newViews] : newViews;

  // Calculate total container size
  const totalEnvRows = Math.ceil(environments.length / 2);
  const totalChartRows = Math.ceil(charts.length / 2);
  const contentHeight = HEADER_HEIGHT + MARGIN + 
    (totalEnvRows * (ENVIRONMENT_CARD_HEIGHT + MARGIN)) +
    (totalChartRows * (CHART_CARD_HEIGHT + MARGIN)) +
    MARGIN;

  // Return updated or new container
  if (preserveExisting && currentView) {
    return {
      ...currentView,
      views: allViews,
      width: Math.max(currentView.width, SIDEBAR_WIDTH + 2 * (ENVIRONMENT_CARD_WIDTH + MARGIN) + MARGIN),
      height: Math.max(currentView.height, contentHeight),
    };
  }

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
    views: allViews,
  };
}
