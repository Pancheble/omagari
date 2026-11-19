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
/** Connecting for the first time, connected, or dropped and reconnecting. */
export type LiveState = "connecting" | "open" | "reconnecting";

/**
 * The live connection to the server (ADR-0014: the web only receives over WebSocket). When it drops, it reconnects with a delay growing from 1 to 10 seconds,
 * and sends the last message number it received as hello's `after` to pick up the messages it missed.
 * If the session has ended and the server refuses (`unauthorized`), it doesn't reconnect and calls `onSignedOut`.
 */
// ponytail: if refused because the contract version differs (a stale screen after a deploy), it keeps reconnecting. If that happens often, show a "Refresh" banner.
export function useLive(
  session: string,
  /** The workspace to receive. A connection receives only one workspace's messages. */
  workspace: string,
  onEvent: (event: LiveEvent) => void,
  onSignedOut: () => void,
): LiveState {
  const [state, setState] = useState<LiveState>("connecting");
  const handle = useEffectEvent(onEvent);
  const signOut = useEffectEvent(onSignedOut);

  useEffect(() => {
    let socket: WebSocket | undefined;
    /** Where to resume from. At first connection it's the number in welcome, and it advances to each message number received. */
    let cursor: number | undefined;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      const url = new URL(LIVE_SOCKET, location.href);
      url.protocol = url.protocol.replace("http", "ws");
      const current = new WebSocket(url);
      socket = current;
      current.onopen = () =>
        current.send(encode(webToServer, "hello", { session, after: cursor, workspace }));
      current.onmessage = ({ data }) => {
        const decoded = decode(serverToWeb, data);
        if ("error" in decoded) return; // Anything that doesn't match the contract is dropped
        const event = decoded.message;
        if (event.kind === "error") {
          if (event.payload.code !== "unauthorized") return;
          stopped = true;
          return signOut();
        }
        if (event.kind === "welcome") {
          // On reconnect, the messages missed while dropped (after welcome) move the position. If it drops again before then, nothing is lost.
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
      // Closing while connecting makes the browser log a warning (StrictMode in development always does this). Close after it connects.
      if (socket?.readyState === WebSocket.CONNECTING) socket.onopen = () => socket?.close();
      else socket?.close();
    };
  }, [session, workspace]);

  return state;
}
