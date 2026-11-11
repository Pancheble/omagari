import {
  decode,
  encode,
  LIVE_SOCKET,
  type Message,
  serverToWeb,
  webToServer,
} from "@omagari/contract";
import { useEffect, useEffectEvent, useState } from "react";

export type LiveEvent = Message<typeof serverToWeb>;
/** 처음 붙는 중, 붙음, 끊겨서 다시 붙는 중. */
export type LiveState = "connecting" | "open" | "reconnecting";

/**
 * 서버의 실시간 연결(ADR-0014: 웹은 받는 것만 WebSocket으로 받는다). 끊기면 1초에서 10초까지 늘려 가며 다시 붙고,
 * 마지막으로 받은 메시지 번호를 hello의 `after`로 실어 끊긴 사이의 메시지를 이어 받는다.
 * 세션이 끝나 서버가 거절하면(`unauthorized`) 다시 붙지 않고 `onSignedOut`을 부른다.
 */
// ponytail: 계약 버전이 달라 거절되면(배포 뒤 낡은 화면) 다시 붙기를 되풀이한다. 그런 일이 잦으면 "새로 고침" 띠를 낸다.
export function useLive(
  session: string,
  onEvent: (event: LiveEvent) => void,
  onSignedOut: () => void,
): LiveState {
  const [state, setState] = useState<LiveState>("connecting");
  const handle = useEffectEvent(onEvent);
  const signOut = useEffectEvent(onSignedOut);

  useEffect(() => {
    let socket: WebSocket | undefined;
    /** 이어 받을 자리. 처음 붙을 때 welcome의 번호이고, 메시지를 받을 때마다 그 번호로 나아간다. */
    let cursor: number | undefined;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      const url = new URL(LIVE_SOCKET, location.href);
      url.protocol = url.protocol.replace("http", "ws");
      const current = new WebSocket(url);
      socket = current;
      current.onopen = () => current.send(encode(webToServer, "hello", { session, after: cursor }));
      current.onmessage = ({ data }) => {
        const decoded = decode(serverToWeb, data);
        if ("error" in decoded) return; // 계약과 다른 것은 버린다
        const event = decoded.message;
        if (event.kind === "error") {
          if (event.payload.code !== "unauthorized") return;
          stopped = true;
          return signOut();
        }
        if (event.kind === "welcome") {
          // 다시 붙을 때는 welcome 뒤에 오는 끊긴 사이의 메시지가 자리를 옮긴다. 그 전에 또 끊겨도 잃지 않는다.
          cursor ??= event.payload.seq;
          delay = 1000;
          setState("open");
        }
        if (event.kind === "message") cursor = Math.max(cursor ?? 0, event.payload.id);
        handle(event);
      };
      current.onclose = () => {
        if (stopped) return;
        setState("reconnecting");
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [session]);

  return state;
}
