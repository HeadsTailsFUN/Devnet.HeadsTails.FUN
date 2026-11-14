"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { EarnPointsContent } from "./EarnPointsClient";
import { EarnIcon } from "./EarnPointsLink";

export function EarnPointsModal({ visible, onClose, onConnect, onPlay }: {
  visible: boolean; onClose: () => void; onConnect: () => void; onPlay: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !visible) return;
    const previousOverflow = document.body.style.overflow;
    const root = document.documentElement;
    const previousRootOverflow = root.style.overflow;
    const previousGutter = root.style.scrollbarGutter;
    element.showModal();
    document.body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    root.style.scrollbarGutter = "stable";
    return () => {
      if (element.open) element.close();
      document.body.style.overflow = previousOverflow;
      root.style.overflow = previousRootOverflow;
      root.style.scrollbarGutter = previousGutter;
    };
  }, [visible]);

  return createPortal(<dialog id="earn-points-dialog" ref={dialog} aria-labelledby="earn-modal-title" aria-describedby="earn-modal-description"
    className="earn-dialog" onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => event.stopPropagation()}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="earn-modal-shell">
      <header className="earn-modal-heading">
        <span className="earn-modal-mark"><EarnIcon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1"><h2 id="earn-modal-title" className="font-display text-2xl font-bold">Earn <span className="text-[var(--heads)]">Points</span></h2>
          <p id="earn-modal-description" className="mt-1 text-xs text-[var(--text-secondary)]">Play. Invite. Complete quests. Earn rewards.</p></div>
        <button type="button" className="earn-modal-close" aria-label="Close Earn Points" onClick={onClose}>×</button>
      </header>
      <div className="earn-modal-scroll"><EarnPointsContent onConnect={onConnect} onPlay={onPlay} /></div>
    </div>
  </dialog>, document.body);
}
