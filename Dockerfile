# 도그푸딩 서버의 배포 이미지(ADR-0042). 빌드 없이 .ts를 그대로 실행하므로 서버는 빌드하지 않고 웹 화면만 빌드한다.
FROM node:24-slim
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
CMD ["node", "packages/server/src/main.ts"]
