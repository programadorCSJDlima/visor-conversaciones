import { fechaHora, nombrePaciente, paso } from '../formato.js';

const siNo = (v) => (v == null ? null : v ? 'Sí' : 'No');

function Tabla({ filas }) {
  const visibles = filas.filter(([, v]) => v != null && v !== '');
  if (!visibles.length) return <p className="tenue">Sin datos</p>;
  return (
    <dl className="datos-tabla">
      {visibles.map(([k, v]) => (
        <div key={k} className="par">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function PanelDatos({ estado, resumen, onCerrar }) {
  const datos = estado?.datos ?? {};
  const p = datos.paciente;

  return (
    <aside className="panel-datos">
      <header>
        <h2>Detalle</h2>
        <button className="boton-icono" onClick={onCerrar} aria-label="Cerrar panel">
          ✕
        </button>
      </header>

      <section>
        <h3>Estado del bot</h3>
        {estado ? (
          <Tabla
            filas={[
              ['Paso actual', paso(estado.paso)],
              ['Intención', datos.intencion],
              ['Actualizado', fechaHora(estado.actualizado_en)],
              ['Privacidad', estado.privacidad_aceptada_en ? `Aceptada ${fechaHora(estado.privacidad_aceptada_en)}` : 'No aceptada'],
            ]}
          />
        ) : (
          <p className="tenue">Sin registro en chatbot_conversaciones</p>
        )}
      </section>

      {(p || datos.documento) && (
        <section>
          <h3>Paciente</h3>
          <Tabla
            filas={[
              ['Nombre', nombrePaciente(datos)],
              ['Documento', p ? `${p.tipoDocumentoDescripcion ?? ''} ${p.numeroDocumento ?? ''}`.trim() : `${datos.tipo_documento ?? ''} ${datos.documento}`.trim()],
              ['Historia', p?.historia ?? datos.historia],
              ['Edad', p?.edad],
              ['Sexo', p?.sexo],
              ['Nacimiento', p?.fechaNacimiento],
              ['Teléfono', p?.telefono],
              ['Email', p?.email],
              ['Nuevo', siNo(p?.nuevo ?? datos.nuevo)],
            ]}
          />
        </section>
      )}

      {(datos.servicio_nombre || datos.medico_nombre || datos.fecha || datos.ultima_cita) && (
        <section>
          <h3>Cita en curso</h3>
          <Tabla
            filas={[
              ['Especialidad', datos.servicio_nombre],
              ['Médico', datos.medico_nombre],
              ['Fecha', datos.fecha],
              ['Hora', datos.hora],
              ['Última cita N°', datos.ultima_cita],
            ]}
          />
        </section>
      )}

      {resumen && (
        <section>
          <h3>Conversación</h3>
          <Tabla
            filas={[
              ['Nombre WhatsApp', resumen.nombre_whatsapp],
              ['Mensajes', resumen.total],
              ['Errores de envío', resumen.errores || null],
              ['Primer mensaje', fechaHora(resumen.primer_mensaje)],
              ['Último mensaje', fechaHora(resumen.ultimo_mensaje)],
            ]}
          />
        </section>
      )}

      {estado && (
        <section>
          <details>
            <summary>Datos completos (JSON)</summary>
            <pre className="json">{JSON.stringify(datos, null, 2)}</pre>
          </details>
        </section>
      )}
    </aside>
  );
}
