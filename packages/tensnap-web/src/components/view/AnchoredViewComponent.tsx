import { AnchoredView } from "@/types/ui";
import * as styles from './styles.css';
import { useViewContext } from "./useViewContext";


export type AnchoredViewComponentProps = {
  view: AnchoredView;
}

export const AnchoredViewComponent = ({ view }: AnchoredViewComponentProps) => {

  const { renderAnchoredView: Renderer } = useViewContext();

  return (
    <div className={styles.windowView}>
      <div className={styles.windowViewHeader}>
        <span style={{ fontWeight: 500, fontSize: '14px' }}>
          {(view as AnchoredView).data.title || view.type}
        </span>
      </div>
      <div className={styles.windowViewContent}>
        <p style={{ color: '#6b7280', fontSize: '14px' }}>
          <Renderer type={view.type} id={view.data.id} />
        </p>
      </div>
    </div>
  );
}