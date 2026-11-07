/**
 * Builds the site GitHub Pages serves, into dist/:
 *
 * - dist/v1/parliaments.json: everything under data/ in one JSON document,
 *   the format other programs read (the Parliaments app's sync among them);
 * - dist/index.html: a short page pointing at it, listing the chambers.
 *
 * It refuses to build while data/ has problems, so an invalid state is never
 * published. Run with `deno task build`; CI runs it on every pull request
 * (to catch a failure early) and publishes its output on every push to main.
 */
import { dirname, join } from "@std/path";

import {
  type ChamberType,
  type Dataset,
  formatProblem,
  type Group,
  type Party,
  type Source,
  summarize,
  validateRepository,
} from "./validate.ts";

/**
 * Version of the JSON format, also in its URL (/v1/). Within a version,
 * fields are only ever added; removing a field or changing its meaning means a
 * new version, published next to the old one.
 */
export const FORMAT_VERSION = 1;

/** A group as in its chamber file; toPublicDataset sets its keys' order. */
export type PublicGroup = Group;

export interface PublicChamber {
  type: ChamberType;
  name: string;
  name_local?: string;
  seats: number;
  /** Always present in the JSON, 0 when the chamber file leaves it out. */
  vacant: number;
  source: string;
  updated: string;
  groups: PublicGroup[];
}

export interface PublicCountry {
  code: string;
  name: string;
  parties: Party[];
  chambers: PublicChamber[];
}

export interface PublicDataset {
  version: typeof FORMAT_VERSION;
  /** The commit of this repository the document was built from. */
  commit: string | null;
  generated_at: string;
  sources: Source[];
  countries: PublicCountry[];
}

/**
 * The JSON document for a dataset. Fields are copied one by one, so the
 * document's shape and key order are set here rather than by whatever the YAML
 * files happen to contain.
 */
export function toPublicDataset(
  dataset: Dataset,
  meta: { commit: string | null; generatedAt: Date },
): PublicDataset {
  return {
    version: FORMAT_VERSION,
    commit: meta.commit,
    generated_at: meta.generatedAt.toISOString(),
    sources: dataset.sources.map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      citation: source.citation,
      license: source.license,
      license_url: source.license_url,
    })),
    countries: dataset.countries.map(({ code, country, chambers }) => ({
      code,
      name: country.name,
      parties: country.parties.map((party) => ({
        id: party.id,
        name: party.name,
        abbreviation: party.abbreviation,
        color: party.color,
        partyfacts_id: party.partyfacts_id,
      })),
      chambers: chambers.map(({ type, chamber }) => ({
        type,
        name: chamber.name,
        name_local: chamber.name_local,
        seats: chamber.seats,
        vacant: chamber.vacant ?? 0,
        source: chamber.source,
        updated: chamber.updated,
        groups: chamber.groups.map((group) => ({
          id: group.id,
          name: group.name,
          abbreviation: group.abbreviation,
          color: group.color,
          seats: group.seats,
          parties: group.parties,
          parties_source: group.parties_source,
        })),
      })),
    })),
  };
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The landing page: where the JSON is, and what it covers. */
export function renderIndex(data: PublicDataset, repoUrl?: string): string {
  const sources = new Map(data.sources.map((source) => [source.id, source]));

  const rows = data.countries.flatMap((country) =>
    country.chambers.map((chamber) => {
      const source = sources.get(chamber.source);
      const local = chamber.name_local
        ? ` <span class="muted">${escapeHtml(chamber.name_local)}</span>`
        : "";
      const credit = source
        ? `<a href="${escapeHtml(source.url)}">${
          escapeHtml(source.name)
        }</a> · <a href="${escapeHtml(source.license_url)}">${
          escapeHtml(source.license)
        }</a>`
        : "";
      return `        <tr>
          <td>
            <div><strong>${escapeHtml(country.name)}</strong> · ${
        escapeHtml(chamber.name)
      }${local}</div>
            <div class="muted small">${credit}</div>
          </td>
          <td class="num">${escapeHtml(chamber.seats)}</td>
          <td class="date">${escapeHtml(chamber.updated)}</td>
        </tr>`;
    })
  );

  const commit = data.commit
    ? ` from commit <code>${escapeHtml(data.commit.slice(0, 7))}</code>`
    : "";
  const repoLinks = repoUrl
    ? ` The rest of the data is under <a href="${
      escapeHtml(`${repoUrl}/blob/main/LICENSE-DATA.md`)
    }">CC BY 4.0</a> and the code under <a href="${
      escapeHtml(`${repoUrl}/blob/main/LICENSE`)
    }">MIT</a>. <a href="${
      escapeHtml(repoUrl)
    }">Source repository</a>, where corrections are welcome.`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>parliaments-data</title>
    <meta name="description" content="Open, versioned data on the composition of national parliaments, by parliamentary group.">
    <style>
      :root {
        color-scheme: light dark;
        --fg: #1f1f1f;
        --muted: #5f6368;
        --border: #dadce0;
        --bg: #ffffff;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --fg: #e8eaed;
          --muted: #9aa0a6;
          --border: #3c4043;
          --bg: #121212;
        }
      }
      body {
        margin: 0 auto;
        max-width: 56rem;
        padding: 2rem 1rem;
        font: 16px/1.5 system-ui, sans-serif;
        color: var(--fg);
        background: var(--bg);
      }
      a { color: inherit; }
      code { font-family: ui-monospace, monospace; }
      .muted { color: var(--muted); }
      .table { overflow-x: auto; }
      table { border-collapse: collapse; width: 100%; }
      th, td { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      .date { white-space: nowrap; font-variant-numeric: tabular-nums; }
      .small { font-size: 0.875rem; }
    </style>
  </head>
  <body>
    <h1>parliaments-data</h1>
    <p>Open, versioned data on the composition of national parliaments: how many seats each parliamentary group holds, which parties those groups are made of, and where the numbers come from.</p>

    <h2>Data</h2>
    <p><a href="v1/parliaments.json"><code>v1/parliaments.json</code></a> holds every chamber below, its groups and their parties, and the source of each seat count, in one JSON document. Built${commit} on ${
    escapeHtml(data.generated_at.slice(0, 10))
  }.</p>

    <h2>Chambers</h2>
    <div class="table">
      <table>
        <thead>
          <tr><th>Chamber and source</th><th class="num">Seats</th><th>Updated</th></tr>
        </thead>
        <tbody>
${rows.join("\n")}
        </tbody>
      </table>
    </div>

    <p class="muted">Seat counts are reused under the terms of their source, linked above.${repoLinks}</p>
  </body>
</html>
`;
}

async function writeFile(path: string, content: string) {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, content);
}

if (import.meta.main) {
  const root = Deno.cwd();
  const githubActions = Deno.env.get("GITHUB_ACTIONS") === "true";
  const report = await validateRepository(root);

  if (report.problems.length > 0) {
    for (const problem of report.problems) {
      console.error(formatProblem(problem, githubActions));
    }
    console.error("\nNot building: data/ has problems.");
    Deno.exit(1);
  }

  const server = Deno.env.get("GITHUB_SERVER_URL");
  const repository = Deno.env.get("GITHUB_REPOSITORY");
  const repoUrl = server && repository ? `${server}/${repository}` : undefined;

  const data = toPublicDataset(report.dataset, {
    commit: Deno.env.get("GITHUB_SHA") ?? null,
    generatedAt: new Date(),
  });

  const dist = join(root, "dist");
  await Deno.remove(dist, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await writeFile(
    join(dist, `v${FORMAT_VERSION}`, "parliaments.json"),
    `${JSON.stringify(data, null, 2)}\n`,
  );
  await writeFile(join(dist, "index.html"), renderIndex(data, repoUrl));

  console.log(`Built dist/: ${summarize(report.dataset)}.`);
}
