import * as styles from './RightPanel.css';

export const RightPanel = () => {
  // 这里可以从 store 中获取当前选中的视图
  // 现在只是一个示例
  
  return (
    <div className={styles.rightPanel}>
      <div className={styles.panelHeader}>
        <h3>属性面板</h3>
      </div>
      <div className={styles.panelContent}>
        <p>在这里可以显示：</p>
        <ul>
          <li>参数控制</li>
          <li>环境视图</li>
          <li>图表视图</li>
          <li>其他锚定视图</li>
        </ul>
        {/* 示例：显示一个参数控制 */}
        {/* <AnchoredViewRenderer type="parameter" id="some-parameter-id" /> */}
      </div>
    </div>
  );
};
