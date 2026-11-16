import { useCallback, useEffect, useRef, useState } from 'react';
import { api, siExpiraSesion } from './api.js';
import Citas from './citas/Citas.jsx';
import Login from './componentes/Login.jsx';
import Panel from './panel/Panel.jsx';
import Visor from './Visor.jsx';

// #/citas y #/panel son vistas propias; cualquier otro hash es una conversación (#/51999999999)
const VISTAS = { '#/citas': 'citas', '#/panel': 'panel' };
const vistaActual = () => VISTAS[location.hash] ?? 'conversaciones';

export default function App() {
  // undefined: verificando · null: sin sesión · objeto: sesión activa
  const [sesion, setSesion] = useState(undefined);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState(vistaActual);
  // Al volver a Conversaciones se reabre la última conversación vista
  const ultimaConversacion = useRef(vistaActual() === 'conversaciones' ? location.hash || '#/' : '#/');

  useEffect(() => {
    const alCambiar = () => {
      setVista(vistaActual());
      if (vistaActual() === 'conversaciones') ultimaConversacion.current = location.hash || '#/';
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

  const pestana = (nombre, href, id) => (
    <a className={`pestana ${vista === id ? 'activa' : ''}`} href={href}>
      {nombre}
    </a>
  );

  return (
    <div className="principal">
      <nav className="barra-superior">
        <span className="marca">Juanita</span>
        {pestana('Conversaciones', ultimaConversacion.current, 'conversaciones')}
        {pestana('Citas', '#/citas', 'citas')}
        {pestana('Panel', '#/panel', 'panel')}
        {sesion.conLogin && (
          <div className="sesion">
            <span className="tenue">{sesion.usuario}</span>
            <button className="boton-chico" onClick={salir}>
              Salir
            </button>
          </div>
        )}
      </nav>
      {vista === 'panel' && <Panel />}
      {vista === 'citas' && <Citas />}
      {vista === 'conversaciones' && <Visor />}
    </div>
  );
}
