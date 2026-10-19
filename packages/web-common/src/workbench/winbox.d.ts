declare module 'winbox/src/js/winbox' {
  export default class WinBox {
    constructor(options: {
      title: string;
      mount: HTMLElement;
      modal: boolean;
      width: number;
      height: number;
      x: string;
      y: string;
      minwidth: number;
      minheight: number;
      class: string[];
      onclose: () => boolean;
      onfocus: () => void;
    });
    dom: HTMLElement;
    setTitle(title: string): void;
    close(force?: boolean): void;
  }
}
declare module '*.css';
