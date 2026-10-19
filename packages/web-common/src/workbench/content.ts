export interface WindowOptions {
  title: string;
  type: string;
  size: 'md' | 'lg' | 'xl' | 'full';
  modal: boolean;
  dismissible: boolean;
  onClose(): void;
}
export interface ContentWindow {
  element: HTMLElement;
  update(options: WindowOptions): void;
  dispose(): void;
}
export interface DialogHost {
  create(options: WindowOptions): ContentWindow;
}
let dialogHost: DialogHost | undefined;
export function configureDialogHost(host: DialogHost): void {
  dialogHost = host;
}
export function getDialogHost(): DialogHost {
  if (!dialogHost)
    throw new Error('The application must configure its dialog host before mounting content.');
  return dialogHost;
}
