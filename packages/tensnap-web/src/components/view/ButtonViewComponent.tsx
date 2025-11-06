import { ButtonView } from "@/types/ui";
import * as styles from './styles.css';
import { useViewContext } from "./useViewContext";

export type ButtonViewProps = {
  view: ButtonView;
};

export const ButtonViewComponent = ({ view }: ButtonViewProps) => {

  const { onButtonAction } = useViewContext();

  return (
    <div className={styles.buttonView} onClick={() => onButtonAction(view.data.id)}>
      {(view as ButtonView).data.text}
    </div>
  );
};