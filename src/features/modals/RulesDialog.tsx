import { ShieldCheck } from "@phosphor-icons/react";
import { Dialog } from "../../lib";
import { ROLL_MS, MOVE_MS } from "../../../shared/game";

export function RulesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="A classic for a reason."
      eyebrow="HOW TO PLAY"
      onClose={onClose}
    >
      <div className="rules-list">
        {[
          [
            "01",
            "Make your entrance",
            "Roll a six to move a token from the yard onto your starting square.",
          ],
          [
            "02",
            "Find your way home",
            "Move clockwise around the board, then up your colour’s home lane. Choose a highlighted token after rolling.",
          ],
          [
            "03",
            "A little friendly rivalry",
            "Land on an opponent to send their tokens to the yard. Star squares and coloured starting squares are safe. Tokens may share squares; stacks do not block movement.",
          ],
          [
            "04",
            "Keep a good thing going",
            "Rolling a six, capturing a token, or finishing a token earns another roll. Three consecutive sixes forfeit that roll and end your turn.",
          ],
          [
            "05",
            "Bring the whole team home",
            "You need the exact number to finish. Bring all four tokens home first to win. No capture is required to enter the home lane.",
          ],
        ].map(([n, t, d]) => (
          <div key={n}>
            <span>{n}</span>
            <section>
              <h3>{t}</h3>
              <p>{d}</p>
            </section>
          </div>
        ))}
      </div>
      <div className="rule-note">
        <ShieldCheck />
        <p>
          Each human has {ROLL_MS / 1000} seconds to roll, then {MOVE_MS / 1000}{" "}
          seconds to choose a token. If time runs out, the game rolls
          automatically or moves the first legal token. Your seat stays saved
          until you explicitly quit.
        </p>
      </div>
    </Dialog>
  );
}
