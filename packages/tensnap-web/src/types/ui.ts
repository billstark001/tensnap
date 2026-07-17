import { JsonSerializable } from "./utils";

export type BaseView<TType extends string, TData extends JsonSerializable> = {
  id: string;
  type: TType;
  left: number;
  top: number;
  width: number;
  height: number;
  expanded: boolean;
  disabled: boolean;
} & (
    [TData] extends [null | undefined | never]
    ? { data?: TData; }
    : { data: TData; }
  );

export type ButtonView = BaseView<
  'button',
  {
    id: string;
    text: string;
    continuous?: boolean;
  }>;

export type AnchoredView = BaseView<
  'environment' | 'parameter' | 'chart' | 'monitor',
  {
    id: string;
    title?: string;
    type?: string;
    /** Local display override; the simulator-owned monitor metadata remains immutable. */
    renderHint?: 'auto' | 'tree' | 'table' | 'text';
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
