FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY scripts ./scripts

CMD ["node", "scripts/render-social-room-artwork.mjs"]
