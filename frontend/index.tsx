import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.tsx';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error('Root container not found. Unable to mount React app.');
} 