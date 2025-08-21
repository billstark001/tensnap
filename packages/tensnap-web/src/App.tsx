import { useEffect } from 'react';
import { MainLayout } from './components/MainLayout';
import { useWebSocketStore } from './store/websocket';
import { container } from './styles/app.css';

function App() {
  const { initialize, destroy } = useWebSocketStore();

  useEffect(() => {
    // 初始化 WebSocket 连接
    initialize('ws://localhost:8765').catch(console.error);
    return () => {
      destroy();
    }
  }, [initialize, destroy]);

  return (
    <div className={container}>
      <MainLayout />
    </div>
  );
}

export default App;