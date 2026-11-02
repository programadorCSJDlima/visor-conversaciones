# 1) Compilar la app React
FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 2) Servir los estáticos con nginx y redirigir /api al backend
FROM nginx:stable-alpine

# nginx reemplaza ${API_URL} en la plantilla al arrancar el contenedor
ENV API_URL=http://backend:3001
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
