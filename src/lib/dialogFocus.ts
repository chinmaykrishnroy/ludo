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
  const first = items[0];
  if (!first) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  // Some WebKit keyboard preferences skip links and reach BODY before the
  // nominal last item. Own each Tab step rather than relying on native order
  // to eventually reach that boundary.
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    index < 0
      ? event.shiftKey
        ? items.length - 1
        : 0
      : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
  items[next].focus();
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
