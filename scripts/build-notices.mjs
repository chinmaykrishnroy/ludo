import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const inventory = [],
  sections = [
    "Ludo Club — distribution notices",
    await readFile("LICENSE", "utf8"),
  ];
for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (!path || entry.dev) continue;
  const metadata = JSON.parse(
    await readFile(join(path, "package.json"), "utf8"),
  );
  const files = (await readdir(path, { withFileTypes: true }))
    .filter(
      (file) =>
        file.isFile() &&
        /^(license|copying|notice|ofl)(\..*)?$/i.test(file.name),
    )
    .map((file) => file.name)
    .sort();
  if (!files.length)
    throw new Error(`Missing distribution notice for ${metadata.name}`);
  inventory.push({
    name: metadata.name,
    version: metadata.version,
    license: metadata.license ?? "UNSPECIFIED",
    files,
  });
  sections.push(
    `\n${"=".repeat(72)}\n${metadata.name}@${metadata.version}\nLicense: ${metadata.license ?? "UNSPECIFIED"}`,
  );
  for (const file of files)
    sections.push(
      `--- ${file} ---\n${await readFile(join(path, file), "utf8")}`,
    );
}
await writeFile("dist/THIRD_PARTY_NOTICES.txt", sections.join("\n\n") + "\n");
await writeFile(
  "dist/third-party-inventory.json",
  JSON.stringify(inventory, null, 2) + "\n",
);
console.log(
  `Distribution notices included for ${inventory.length} production packages, including bundled fonts/icons.`,
);
