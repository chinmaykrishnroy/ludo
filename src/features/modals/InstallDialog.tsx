import { Check } from "@phosphor-icons/react";
import { Dialog } from "../../lib";

export function InstallDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="INSTALL LUDO" onClose={onClose}>
      <p className="dialog-intro">
        In Chrome or Edge, use the browser’s Install app option. On iPhone or
        iPad, use Share, then Add to Home Screen. Open the app once online to
        download offline play.
      </p>
      <button className="primary full" onClick={onClose}>
        GOT IT
        <Check />
      </button>
    </Dialog>
  );
}
