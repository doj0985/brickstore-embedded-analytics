import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// The benign "ResizeObserver loop …" error is fired by layout-measuring UI (MUI
// tables/tooltips, the streaming agent trace) when an observer callback itself
// changes layout. Rather than just suppress the error event (CRA's dev overlay
// often registers its own listener first, so that doesn't reliably work), we fix
// it at the root: defer every ResizeObserver callback to the next animation
// frame. That breaks the synchronous measure→mutate→measure loop, so the error
// is never generated. Must run before any component constructs a ResizeObserver.
if (typeof window !== 'undefined' && window.ResizeObserver) {
  const NativeResizeObserver = window.ResizeObserver;
  window.ResizeObserver = class extends NativeResizeObserver {
    constructor(callback) {
      super((entries, observer) => {
        window.requestAnimationFrame(() => callback(entries, observer));
      });
    }
  };
}

// Belt-and-suspenders: also swallow the benign error if it ever slips through.
const RESIZE_OBSERVER_MSG = /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/;
window.addEventListener('error', (e) => {
  if (e.message && RESIZE_OBSERVER_MSG.test(e.message)) {
    e.stopImmediatePropagation();
  }
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
