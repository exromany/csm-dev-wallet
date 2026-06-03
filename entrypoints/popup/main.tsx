// Side-effect import — must run before style.css so [data-theme] selectors
// apply on first style computation. ESM evaluates imports in declared order.
import './theme-init.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
