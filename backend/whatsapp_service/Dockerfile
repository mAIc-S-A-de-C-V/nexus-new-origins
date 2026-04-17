FROM node:20-alpine

RUN apk add --no-cache git python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# Copy non-TS assets (SQL migrations) to dist
RUN cp -r src/db/migrations dist/db/migrations

EXPOSE 8025

CMD ["node", "dist/index.js"]
