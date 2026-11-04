/**
 * What every fetcher under scripts/fetchers/ provides, and the helpers they
 * share. A fetcher reads one chamber's seat counts from its source; writing
 * them into the chamber file is scripts/fetch.ts's job.
 */

/** A parliamentary group as a source reports it. */
export interface SourceGroup {
  /**
   * How the source identifies the group: a code where it has one, its name
   * otherwise. The fetcher's `groups` maps it to the group's id.
   */
  key: string;
  /** The group's name as the source gives it, for messages about a key nobody mapped yet. */
  label: string;
  seats: number;
}

export interface Fetcher {
  /** Id in data/sources.yaml. The chamber file must name the same source. */
  source: string;
  /**
   * The id, in the chamber file, of the group each of the source's keys
   * stands for. Several keys may share an id. A key missing here stops the
   * update: the group it stands for needs an id, a colour and parties, which
   * only a person can give.
   */
  groups: Readonly<Record<string, string>>;
  /** The chamber's current seat counts, as the source reports them. */
  read(): Promise<SourceGroup[]>;
}

/** One seat per member, counted under the key `keyOf` gives the member. */
export function tally<T>(
  members: Iterable<T>,
  keyOf: (member: T) => string,
  labelOf: (member: T) => string,
): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const member of members) {
    const key = keyOf(member);
    const group = groups.get(key);
    if (group) group.seats += 1;
    else groups.set(key, { key, label: labelOf(member), seats: 1 });
  }
  return [...groups.values()];
}

/**
 * For the whole answer, body included. Long enough for the Austrian export
 * (about 3 MB), short of a hung run.
 */
const TIMEOUT_MS = 90_000;

/** Why reading `url` failed, with the URL: fetch's own errors name neither. */
function unreadable(url: string, error: unknown): Error {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new Error(
      `${url} could not be read (no complete answer within ${
        TIMEOUT_MS / 1000
      } s)`,
    );
  }
  const cause = error instanceof Error && error.cause instanceof Error
    ? `: ${error.cause.message}`
    : "";
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${url} could not be read (${message}${cause})`);
}

/**
 * The body of `url` as text, failing on any answer but a 2xx and on a source
 * that hangs. Every failure, the body's included, names the URL.
 */
export async function requestText(
  url: string,
  init: RequestInit = {},
): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error) {
    throw unreadable(url, error);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${url} answered HTTP ${response.status}`);
  }
  try {
    return await response.text();
  } catch (error) {
    throw unreadable(url, error);
  }
}

/**
 * The body of `url` parsed as JSON, failing as requestText does, and on an
 * answer that is not JSON (an error or bot-check page served with HTTP 200).
 * Its shape is the caller's to check.
 */
export async function requestJson(
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const text = await requestText(url, init);
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${url} did not answer JSON (${message})`);
  }
}
