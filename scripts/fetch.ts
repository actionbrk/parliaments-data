/**
 * Reads chambers' current seat counts from their sources (scripts/fetchers/)
 * and writes them into their files under data/: each group's seats, the
 * vacant seats, and `updated` when anything changed. A group left with no
 * member is removed. The rest of the file, ids, names, colours, parties,
 * comments and layout, is left as it is, and a file whose counts didn't
 * change is not written at all.
 *
 *   deno task fetch                  every chamber that has a fetcher
 *   deno task fetch fra/upper ...    only these
 *   deno task fetch --list           the chambers, as a JSON array
 *   deno task fetch --counts         the seat counts of the chamber file on
 *                                    stdin, in a form to compare (seatCounts)
 *
 * For each chamber whose file changed, it prints a pull request's title (one
 * line) and, after a blank line, its body in Markdown. Progress and problems
 * go to stderr. .github/workflows/fetch.yml runs it for one chamber at a time
 * every day and proposes the result as that chamber's pull request
 * (scripts/propose.sh).
 *
 * It refuses to write what a reviewer would only have to undo: a group the
 * chamber file doesn't list (a new group needs details only a person can
 * give: CONTRIBUTING.md, "Adding a chamber"), more members than seats, or a reading that
 * leaves more than a tenth of the chamber vacant, more than the file records
 * (a dissolved chamber, a truncated export).
 */
import { join } from "@std/path";
import { isScalar, isSeq, parse, parseDocument, type YAMLMap } from "yaml";

import { type Fetcher, FETCHERS, type SourceGroup } from "./fetchers/mod.ts";
import type { Chamber, Country, Source, SourcesFile } from "./validate.ts";
import { formatProblem } from "./validate.ts";

/** Serialisation options under which the chamber files round-trip unchanged. */
const YAML_OPTIONS = { lineWidth: 0, flowCollectionPadding: false } as const;

/**
 * The largest share of a chamber a reading may leave vacant. A few seats
 * awaiting a by-election are routine; more points at a source that lost
 * members (a truncated export) or at a dissolved chamber, where only a few
 * members keep their seat until the election. Both need a person, who can
 * record those vacancies by hand when the reading is right: only a reading
 * leaving more seats vacant than the file records is held to this share.
 */
export const MAX_VACANT_SHARE = 0.1;

export interface SeatChange {
  id: string;
  name: string;
  abbreviation?: string;
  before: number;
  /** 0 when the group has no member left: it is removed from the file. */
  after: number;
}

export interface ChamberUpdate {
  /**
   * The chamber file with the new counts, written out again by the YAML
   * library: a file it lays out otherwise comes back laid out its way, even
   * when no count changed. `changed` says whether one did.
   */
  text: string;
  /** Whether any count changed: a group's seats or the vacant seats. */
  changed: boolean;
  /** The groups whose seats changed, in the file's order. */
  changes: SeatChange[];
  vacant: { before: number; after: number };
}

function quoteAll(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

/**
 * The seats of each group id, from a source's reading. Fails on a key the
 * fetcher doesn't map: until a person adds the group, there is nowhere to
 * put its seats.
 */
export function assignSeats(
  reading: readonly SourceGroup[],
  groups: Readonly<Record<string, string>>,
): Map<string, number> {
  const unknown = reading.filter((group) => !Object.hasOwn(groups, group.key));
  if (unknown.length > 0) {
    const listed = unknown
      .map((group) =>
        `${JSON.stringify(group.key)} (${group.label}, ${group.seats} seat${
          group.seats > 1 ? "s" : ""
        })`
      )
      .join(", ");
    throw new Error(
      `the source reports a group its fetcher doesn't know: ${listed}. Add the group to the chamber file as CONTRIBUTING.md describes ("Adding a chamber"), and map its key to that id in the fetcher's groups (scripts/fetchers/)`,
    );
  }

  const seats = new Map<string, number>();
  for (const group of reading) {
    const id = groups[group.key];
    seats.set(id, (seats.get(id) ?? 0) + group.seats);
  }
  return seats;
}

/**
 * Rewrites a chamber file's seat counts to `seats` (seats per group id),
 * dated `today` (YYYY-MM-DD) if anything changed. A group missing from
 * `seats` has no member left and is removed.
 */
export function updateChamber(
  text: string,
  seats: ReadonlyMap<string, number>,
  today: string,
): ChamberUpdate {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new Error(`YAML: ${doc.errors[0].message.split("\n")[0]}`);
  }
  const chamber = doc.toJS() as Chamber;

  const ids = new Set(chamber.groups.map((group) => group.id));
  const unlisted = [...seats.keys()].filter((id) => !ids.has(id));
  if (unlisted.length > 0) {
    throw new Error(
      `the source reports seats for group ${
        quoteAll(unlisted)
      }, which the chamber file doesn't list. Add it back, or map the source's key to another group in its fetcher (scripts/fetchers/)`,
    );
  }

  const filled = [...seats.values()].reduce((sum, count) => sum + count, 0);
  if (filled === 0) {
    throw new Error(
      "the source reports no member at all: its format may have changed",
    );
  }
  if (filled > chamber.seats) {
    throw new Error(
      `the source reports ${filled} members for ${chamber.seats} seats. If the chamber grew, correct its "seats"`,
    );
  }
  const vacant = chamber.seats - filled;
  const before = chamber.vacant ?? 0;
  if (vacant > before && vacant > chamber.seats * MAX_VACANT_SHARE) {
    throw new Error(
      `the source reports only ${filled} of ${chamber.seats} seats filled, ${vacant} vacant where the file records ${before}. That many vacancies point at an incomplete source or a dissolved chamber: check the source, and if the reading is right, write its counts into the file by hand, "vacant" included. Readings with no more vacancies than the file records then go through`,
    );
  }

  const list = doc.get("groups");
  if (!isSeq<YAMLMap>(list)) throw new Error('"groups" is not a list');
  const changes: SeatChange[] = [];

  // Backwards, so that removing a group leaves the indices still to visit alone.
  for (let index = chamber.groups.length - 1; index >= 0; index--) {
    const group = chamber.groups[index];
    const after = seats.get(group.id) ?? 0;
    if (after === group.seats) continue;

    changes.unshift({
      id: group.id,
      name: group.name,
      abbreviation: group.abbreviation,
      before: group.seats,
      after,
    });
    if (after > 0) {
      doc.setIn(["groups", index, "seats"], after);
    } else {
      // The next group takes the removed one's place, blank line before it included.
      const [removed] = list.items.splice(index, 1);
      const next = list.items[index];
      if (next) next.spaceBefore = removed.spaceBefore;
    }
  }

  if (vacant !== before) {
    const root = doc.contents as YAMLMap;
    if (vacant === 0) {
      root.delete("vacant");
    } else if (root.has("vacant")) {
      root.set("vacant", vacant);
    } else {
      const at = root.items.findIndex((pair) =>
        isScalar(pair.key) && pair.key.value === "seats"
      );
      root.items.splice(at + 1, 0, doc.createPair("vacant", vacant));
    }
  }

  const changed = changes.length > 0 || vacant !== before;
  if (changed) doc.set("updated", today);

  return {
    text: doc.toString(YAML_OPTIONS),
    changed,
    changes,
    vacant: { before, after: vacant },
  };
}

/**
 * A chamber file's seat counts alone, as one line of JSON: the seats, the
 * vacant seats, and each group's seats by id, in id order. Two files with the
 * same counts give the same line, whatever else differs (dates, names,
 * colours, comments, the groups' order). scripts/propose.sh compares
 * proposals with it.
 */
export function seatCounts(text: string): string {
  const chamber = parse(text) as Chamber;
  const groups = chamber.groups
    .map((group) => [group.id, group.seats] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify({
    seats: chamber.seats,
    vacant: chamber.vacant ?? 0,
    groups,
  });
}

/** A group as the pull request names it: its name, and its abbreviation if any. */
function groupLabel(change: SeatChange): string {
  const label = change.abbreviation
    ? `${change.name} (${change.abbreviation})`
    : change.name;
  return label.replaceAll("|", "\\|");
}

/** The pull request proposing `update`: a title, and a Markdown body. */
export function describe(
  update: ChamberUpdate,
  context: { file: string; chamber: string; country: string; source: Source },
): { title: string; body: string } {
  const { file, chamber, country, source } = context;
  const rows = update.changes.map((change) =>
    `| ${groupLabel(change)} | ${change.before} | ${change.after} |`
  );
  if (update.vacant.before !== update.vacant.after) {
    rows.push(`| Vacant | ${update.vacant.before} | ${update.vacant.after} |`);
  }

  const notes = ["Groups not listed keep their seats."];
  if (update.changes.some((change) => change.after === 0)) {
    notes.push(
      "A group down to 0 has no member left in the source, and is removed from the file.",
    );
  }

  const body = [
    `[${source.name}](${source.url}) reports new seat counts for the ${chamber} (${country}), in \`${file}\`:`,
    "",
    "| Group | Before | After |",
    "| --- | ---: | ---: |",
    ...rows,
    "",
    notes.join(" "),
  ].join("\n");

  return {
    title: `Update the seat counts of the ${chamber} (${country})`,
    body,
  };
}

async function readYaml<T>(root: string, file: string): Promise<T> {
  return parse(await Deno.readTextFile(join(root, file))) as T;
}

/**
 * Reads `chamber`'s seats from its source and rewrites its file under `root`
 * with them. Returns the pull request describing the change, or undefined
 * when there was none.
 */
export async function fetchChamber(
  root: string,
  chamber: string,
  fetcher: Fetcher,
  today: string,
): Promise<{ title: string; body: string } | undefined> {
  const file = `data/${chamber}.yaml`;
  const text = await Deno.readTextFile(join(root, file));
  const current = parse(text) as Chamber;
  if (current.source !== fetcher.source) {
    throw new Error(
      `the chamber names source "${current.source}", but its fetcher reads "${fetcher.source}"`,
    );
  }

  const seats = assignSeats(await fetcher.read(), fetcher.groups);
  const update = updateChamber(text, seats, today);
  if (!update.changed) return undefined;

  const [country, sources] = await Promise.all([
    readYaml<Country>(root, `data/${chamber.split("/")[0]}/country.yaml`),
    readYaml<SourcesFile>(root, "data/sources.yaml"),
  ]);
  const source = sources.sources.find((entry) => entry.id === current.source);
  if (!source) {
    throw new Error(`source "${current.source}" is not in data/sources.yaml`);
  }

  await Deno.writeTextFile(join(root, file), update.text);
  return describe(update, {
    file,
    chamber: current.name,
    country: country.name,
    source,
  });
}

if (import.meta.main) {
  const known = Object.keys(FETCHERS);

  if (Deno.args.includes("--list")) {
    console.log(JSON.stringify(known));
    Deno.exit(0);
  }

  if (Deno.args.includes("--counts")) {
    console.log(seatCounts(await new Response(Deno.stdin.readable).text()));
    Deno.exit(0);
  }

  const chambers = Deno.args.length > 0 ? Deno.args : known;
  const unknown = chambers.filter((chamber) =>
    !Object.hasOwn(FETCHERS, chamber)
  );
  if (unknown.length > 0) {
    console.error(
      `No fetcher for ${quoteAll(unknown)}. Chambers with one: ${
        known.join(", ")
      }.`,
    );
    Deno.exit(2);
  }

  const githubActions = Deno.env.get("GITHUB_ACTIONS") === "true";
  const today = new Date().toISOString().slice(0, 10);
  const reports: string[] = [];
  let failures = 0;

  for (const chamber of chambers) {
    const file = `data/${chamber}.yaml`;
    try {
      const pullRequest = await fetchChamber(
        Deno.cwd(),
        chamber,
        FETCHERS[chamber],
        today,
      );
      console.error(`${file}: ${pullRequest ? "updated" : "no change"}`);
      if (pullRequest) {
        reports.push(`${pullRequest.title}\n\n${pullRequest.body}`);
      }
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(formatProblem({ file, message }, githubActions));
    }
  }

  if (reports.length > 0) console.log(reports.join("\n\n"));
  if (failures > 0) Deno.exit(1);
}
