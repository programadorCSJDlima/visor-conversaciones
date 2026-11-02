import { useCallback, useEffect, useState } from 'react';
import { api, siExpiraSesion } from './api.js';
import Login from './componentes/Login.jsx';
import Visor from './Visor.jsx';

export default function App() {
  // undefined: verificando · null: sin sesión · objeto: sesión activa
  const [sesion, setSesion] = useState(undefined);
  const [error, setError] = useState(null);

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
  return <Visor usuario={sesion.usuario} onSalir={sesion.conLogin ? salir : null} />;
}
