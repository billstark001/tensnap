export type JsonSerializable = any;

export type BaseView<TType extends string, TData extends JsonSerializable> = {
  id: string;
  type: TType;
  left: number;
  top: number;
  width: number;
  height: number;
  expanded: boolean;
} & (
    [TData] extends [null | undefined | never]
    ? { data?: TData; }
    : { data: TData; }
  );

export type ButtonView = BaseView<
  'button',
  {
    operation: string;
    text: string;
  }>;

export type AnchoredView = BaseView<
  'environment' | 'parameter' | 'chart',
  {
    id: string;
    title?: string;
  }>;

export type ContainerView = BaseView<
  'container',
  {
    title: string;
  }
> & {
  views: AnyView[];
};

export type AnyView = ButtonView | AnchoredView | ContainerView;

export type AlignmentGuides = {
  vertical: number[];
  horizontal: number[];
};