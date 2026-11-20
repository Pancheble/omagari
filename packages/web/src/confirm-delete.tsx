import { ContractFailure } from "@omagari/contract";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { t } from "./i18n.ts";

/**
 * Asks before deleting an account, a repo's data, or a workspace (ADR-0054, picked 2026-11-21): what goes, that it can't be undone,
 * and the name to type. "Delete" turns on once the name matches. Opens as soon as it's drawn; the caller removes it in `onClose`.
 */
export function ConfirmDelete({
  title,
  lines,
  name,
  forbidden,
  onDelete,
  onClose,
}: {
  title: string;
  lines: string[];
  /** What to type: the login, repo, or workspace name. */
  name: string;
  /** What to say when the server answers `forbidden`. */
  forbidden?: string;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  const heading = useId();
  const input = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await onDelete();
      dialog.current?.close();
    } catch (failure) {
      setError(
        forbidden && failure instanceof ContractFailure && failure.code === "forbidden"
          ? forbidden
          : t.deletion.failed,
      );
      setBusy(false);
    }
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc is handled by the dialog
    <dialog
      ref={dialog}
      className="dialog confirm-delete"
      aria-labelledby={heading}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
    >
      <form onSubmit={submit}>
        <h2 id={heading}>{title}</h2>
        <ul className="dialog-list">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="dialog-lead">{t.deletion.forever}</p>
        <div className="field">
          <label htmlFor={input}>
            {t.deletion.typeName} <code>{name}</code>
          </label>
          <input
            id={input}
            className="text-input"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        {error && (
          <p className="help error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>
            {t.deletion.cancel}
          </button>
          <button type="submit" className="button danger" disabled={busy || typed.trim() !== name}>
            {t.deletion.delete}
          </button>
        </div>
      </form>
    </dialog>
  );
}
