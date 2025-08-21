import { MainLayout } from './components/MainLayout';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { container } from './styles/app.css';

function App() {
  return (
    <ThemeProvider>
      <WebSocketProvider url="ws://localhost:8765">
        <div className={container}>
          <MainLayout />
        </div>
      </WebSocketProvider>
    </ThemeProvider>
  );
}

export default App;