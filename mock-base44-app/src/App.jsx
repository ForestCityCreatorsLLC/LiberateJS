import React from 'react';
import { AppLayout } from './components/AppLayout.jsx';
import MyLegacyView from './components/MyLegacyView.jsx';
import pino from 'pino';

// Pino Structured Logger Setup
export const logger = pino({
  level: 'info',
  browser: {
    asObject: true
  }
});
logger.info('Application initialized successfully');
function App() {
  return (
    <AppLayout>
      <MyLegacyView />
    </AppLayout>
  );
}

export default App;
