export function containDialogFocus(
  event: { key: string; shiftKey: boolean; preventDefault(): void },
  dialog: HTMLDialogElement,
) {
  if (event.key !== "Tab") return;
  const items = [
    ...dialog.querySelectorAll<HTMLElement>(
      "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]",
    ),
  ].filter((e) => e.tabIndex >= 0 && e.getClientRects().length > 0);
  const first = items[0],
    last = items.at(-1);
  if (!first) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === dialog)
  ) {
    event.preventDefault();
    last!.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function openDialog(dialog: HTMLDialogElement) {
  const opener =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  dialog.showModal();
  return () => {
    dialog.close();
    queueMicrotask(() => {
      if (opener?.isConnected && !document.querySelector("dialog[open]"))
        opener.focus({ preventScroll: true });
    });
  };
}
