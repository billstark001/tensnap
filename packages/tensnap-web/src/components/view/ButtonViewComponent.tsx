import { ButtonView } from "@/types/ui";
import * as styles from './styles.css';
import { useViewContext } from "./useViewContext";
import clsx from 'clsx';
import { Play, Pause } from 'lucide-react';

export type ButtonViewProps = {
  view: ButtonView;
};

export const ButtonViewComponent = ({ view }: ButtonViewProps) => {

  const { onButtonAction, isRunning } = useViewContext();
  const isDisabled = view.disabled;
  const isContinuous = (view as ButtonView).data.continuous ?? false;
  const running = isContinuous && isRunning(view.data.id);

  return (
    <div
      className={clsx(
        styles.buttonView,
        isDisabled && styles.buttonViewDisabled,
        running && styles.buttonViewRunning,
      )}
      onClick={isDisabled ? undefined : () => onButtonAction(view.data.id, view.data.continuous)}
    >
      {isContinuous && (running ? <Pause size={14} /> : <Play size={14} />)}
      {(view as ButtonView).data.text}
    </div>
  );
};
