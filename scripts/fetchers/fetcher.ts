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

/** Long enough for the Austrian export (about 3 MB), short of a hung run. */
const TIMEOUT_MS = 90_000;

/** fetch(), failing on any answer but a 2xx and on a source that hangs. */
export async function request(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Deno's own message ("fetch failed") names neither the URL nor the cause.
    const cause = error instanceof Error && error.cause instanceof Error
      ? `: ${error.cause.message}`
      : "";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${url} could not be read (${message}${cause})`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${url} answered HTTP ${response.status}`);
  }
  return response;
}
