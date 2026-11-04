import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { parse } from "yaml";

import {
  assignSeats,
  describe,
  fetchChamber,
  MAX_VACANT_SHARE,
  seatCounts,
  updateChamber,
} from "./fetch.ts";
import { type Fetcher, FETCHERS } from "./fetchers/mod.ts";
import { SOURCES, writeFiles } from "./testing.ts";
import type { Chamber } from "./validate.ts";

const TODAY = "2026-11-03";

const CHAMBER =
  `# yaml-language-server: $schema=../../schema/chamber.schema.json
name: Assembly
seats: 100
source: official
updated: 2026-10-01
groups:
  - id: a
    name: Group A
    abbreviation: A
    color: "#000000"
    seats: 60
    parties: [a]

  # Non-attached members.
  - id: ni
    name: Non-attached
    color: "#999999"
    seats: 40
    parties: []
`;

function seats(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries));
}

Deno.test("unchanged seats leave the file as it is, date included", () => {
  const update = updateChamber(CHAMBER, seats({ a: 60, ni: 40 }), TODAY);
  assertEquals(update.text, CHAMBER);
  assertEquals(update.changes, []);
  assertEquals(update.changed, false);
});

Deno.test("changed seats rewrite only the counts and the date", () => {
  const update = updateChamber(CHAMBER, seats({ a: 61, ni: 39 }), TODAY);
  assertEquals(
    update.text,
    CHAMBER.replace("updated: 2026-10-01", `updated: ${TODAY}`)
      .replace("seats: 60", "seats: 61")
      .replace("seats: 40", "seats: 39"),
  );
  assertEquals(update.changes.map((c) => [c.id, c.before, c.after]), [
    ["a", 60, 61],
    ["ni", 40, 39],
  ]);
});

Deno.test("empty seats are recorded as vacant, after the seat count", () => {
  const update = updateChamber(CHAMBER, seats({ a: 58, ni: 40 }), TODAY);
  assertMatch(update.text, /^seats: 100\nvacant: 2\nsource: official$/m);
  assertEquals(update.vacant, { before: 0, after: 2 });

  const filledAgain = updateChamber(
    update.text,
    seats({ a: 60, ni: 40 }),
    "2026-11-04",
  );
  assertEquals(
    filledAgain.text,
    CHAMBER.replace("updated: 2026-10-01", "updated: 2026-11-04"),
  );
  assertEquals(filledAgain.vacant, { before: 2, after: 0 });
});

Deno.test("a group with no member left is removed, with its blank line", () => {
  const lastGone = updateChamber(CHAMBER, seats({ a: 95 }), TODAY);
  const chamber = parse(lastGone.text) as Chamber;
  assertEquals(chamber.groups.map((g) => g.id), ["a"]);
  assertEquals(chamber.vacant, 5);
  assertMatch(lastGone.text, /parties: \[a\]\n$/);
  assertEquals(lastGone.changes.at(-1)?.after, 0);

  const firstGone = updateChamber(CHAMBER, seats({ ni: 95 }), TODAY);
  assertMatch(
    firstGone.text,
    /^groups:\n {2}# Non-attached members.\n {2}- id: ni$/m,
  );
});

Deno.test("seats for a group the file doesn't list are refused", () => {
  const error = assertThrows(() =>
    updateChamber(CHAMBER, seats({ a: 50, ni: 40, b: 10 }), TODAY)
  );
  assertMatch(String(error), /group "b", which the chamber file doesn't list/);
});

Deno.test("more members than seats are refused", () => {
  const error = assertThrows(() =>
    updateChamber(CHAMBER, seats({ a: 61, ni: 40 }), TODAY)
  );
  assertMatch(String(error), /101 members for 100 seats/);
});

Deno.test("a mostly empty chamber is taken for a broken reading", () => {
  const atLimit = 100 * MAX_VACANT_SHARE;
  updateChamber(CHAMBER, seats({ a: 60 - atLimit, ni: 40 }), TODAY);

  const error = assertThrows(() =>
    updateChamber(CHAMBER, seats({ a: 59 - atLimit, ni: 40 }), TODAY)
  );
  assertMatch(String(error), /only 89 of 100 seats filled, 11 vacant/);
  assertMatch(
    String(assertThrows(() => updateChamber(CHAMBER, seats({}), TODAY))),
    /no member at all/,
  );
});

Deno.test("vacancies the file records by hand are no broken reading", () => {
  // A person checked the source and recorded 20 vacant seats, twice the share.
  const recorded = CHAMBER.replace("seats: 100\n", "seats: 100\nvacant: 20\n")
    .replace("seats: 60", "seats: 40");

  const same = updateChamber(recorded, seats({ a: 40, ni: 40 }), TODAY);
  assertEquals(same.text, recorded);
  const fewer = updateChamber(recorded, seats({ a: 45, ni: 40 }), TODAY);
  assertEquals(fewer.vacant, { before: 20, after: 15 });

  // More of them still needs a person.
  assertThrows(
    () => updateChamber(recorded, seats({ a: 39, ni: 40 }), TODAY),
    Error,
    "21 vacant where the file records 20",
  );
});

Deno.test("keys add up into their groups, and an unknown key is refused", () => {
  const groups = { X: "a", Y: "a", N: "ni" };
  assertEquals(
    assignSeats([
      { key: "X", label: "Group X", seats: 50 },
      { key: "Y", label: "Group Y", seats: 10 },
      { key: "N", label: "Non-attached", seats: 40 },
    ], groups),
    seats({ a: 60, ni: 40 }),
  );

  const error = assertThrows(() =>
    assignSeats([{ key: "Z", label: "Group Z", seats: 5 }], groups)
  );
  assertMatch(String(error), /"Z" \(Group Z, 5 seats\)/);
  // Inherited properties are no mapping.
  assertThrows(() =>
    assignSeats([{ key: "constructor", label: "?", seats: 1 }], groups)
  );
});

Deno.test("the pull request lists what changed", () => {
  const update = updateChamber(CHAMBER, seats({ a: 97 }), TODAY);
  const { title, body } = describe(update, {
    file: "data/xyz/unicameral.yaml",
    chamber: "Assembly",
    country: "Xyzland",
    source: {
      id: "official",
      name: "Official open data",
      url: "https://example.org/open-data",
      license: "CC BY 4.0",
      license_url: "https://creativecommons.org/licenses/by/4.0/",
    },
  });
  assertEquals(title, "Update the seat counts of the Assembly (Xyzland)");
  assertMatch(
    body,
    /^\[Official open data\]\(https:\/\/example.org\/open-data\)/,
  );
  assertMatch(body, /^\| Group A \(A\) \| 60 \| 97 \|$/m);
  assertMatch(body, /^\| Non-attached \| 40 \| 0 \|$/m);
  assertMatch(body, /^\| Vacant \| 0 \| 3 \|$/m);
  assertMatch(body, /removed from the file/);
});

Deno.test("seat counts compare whatever else differs", () => {
  const counts = seatCounts(CHAMBER);
  assertEquals(
    counts,
    '{"seats":100,"vacant":0,"groups":[["a",60],["ni",40]]}',
  );

  const reordered = `name: Renamed
seats: 100
vacant: 0
source: official
updated: 2027-01-01
groups:
  - { id: ni, name: Non-inscrits, color: "#AAAAAA", seats: 40, parties: [] }
  - { id: a, name: A, color: "#111111", seats: 60, parties: [a, b] }
`;
  assertEquals(seatCounts(reordered), counts);
  assert(seatCounts(reordered.replace("seats: 60", "seats: 59")) !== counts);
});

/** A repository holding one chamber, data/xyz/unicameral.yaml, as `chamber`. */
async function repository(chamber: string): Promise<string> {
  const root = await Deno.makeTempDir();
  await writeFiles(root, {
    "data/sources.yaml": SOURCES,
    "data/xyz/country.yaml": "name: Xyzland\nparties: []\n",
    "data/xyz/unicameral.yaml": chamber,
  });
  return root;
}

function reading(entries: Record<string, number>): Fetcher {
  return {
    source: "official",
    groups: { A: "a", NI: "ni" },
    read: () =>
      Promise.resolve(
        Object.entries(entries).map(([key, seats]) => ({
          key,
          label: key,
          seats,
        })),
      ),
  };
}

Deno.test("a file whose counts didn't change is not rewritten", async () => {
  // Laid out by hand: the YAML library would write "[a]".
  const chamber = CHAMBER.replace("parties: [a]", "parties: [ a ]");
  const root = await repository(chamber);
  try {
    const file = join(root, "data/xyz/unicameral.yaml");
    const unchanged = await fetchChamber(
      root,
      "xyz/unicameral",
      reading({ A: 60, NI: 40 }),
      TODAY,
    );
    assertEquals(unchanged, undefined);
    assertEquals(await Deno.readTextFile(file), chamber);

    const changed = await fetchChamber(
      root,
      "xyz/unicameral",
      reading({ A: 61, NI: 39 }),
      TODAY,
    );
    assertEquals(
      changed?.title,
      "Update the seat counts of the Assembly (Xyzland)",
    );
    assertMatch(await Deno.readTextFile(file), /seats: 61/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// The fetchers against the files they write.

for (const [chamber, fetcher] of Object.entries(FETCHERS)) {
  const file = `data/${chamber}.yaml`;

  Deno.test(`${file} matches its fetcher`, async () => {
    const text = await Deno.readTextFile(file);
    const current = parse(text) as Chamber;
    assertEquals(current.source, fetcher.source);

    // Every group of the file can be reached: one that can't would lose its
    // seats on the first run. A key may lead to a group the file no longer
    // lists: the fetch removed it when its last member left, and stops, to
    // have a person add it back, if the source reports members for it again.
    const ids = new Set(current.groups.map((group) => group.id));
    const mapped = new Set(Object.values(fetcher.groups));
    assertEquals([...ids].filter((id) => !mapped.has(id)), []);

    // Rewriting the file with its own counts changes nothing: the YAML
    // round-trips, comments and layout included.
    const own = new Map(current.groups.map((group) => [group.id, group.seats]));
    assertEquals(updateChamber(text, own, TODAY).text, text);
  });
}
