import { assertEquals, assertMatch } from "@std/assert";

import { SOURCES, writeFiles } from "./testing.ts";
import { formatProblem, type Problem, validateRepository } from "./validate.ts";

const NOW = new Date("2026-11-03T12:00:00Z");

const COUNTRY = `name: Xyzland
parties:
  - id: a
    name: Party A
    abbreviation: A
    color: "#000000"
    partyfacts_id: 1
`;

const CHAMBER = `name: Assembly
seats: 10
source: official
updated: 2026-11-01
groups:
  - id: a
    name: Group A
    color: "#000000"
    seats: 9
    parties: [a]
  - id: ni
    name: Non-attached
    color: "#999999"
    seats: 1
    parties: []
`;

const VALID: Record<string, string> = {
  "data/sources.yaml": SOURCES,
  "data/xyz/country.yaml": COUNTRY,
  "data/xyz/unicameral.yaml": CHAMBER,
};

/** Validates a throwaway repository made of `files`. */
async function validate(files: Record<string, string>): Promise<Problem[]> {
  const root = await Deno.makeTempDir();
  try {
    await writeFiles(root, files);
    return (await validateRepository(root, NOW)).problems;
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

/** VALID with one string replaced in one file. */
function edit(file: string, from: string, to: string): Record<string, string> {
  if (!VALID[file].includes(from)) {
    throw new Error(`"${from}" is not in ${file}`);
  }
  return { ...VALID, [file]: VALID[file].replace(from, to) };
}

Deno.test("a consistent repository has no problems", async () => {
  assertEquals(await validate(VALID), []);
});

Deno.test("groups must add up to the seat count, vacant seats included", async () => {
  const [problem, ...rest] = await validate(
    edit("data/xyz/unicameral.yaml", "seats: 9", "seats: 8"),
  );
  assertEquals(rest, []);
  assertEquals(problem.file, "data/xyz/unicameral.yaml");
  assertEquals(problem.line, 2);
  assertMatch(problem.message, /10 seats but 9 in groups/);

  const withVacancy = edit("data/xyz/unicameral.yaml", "seats: 9", "seats: 8");
  withVacancy["data/xyz/unicameral.yaml"] =
    withVacancy["data/xyz/unicameral.yaml"].replace(
      "seats: 10\n",
      "seats: 10\nvacant: 1\n",
    );
  assertEquals(await validate(withVacancy), []);
});

Deno.test("a group can only list parties of its country", async () => {
  const [problem, ...rest] = await validate(
    edit("data/xyz/unicameral.yaml", "parties: [a]", "parties: [a, b]"),
  );
  assertEquals(rest, []);
  assertEquals(problem.line, 10);
  assertMatch(
    problem.message,
    /party "b" is not listed in data\/xyz\/country.yaml/,
  );
});

Deno.test("a chamber's source must be listed in sources.yaml", async () => {
  const [problem, ...rest] = await validate(
    edit("data/xyz/unicameral.yaml", "source: official", "source: wikipedia"),
  );
  assertEquals(rest, []);
  assertEquals(problem.line, 3);
  assertMatch(problem.message, /source "wikipedia" is not listed/);
});

Deno.test("group ids are unique within a chamber", async () => {
  const [problem, ...rest] = await validate(
    edit("data/xyz/unicameral.yaml", "id: ni", "id: a"),
  );
  assertEquals(rest, []);
  assertMatch(problem.message, /group id "a" is used twice/);
});

Deno.test("a Party Facts id belongs to a single party", async () => {
  const problems = await validate({
    ...VALID,
    "data/xyz/country.yaml": `${COUNTRY}  - id: b
    name: Party B
    abbreviation: B
    color: "#FFFFFF"
    partyfacts_id: 1
`,
  });
  assertEquals(problems.length, 1);
  assertMatch(
    problems[0].message,
    /partyfacts_id 1 is already given to data\/xyz: a/,
  );
});

Deno.test("a party has a hex colour", async () => {
  const [missing, ...rest] = await validate(
    edit("data/xyz/country.yaml", '    color: "#000000"\n', ""),
  );
  assertEquals(rest, []);
  assertEquals(missing.line, 3);
  assertEquals(missing.message, 'parties[0]: missing "color"');

  const [invalid] = await validate(
    edit("data/xyz/country.yaml", '"#000000"', "black"),
  );
  assertEquals(invalid.line, 6);
  assertEquals(
    invalid.message,
    'parties[0].color: must be a hex colour such as "#1D84CE"',
  );
});

Deno.test("a misspelt property is reported where it is written", async () => {
  const problems = await validate(
    edit("data/xyz/unicameral.yaml", "    seats: 9\n", "    seat: 9\n"),
  );
  assertEquals(
    problems.map(({ line, message }) => ({ line, message })),
    [
      { line: 6, message: 'groups[0]: missing "seats"' },
      { line: 9, message: 'groups[0]: unknown property "seat"' },
    ],
  );
});

Deno.test("ids, colours and dates have a fixed format", async () => {
  let files = edit("data/xyz/unicameral.yaml", "id: ni", "id: Non_Inscrits");
  files = {
    ...files,
    "data/xyz/unicameral.yaml": files["data/xyz/unicameral.yaml"].replace(
      '"#999999"',
      "grey",
    ),
  };
  files = {
    ...files,
    "data/xyz/unicameral.yaml": files["data/xyz/unicameral.yaml"].replace(
      "2026-11-01",
      "01/11/2026",
    ),
  };

  const messages = (await validate(files)).map((problem) => problem.message);
  assertEquals(messages, [
    "updated: must be a date written YYYY-MM-DD",
    'groups[1].id: ids use lowercase ASCII letters, digits and single hyphens (e.g. "lfi-nfp")',
    'groups[1].color: must be a hex colour such as "#1D84CE"',
  ]);
});

Deno.test("source links are web addresses", async () => {
  const [script, ...rest] = await validate(
    edit(
      "data/sources.yaml",
      "license_url: https://creativecommons.org/licenses/by/4.0/",
      "license_url: javascript:alert(1)",
    ),
  );
  assertEquals(rest, []);
  assertEquals(script.line, 6);
  assertEquals(
    script.message,
    "sources[0].license_url: must be a web address starting with https:// (or http://)",
  );

  // Not even a URI: explained once.
  const messages = (await validate(
    edit("data/sources.yaml", "url: https://example.org/open-data", "url: x"),
  )).map((problem) => problem.message);
  assertEquals(messages, [
    "sources[0].url: must be a web address starting with https:// (or http://)",
  ]);
});

Deno.test("updated cannot be in the future", async () => {
  const [problem] = await validate(
    edit("data/xyz/unicameral.yaml", "2026-11-01", "2026-12-01"),
  );
  assertMatch(problem.message, /updated \(2026-12-01\) is in the future/);
});

Deno.test("YAML syntax errors are reported with their line", async () => {
  const [problem, ...rest] = await validate(
    edit("data/xyz/unicameral.yaml", "seats: 10\n", "seats: 10\nseats: 11\n"),
  );
  assertEquals(rest, []);
  assertEquals(problem.line, 3);
  assertMatch(problem.message, /^YAML: Map keys must be unique/);
});

Deno.test("files outside the expected layout are reported", async () => {
  const problems = await validate({
    ...VALID,
    "data/xyz/notes.txt": "todo",
    "data/xyz/lower.yaml": CHAMBER,
    "data/France/country.yaml": COUNTRY,
  });
  assertEquals(
    problems.map((problem) => problem.file),
    ["data/France", "data/xyz/notes.txt", "data/xyz/unicameral.yaml"],
  );
});

Deno.test("GitHub Actions output is an annotation on the offending line", () => {
  const problem = {
    file: "data/fra/lower.yaml",
    line: 12,
    message: "50% off\nnext line",
  };
  assertEquals(
    formatProblem(problem, true),
    "::error file=data/fra/lower.yaml,line=12::50%25 off%0Anext line",
  );
  assertEquals(
    formatProblem(problem, false),
    "data/fra/lower.yaml:12: 50% off\nnext line",
  );

  // A file name can't end the property or add one of its own.
  assertEquals(
    formatProblem({ file: "data/a,line=1:b%", line: 3, message: "m" }, true),
    "::error file=data/a%2Cline=1%3Ab%25,line=3::m",
  );
});
