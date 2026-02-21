import { CreateStoreFunction } from '@/utils/zustand';
import { ViewsSlice, ScenarioStore } from '../types';
import { createDefaultRootLayout } from '@/components/view/utils/pack';
import { createAutoLayout } from '@/components/view/utils/pack';

const getEnvironmentMetadata = (env: any) => ({
  id: env.id,
  type: env.type,
  label: env.label,
  width: env.props?.width,
  height: env.props?.height,
});

export const createViewsSlice: CreateStoreFunction<ViewsSlice, ScenarioStore> = (set, get) => ({
  mainView: createDefaultRootLayout(),

  setMainView: (view) => {
    if (typeof view === 'function') {
      set((state) => ({ mainView: view(state.mainView) }));
    } else {
      set({ mainView: view });
    }
  },

  updateMainViewLayout: () => {
    const { environments, parameters, charts, mainView } = get();
    const environmentsArray = Array.from(environments.values()).map(getEnvironmentMetadata);
    
    set({
      mainView: createAutoLayout(
        mainView,
        environmentsArray,
        Array.from(parameters.values()),
        charts.getGroupList(),
        { disableMissingViews: true }
      )
    });
  },
});