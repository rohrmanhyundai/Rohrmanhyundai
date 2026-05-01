import React from 'react';
import { createRoot } from 'react-dom/client';
import SalesApp from './sales/SalesApp';
import './App.css';

createRoot(document.getElementById('sales-root')).render(<SalesApp />);
