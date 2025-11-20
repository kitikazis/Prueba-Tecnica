# ETAPA 1: BUILD - Instalación de dependencias (para caché)
# Usamos una imagen Node base para instalar todas las dependencias
FROM node:20-alpine AS installer
WORKDIR /app

# Copiamos solo los archivos de configuración de dependencias
COPY package.json package-lock.json ./

# Instalamos las dependencias de producción (Hapi, Joi, mysql2, dotenv)
RUN npm install --production

# ETAPA 2: PRODUCTION - Imagen final ligera
# Volvemos a usar node:alpine para una imagen final pequeña
FROM node:20-alpine
WORKDIR /app

# Copia las dependencias instaladas de la etapa de build
COPY --from=installer /app/node_modules ./node_modules

# Copia el código fuente del microservicio (security_server.js)
COPY . .

# Expone el puerto 3001 (leído desde el .env y usado en el servidor Hapi)
EXPOSE 3001

# CAMBIO: Ejecutar directamente el archivo del servidor
CMD ["node", "security_server.js"]