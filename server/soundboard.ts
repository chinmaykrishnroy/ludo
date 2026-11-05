import { readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SOUND_MAX_SECONDS, type SoundCatalog } from "../shared/effects.js";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const manifest = z.object({
  schemaVersion: z.literal(1),
  categories: z
    .array(z.object({ id, label: z.string().min(1).max(90) }))
    .max(30),
  sounds: z
    .array(
      z.object({
        id,
        label: z.string().min(1).max(90),
        filename: z
          .string()
          .regex(/^[a-zA-Z0-9_-]+\.mp3$/)
          .max(128),
        categories: z.array(id).max(30),
        enabledInFamilyMode: z.boolean().optional(),
        durationSeconds: z.number().positive().nullish(),
        measuredMeanDbfs: z.number().finite().nullish(),
      }),
    )
    .max(100),
});
const maxClipBytes = 512 * 1024;
const maxLibraryBytes = 12 * 1024 * 1024;
export function loadSoundboard(directory: string, familyMode: boolean) {
  const catalog: SoundCatalog = { categories: [], clips: [] };
  const files = new Map<
    string,
    { path: string; bytes: Buffer; gain: number }
  >();
  function available(id: string) {
    const file = files.get(id);
    if (!file) return;
    try {
      const stat = lstatSync(file.path);
      if (stat.isFile() && stat.size === file.bytes.length) return file;
    } catch {
      // A clip removed while the server is running disappears from the menu.
    }
  }
  function availableCatalog(): SoundCatalog {
    const clips = catalog.clips.filter((clip) => available(clip.id));
    return {
      clips,
      categories: catalog.categories.filter((category) =>
        clips.some((clip) => clip.categories.includes(category.id)),
      ),
    };
  }
  let data: z.infer<typeof manifest>;
  try {
    const file = join(directory, "catalog.json");
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 256 * 1024)
      throw new Error("Invalid sound catalog file");
    data = manifest.parse(
      JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.warn("Soundboard catalog could not be loaded.");
    return { catalog, available, availableCatalog };
  }
  const categories = new Map(
    data.categories.map((category) => [
      category.id,
      {
        id: category.id,
        label: category.label.replace(/^[^\p{L}\p{N}]+/u, "") || category.id,
      },
    ]),
  );
  let usedBytes = 0;
  for (const clip of data.sounds) {
    const duration = clip.durationSeconds;
    const filters = [
      ...new Set(
        clip.categories.filter((category) => categories.has(category)),
      ),
    ];
    if (
      !duration ||
      duration > SOUND_MAX_SECONDS ||
      !filters.length ||
      files.has(clip.id) ||
      (familyMode && clip.enabledInFamilyMode !== true)
    )
      continue;
    try {
      const path = join(directory, clip.filename);
      const stat = lstatSync(path);
      if (
        !stat.isFile() ||
        !stat.size ||
        stat.size > maxClipBytes ||
        usedBytes + stat.size > maxLibraryBytes
      )
        continue;
      const bytes = readFileSync(path);
      const mean = clip.measuredMeanDbfs;
      const gain =
        mean == null ? 0.22 : Math.min(0.5, 10 ** ((-24 - mean) / 20));
      files.set(clip.id, { path, bytes, gain });
      catalog.clips.push({
        id: clip.id,
        label: clip.label,
        categories: filters,
        duration,
      });
      usedBytes += bytes.length;
    } catch {
      // Missing or unreadable files are omitted from the catalog.
    }
  }
  catalog.categories = [...categories.values()].filter((category) =>
    catalog.clips.some((clip) => clip.categories.includes(category.id)),
  );
  return { catalog, available, availableCatalog };
}
