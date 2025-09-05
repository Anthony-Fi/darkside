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
# Exec form with explicit 3s client timeout; consume response and exit explicitly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const http=require('http');const port=process.env.PORT||3000;const req=http.get({hostname:'127.0.0.1',port:port,path:'/health',timeout:3000},res=>{res.resume();process.exit(res.statusCode===200?0:1)});req.on('timeout',()=>{req.destroy(new Error('timeout'))});req.on('error',()=>process.exit(1));"]

CMD ["node", "server.js"]
