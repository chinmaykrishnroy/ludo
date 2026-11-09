import { Check } from "@phosphor-icons/react";
import { Dialog } from "../../lib";
import type { Appearance } from "../../useAppearance";

interface SettingsDialogProps {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  name: string;
  setName: (name: string) => void;
  sound: boolean;
  setSound: (sound: boolean) => void;
  haptics: boolean;
  setHaptics: (haptics: boolean) => void;
  onClose: () => void;
}

export function SettingsDialog({
  appearance,
  setAppearance,
  name,
  setName,
  sound,
  setSound,
  haptics,
  setHaptics,
  onClose,
}: SettingsDialogProps) {
  return (
    <Dialog title="SETTINGS" onClose={onClose}>
      <label className="field-label">
        Appearance
        <select
          value={appearance}
          onChange={(e) => setAppearance(e.target.value as Appearance)}
        >
          <option value="system">System default</option>
          <option value="light">Light mode</option>
          <option value="dark">Dark mode</option>
        </select>
      </label>
      <label className="field-label">
        Your display name
        <input
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="settings-row">
        <span>
          <strong>Game sounds</strong>
        </span>
        <button
          className={`switch ${sound ? "on" : ""}`}
          role="switch"
          aria-checked={sound}
          aria-label="Game sounds"
          onClick={() => setSound(!sound)}
        >
          <i />
        </button>
      </div>
      <div className="settings-row">
        <span>
          <strong>Capture vibration</strong>
          <small>On supported devices</small>
        </span>
        <button
          className={`switch ${haptics ? "on" : ""}`}
          role="switch"
          aria-checked={haptics}
          aria-label="Capture vibration"
          onClick={() => setHaptics(!haptics)}
        >
          <i />
        </button>
      </div>
      <button className="primary full" onClick={onClose}>
        DONE <Check />
      </button>
      <a
        className="text-button privacy-link"
        href="/privacy.html"
        target="_blank"
        rel="noreferrer"
      >
        Privacy &amp; retention
      </a>
    </Dialog>
  );
}
