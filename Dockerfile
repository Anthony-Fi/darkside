# Use a Debian-based Node image to ensure sharp works out-of-the-box
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
ENV NODE_ENV=production
RUN npm ci --omit=dev

# Bundle app source
COPY . .

# Environment and port
ENV PORT=3000
# Optional: set this to point to a mounted legacy tiles directory
ENV LEGACY_TILES_DIR=""

EXPOSE 3000

# Healthcheck hitting the Express /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT||3000) + '/health', r=>{ if(r.statusCode!==200) process.exit(1) }).on('error',()=>process.exit(1))" || exit 1

CMD ["node", "server.js"]
