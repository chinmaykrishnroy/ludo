type ProfileStorage = Pick<Storage, "getItem" | "setItem">;
export const DISPLAY_NAME_KEY = "ludo-name";
const PROFILE_VERSION_KEY = "ludo-profile-v1";
const verbs = [
  "Rolling",
  "Dashing",
  "Hopping",
  "Flying",
  "Racing",
  "Bouncing",
  "Dancing",
  "Wandering",
  "Leaping",
  "Sailing",
  "Spinning",
  "Skipping",
  "Gliding",
  "Roaming",
  "Drifting",
  "Climbing",
];
const nouns = [
  "Otter",
  "Panda",
  "Fox",
  "Falcon",
  "Tiger",
  "Badger",
  "Robin",
  "Gecko",
  "Koala",
  "Finch",
  "Owl",
  "Lynx",
  "Dolphin",
  "Penguin",
  "Rabbit",
  "Raven",
];
export function generateGuestName() {
  const random = crypto.getRandomValues(new Uint32Array(3));
  return `${verbs[random[0] % verbs.length]}${nouns[random[1] % nouns.length]}${String(random[2] % 1000).padStart(3, "0")}`;
}
export function rememberDisplayName(storage: ProfileStorage, name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 24) return;
  try {
    storage.setItem(DISPLAY_NAME_KEY, trimmed);
    storage.setItem(PROFILE_VERSION_KEY, "1");
  } catch {
    /* Play remains available when browser storage is restricted. */
  }
}
export function loadDisplayName(storage: ProfileStorage) {
  try {
    const name = storage.getItem(DISPLAY_NAME_KEY)?.trim();
    const migrated = storage.getItem(PROFILE_VERSION_KEY) === "1";
    if (name && name.length <= 24 && (name !== "You" || migrated)) {
      rememberDisplayName(storage, name);
      return name;
    }
  } catch {
    /* Use a temporary guest name if storage is unavailable. */
  }
  const name = generateGuestName();
  rememberDisplayName(storage, name);
  return name;
}
