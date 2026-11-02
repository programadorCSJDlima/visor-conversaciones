import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onIngresar }) {
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

  return (
    <div className="login-fondo">
      <form className="login" onSubmit={enviar}>
        <h1>Conversaciones</h1>
        <p className="tenue">Visor del chatbot Juanita</p>
        <label>
          Usuario
          <input autoFocus autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
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
        {error && <p className="login-error">{error}</p>}
        <button type="submit" disabled={enviando || !usuario.trim() || !clave}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
