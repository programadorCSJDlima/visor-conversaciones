# Visor de conversaciones · Juanita

Interfaz web para revisar las conversaciones de WhatsApp del chatbot.

```
visor-conversaciones/
├── backend/    API Node + Express. Lee juanita_db en modo solo lectura.
└── frontend/   Interfaz React + Vite.
```

El backend lee `chatbot_mensajes` y `chatbot_conversaciones` con una conexión de
**solo lectura**: el visor no puede modificar nada en la base.

## Backend

Copiar `backend/.env.example` a `backend/.env` y completar los datos de la base
(acepta la URL JDBC tal como la usa el chatbot):

```
DB_URL=jdbc:postgresql://10.10.0.133:5432/juanita_db
DB_USERNAME=...
DB_PASSWORD=...
PUERTO=3001
```

Si el visor va a quedar accesible en la red, definir `VISOR_USUARIO` y `VISOR_CLAVE`
para que pida usuario y clave (los mensajes incluyen datos de pacientes).

```
cd backend
npm install
npm run dev      # con recarga automática
npm start        # producción
```

Endpoints:

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/conversaciones?q=` | Conversaciones por teléfono, ordenadas por actividad |
| GET | `/api/conversaciones/:telefono` | Estado del bot y datos del paciente |
| GET | `/api/conversaciones/:telefono/mensajes?antes=&despues=` | Mensajes (paginados por id) |
| GET | `/api/mensajes/:id` | Mensaje con su payload completo de WhatsApp |

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
2. Crear `backend/.env` a partir de `backend/.env.example` con los datos de la base.
   Las credenciales se leen al arrancar; no quedan dentro de las imágenes.
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
