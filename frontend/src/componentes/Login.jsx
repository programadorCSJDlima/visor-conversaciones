import { useState } from 'react';
import { api } from '../api.js';

// aviso: por qué se cerró la sesión (vencida o acceso retirado), si estaba abierta
export default function Login({ onIngresar, aviso }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      onIngresar(await api.login(usuario.trim(), clave));
    } catch (err) {
      setError(err.message);
      setClave('');
    } finally {
      setEnviando(false);
    }
  };

  const mensaje = error ?? aviso;

  return (
    <div className="login-fondo">
      <form className="login" onSubmit={enviar}>
        <h1>Conversaciones</h1>
        <p className="tenue">Visor del chatbot Juanita. Ingresa con tu usuario y clave de Lolimsa.</p>
        <label>
          Usuario de Lolimsa
          <input
            autoFocus
            autoComplete="username"
            placeholder="Usuario o DNI"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
          />
        </label>
        <label>
          Clave
          <input
            type="password"
            autoComplete="current-password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
          />
        </label>
        {mensaje && (
          <p className="login-error" role="alert">
            {mensaje}
          </p>
        )}
        <button type="submit" disabled={enviando || !usuario.trim() || !clave}>
          {enviando ? 'Validando en Lolimsa…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
