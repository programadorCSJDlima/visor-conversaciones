import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './estilos.css';
import { aplicarTema, temaInicial } from './tema.js';

// Antes de pintar, para no mostrar un destello claro en modo noche
aplicarTema(temaInicial());

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
