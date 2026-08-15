FROM node:22-alpine
WORKDIR /app
COPY --chmod=644 package.json ./
RUN npm install --omit=dev --registry=https://registry.npmmirror.com
COPY --chmod=644 server.js ./
USER node
EXPOSE 8787
CMD ["node", "server.js"]
