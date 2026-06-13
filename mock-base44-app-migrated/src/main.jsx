import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import pino from 'pino';

// Pino Structured Logger Setup
export const logger = pino({
  level: 'info',
  browser: {
    asObject: true
  }
});
logger.info('Application initialized successfully');
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
