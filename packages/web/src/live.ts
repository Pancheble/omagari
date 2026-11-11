import {
  decode,
  encode,
  type MemberView,
  serverToWeb,
  WEB_SOCKET,
  webToServer,
} from "@omagari/contract";
import { useEffect, useState } from "react";

/**
 * 서버의 실시간 길에 붙어 멤버 목록을 받는다. 붙자마자 한 번, 그 뒤로는 달라질 때마다 온다.
 * 끊기면 1초에서 30초까지 늘려 가며 다시 붙고, 그동안 `members`는 마지막으로 받은 것이다(`connected`가 false).
 * 세션이 끝나 닫히면(1008) `onSignedOut`을 부르고 멈춘다. `onSignedOut`은 바뀌지 않는 함수여야 한다.
 */
export function useMembers(session: string, onSignedOut: () => void) {
  const [members, setMembers] = useState<MemberView[]>();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    let stopped = false;
    const open = () => {
      const url = new URL(WEB_SOCKET, location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onopen = () => socket.send(encode(webToServer, "hello", { session }));
      socket.onmessage = ({ data }) => {
        const decoded = decode(serverToWeb, data);
        if (!("message" in decoded) || decoded.message.kind !== "members") return;
        setMembers(decoded.message.payload.members);
        setConnected(true);
        delay = 1000;
      };
      socket.onclose = ({ code, reason }) => {
        setConnected(false);
        if (stopped) return;
        if (code === 1008 && (reason === "unauthorized" || reason === "forbidden")) {
          return onSignedOut();
        }
        retry = setTimeout(open, delay);
        delay = Math.min(delay * 2, 30_000);
      };
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      // 붙는 중에 닫으면 브라우저가 경고를 남긴다(개발 모드의 StrictMode가 늘 그렇게 한다). 붙은 뒤에 닫는다.
      if (socket.readyState === WebSocket.CONNECTING) socket.onopen = () => socket.close();
      else socket.close();
    };
  }, [session, onSignedOut]);

  return { members, connected };
}
