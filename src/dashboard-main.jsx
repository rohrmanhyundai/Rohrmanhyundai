import React from 'react';
import { createRoot } from 'react-dom/client';
import TvDashboard from './tv/TvDashboard';
import './App.css';

createRoot(document.getElementById('tv-root')).render(<TvDashboard />);
