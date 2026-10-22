FROM node:22-bookworm-slim AS javascript
FROM python:3.12-slim-bookworm
COPY --from=javascript /usr/local/bin/node /usr/local/bin/node
RUN pip install --no-cache-dir "yt-dlp[default]"
WORKDIR /app
COPY package.json server.js ./
RUN useradd --create-home app
USER app
ENV NODE_ENV=production PORT=10000
EXPOSE 10000
CMD ["node", "server.js"]
