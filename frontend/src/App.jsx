import { useCallback, useEffect, useRef, useState } from 'react';
import { api, siExpiraSesion } from './api.js';
import Citas from './citas/Citas.jsx';
import Login from './componentes/Login.jsx';
import Configuracion from './configuracion/Configuracion.jsx';
import Panel from './panel/Panel.jsx';
import { aplicarTema } from './tema.js';
import Visor from './Visor.jsx';

// #/citas, #/panel y #/configuracion son vistas propias; cualquier otro hash es una conversación (#/51999999999)
const VISTAS = { '#/citas': 'citas', '#/panel': 'panel', '#/configuracion': 'configuracion' };

function SwitchTema({ oscuro, onCambiar }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={oscuro}
      aria-label="Modo noche"
      title={oscuro ? 'Cambiar a modo día' : 'Cambiar a modo noche'}
      className="switch-tema"
      onClick={onCambiar}
    >
      <span className="switch-tema-icono sol" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="3" fill="currentColor" />
          <path
            d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="switch-tema-icono luna" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 16 16">
          <path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7Z" fill="currentColor" />
        </svg>
      </span>
      <span className="switch-tema-perilla" aria-hidden="true" />
    </button>
  );
}

function IconoUsuario() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="5.5" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 14c.6-2.8 2.8-4.3 5.5-4.3s4.9 1.5 5.5 4.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconoEngranaje() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
const vistaActual = () => VISTAS[location.hash] ?? 'conversaciones';

export default function App() {
  // undefined: verificando · null: sin sesión · objeto: sesión activa
  const [sesion, setSesion] = useState(undefined);
  const [error, setError] = useState(null);
  // Por qué se cerró una sesión abierta (vencida o acceso retirado); se muestra en el login
  const [avisoLogin, setAvisoLogin] = useState(null);
  const sesionAbierta = useRef(false);
  sesionAbierta.current = Boolean(sesion);
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
    siExpiraSesion((mensaje) => {
      setAvisoLogin(sesionAbierta.current ? mensaje : null);
      setSesion(null);
    });
    verificar();
  }, [verificar]);

  const ingresar = (nueva) => {
    setAvisoLogin(null);
    setSesion(nueva);
  };

  const salir = async () => {
    await api.logout().catch(() => {});
    setAvisoLogin(null);
    setSesion(null);
  };

  const [tema, setTema] = useState(() => document.documentElement.dataset.theme ?? 'light');
  const cambiarTema = () => {
    const nuevo = tema === 'dark' ? 'light' : 'dark';
    aplicarTema(nuevo, true);
    setTema(nuevo);
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
  if (sesion === null) return <Login onIngresar={ingresar} aviso={avisoLogin} />;

  const rotuloUsuario = [sesion.nombre, sesion.esAdmin ? 'Administrador' : 'Usuario'].filter(Boolean).join(' · ');

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
        <div className="sesion">
          <SwitchTema oscuro={tema === 'dark'} onCambiar={cambiarTema} />
          {sesion.conLogin ? (
            <>
              <span className="usuario-sesion" title={`${sesion.usuario}: ${rotuloUsuario}`}>
                <IconoUsuario />
                <span className="nombre-usuario">{sesion.usuario}</span>
              </span>
              {sesion.esAdmin && (
                <a
                  className={`engranaje ${vista === 'configuracion' ? 'activa' : ''}`}
                  href="#/configuracion"
                  title="Configuración"
                  aria-label="Configuración"
                >
                  <IconoEngranaje />
                </a>
              )}
              <button className="boton-chico" onClick={salir}>
                Salir
              </button>
            </>
          ) : (
            <span className="tenue" title="Define USUARIOS_API_KEY (o VISOR_USUARIO y VISOR_CLAVE) en backend/.env para activar el login">
              Sin login (desarrollo)
            </span>
          )}
        </div>
      </nav>
      {vista === 'panel' && <Panel />}
      {vista === 'citas' && <Citas />}
      {vista === 'conversaciones' && <Visor />}
      {vista === 'configuracion' && <Configuracion sesion={sesion} />}
    </div>
  );
}
