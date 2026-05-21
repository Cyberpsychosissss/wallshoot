FROM node:20-alpine

RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server ./server
COPY client ./client

ENV NODE_ENV=production
ENV PORT=8088

EXPOSE 8088

CMD ["node", "server/index.js"]
