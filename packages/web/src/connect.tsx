import { Check, Copy, X } from "lucide-react";
import { useState } from "react";
import { clearLimit, useLimit } from "./api.ts";
import { t } from "./i18n.ts";

/** One command in a code block with its own copy button. */
function Command({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {} // Even if copying is blocked, the command is on screen
  };
  return (
    <div className="connect-row">
      <span className="connect-label">{label}</span>
      <div className="connect-command">
        <pre>
          <code>{command}</code>
        </pre>
        <button
          type="button"
          className="button outline"
          onClick={copy}
          aria-label={`${t.connect.copy}: ${command}`}
        >
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied ? t.connect.copied : t.connect.copy}
        </button>
      </div>
    </div>
  );
}

/** Shown above the conversation until this member's runner has connected to this server once. */
export function ConnectCard({ address }: { address: string }) {
  return (
    <section className="connect" aria-label={t.connect.title}>
      <h2>{t.connect.title}</h2>
      <p>{t.connect.body}</p>
      <Command label={t.connect.install} command="npm i -g omagari" />
      <Command label={t.connect.setup} command={`omagari setup ${address}`} />
      <p className="connect-note">{t.connect.codex}</p>
    </section>
  );
}

/** A repo this member hasn't shared: a short notice with a Share button (a banner action). */
export function ShareNotice({ onShare, failed }: { onShare: () => void; failed: boolean }) {
  return (
    <div
      className={failed ? "banner error connect-notice" : "banner info connect-notice"}
      role={failed ? "alert" : "status"}
    >
      {failed ? t.connect.shareFailed : t.connect.notShared}
      <button type="button" className="banner-action" onClick={onShare}>
        {t.connect.share}
      </button>
    </div>
  );
}

/** A limit the server said was hit (ADR-0052), named with its number. Stays until closed or the next hit replaces it. */
export function LimitNotice() {
  const limit = useLimit();
  if (!limit) return null;
  return (
    <div className="banner warning connect-notice" role="alert">
      {t.connect.limit[limit.name](limit.max)}
      <button
        type="button"
        className="reply-stop limit-close"
        aria-label={t.connect.closeLimit}
        title={t.connect.closeLimit}
        onClick={clearLimit}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
