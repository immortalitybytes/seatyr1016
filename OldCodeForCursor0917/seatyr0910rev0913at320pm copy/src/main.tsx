import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const renderApp = () => {
  try {
    const rootElement = document.getElementById('root');
    if (!rootElement) {
      console.error('Root element not found');
      return;
    }
    
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    console.error('Error rendering app:', error);
    
    // Display error on the page if React fails to render
    document.body.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f4ff; padding: 20px;">
        <div style="background: white; border-radius: 8px; padding: 20px; max-width: 500px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h2 style="color: #ff4040; margin-top: 0;">Application Error</h2>
          <p>There was an error loading the application. This may be due to a configuration issue.</p>
          <div style="background: #fff8f8; padding: 10px; border-radius: 4px; margin: 10px 0; overflow: auto;">
            <pre style="margin: 0; color: #d00; font-size: 12px;">${error.toString()}</pre>
          </div>
          <button 
            onclick="window.location.reload()" 
            style="background: #7973BB; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;"
          >
            Refresh Page
          </button>
        </div>
      </div>
    `;
  }
};

// Delay execution slightly to ensure DOM is fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderApp);
} else {
  renderApp();
}