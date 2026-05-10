import React from 'react';
import { createRoot } from 'react-dom/client';
import VitalSignsApp from './vital_signs_app.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <VitalSignsApp />
  </React.StrictMode>,
);
