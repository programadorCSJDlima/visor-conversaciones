# Visor de conversaciones · Juanita

Interfaz web para revisar las conversaciones de WhatsApp del chatbot.

```
visor-conversaciones/
├── backend/    API Node + Express. Lee juanita_db en modo solo lectura.
└── frontend/   Interfaz React + Vite.
```

El backend lee `chatbot_mensajes` y `chatbot_conversaciones` con una conexión de
**solo lectura**: el visor no puede modificar nada del chatbot. Lo único que escribe es su
propia tabla `visor_usuarios` (quién tiene acceso al visor), con una conexión aparte.

## Backend

Copiar `backend/.env.example` a `backend/.env` y completar los datos de la base
(acepta la URL JDBC tal como la usa el chatbot):

```
DB_URL=jdbc:postgresql://10.10.0.133:5432/juanita_db
DB_USERNAME=...
DB_PASSWORD=...
PUERTO=3001
CSJD_API_URL=http://10.10.0.133:8081
USUARIOS_API_KEY=...   # la misma que en el .env de api_csjd
```

### Login con usuarios de Lolimsa

Como en app-citas, cada persona entra con **su usuario (o DNI) y clave de Lolimsa**. El visor
no ve ni guarda claves: se las pasa a `api_csjd` (`POST /api/v1/usuarios-lolimsa/validar`),
que las compara con `lolimsa.usuarios` (solo usuarios activos). Además, el usuario tiene que
tener **acceso asignado** en el engranaje; si no, el login responde "no tiene acceso al visor".

Hay dos roles:

| Rol | Puede |
| --- | --- |
| Administrador | Todo, más el engranaje: dar acceso, cambiar rol, desactivar y quitar usuarios |
| Usuario | Conversaciones, Citas y Panel (sin engranaje) |

`SOPORTETI` (se cambia con `VISOR_ADMIN`) es **administrador permanente**: siempre puede entrar
y no se le puede quitar el acceso, desactivar ni bajar de rol. Un administrador tampoco puede
cambiar su propio acceso.

El rol se vuelve a leer en cada petición (con 15 s de memoria), así que quitar o desactivar a
alguien lo saca del visor al instante aunque tenga la sesión abierta.

Las asignaciones se guardan en la tabla `visor_usuarios` de juanita_db, que el backend crea
al arrancar si no existe.

Para que funcione, `USUARIOS_API_KEY` tiene que tener **el mismo valor** en `backend/.env` del
visor y en el `.env` de api_csjd (un texto largo al azar, por ejemplo la salida de
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).

Opcional: `VISOR_USUARIO` y `VISOR_CLAVE` definen una **cuenta de respaldo** (normalmente
`SOPORTETI`) para entrar si Lolimsa o api_csjd no responden. Tiene el rol que le corresponda,
como cualquier usuario.

- La sesión dura 12 horas y se guarda en una cookie `HttpOnly`.
- Tras 5 intentos fallidos desde la misma IP, el login se bloquea 5 minutos.
- Reiniciar el backend cierra las sesiones, salvo que se defina `VISOR_SECRETO`
  (cualquier texto largo y aleatorio) para firmarlas siempre con la misma clave.

Sin `USUARIOS_API_KEY` ni `VISOR_USUARIO`/`VISOR_CLAVE` el visor abre directo, sin login (útil en
desarrollo).

El encabezado tiene a la derecha un switch de modo día / noche (se recuerda en cada navegador;
si no se eligió, sigue el modo del sistema), el usuario conectado y, solo para los
administradores, el engranaje que abre la configuración (`#/configuracion`). El backend también
lo exige: `/api/configuracion/*` responde 403 a los usuarios sin rol de administrador.

```
cd backend
npm install
npm run dev      # con recarga automática
npm start        # producción
```

Endpoints:

| Método | Ruta | Descripción |
| --- | --- | --- |
| POST | `/api/login` | `{ usuario, clave }` de Lolimsa → crea la cookie de sesión (403 si no tiene acceso asignado) |
| POST | `/api/logout` | Cierra la sesión |
| GET | `/api/sesion` | Usuario, nombre y rol de la sesión actual (401 si no hay o si le quitaron el acceso) |
| GET | `/api/configuracion/usuarios` | Usuarios con acceso al visor (solo administradores) |
| GET | `/api/configuracion/usuarios/lolimsa?q=` | Busca usuarios activos de Lolimsa por login, DNI o nombre |
| POST | `/api/configuracion/usuarios` | `{ usuario, rol }` da acceso (usuario = login o DNI de Lolimsa; rol `ADMIN` o `USUARIO`) |
| PATCH | `/api/configuracion/usuarios/:usuario` | `{ rol?, activo? }` cambia el rol o desactiva |
| DELETE | `/api/configuracion/usuarios/:usuario` | Quita el acceso |
| GET | `/api/conversaciones?q=` | Conversaciones por teléfono, ordenadas por actividad |
| GET | `/api/conversaciones/:telefono` | Estado del bot y datos del paciente |
| GET | `/api/conversaciones/:telefono/mensajes?antes=&despues=` | Mensajes (paginados por id) |
| GET | `/api/mensajes/:id` | Mensaje con su payload completo de WhatsApp |
| GET | `/api/estadisticas?dias=1\|7\|30\|90\|0` | Todo lo que muestra el panel (0 = todo el historial) |
| GET | `/api/estadisticas?desde=yyyy-mm-dd&hasta=yyyy-mm-dd` | Lo mismo para un rango de fechas de Lima, ambas incluidas (máximo 366 días) |
| GET | `/api/citas?dias=…&fresco=1` (o `?desde=yyyy-mm-dd&hasta=yyyy-mm-dd`) | Citas agendadas por el bot (y las reservadas en otro canal pagadas con su link, `origen: PAGO_LINK`) con su pago y su estado en Lolimsa (`fresco=1` no usa la respuesta guardada de Lolimsa) |

## Frontend

```
cd frontend
npm install
npm run dev      # http://localhost:5173
```

Vite redirige `/api` al backend (`http://localhost:3001` por defecto; se cambia con
`API_URL` en `frontend/.env`, ver `frontend/.env.example`).

`npm run build` genera los archivos estáticos en `frontend/dist`.

## Despliegue con Docker

```
visor-conversaciones/
├── docker-compose.yml
├── backend/Dockerfile           imagen Node con la API (usuario sin privilegios)
└── frontend/Dockerfile          compila React y lo sirve con nginx
    frontend/nginx.conf.template nginx: estáticos + proxy de /api al backend
```

Solo se publica el contenedor `frontend` (nginx). El `backend` queda en la red interna
de Docker y nginx le reenvía las llamadas `/api`.

En el servidor:

1. Copiar la carpeta `visor-conversaciones` (sin `node_modules` ni `dist`).
2. Crear `backend/.env` a partir de `backend/.env.example` con los datos de la base,
   `CSJD_API_URL` y `USUARIOS_API_KEY`. Las credenciales se leen al arrancar; no quedan
   dentro de las imágenes.
3. Construir y levantar:

   ```
   docker compose up -d --build
   ```

El visor queda en http://servidor:8080. Para usar otro puerto:
`VISOR_PUERTO=80 docker compose up -d` (o poner `VISOR_PUERTO=80` en un `.env` junto al
`docker-compose.yml`).

Comandos útiles:

```
docker compose ps                 # estado (el backend reporta "healthy" si llega a la base)
docker compose logs -f backend    # logs de la API
docker compose up -d --build      # actualizar después de cambiar el código
docker compose down               # detener y eliminar los contenedores
```

El backend expone `GET /api/salud` (sin autenticación, sin datos) para el healthcheck:
hace un `select 1` contra la base.

Si el servidor no tiene acceso a Docker Hub, construir en otra máquina y copiar las
imágenes:

```
docker compose build
docker save visor-conversaciones-backend visor-conversaciones-frontend -o visor.tar
# en el servidor:
docker load -i visor.tar
docker compose up -d
```

## Despliegue sin Docker

- **Un solo proceso:** compilar el frontend y poner `FRONTEND_DIST=../frontend/dist` en
  `backend/.env`. El backend sirve la API y la interfaz en http://localhost:3001.
- **Por separado:** publicar `frontend/dist` en un servidor web (IIS, Nginx…) que
  redirija `/api` al backend.

## Qué muestra

- Lista de conversaciones por teléfono, ordenada por actividad, con búsqueda por
  teléfono, nombre, DNI/datos del paciente o texto de cualquier mensaje.
- Chat estilo WhatsApp: botones, listas, formularios (Flows), respuestas del usuario,
  links de pago y mensajes con error de envío. Cada mensaje muestra el paso del bot.
- Botón `{ }` en cada mensaje para ver el payload completo de WhatsApp.
- Panel de detalle con el estado actual del bot y los datos del paciente.
- Se actualiza solo: la lista cada 15 s y el chat abierto cada 5 s.
- El enlace `#/<telefono>` abre directamente una conversación.

### Panel (`#/panel`)

Estadísticas filtrables por periodo (hoy, 7, 30, 90 días, todo o un rango personalizado de
hasta 366 días elegido en el calendario), comparadas con el mismo número de días
inmediatamente anteriores y actualizadas cada minuto:

- **Indicadores:** conversaciones, citas registradas (y su valor), conversión a cita,
  recaudado en línea, tiempo de respuesta del bot (mediana y p95) y errores de envío.
- **Actividad** por día (o por hora en "Hoy").
- **Embudo de citas:** cuántas personas iniciaron, se identificaron, eligieron horario,
  registraron cita y pagaron.
- **¿Cuándo escriben?:** mapa de calor por día de la semana y hora.
- **Cómo responden:** texto libre vs botones, listas y formularios.
- **Citas por especialidad** y **médicos más solicitados**.
- **Pagos en línea:** links pagados, vencidos, prefacturas y facturas.
- **Botones más usados**, **dónde quedaron las conversaciones** y **errores recientes**.

Cada gráfico tiene un botón **Tabla** con los datos exactos.

### Citas (`#/citas`)

Cada cita que agendó el bot y, además, las **reservadas fuera del chatbot** (ventanilla,
teléfono) que el paciente pagó con un link del bot (opción "Pagar mis citas"). Estas llevan la
etiqueta *Reservada fuera del chatbot*, se ubican por su orden de pago pagada (o en revisión)
y el período se cuenta desde que se generó ese link; las que solo tienen links vencidos no se
listan. El resumen muestra cuántas son; al hacer clic se filtran. Cada cita trae:

- **Pago con link** (juanita_db): pagado, link activo, link vencido o sin link. Los pagados
  muestran el *External Id* de la orden, el que se busca en el portal de Niubiz.
- **Estado en Lolimsa**: si sigue existiendo, si caja ya emitió la boleta y si fue atendida.
  Una cita anulada en Lolimsa desaparece de `lolimsa.citas`, así que se muestra como **Anulada**.
  - **Boleta emitida** (con serie-número, fecha y caja): la prefactura de la cita tiene un
    comprobante vigente en `lolimsa.facturas`.
  - **Falta boleta**: la cita figura pagada (`citas.stapag_caj = 'S'`) pero su prefactura aún no
    tiene boleta. Es lo normal en los pagos con link mientras `PAGOS_FACTURAR_CON_SP=false`:
    api_csjd marca la cita y crea la prefactura, y caja emite la boleta. Ojo: `stapag_caj` solo
    no confirma el cobro en caja, porque lo marca la propia api_csjd.
  - **Por pagar**: sin marca de pagada ni comprobante.
  El resumen muestra cuántas pagadas con link siguen sin boleta; al hacer clic se filtran.
  Se puede buscar por External Id, prefactura o número de boleta.
- **Estado final** para filtrar: pendiente de pago, pagada por atender, atendida o anulada.
  Cada cita está en un solo estado: una cita pagada y ya atendida cuenta como atendida.
  Debajo de los filtros se muestra el total de pagadas (con link, en caja y ya atendidas).
  El Panel, en cambio, cuenta solo las citas pagadas con link.

Se filtra por periodo igual que el panel (hoy, 7, 30, 90 días, todo o un rango personalizado de
hasta 366 días), según la fecha en que el bot agendó la cita (las reservadas fuera del chatbot,
según su link pagado). Se puede buscar por paciente, documento, N° de cita, especialidad o médico y descargar
la lista filtrada en CSV.

Lolimsa se consulta a través de `api_csjd` (`GET /api/v1/citas?numeroDocumento=`), que ya
tiene acceso a Oracle: el visor no necesita credenciales de Lolimsa. Requiere en
`backend/.env`:

```
CSJD_API_URL=http://10.10.0.133:8081
```

Como esa API busca por documento, el visor identifica el documento de cada cita con el
mensaje "Revisa tu cita" que el bot envía antes de confirmarla (muestra los últimos
dígitos, p. ej. `DNI ••••8841`) y los documentos que el paciente escribió en la
conversación. En las reservadas fuera del chatbot no hay "Revisa tu cita": se prueban los
documentos que el paciente escribió antes de pedir el link y se queda el que tiene esa cita
en Lolimsa; el nombre sale de su ficha (`GET /api/v1/pacientes/documento/{numero}`).
Las respuestas de Lolimsa se guardan 2 minutos en memoria; el botón
**Actualizar** las vuelve a pedir.

### Textos del bot que usa el visor

Las citas (en el panel y en Citas) se leen de mensajes fijos del bot:

- Confirmación: "Tu cita quedó registrada" con N° de cita, especialidad, médico,
  consultorio, fecha, hora y precio.
- Revisión previa: "Revisa tu cita" con el paciente y los últimos dígitos del documento.
- Link de pago (solo en Citas): "Tu enlace de pago está listo" con el N° de cada cita que paga.

Si cambian esos textos en el chatbot, hay que ajustar `backend/src/confirmaciones.js`.
