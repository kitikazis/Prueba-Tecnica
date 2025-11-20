# ETAPA 1: BUILD - Instalación de dependencias (para caché)
FROM node:20-alpine AS installer
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --production

# ETAPA 2: PRODUCTION - Imagen final ligera
FROM node:20-alpine
WORKDIR /app

# Copia las dependencias instaladas de la etapa de build
COPY --from=installer /app/node_modules ./node_modules

# Copia el código fuente del microservicio
COPY . .

# Expone el puerto que usará Hapi
EXPOSE 3000

# Comando para iniciar el microservicio
CMD ["node", "server.js"]