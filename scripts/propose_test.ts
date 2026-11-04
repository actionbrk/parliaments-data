// scripts/propose.sh against a throwaway repository: a clone of a local
// origin, and a stand-in for gh that answers from a list of pull requests and
// records every call that changes something.
import { assert, assertEquals, assertMatch } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

import { writeFiles } from "./testing.ts";

const PROPOSE = fromFileUrl(new URL("./propose.sh", import.meta.url));
const CHAMBER = "xyz/unicameral";
const FILE = `data/${CHAMBER}.yaml`;
const BRANCH = "fetch/xyz-unicameral";
const WITHDRAWN = "fetch: withdrawn";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

/** A stand-in for gh: pr list answers from $FAKE_GH/prs.json. */
const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "pr list")
    if [ -e "$FAKE_GH/fails" ]; then echo "HTTP 502" >&2; exit 1; fi
    cat "$FAKE_GH/prs.json" ;;
  *) jq --null-input --compact-output '$ARGS.positional' --args -- "$@" >>"$FAKE_GH/calls" ;;
esac
`;

/** Keeps the tests' git from the developer's own configuration (signing...). */
const GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

interface Counts {
  a: number;
  ni: number;
  color?: string;
  updated?: string;
}

/** The chamber file with these counts; 10 seats, the rest vacant. */
function chamber({ a, ni, color = "#000000", updated = "2026-11-01" }: Counts) {
  const vacant = 10 - a - ni;
  return `name: Assembly
seats: 10
${vacant ? `vacant: ${vacant}\n` : ""}source: official
updated: ${updated}
groups:
  - id: a
    name: Group A
    color: "${color}"
    seats: ${a}
    parties: []
  - id: ni
    name: Non-attached
    color: "#999999"
    seats: ${ni}
    parties: []
`;
}

const MAIN: Counts = { a: 9, ni: 1 };

interface PullRequest {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  isCrossRepository?: boolean;
  labels?: string[];
  /** Pushed as the pull request's head; none for a fork's. */
  counts?: Counts;
  /** Whether the workflow committed its head, rather than someone else. */
  owned?: boolean;
}

async function run(
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string> },
) {
  const output = await new Deno.Command(command, {
    args,
    cwd: options.cwd,
    env: { ...GIT_ENV, ...options.env },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return {
    code: output.code,
    stdout: decode(output.stdout),
    stderr: decode(output.stderr),
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await run("git", args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

/** Commits the work tree's chamber file as `email`. */
function commit(work: string, email: string, message: string) {
  return git(
    work,
    "-c",
    "user.name=Committer",
    "-c",
    `user.email=${email}`,
    "commit",
    "--quiet",
    "-am",
    message,
  );
}

/** The commit the branch ends with in `origin`, if it exists. */
async function branchHead(origin: string): Promise<string | undefined> {
  const head = await git(
    origin,
    "for-each-ref",
    "--format=%(objectname)",
    `refs/heads/${BRANCH}`,
  );
  return head || undefined;
}

/**
 * Runs propose.sh on a repository whose main holds MAIN, whose origin holds
 * `pullRequests`, and whose working tree holds `reading`.
 */
async function propose(
  reading: Counts,
  pullRequests: PullRequest[],
  options: { ghFails?: boolean } = {},
) {
  const root = await Deno.makeTempDir();
  try {
    const origin = join(root, "origin.git");
    const work = join(root, "work");
    const gh = join(root, "gh");
    await git(root, "init", "--quiet", "--bare", "-b", "main", origin);
    await git(root, "init", "--quiet", "-b", "main", work);
    await git(work, "remote", "add", "origin", origin);
    await writeFiles(work, { [FILE]: chamber(MAIN) });
    await git(work, "add", FILE);
    await commit(work, "maintainer@example.org", "main");

    // Each pull request's head, pushed with main in one go.
    const refspecs = ["main"];
    for (const pr of pullRequests) {
      if (!pr.counts) continue;
      await git(work, "switch", "--quiet", "--detach", "main");
      await writeFiles(work, { [FILE]: chamber(pr.counts) });
      const email = pr.owned ? BOT_EMAIL : "maintainer@example.org";
      await commit(work, email, `#${pr.number}`);
      const head = await git(work, "rev-parse", "HEAD");
      refspecs.push(`${head}:refs/pull/${pr.number}/head`);
      if (pr.state === "OPEN") refspecs.push(`${head}:refs/heads/${BRANCH}`);
      await git(work, "switch", "--quiet", "main");
    }
    await git(work, "push", "--quiet", "--force", "origin", ...refspecs);
    const headBefore = await branchHead(origin);

    await Deno.mkdir(gh);
    await Deno.writeTextFile(join(gh, "gh"), FAKE_GH, { mode: 0o755 });
    await writeFiles(gh, {
      "prs.json": JSON.stringify(pullRequests.map((pr) => ({
        number: pr.number,
        state: pr.state,
        isCrossRepository: pr.isCrossRepository ?? false,
        labels: (pr.labels ?? []).map((name) => ({ name })),
      }))),
      "calls": "",
      ...(options.ghFails ? { fails: "" } : {}),
    });

    await writeFiles(work, { [FILE]: chamber(reading) });
    const report = join(root, "report.md");
    await Deno.writeTextFile(report, "Update the seat counts\n\n| table |\n");

    const path = [gh, dirname(Deno.execPath()), Deno.env.get("PATH")].join(":");
    const result = await run("bash", [PROPOSE, CHAMBER, report], {
      cwd: work,
      env: {
        PATH: path,
        FAKE_GH: gh,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_RUN_ID: "1",
      },
    });

    const calls = (await Deno.readTextFile(join(gh, "calls")))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
    const head = await branchHead(origin);
    return {
      ...result,
      calls,
      branchMoved: head !== headBefore,
      /** The chamber file the branch ends with, and who committed it. */
      proposed: head && (await run("git", ["show", `${head}:${FILE}`], {
        cwd: origin,
      })).stdout,
      committer: head &&
        await git(origin, "log", "-1", "--format=%ce", head),
    };
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

const READING: Counts = { a: 8, ni: 1 };
const OTHER: Counts = { a: 8, ni: 2 };

Deno.test("a reading nobody proposed yet opens a pull request", async () => {
  const result = await propose(READING, []);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.calls.map((call) => call.slice(0, 2)), [
    ["pr", "create"],
    ["workflow", "run"],
  ]);
  assertEquals(result.proposed, chamber(READING));
  // Committed by the workflow: the pull request is its own.
  assertEquals(result.committer, BOT_EMAIL);
});

Deno.test("a source back to main's counts closes the pull request, as withdrawn", async () => {
  const result = await propose(MAIN, [
    { number: 7, state: "OPEN", counts: READING, owned: true },
  ]);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.calls.map((call) => call.slice(0, 3)), [
    ["label", "create", WITHDRAWN],
    ["pr", "edit", "7"],
    ["pr", "close", "7"],
  ]);
  assertEquals(result.calls[1].slice(3), ["--add-label", WITHDRAWN]);
});

Deno.test("counts the workflow withdrew itself are proposed again", async () => {
  const result = await propose(READING, [
    { number: 7, state: "CLOSED", counts: READING, labels: [WITHDRAWN] },
  ]);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.calls[0].slice(0, 2), ["pr", "create"]);
});

Deno.test("turned-down counts are not proposed again, whatever else changed", async () => {
  // Turned down in #7, with another colour than main's now. Since then, #8
  // proposed other counts, and the source is back to #7's.
  const result = await propose(READING, [
    { number: 8, state: "OPEN", counts: OTHER, owned: true },
    {
      number: 7,
      state: "CLOSED",
      counts: { ...READING, color: "#123456", updated: "2026-10-01" },
    },
  ]);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.calls, []);
  assertEquals(result.branchMoved, false);
  assertMatch(result.stdout, /::notice::#7 proposed these seat counts/);
});

Deno.test("the open pull request follows the source", async () => {
  const result = await propose(READING, [
    { number: 7, state: "OPEN", counts: OTHER, owned: true },
  ]);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.calls.map((call) => call.slice(0, 3)), [
    ["pr", "edit", "7"],
    ["workflow", "run", "validate.yml"],
  ]);
  assertEquals(result.proposed, chamber(READING));
  assertEquals(result.committer, BOT_EMAIL);

  const same = await propose(READING, [
    {
      number: 7,
      state: "OPEN",
      counts: { ...READING, updated: "2026-10-02" },
      owned: true,
    },
  ]);
  assertEquals(same.calls, []);
  assertMatch(same.stdout, /#7 already proposes these seat counts/);
});

Deno.test("a pull request someone else pushed to is left alone", async () => {
  const someoneElses: PullRequest = {
    number: 7,
    state: "OPEN",
    counts: OTHER,
    owned: false,
  };
  for (const reading of [MAIN, READING]) {
    const result = await propose(reading, [someoneElses]);
    assertEquals(result.code, 0, result.stderr);
    assertEquals(result.calls, []);
    assertEquals(result.branchMoved, false);
    assertMatch(result.stdout, /::warning::.*#7 has commits from someone else/);
  }
});

Deno.test("gh failing stops the run before it changes anything", async () => {
  for (const reading of [MAIN, READING]) {
    const result = await propose(
      reading,
      [{ number: 7, state: "OPEN", counts: OTHER, owned: true }],
      { ghFails: true },
    );
    assert(result.code !== 0);
    assertEquals(result.calls, []);
    assertEquals(result.branchMoved, false);
  }
});

Deno.test("a fork's pull request from a branch of the same name is set aside", async () => {
  const result = await propose(READING, [
    { number: 9, state: "OPEN", isCrossRepository: true },
  ]);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.calls[0].slice(0, 2), ["pr", "create"]);
});
