declare module 'winbox/src/js/winbox' {
  export default class WinBox {
    constructor(options: {
      title: string;
      mount: HTMLElement;
      modal: boolean;
      width: number;
      height: number;
      x: string | number;
      y: string | number;
      maxwidth: number;
      maxheight: number;
      minwidth: number;
      minheight: number;
      header: number;
      class: string[];
      onclose: () => boolean;
      onfocus: () => void;
    });
    max: boolean;
    onmaximize?: () => void;
    x: number;
    y: number;
    width: number;
    height: number;
    minwidth: number;
    minheight: number;
    maxwidth: number;
    maxheight: number;
    onmove?: (x: number, y: number) => void;
    onresize?: (width: number, height: number) => void;
    resize(width: number, height: number, skipUpdate?: boolean): this;
    move(x: number, y: number, skipUpdate?: boolean): this;
    dom: HTMLElement;
    setTitle(title: string): void;
    close(force?: boolean): void;
  }
}
declare module '*.css';
