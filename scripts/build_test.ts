import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { renderIndex, toPublicDataset } from "./build.ts";
import type { Dataset } from "./validate.ts";

const DATASET: Dataset = {
  sources: [{
    id: "official",
    name: "Official <open> data",
    url: "https://example.org/open-data",
    license: "CC BY 4.0",
    license_url: "https://creativecommons.org/licenses/by/4.0/",
  }],
  countries: [{
    code: "xyz",
    country: {
      name: "Xyzland",
      parties: [{
        id: "a",
        name: "Party A",
        abbreviation: "A",
        color: "#000000",
        partyfacts_id: 1,
      }],
    },
    chambers: [{
      type: "lower",
      chamber: {
        name: "Assembly",
        seats: 10,
        source: "official",
        updated: "2026-11-01",
        groups: [
          {
            id: "a",
            name: "Group A",
            color: "#000000",
            seats: 10,
            parties: ["a"],
            parties_source: "https://example.org/members",
          },
        ],
      },
    }],
  }],
};

const META = {
  commit: "4f7cb2e4355cd5e04f0c2c1915ae9f8d48857aee",
  generatedAt: new Date("2026-11-03T12:00:00Z"),
};

Deno.test("the JSON document carries its version, commit and build time", () => {
  const data = toPublicDataset(DATASET, META);
  assertEquals(data.version, 1);
  assertEquals(data.commit, META.commit);
  assertEquals(data.generated_at, "2026-11-03T12:00:00.000Z");
});

Deno.test("vacant is always present in the JSON document", () => {
  const chamber = toPublicDataset(DATASET, META).countries[0].chambers[0];
  assertEquals(chamber.type, "lower");
  assertEquals(chamber.vacant, 0);
});

Deno.test("parties carry their colour, as groups do", () => {
  const country = toPublicDataset(DATASET, META).countries[0];
  assertEquals(country.parties[0].color, "#000000");
  assertEquals(country.chambers[0].groups[0].color, "#000000");
});

Deno.test("a group carries the source of its link to its parties", () => {
  const group = toPublicDataset(DATASET, META).countries[0].chambers[0]
    .groups[0];
  assertEquals(group.parties_source, "https://example.org/members");
});

Deno.test("absent optional fields stay out of the JSON", () => {
  const json = JSON.stringify(toPublicDataset(DATASET, META));
  assert(!json.includes("name_local"));
  assert(!json.includes("citation"));
});

Deno.test("the landing page links the JSON and escapes what it shows", () => {
  const page = renderIndex(
    toPublicDataset(DATASET, META),
    "https://github.com/owner/parliaments-data",
  );
  assertStringIncludes(page, '<a href="v1/parliaments.json">');
  assertStringIncludes(page, "<code>4f7cb2e</code>");
  assertStringIncludes(page, "Official &lt;open&gt; data");
  assertStringIncludes(
    page,
    "https://github.com/owner/parliaments-data/blob/main/LICENSE-DATA.md",
  );
});
