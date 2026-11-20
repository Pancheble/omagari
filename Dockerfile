# 도그푸딩 서버의 배포 이미지(ADR-0042). 빌드 없이 .ts를 그대로 실행하므로 서버는 빌드하지 않고 웹 화면만 빌드한다.
FROM litestream/litestream:0.5.18 AS litestream
FROM node:24-slim
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY litestream.yml /etc/litestream.yml
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/
COPY packages/server/package.json packages/server/
COPY packages/runner/package.json packages/runner/
COPY packages/cli/package.json packages/cli/
COPY packages/hooks/package.json packages/hooks/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY . .
RUN npm run build -w @omagari/web
ENV HOST=0.0.0.0 PORT=8080 OMAGARI_DB=/data/omagari.db
EXPOSE 8080
CMD ["./docker-entrypoint.sh"]
