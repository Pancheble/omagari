#!/bin/sh
# 버킷 설정이 있으면 Litestream이 서버 옆에서 DB를 버킷으로 흘려 보낸다(ADR-0055). 없으면 예전처럼 서버만 띄운다.
set -e
if [ -n "$LITESTREAM_BUCKET" ] && [ -n "$LITESTREAM_ACCESS_KEY_ID" ] && [ -n "$LITESTREAM_SECRET_ACCESS_KEY" ]; then
  export LITESTREAM_PATH="${LITESTREAM_PATH:-omagari}" LITESTREAM_REGION="${LITESTREAM_REGION:-auto}" LITESTREAM_ENDPOINT="${LITESTREAM_ENDPOINT:-}"
  # 새 기계처럼 DB 파일이 없으면 버킷의 최신 복제본에서 먼저 되살린다. 복제본이 없으면(첫 시작) 그냥 넘어간다.
  litestream restore -config /etc/litestream.yml -if-db-not-exists -if-replica-exists "$OMAGARI_DB"
  # litestream이 서버를 자식으로 띄우고, 서버가 끝나면 마지막까지 보낸 뒤 같이 끝난다.
  exec litestream replicate -config /etc/litestream.yml -exec "node packages/server/src/main.ts"
fi
exec node packages/server/src/main.ts
