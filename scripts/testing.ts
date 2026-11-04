// What the tests share: a sources.yaml fixture, and writing files into a
// throwaway repository. Not a test module itself (deno test only collects
// *_test.ts files).
import { dirname, join } from "@std/path";

/** A data/sources.yaml with one source, "official". */
export const SOURCES = `sources:
  - id: official
    name: Official open data
    url: https://example.org/open-data
    license: CC BY 4.0
    license_url: https://creativecommons.org/licenses/by/4.0/
`;

/** Writes `files` (path from `root` → content) under `root`, directories included. */
export async function writeFiles(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await Deno.mkdir(dirname(join(root, path)), { recursive: true });
    await Deno.writeTextFile(join(root, path), content);
  }
}
