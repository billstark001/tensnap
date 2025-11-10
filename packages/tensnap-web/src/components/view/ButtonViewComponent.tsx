import { ButtonView } from "@/types/ui";
import * as styles from './styles.css';
import { useViewContext } from "./useViewContext";
import clsx from 'clsx';

export type ButtonViewProps = {
  view: ButtonView;
};

export const ButtonViewComponent = ({ view }: ButtonViewProps) => {

  const { onButtonAction } = useViewContext();
  const isDisabled = view.data.disabled;

  return (
    <div 
      className={clsx(styles.buttonView, isDisabled && styles.buttonViewDisabled)} 
      onClick={isDisabled ? undefined : () => onButtonAction(view.data.id)}
    >
      {(view as ButtonView).data.text}
    </div>
  );
};