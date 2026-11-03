/**
 * Checks everything under data/: that each file parses, matches its JSON
 * Schema (schema/), and holds together with the others -- ids unique, every
 * reference resolving, every chamber's groups adding up to its seat count.
 *
 * Run with `deno task validate`. CI runs it on every pull request; inside
 * GitHub Actions the problems are printed as annotations, so they show up on
 * the offending lines of the pull request's diff.
 */
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import ajvFormats from "ajv-formats";
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml";
import type { Document, Node } from "yaml";
import { join } from "@std/path";

import chamberSchema from "../schema/chamber.schema.json" with { type: "json" };
import countrySchema from "../schema/country.schema.json" with { type: "json" };
import sourcesSchema from "../schema/sources.schema.json" with { type: "json" };

// The shapes the schemas describe, for the checks that run once a file has
// passed its schema.
export interface Source {
  id: string;
  name: string;
  url: string;
  citation?: string;
  license: string;
  license_url: string;
}

export interface SourcesFile {
  sources: Source[];
}

export interface Party {
  id: string;
  name: string;
  abbreviation: string;
  partyfacts_id?: number;
}

export interface Country {
  name: string;
  parties: Party[];
}

export interface Group {
  id: string;
  name: string;
  abbreviation?: string;
  color: string;
  seats: number;
  parties: string[];
}

export interface Chamber {
  name: string;
  name_local?: string;
  seats: number;
  vacant?: number;
  source: string;
  updated: string;
  groups: Group[];
}

export interface Problem {
  /** Path from the repository root, with forward slashes. */
  file: string;
  /** 1-based line the problem points at, when it can be located. */
  line?: number;
  message: string;
}

export const CHAMBER_TYPES = ["lower", "upper", "unicameral"] as const;
export type ChamberType = (typeof CHAMBER_TYPES)[number];

/** Everything under data/ that passed its schema, as loaded. */
export interface Dataset {
  sources: Source[];
  /** Ordered by code. */
  countries: {
    /** Lowercase ISO 3166-1 alpha-3 code: the directory's name. */
    code: string;
    country: Country;
    /** In CHAMBER_TYPES order. */
    chambers: { type: ChamberType; chamber: Chamber }[];
  }[];
}

export interface Report {
  problems: Problem[];
  /** Complete only when there are no problems. */
  dataset: Dataset;
}

type Path = readonly (string | number)[];

const SOURCES_FILE = "data/sources.yaml";
const COUNTRY_FILE = "country.yaml";
const CHAMBER_FILES = CHAMBER_TYPES.map((type) => `${type}.yaml`);
const COUNTRY_DIR = /^[a-z]{3}$/;

const ID_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";
const COLOR_PATTERN = "^#[0-9A-Fa-f]{6}$";

const ajv = new Ajv({ allErrors: true });
// ajv-formats is CommonJS: its plugin is the module's `default` export.
ajvFormats.default(ajv);

const validators = {
  sources: ajv.compile(sourcesSchema),
  country: ajv.compile(countrySchema),
  chamber: ajv.compile(chamberSchema),
};

/** A parsed YAML file that passed its schema, able to point back at its lines. */
class DataFile<T> {
  constructor(
    readonly file: string,
    readonly value: T,
    private readonly doc: Document.Parsed,
    private readonly lines: LineCounter,
  ) {}

  /**
   * The line of the node at `path`, or of the deepest ancestor that exists.
   * With `key`, the line of the last segment's key rather than its value --
   * for a property that should not be there at all.
   */
  lineOf(path: Path, key = false): number | undefined {
    let node: Node | null = this.doc.contents;
    let offset = node?.range?.[0];

    for (const [index, segment] of path.entries()) {
      let next: unknown;
      if (isMap(node)) {
        const pair = node.items.find((item) =>
          isScalar(item.key) && item.key.value === segment
        );
        if (!pair) break;
        const wantKey = key && index === path.length - 1;
        next = wantKey || pair.value == null ? pair.key : pair.value;
      } else if (isSeq(node) && typeof segment === "number") {
        next = node.items[segment];
      } else {
        break;
      }

      if (
        !next || typeof next !== "object" || !("range" in next) || !next.range
      ) break;
      node = next as Node;
      offset = node.range?.[0];
    }

    return offset === undefined ? undefined : this.lines.linePos(offset).line;
  }

  problem(path: Path, message: string, key = false): Problem {
    return { file: this.file, line: this.lineOf(path, key), message };
  }
}

/** "groups[2].seats" for ["groups", 2, "seats"]. */
function displayPath(path: Path): string {
  return path
    .map((segment, index) =>
      typeof segment === "number"
        ? `[${segment}]`
        : index === 0
        ? segment
        : `.${segment}`
    )
    .join("");
}

/** Ajv's JSON Pointer ("/groups/2/seats") as a path. */
function pointerToPath(pointer: string): Path {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

function describeSchemaError(
  error: ErrorObject,
): { path: Path; key: boolean; message: string } {
  const path = pointerToPath(error.instancePath);
  const where = path.length ? `${displayPath(path)}: ` : "";

  switch (error.keyword) {
    case "required":
      return {
        path,
        key: false,
        message: `${where}missing "${error.params.missingProperty}"`,
      };
    case "additionalProperties": {
      const property = String(error.params.additionalProperty);
      return {
        path: [...path, property],
        key: true,
        message: `${where}unknown property "${property}"`,
      };
    }
    case "pattern":
      if (error.params.pattern === ID_PATTERN) {
        return {
          path,
          key: false,
          message:
            `${where}ids use lowercase ASCII letters, digits and single hyphens (e.g. "lfi-nfp")`,
        };
      }
      if (error.params.pattern === COLOR_PATTERN) {
        return {
          path,
          key: false,
          message: `${where}must be a hex colour such as "#1D84CE"`,
        };
      }
      break;
    case "format":
      if (error.params.format === "date") {
        return {
          path,
          key: false,
          message: `${where}must be a date written YYYY-MM-DD`,
        };
      }
      return {
        path,
        key: false,
        message: `${where}must be a valid ${error.params.format}`,
      };
  }

  return { path, key: false, message: `${where}${error.message}` };
}

async function readText(
  root: string,
  file: string,
): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(join(root, file));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

/**
 * Parses `file` and checks it against its schema. Returns undefined, after
 * recording why, when either fails: the cross-file checks only ever see data
 * of the right shape.
 */
async function load<T>(
  root: string,
  file: string,
  validate: ValidateFunction,
  problems: Problem[],
): Promise<DataFile<T> | undefined> {
  const text = await readText(root, file);
  if (text === undefined) {
    problems.push({ file, message: "file is missing" });
    return undefined;
  }

  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, prettyErrors: true });
  if (doc.errors.length > 0) {
    for (const error of doc.errors) {
      problems.push({
        file,
        line: error.linePos?.[0].line,
        message: `YAML: ${error.message.split("\n")[0]}`,
      });
    }
    return undefined;
  }

  const value = doc.toJS();
  const dataFile = new DataFile<T>(file, value as T, doc, lines);
  if (!validate(value)) {
    for (const error of validate.errors ?? []) {
      const { path, key, message } = describeSchemaError(error);
      problems.push(dataFile.problem(path, message, key));
    }
    return undefined;
  }

  return dataFile;
}

/** Records every id that appears more than once in `items`, at its repeats. */
function checkUniqueIds(
  dataFile: DataFile<unknown>,
  items: readonly { id: string }[],
  listPath: Path,
  what: string,
  problems: Problem[],
) {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      problems.push(
        dataFile.problem(
          [...listPath, index, "id"],
          `${what} id "${item.id}" is used twice`,
        ),
      );
    }
    seen.add(item.id);
  });
}

async function listDir(root: string, dir: string): Promise<Deno.DirEntry[]> {
  const entries: Deno.DirEntry[] = [];
  for await (const entry of Deno.readDir(join(root, dir))) entries.push(entry);
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** The latest `updated` date accepted: tomorrow in UTC, to allow for time zones. */
function latestDate(now: Date): string {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(
    0,
    10,
  );
}

export async function validateRepository(
  root: string,
  now = new Date(),
): Promise<Report> {
  const problems: Problem[] = [];
  const dataset: Dataset = { sources: [], countries: [] };

  const sourcesFile = await load<SourcesFile>(
    root,
    SOURCES_FILE,
    validators.sources,
    problems,
  );
  const sourceIds = new Set(
    sourcesFile?.value.sources.map((source) => source.id),
  );
  if (sourcesFile) {
    checkUniqueIds(
      sourcesFile,
      sourcesFile.value.sources,
      ["sources"],
      "source",
      problems,
    );
    dataset.sources = sourcesFile.value.sources;
  }

  // A Party Facts id names one party, wherever it is listed.
  const partyfactsIds = new Map<number, string>();
  const maxDate = latestDate(now);

  for (const entry of await listDir(root, "data")) {
    if (entry.isFile && `data/${entry.name}` === SOURCES_FILE) continue;
    if (!entry.isDirectory || !COUNTRY_DIR.test(entry.name)) {
      problems.push({
        file: `data/${entry.name}`,
        message:
          "data/ holds sources.yaml and one directory per country, named after its lowercase ISO 3166-1 alpha-3 code (e.g. data/fra/)",
      });
      continue;
    }

    const dir = `data/${entry.name}`;
    const files = await listDir(root, dir);
    const chamberFiles: ChamberType[] = [];

    for (const file of files) {
      if (file.isFile && file.name === COUNTRY_FILE) continue;
      const type = CHAMBER_TYPES[CHAMBER_FILES.indexOf(file.name)];
      if (file.isFile && type) {
        chamberFiles.push(type);
        continue;
      }
      problems.push({
        file: `${dir}/${file.name}`,
        message:
          `a country directory holds ${COUNTRY_FILE} and its chambers: lower.yaml and upper.yaml, or unicameral.yaml`,
      });
    }

    chamberFiles.sort((a, b) =>
      CHAMBER_TYPES.indexOf(a) - CHAMBER_TYPES.indexOf(b)
    );
    if (chamberFiles.includes("unicameral") && chamberFiles.length > 1) {
      problems.push({
        file: `${dir}/unicameral.yaml`,
        message:
          "a country has either a unicameral.yaml or lower.yaml/upper.yaml, not both",
      });
    }

    const countryFile = await load<Country>(
      root,
      `${dir}/${COUNTRY_FILE}`,
      validators.country,
      problems,
    );
    const loaded = countryFile && {
      code: entry.name,
      country: countryFile.value,
      chambers: [] as Dataset["countries"][number]["chambers"],
    };
    if (countryFile && loaded) {
      dataset.countries.push(loaded);
      if (chamberFiles.length === 0) {
        problems.push({
          file: countryFile.file,
          message: "the country has no chamber file next to it",
        });
      }

      const parties = countryFile.value.parties;
      checkUniqueIds(countryFile, parties, ["parties"], "party", problems);

      parties.forEach((party, index) => {
        const id = party.partyfacts_id;
        if (id === undefined) return;
        const previous = partyfactsIds.get(id);
        if (previous) {
          problems.push(
            countryFile.problem(
              ["parties", index, "partyfacts_id"],
              `partyfacts_id ${id} is already given to ${previous}`,
            ),
          );
        } else {
          partyfactsIds.set(id, `${dir}: ${party.id}`);
        }
      });
    }
    const partyIds = new Set(
      countryFile?.value.parties.map((party) => party.id),
    );

    for (const type of chamberFiles) {
      const chamberFile = await load<Chamber>(
        root,
        `${dir}/${type}.yaml`,
        validators.chamber,
        problems,
      );
      if (!chamberFile) continue;

      const chamber = chamberFile.value;
      loaded?.chambers.push({ type, chamber });
      checkUniqueIds(
        chamberFile,
        chamber.groups,
        ["groups"],
        "group",
        problems,
      );

      const names = new Set<string>();
      chamber.groups.forEach((group, index) => {
        if (names.has(group.name)) {
          problems.push(
            chamberFile.problem(
              ["groups", index, "name"],
              `group name "${group.name}" is used twice`,
            ),
          );
        }
        names.add(group.name);

        // Without a valid country.yaml there is nothing to check against;
        // its own problems are already reported.
        if (!countryFile) return;
        group.parties.forEach((party, partyIndex) => {
          if (!partyIds.has(party)) {
            problems.push(
              chamberFile.problem(
                ["groups", index, "parties", partyIndex],
                `party "${party}" is not listed in ${dir}/${COUNTRY_FILE}`,
              ),
            );
          }
        });
      });

      if (sourcesFile && !sourceIds.has(chamber.source)) {
        problems.push(
          chamberFile.problem(
            ["source"],
            `source "${chamber.source}" is not listed in ${SOURCES_FILE}`,
          ),
        );
      }

      const groupSeats = chamber.groups.reduce(
        (sum, group) => sum + group.seats,
        0,
      );
      const vacant = chamber.vacant ?? 0;
      if (groupSeats + vacant !== chamber.seats) {
        const counted = vacant
          ? `${groupSeats} in groups + ${vacant} vacant = ${
            groupSeats + vacant
          }`
          : `${groupSeats} in groups`;
        problems.push(
          chamberFile.problem(
            ["seats"],
            `the chamber has ${chamber.seats} seats but ${counted}; record empty seats in "vacant"`,
          ),
        );
      }

      if (chamber.updated > maxDate) {
        problems.push(
          chamberFile.problem(
            ["updated"],
            `updated (${chamber.updated}) is in the future`,
          ),
        );
      }
    }
  }

  problems.sort((a, b) =>
    a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0)
  );
  return { problems, dataset };
}

export function summarize(dataset: Dataset): string {
  const chambers = dataset.countries.reduce(
    (sum, entry) => sum + entry.chambers.length,
    0,
  );
  return `${dataset.countries.length} countries, ${chambers} chambers, ${dataset.sources.length} sources`;
}

/** https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands */
function escapeWorkflowData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll(
    "\n",
    "%0A",
  );
}

export function formatProblem(
  problem: Problem,
  githubActions: boolean,
): string {
  if (githubActions) {
    const location = problem.line
      ? `file=${problem.file},line=${problem.line}`
      : `file=${problem.file}`;
    return `::error ${location}::${escapeWorkflowData(problem.message)}`;
  }
  return `${problem.file}${
    problem.line ? `:${problem.line}` : ""
  }: ${problem.message}`;
}

if (import.meta.main) {
  const report = await validateRepository(Deno.cwd());
  const githubActions = Deno.env.get("GITHUB_ACTIONS") === "true";

  for (const problem of report.problems) {
    console.log(formatProblem(problem, githubActions));
  }

  if (report.problems.length > 0) {
    const count = report.problems.length;
    console.log(`\n${count} problem${count > 1 ? "s" : ""} found.`);
    Deno.exit(1);
  }

  console.log(`data/ is valid: ${summarize(report.dataset)}.`);
}
