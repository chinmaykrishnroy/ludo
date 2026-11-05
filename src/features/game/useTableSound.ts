import { useEffect, useRef, useState } from "react";
import type { SoundCue } from "../../../shared/effects";
import type { RoomAudioMixer } from "../voice/roomAudioMixer";
import { silentAudioUrl } from "../voice/voicePlayback";

export function useTableSound(
  cue: SoundCue | undefined,
  room: string | undefined,
  offset: number,
  muted: boolean,
  ducked: boolean,
  mixer: RoomAudioMixer,
) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const active = useRef<SoundCue | undefined>(undefined);
  const ignored = useRef("");
  const pausedForVoice = useRef(false);
  const autoplay = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const clock = useRef(offset);
  clock.current = offset;

  function element() {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.preload = "none";
    }
    return audio.current;
  }
  function reset() {
    const player = audio.current;
    active.current = undefined;
    pausedForVoice.current = false;
    if (player) {
      player.onended = player.onerror = null;
      player.pause();
      player.removeAttribute("src");
      player.load();
    }
    setPlaying(false);
    setNeedsTap(false);
  }
  function play(player: HTMLAudioElement, id: string) {
    void player
      .play()
      .then(() => {
        if (active.current?.id === id) {
          setPlaying(true);
          setNeedsTap(false);
        }
      })
      .catch((error: unknown) => {
        if (active.current?.id !== id || pausedForVoice.current) return;
        if (error instanceof Error && error.name === "NotAllowedError")
          setNeedsTap(true);
        else reset();
      });
  }
  function applyLevel() {
    const player = audio.current;
    const sound = active.current;
    if (!player || !sound) return false;
    const controlled = mixer.setSoundLevel(player, sound.gain);
    if (ducked && !controlled) {
      pausedForVoice.current = true;
      player.pause();
      return false;
    }
    return true;
  }
  const latestLevel = useRef(applyLevel);
  latestLevel.current = applyLevel;

  useEffect(() => {
    if (!room || muted) return;
    const unlock = () => {
      if (active.current) return;
      if (autoplay.current) return;
      autoplay.current = true;
      mixer.unlock();
      const player = element();
      const url = silentAudioUrl();
      player.src = url;
      void player
        .play()
        .catch(() => {
          autoplay.current = false;
        })
        .finally(() => URL.revokeObjectURL(url));
    };
    document.addEventListener("click", unlock, true);
    document.addEventListener("keydown", unlock, true);
    return () => {
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
  }, [room, muted, mixer]);
  useEffect(
    () => () => {
      const player = audio.current;
      if (player) mixer.forgetSound(player);
      audio.current = null;
      autoplay.current = false;
    },
    [mixer],
  );

  useEffect(() => {
    reset();
    if (!room || !cue || ignored.current === cue.id) return;
    if (muted) {
      ignored.current = cue.id;
      return;
    }
    const now = Date.now() + clock.current;
    if (now - cue.startsAt > 2200 || cue.endsAt <= now) return;
    const player = element();
    active.current = cue;
    player.src = `/api/soundboard/${encodeURIComponent(cue.sound)}/${encodeURIComponent(cue.id)}`;
    player.onended = player.onerror = reset;
    if (latestLevel.current()) play(player, cue.id);
    const stopAt = setTimeout(reset, cue.endsAt - now);
    return () => {
      clearTimeout(stopAt);
      reset();
    };
  }, [room, cue?.id, muted]);
  useEffect(() => {
    mixer.duck(ducked);
    const canPlay = applyLevel();
    if (canPlay && pausedForVoice.current && audio.current && active.current) {
      pausedForVoice.current = false;
      play(audio.current, active.current.id);
    }
  }, [ducked, mixer]);
  return {
    playing,
    needsTap,
    stop: () => {
      if (active.current) ignored.current = active.current.id;
      reset();
    },
    resume: () => {
      mixer.unlock();
      if (audio.current && active.current && applyLevel())
        play(audio.current, active.current.id);
    },
  };
}
export type TableSoundController = ReturnType<typeof useTableSound>;
