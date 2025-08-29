import { ContainerView, AnchoredView, AnyView, ButtonView } from '@/types/ui';
import { Environment, Parameter, ChartData } from '@/types/modeling';

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

export const preservedViewIds = Object.freeze({
  buttonsContainer: 'buttons-container',
  parametersContainer: 'parameters-container',
  mainContainer: 'main-container',
});

// Helper function for simple vertical layout within containers
function layoutVertically(views: AnyView[], padding: number): AnyView[] {
  let currentY = 0;
  return views.map(view => {
    const layoutedView = {
      ...view,
      left: 0,
      top: currentY,
    };
    currentY += view.height + padding;
    return layoutedView;
  });
}

// Helper function to check if a view matches a data item by type and properties

// Helper function to check if a view matches a data item by type and properties
function viewMatchesItem(view: AnyView, item: Environment | Parameter | ChartData, type: string): boolean {
  if (view.type !== type) return false;
  
  switch (type) {
    case 'environment':
      return 'id' in view.data && view.data.id === (item as Environment).id.toString();
    case 'parameter':
      return 'id' in view.data && view.data.id === (item as Parameter).id;
    case 'button':
      return 'operation' in view.data && view.data.operation === (item as Parameter & { action?: string }).action;
    case 'chart':
      return 'id' in view.data && view.data.id === (item as ChartData).id;
    default:
      return false;
  }
}

// Helper function to find existing views that match data items
function findExistingViews(
  currentViews: AnyView[],
  items: (Environment | Parameter | ChartData)[],
  type: string
): { existing: AnyView[]; itemsToAdd: (Environment | Parameter | ChartData)[] } {
  const existing: AnyView[] = [];
  const itemsToAdd: (Environment | Parameter | ChartData)[] = [];
  
  for (const item of items) {
    const existingView = currentViews.find(view => viewMatchesItem(view, item, type));
    if (existingView) {
      existing.push(existingView);
    } else {
      itemsToAdd.push(item);
    }
  }
  
  return { existing, itemsToAdd };
}

export interface LayoutOptions {
  currentView?: ContainerView;
  preserveExisting?: boolean;
}

// #region utility functions

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

// #endregion


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

  // Find existing containers
  const existingButtonsContainer = existingViews.find(view => view.id === preservedViewIds.buttonsContainer) as ContainerView;
  const existingParametersContainer = existingViews.find(view => view.id === preservedViewIds.parametersContainer) as ContainerView;
  
  // Process buttons container
  let buttonsContainer: ContainerView | null = null;
  if (buttonParameters.length > 0) {
    const buttonContainerViews = existingButtonsContainer?.views || [];
    const { existing: existingButtonViews, itemsToAdd: buttonsToAdd } = findExistingViews(
      buttonContainerViews,
      buttonParameters,
      'button'
    );
    
    // Create new button views
    const newButtonViews: ButtonView[] = (buttonsToAdd as Parameter[]).map((param, index) => ({
      id: `button-${param.id}`,
      type: 'button',
      left: 0,
      top: index * (BUTTON_HEIGHT + MARGIN / 2),
      width: PARAMETER_CARD_WIDTH - 2 * MARGIN,
      height: BUTTON_HEIGHT,
      expanded: true,
      data: {
        operation: (param as any).action ?? param.id,
        text: param.label,
      },
    }));

    // Combine existing and new button views
    const allButtonViews = [...existingButtonViews, ...newButtonViews];
    
    if (allButtonViews.length > 0) {
      // Use simple vertical layout for buttons
      const layoutedButtonViews = layoutVertically(allButtonViews, MARGIN / 2).map(view => ({
        ...view,
        left: view.left + MARGIN,
        top: view.top + MARGIN,
      }));
      
      // Calculate correct container height
      const totalHeight = allButtonViews.length > 0 ? 
        allButtonViews.reduce((acc, _, index) => acc + BUTTON_HEIGHT + (index > 0 ? MARGIN / 2 : 0), 0) + 2 * MARGIN :
        100;
      
      buttonsContainer = {
        id: preservedViewIds.buttonsContainer,
        type: 'container',
        left: 0,
        top: HEADER_HEIGHT,
        width: SIDEBAR_WIDTH,
        height: Math.max(totalHeight, 100),
        expanded: true,
        data: {
          title: 'Buttons',
        },
        views: layoutedButtonViews,
      };
    }
  }

  // Process parameters container
  let parametersContainer: ContainerView | null = null;
  if (otherParameters.length > 0) {
    const paramContainerViews = existingParametersContainer?.views || [];
    const { existing: existingParamViews, itemsToAdd: paramsToAdd } = findExistingViews(
      paramContainerViews,
      otherParameters,
      'parameter'
    );
    
    // Create new parameter views
    const newParameterViews: AnchoredView[] = (paramsToAdd as Parameter[]).map((param, index) => ({
      id: `parameter-${param.id}`,
      type: 'parameter',
      left: 0,
      top: index * (PARAMETER_CARD_HEIGHT + MARGIN),
      width: PARAMETER_CARD_WIDTH - 2 * MARGIN,
      height: PARAMETER_CARD_HEIGHT,
      expanded: true,
      data: {
        id: param.id,
        title: param.label,
      },
    }));

    // Combine existing and new parameter views
    const allParameterViews = [...existingParamViews, ...newParameterViews];
    
    if (allParameterViews.length > 0) {
      // Use simple vertical layout for parameters
      const layoutedParameterViews = layoutVertically(allParameterViews, MARGIN).map(view => ({
        ...view,
        left: view.left + MARGIN,
        top: view.top + MARGIN,
      }));
      
      // Calculate correct container height
      const totalHeight = allParameterViews.length > 0 ? 
        allParameterViews.reduce((acc, _, index) => acc + PARAMETER_CARD_HEIGHT + (index > 0 ? MARGIN : 0), 0) + 2 * MARGIN :
        100;
      
      const containerTop = buttonsContainer ? 
        buttonsContainer.top + buttonsContainer.height + MARGIN : 
        HEADER_HEIGHT;
      
      parametersContainer = {
        id: preservedViewIds.parametersContainer,
        type: 'container',
        left: 0,
        top: containerTop,
        width: SIDEBAR_WIDTH,
        height: Math.max(totalHeight, 100),
        expanded: true,
        data: {
          title: 'Parameters',
        },
        views: layoutedParameterViews,
      };
    }
  }

  // Add container views to new views
  if (buttonsContainer) newViews.push(buttonsContainer);
  if (parametersContainer) newViews.push(parametersContainer);

  // Create environment and chart views for main content area
  const mainContentViews: AnchoredView[] = [];
  
  // Find existing main content views
  const { existing: existingEnvViews, itemsToAdd: envsToAdd } = findExistingViews(
    existingViews,
    environments,
    'environment'
  );
  
  const { existing: existingChartViews, itemsToAdd: chartsToAdd } = findExistingViews(
    existingViews,
    charts,
    'chart'
  );

  // Create new environment views
  const newEnvViews: AnchoredView[] = (envsToAdd as Environment[]).map((env, index) => {
    // Place new environments starting from where existing ones end
    const existingEnvCount = existingEnvViews.length;
    const totalIndex = existingEnvCount + index;
    const col = totalIndex % 2;
    const row = Math.floor(totalIndex / 2);
    return {
      id: `environment-${env.id}`,
      type: 'environment',
      left: col * (ENVIRONMENT_CARD_WIDTH + MARGIN),
      top: row * (ENVIRONMENT_CARD_HEIGHT + MARGIN),
      width: ENVIRONMENT_CARD_WIDTH,
      height: ENVIRONMENT_CARD_HEIGHT,
      expanded: true,
      data: {
        id: env.id.toString(),
        title: `Environment ${env.id}`,
      },
    };
  });

  // Create new chart views
  const newChartViews: AnchoredView[] = (chartsToAdd as ChartData[]).map((chart, index) => {
    // Place charts below all environments
    const totalEnvCount = existingEnvViews.length + newEnvViews.length;
    const envRows = Math.ceil(totalEnvCount / 2);
    const existingChartCount = existingChartViews.length;
    const totalIndex = existingChartCount + index;
    const col = totalIndex % 2;
    const row = envRows + Math.floor(totalIndex / 2);
    return {
      id: `chart-${chart.id}`,
      type: 'chart',
      left: col * (CHART_CARD_WIDTH + MARGIN),
      top: row * (CHART_CARD_HEIGHT + MARGIN),
      width: CHART_CARD_WIDTH,
      height: CHART_CARD_HEIGHT,
      expanded: true,
      data: {
        id: chart.id,
        title: chart.label,
      },
    };
  });

  // Combine all main content views
  const allMainViews = [...existingEnvViews, ...existingChartViews, ...newEnvViews, ...newChartViews] as AnchoredView[];
  
  if (allMainViews.length > 0) {
    const sidebarWidth = Math.max(
      buttonsContainer?.width || 0,
      parametersContainer?.width || 0,
      SIDEBAR_WIDTH
    );
    
    let packedMainViews: AnchoredView[];
    
    if (preserveExisting && allMainViews.some(view => (view.left || 0) > 0 || (view.top || 0) > 0)) {
      // For existing layouts, try to preserve positions but fix overlaps
      const environments = allMainViews.filter(view => view.type === 'environment');
      const charts = allMainViews.filter(view => view.type === 'chart');
      
      // Re-layout environments in a grid
      const layoutedEnvironments = environments.map((env, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        return {
          ...env,
          left: col * (ENVIRONMENT_CARD_WIDTH + MARGIN),
          top: row * (ENVIRONMENT_CARD_HEIGHT + MARGIN),
        };
      });
      
      // Layout charts below environments
      const envRows = Math.ceil(environments.length / 2);
      const layoutedCharts = charts.map((chart, index) => {
        const col = index % 2;
        const row = envRows + Math.floor(index / 2);
        return {
          ...chart,
          left: col * (CHART_CARD_WIDTH + MARGIN),
          top: row * (CHART_CARD_HEIGHT + MARGIN),
        };
      });
      
      packedMainViews = [...layoutedEnvironments, ...layoutedCharts] as AnchoredView[];
    } else {
      // For new layouts, separate environments and charts
      const environments = allMainViews.filter(view => view.type === 'environment');
      const charts = allMainViews.filter(view => view.type === 'chart');
      
      // Layout environments in a grid
      const layoutedEnvironments = environments.map((env, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        return {
          ...env,
          left: col * (ENVIRONMENT_CARD_WIDTH + MARGIN),
          top: row * (ENVIRONMENT_CARD_HEIGHT + MARGIN),
        };
      });
      
      // Layout charts below environments
      const envRows = Math.ceil(environments.length / 2);
      const layoutedCharts = charts.map((chart, index) => {
        const col = index % 2;
        const row = envRows + Math.floor(index / 2);
        return {
          ...chart,
          left: col * (CHART_CARD_WIDTH + MARGIN),
          top: row * (CHART_CARD_HEIGHT + MARGIN),
        };
      });
      
      packedMainViews = [...layoutedEnvironments, ...layoutedCharts] as AnchoredView[];
    }

    // Apply offset by sidebar width and header height
    const offsetMainViews = packedMainViews.map(view => ({
      ...view,
      left: view.left + sidebarWidth + MARGIN,
      top: view.top + HEADER_HEIGHT + MARGIN,
    }));
    
    mainContentViews.push(...offsetMainViews);
  }

  newViews.push(...mainContentViews);

  // Filter out existing views that don't match current data
  const filteredExistingViews = preserveExisting ? 
    existingViews.filter(view => {
      // Keep containers and main content views that we've already processed
      if (view.id === preservedViewIds.buttonsContainer || 
          view.id === preservedViewIds.parametersContainer) {
        return false; // We've replaced these
      }
      
      // Keep other views that still have matching data
      const isEnvironment = environments.some(env => viewMatchesItem(view, env, 'environment'));
      const isParameter = parameters.some(param => viewMatchesItem(view, param, 'parameter'));
      const isButton = buttonParameters.some(param => viewMatchesItem(view, param, 'button'));
      const isChart = charts.some(chart => viewMatchesItem(view, chart, 'chart'));
      
      return isEnvironment || isParameter || isButton || isChart;
    }) : [];

  // Combine all views
  const allViews = [...filteredExistingViews, ...newViews];

  // Calculate total container size
  const sidebarWidth = Math.max(
    buttonsContainer?.width || 0,
    parametersContainer?.width || 0,
    SIDEBAR_WIDTH
  );
  
  // Calculate main content area dimensions
  const totalEnvCount = environments.length;
  const totalChartCount = charts.length;
  const envRows = Math.ceil(totalEnvCount / 2);
  const chartRows = Math.ceil(totalChartCount / 2);
  const totalRows = envRows + chartRows;
  
  const mainContentWidth = Math.max(
    2 * Math.max(ENVIRONMENT_CARD_WIDTH, CHART_CARD_WIDTH) + 3 * MARGIN,
    800
  );
  const mainContentHeight = totalRows > 0 ? 
    (totalRows * Math.max(ENVIRONMENT_CARD_HEIGHT, CHART_CARD_HEIGHT) + (totalRows + 1) * MARGIN) : 
    400;
  
  const totalWidth = sidebarWidth + mainContentWidth + MARGIN;
  const totalHeight = Math.max(
    HEADER_HEIGHT + mainContentHeight + MARGIN,
    HEADER_HEIGHT + (buttonsContainer?.height || 0) + (parametersContainer?.height || 0) + 2 * MARGIN,
    600
  );

  // Return updated or new container
  if (preserveExisting && currentView) {
    return {
      ...currentView,
      views: allViews,
      width: Math.max(currentView.width, totalWidth),
      height: Math.max(currentView.height, totalHeight),
    };
  }

  return createDefaultRootLayout(allViews, totalHeight);
}
