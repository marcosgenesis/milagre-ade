import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ipcErrorMessage } from "@milagre/shared/result";
import type { PendingComputer } from "../electron";
import { ALLOW_DETAIL, allowQuestion } from "../lib/pending-computers";

/**
 * Asks this Mac's owner whether a computer pairing for the first time may drive it (spec "Allowing a new computer").
 * The daemon holds that computer's channel until Allow or Deny; two at once are asked oldest first. Escape answers
 * Deny, the choice that can't give anything away. Not behind Settings › Experimental: the computer asking has the flag
 * on, this Mac may not.
 */
export function ComputerAllowPrompt() {
  const [requests, setRequests] = useState<PendingComputer[]>([]);
  const [busy, setBusy] = useState(false);
  // Tied to the request it came from, so it goes with that request.
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let live = true;
    let heard = false;
    const off = window.milagre.onDevicesPending((payload) => {
      heard = true;
      setRequests(Array.isArray(payload?.requests) ? payload.requests : []);
    });
    // A host from before Allow has no devices:pending; nothing ever asks there.
    void (async () => {
      try {
        const list = await window.milagre.listPendingDevices();
        if (live && !heard) setRequests(list ?? []);
      } catch {}
    })();
    return () => {
      live = false;
      off();
    };
  }, []);
  const request = requests[0];
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (request && !element.open) element.showModal();
    if (!request && element.open) element.close();
  }, [request]);
  const error = failure && failure.key === request?.key ? failure.message : null;

  async function answer(allow: boolean) {
    if (!request || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      setRequests(await (allow ? window.milagre.allowDevice(request.key) : window.milagre.denyDevice(request.key)));
    } catch (cause) {
      setFailure({ key: request.key, message: ipcErrorMessage(cause) });
      // Most often the computer gave up meanwhile: show what is still waiting.
      window.milagre.listPendingDevices().then(setRequests, () => {});
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <dialog
      ref={dialog}
      data-computer-allow
      aria-labelledby="computer-allow-title"
      onCancel={(event) => {
        event.preventDefault();
        void answer(false);
      }}
      className="m-auto w-[400px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[16px] bg-surface p-0 text-ink shadow-overlay backdrop:bg-black/20 backdrop:backdrop-blur-overlay"
    >
      {request && (
        <div className="flex flex-col p-5">
          <h2 id="computer-allow-title" className="text-[17px] font-semibold">
            {allowQuestion(request)}
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">{ALLOW_DETAIL}</p>
          {error && (
            <p role="alert" className="mt-3 text-[13px] text-red">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => void answer(false)} className="rounded-control px-3 py-2 text-[13px] hover:bg-hover-2">
              Deny
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void answer(true)}
              className="rounded-control bg-ink px-3 py-2 text-[13px] font-medium text-surface disabled:opacity-40"
            >
              Allow
            </button>
          </div>
        </div>
      )}
    </dialog>,
    document.body,
  );
}
