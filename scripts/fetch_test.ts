import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import { parse } from "yaml";

import {
  assignSeats,
  describe,
  MAX_VACANT_SHARE,
  updateChamber,
} from "./fetch.ts";
import { FETCHERS } from "./fetchers/mod.ts";
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
  assertMatch(String(error), /only 89 of 100 seats filled/);
  assertMatch(
    String(assertThrows(() => updateChamber(CHAMBER, seats({}), TODAY))),
    /no member at all/,
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

// The fetchers against the files they write.

for (const [chamber, fetcher] of Object.entries(FETCHERS)) {
  const file = `data/${chamber}.yaml`;

  Deno.test(`${file} matches its fetcher`, async () => {
    const text = await Deno.readTextFile(file);
    const current = parse(text) as Chamber;
    assertEquals(current.source, fetcher.source);

    // Every key leads to a group of the file, and every group of the file can
    // be reached: one that can't would lose its seats on the first run.
    const ids = new Set(current.groups.map((group) => group.id));
    const mapped = new Set(Object.values(fetcher.groups));
    assertEquals([...mapped].filter((id) => !ids.has(id)), []);
    assertEquals([...ids].filter((id) => !mapped.has(id)), []);

    // Rewriting the file with its own counts changes nothing: the YAML
    // round-trips, comments and layout included.
    const own = new Map(current.groups.map((group) => [group.id, group.seats]));
    assertEquals(updateChamber(text, own, TODAY).text, text);
  });
}
