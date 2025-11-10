import { AnchoredView, ContainerView } from "@/types/ui";
import * as styles from './styles.css';
import { useViewContext } from "./useViewContext";
import clsx from 'clsx';


export type AnchoredViewComponentProps = {
  view: AnchoredView;
  parentView?: ContainerView;
}

export const AnchoredViewComponent = ({ view, parentView }: AnchoredViewComponentProps) => {

  const { AnchoredViewRenderer } = useViewContext();
  const isDisabled = view.data.disabled;

  return (
    <div className={clsx(styles.windowView, isDisabled && styles.windowViewDisabled)}>
      <div className={styles.windowViewHeader}>
        <span className={styles.windowViewTitle}>
          {(view as AnchoredView).data.title || view.type}
        </span>
      </div>
      <div className={styles.windowViewContent}>
        <AnchoredViewRenderer type={view.type} id={view.data.id} view={view} parentView={parentView} />
      </div>
    </div>
  );
}