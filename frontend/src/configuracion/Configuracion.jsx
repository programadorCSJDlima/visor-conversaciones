import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { fechaHora, fechaLista, hora } from '../formato.js';
import '../panel/panel.css';
import './configuracion.css';

const NOMBRE_ROL = { ADMIN: 'Administrador', USUARIO: 'Usuario' };

// "Hoy, 5:52 p. m." · "Ayer, 9:10 a. m." · "16/11/26"
function momento(f) {
  const lista = fechaLista(f);
  if (lista === hora(f)) return `Hoy, ${lista}`;
  if (lista === 'Ayer') return `Ayer, ${hora(f)}`;
  return lista;
}

// Debajo del nombre: login y DNI (sin repetir el login si no hay nombre, porque ya va arriba)
const detalleUsuario = (u) => [u.nombre && u.usuario, u.documento && `DNI ${u.documento}`].filter(Boolean).join(' · ');

function IconoCandado() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function SwitchAcceso({ activo, deshabilitado, motivo, etiqueta, onCambiar }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      className="switch-acceso"
      disabled={deshabilitado}
      title={motivo}
      onClick={onCambiar}
    >
      <span className="switch-acceso-pista" aria-hidden="true">
        <span className="switch-acceso-perilla" />
      </span>
      {activo ? 'Activo' : 'Desactivado'}
    </button>
  );
}

// Busca en Lolimsa (usuarios activos) y da acceso con el rol elegido.
// asignados: logins que ya están en la tabla (se toma de la lista, así refleja también lo que se quita)
function AgregarUsuario({ disponible, asignados, onAsignado }) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState(null);
  const [roles, setRoles] = useState({}); // usuario -> rol elegido en su fila
  const [asignando, setAsignando] = useState(null);
  const ultimaBusqueda = useRef(0);

  useEffect(() => {
    const texto = q.trim();
    const id = ++ultimaBusqueda.current;
    if (texto.length < 2) {
      setResultados(null);
      setError(null);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const espera = setTimeout(() => {
      api
        .buscarEnLolimsa(texto)
        .then(
          (r) => id === ultimaBusqueda.current && (setResultados(r), setError(null)),
          (e) => id === ultimaBusqueda.current && (setResultados(null), setError(e.message)),
        )
        .finally(() => id === ultimaBusqueda.current && setBuscando(false));
    }, 350);
    return () => clearTimeout(espera);
  }, [q]);

  const asignar = async (u) => {
    setAsignando(u.usuario);
    setError(null);
    try {
      onAsignado(await api.asignarUsuario(u.usuario, roles[u.usuario] ?? 'USUARIO'));
    } catch (e) {
      setError(e.message);
    } finally {
      setAsignando(null);
    }
  };

  if (!disponible) {
    return (
      <p className="aviso-config aviso">
        Para buscar usuarios de Lolimsa hay que configurar <code>CSJD_API_URL</code> y <code>USUARIOS_API_KEY</code> en
        el <code>.env</code> del backend.
      </p>
    );
  }

  return (
    <div className="agregar-usuario">
      <label className="buscar-lolimsa">
        Dar acceso a un usuario de Lolimsa
        <input
          type="search"
          placeholder="Busca por usuario, DNI o nombre"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {buscando && <p className="tenue chico estado-busqueda">Buscando en Lolimsa…</p>}
      {error && <p className="aviso-config error">{error}</p>}
      {resultados && !buscando && resultados.length === 0 && (
        <p className="tenue chico estado-busqueda">No hay usuarios activos en Lolimsa con «{q.trim()}».</p>
      )}
      {resultados && !buscando && resultados.length > 0 && (
        <ul className="resultados-lolimsa">
          {resultados.map((u) => (
            <li key={u.usuario}>
              <div className="usuario-celda">
                <span className="usuario-nombre">{u.nombre || u.usuario}</span>
                <span className="tenue chico">{detalleUsuario(u)}</span>
              </div>
              {asignados.has(u.usuario?.toUpperCase()) ? (
                <span className="tenue chico">Ya tiene acceso</span>
              ) : (
                <div className="asignar-controles">
                  <select
                    aria-label={`Rol para ${u.usuario}`}
                    value={roles[u.usuario] ?? 'USUARIO'}
                    onChange={(e) => setRoles((r) => ({ ...r, [u.usuario]: e.target.value }))}
                  >
                    <option value="USUARIO">Usuario</option>
                    <option value="ADMIN">Administrador</option>
                  </select>
                  <button className="boton-primario" disabled={asignando !== null} onClick={() => asignar(u)}>
                    {asignando === u.usuario ? 'Asignando…' : 'Dar acceso'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {resultados?.length === 30 && !buscando && (
        <p className="tenue chico estado-busqueda">Se muestran los primeros 30: escribe algo más preciso.</p>
      )}
    </div>
  );
}

function FilaUsuario({ u, yo, ocupado, confirmando, onCambiar, onPedirQuitar, onQuitar, onCancelar }) {
  const propio = u.usuario === yo;
  const bloqueado = u.permanente || propio || ocupado;
  const motivo = u.permanente
    ? `${u.usuario} es administrador permanente`
    : propio
      ? 'No puedes cambiar tu propio acceso; pídeselo a otro administrador'
      : undefined;

  return (
    <tr className={u.activo ? undefined : 'inactivo'}>
      <td>
        <div className="usuario-celda">
          <span className="usuario-nombre">
            {u.nombre || u.usuario}
            {propio && <span className="etiqueta-tu">Tú</span>}
          </span>
          <span className="tenue chico">{detalleUsuario(u)}</span>
        </div>
      </td>
      <td>
        {u.permanente ? (
          <span className="insignia-permanente" title="No se le puede quitar el acceso, desactivar ni bajar de rol">
            <IconoCandado /> Administrador permanente
          </span>
        ) : (
          <select
            value={u.rol}
            disabled={bloqueado}
            title={motivo}
            aria-label={`Rol de ${u.usuario}`}
            onChange={(e) =>
              onCambiar({ rol: e.target.value }, `${u.usuario} ahora es ${NOMBRE_ROL[e.target.value].toLowerCase()}`)
            }
          >
            <option value="ADMIN">Administrador</option>
            <option value="USUARIO">Usuario</option>
          </select>
        )}
      </td>
      <td>
        <SwitchAcceso
          activo={u.activo}
          deshabilitado={bloqueado}
          motivo={motivo}
          etiqueta={`Acceso de ${u.usuario}`}
          onCambiar={() =>
            onCambiar({ activo: !u.activo }, u.activo ? `Se desactivó a ${u.usuario}` : `Se reactivó a ${u.usuario}`)
          }
        />
      </td>
      <td title={u.ultimo_ingreso ? fechaHora(u.ultimo_ingreso) : undefined}>
        {u.ultimo_ingreso ? momento(u.ultimo_ingreso) : <span className="tenue">Nunca</span>}
      </td>
      <td title={fechaHora(u.creado_en)}>
        {u.creado_por === 'sistema' ? <span className="tenue">Automático</span> : u.creado_por}
        <span className="tenue chico bloque">{momento(u.creado_en)}</span>
      </td>
      <td className="acciones">
        {!u.permanente &&
          !propio &&
          (confirmando ? (
            <span className="confirmar-quitar">
              ¿Quitar acceso?
              <button className="boton-chico peligro" disabled={ocupado} onClick={onQuitar}>
                Sí, quitar
              </button>
              <button className="boton-chico" disabled={ocupado} onClick={onCancelar}>
                No
              </button>
            </span>
          ) : (
            <button className="boton-chico" disabled={ocupado} onClick={onPedirQuitar}>
              Quitar
            </button>
          ))}
      </td>
    </tr>
  );
}

function UsuariosVisor({ config, yo }) {
  const [usuarios, setUsuarios] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(null); // usuario con un cambio en curso
  const [confirmando, setConfirmando] = useState(null); // usuario al que se le va a quitar el acceso
  const [aviso, setAviso] = useState(null); // { tipo: 'ok' | 'error', texto }

  const cargar = useCallback(() => {
    setError(null);
    api.usuariosVisor().then(setUsuarios, (e) => setError(e.message));
  }, []);
  useEffect(cargar, [cargar]);

  const ejecutar = async (usuario, accion, textoOk) => {
    setOcupado(usuario);
    setAviso(null);
    try {
      await accion();
      setAviso({ tipo: 'ok', texto: textoOk });
    } catch (e) {
      setAviso({ tipo: 'error', texto: e.message });
    } finally {
      setOcupado(null);
      setConfirmando(null);
    }
  };

  const cambiar = (u, cambios, textoOk) =>
    ejecutar(
      u.usuario,
      async () => {
        const fila = await api.cambiarUsuario(u.usuario, cambios);
        setUsuarios((lista) => lista.map((x) => (x.usuario === fila.usuario ? fila : x)));
      },
      textoOk,
    );

  const quitar = (u) =>
    ejecutar(
      u.usuario,
      async () => {
        await api.quitarUsuario(u.usuario);
        setUsuarios((lista) => lista.filter((x) => x.usuario !== u.usuario));
      },
      `Se quitó el acceso a ${u.usuario}`,
    );

  const alAsignar = (fila) => {
    setUsuarios((lista) => [...(lista ?? []), fila]);
    setAviso({ tipo: 'ok', texto: `${fila.usuario} ya puede entrar al visor como ${NOMBRE_ROL[fila.rol].toLowerCase()}` });
  };

  const activos = usuarios?.filter((u) => u.activo) ?? [];
  const admins = activos.filter((u) => u.rol === 'ADMIN').length;
  const asignados = new Set(usuarios?.map((u) => u.usuario));

  return (
    <section className="tarjeta">
      <header className="tarjeta-cabecera">
        <div>
          <h2>Usuarios del visor</h2>
          <p className="tenue">
            Entran con su usuario y clave de Lolimsa. <strong>Administrador</strong>: además ve este engranaje y asigna
            usuarios. <strong>Usuario</strong>: conversaciones, citas y panel.
          </p>
        </div>
        {usuarios && (
          <span className="conteo-usuarios">
            {activos.length} {activos.length === 1 ? 'activo' : 'activos'} · {admins}{' '}
            {admins === 1 ? 'administrador' : 'administradores'}
          </span>
        )}
      </header>

      <AgregarUsuario disponible={config.busquedaLolimsa} asignados={asignados} onAsignado={alAsignar} />

      {aviso && (
        <p className={`aviso-config ${aviso.tipo}`} role="status">
          {aviso.texto}
        </p>
      )}
      {error && (
        <p className="aviso-config error">
          {error}{' '}
          <button className="boton-chico" onClick={cargar}>
            Reintentar
          </button>
        </p>
      )}
      {!usuarios && !error && <p className="tenue chico">Cargando usuarios…</p>}
      {usuarios && (
        <div className="tabla-usuarios-envoltura">
          <table className="tabla-usuarios">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Acceso</th>
                <th>Último ingreso</th>
                <th>Asignado por</th>
                <th>
                  <span className="oculto-visual">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <FilaUsuario
                  key={u.usuario}
                  u={u}
                  yo={yo}
                  ocupado={ocupado === u.usuario}
                  confirmando={confirmando === u.usuario}
                  onCambiar={(cambios, textoOk) => cambiar(u, cambios, textoOk)}
                  onPedirQuitar={() => setConfirmando(u.usuario)}
                  onQuitar={() => quitar(u)}
                  onCancelar={() => setConfirmando(null)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// El engranaje solo aparece para los administradores, pero quien escriba #/configuracion a mano
// igual pasa por la verificación del backend (403 para cualquier otro usuario).
export default function Configuracion({ sesion }) {
  const [estado, setEstado] = useState(sesion.esAdmin ? 'verificando' : 'sin-acceso');
  const [config, setConfig] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  useEffect(() => {
    if (!sesion.esAdmin) return;
    let vivo = true;
    api.configuracion().then(
      (c) => {
        if (!vivo) return;
        setConfig(c);
        setEstado('ok');
      },
      (e) => {
        if (!vivo) return;
        setEstado('sin-acceso');
        setMensaje(e.message);
      },
    );
    return () => {
      vivo = false;
    };
  }, [sesion.esAdmin]);

  if (estado === 'verificando') return <div className="panel" />;

  if (estado === 'sin-acceso') {
    return (
      <div className="panel">
        <div className="sin-acceso">
          <h1>Sin acceso</h1>
          <p className="tenue">{mensaje ?? 'Solo los administradores del visor pueden entrar a la configuración.'}</p>
          <a className="boton-chico" href="#/">
            Volver a Conversaciones
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-cabecera">
        <div>
          <h1>Configuración</h1>
          <p className="tenue">Solo la ven los administradores del visor</p>
        </div>
      </div>

      <div className="configuracion-secciones">
        <UsuariosVisor config={config} yo={sesion.usuario} />
      </div>
    </div>
  );
}
