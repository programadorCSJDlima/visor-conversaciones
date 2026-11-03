import { useCallback, useEffect, useRef, useState } from 'react';
import { api, siExpiraSesion } from './api.js';
import Login from './componentes/Login.jsx';
import Panel from './panel/Panel.jsx';
import Visor from './Visor.jsx';

const enPanel = () => location.hash === '#/panel';

export default function App() {
  // undefined: verificando · null: sin sesión · objeto: sesión activa
  const [sesion, setSesion] = useState(undefined);
  const [error, setError] = useState(null);
  const [panel, setPanel] = useState(enPanel);
  // Al volver del panel se reabre la última conversación vista
  const ultimaConversacion = useRef(enPanel() ? '#/' : location.hash || '#/');

  useEffect(() => {
    const alCambiar = () => {
      setPanel(enPanel());
      if (!enPanel()) ultimaConversacion.current = location.hash || '#/';
    };
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  const verificar = useCallback(() => {
    setError(null);
    api.sesion().then(setSesion, (e) => (e.status === 401 ? setSesion(null) : setError(e.message)));
  }, []);

  useEffect(() => {
    siExpiraSesion(() => setSesion(null));
    verificar();
  }, [verificar]);

  const salir = async () => {
    await api.logout().catch(() => {});
    setSesion(null);
  };

  if (error) {
    return (
      <div className="login-fondo">
        <div className="login">
          <p className="login-error">No se pudo conectar con el servidor: {error}</p>
          <button onClick={verificar}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (sesion === undefined) return null;
  if (sesion === null) return <Login onIngresar={setSesion} />;
  return (
    <div className="principal">
      <nav className="barra-superior">
        <span className="marca">Juanita</span>
        <a className={`pestana ${panel ? '' : 'activa'}`} href={ultimaConversacion.current}>
          Conversaciones
        </a>
        <a className={`pestana ${panel ? 'activa' : ''}`} href="#/panel">
          Panel
        </a>
        {sesion.conLogin && (
          <div className="sesion">
            <span className="tenue">{sesion.usuario}</span>
            <button className="boton-chico" onClick={salir}>
              Salir
            </button>
          </div>
        )}
      </nav>
      {panel ? <Panel /> : <Visor />}
    </div>
  );
}
