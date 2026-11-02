import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { containDialogFocus, openDialog } from "../dialogFocus";

export interface DialogProps {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}

export function Dialog({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    return openDialog(ref.current!);
  }, []);
  return (
    <dialog
      ref={ref}
      onKeyDown={(e) => containDialogFocus(e, e.currentTarget)}
      aria-labelledby={titleId}
      className={`dialog ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current!.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            closeRef.current();
        }
      }}
    >
      <div className="dialog-head">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default Dialog;
