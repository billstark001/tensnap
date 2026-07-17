import type { MonitorBinding, MonitorOptions } from './types';
import { titleFromId, withDefined } from './utils';

export function monitorBinding<TConfig extends object, TModel>(
  id: string,
  options: MonitorOptions<TConfig, TModel>,
): MonitorBinding<TConfig, TModel> {
  return {
    metadata() {
      return withDefined({
        id,
        label: options.label ?? titleFromId(id),
        render_hint: options.renderHint,
      });
    },
    value(model, config) {
      return options.get(model, config);
    },
  };
}
