type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

export type BaseView<TType extends string, TData extends JsonSerializable> = {
  id: string;
  type: TType;
  left: number;
  top: number;
  width: number;
  height: number;
  expanded: boolean;
  disabled: boolean;
} & ([TData] extends [null | undefined | never] ? { data?: TData } : { data: TData });

export type ButtonView = BaseView<
  'button',
  {
    id: string;
    text: string;
    continuous?: boolean;
  }
>;

/** Presentation fields for one environment layer; simulator metadata stays unchanged. */
export type LayerViewOverride = { [field: string]: JsonSerializable };
export type LayerViewOverrides = { [layerId: string]: LayerViewOverride };

/** One locally displayed chart series, keyed by its published or local series ID. */
export type ChartSeriesView = { id: string; label: string; color?: string };

export type AnchoredView = BaseView<
  'environment' | 'parameter' | 'chart' | 'monitor',
  {
    id: string;
    title?: string;
    type?: string;
    /** Environment views only: local presentation overrides for each bound layer. */
    layerOverrides?: LayerViewOverrides;
    /** Chart views only: displayed series and local labels/colors; history stays unchanged. */
    chartSeries?: ChartSeriesView[];
    /** Monitor views only: local display override; omission follows simulator metadata. */
    renderHint?: 'auto' | 'tree' | 'table' | 'text';
  }
>;

export type ContainerView = BaseView<
  'container',
  {
    title: string;
  }
> & {
  views: AnyView[];
};

export type AnyView = ButtonView | AnchoredView | ContainerView;

/**
 * Creates the default root layout container
 */
export function createDefaultRootLayout(views?: AnyView[]): ContainerView {
  views ??= [];
  return {
    id: 'main-container',
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
