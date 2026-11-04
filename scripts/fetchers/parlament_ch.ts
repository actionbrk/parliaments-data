/**
 * Switzerland's National Council and Council of States, from the Federal
 * Assembly's OData service (source parlament-ch-odata): its sitting members,
 * each with their parliamentary group.
 */
import {
  type Fetcher,
  requestJson,
  type SourceGroup,
  tally,
} from "./fetcher.ts";

/** The service sources.yaml cites; the queries below are built on it. */
const SERVICE_URL = "https://ws.parlament.ch/odata.svc/";

/** Council 1 is the National Council, 2 the Council of States. */
export type Council = 1 | 2;

function membersUrl(council: Council): string {
  return `${SERVICE_URL}MemberCouncil?$filter=Active%20eq%20true%20and%20Language%20eq%20'FR'%20and%20Council%20eq%20${council}&$format=json&$select=ID,ParlGroupAbbreviation,ParlGroupName`;
}

/**
 * Keyed by the service's ParlGroupAbbreviation, which is a code ("M-E" for
 * the Centre group) rather than the abbreviation the group goes by. A Swiss
 * group spans both councils, but each chamber file lists its own members of
 * it. FRAKTIONSLOS, the non-attached members, only has a group in the
 * Council of States, the one chamber that seats any right now.
 */
const GROUPS: Record<Council, Record<string, string>> = {
  1: {
    V: "udc",
    S: "ps",
    "M-E": "centre",
    RL: "plr",
    G: "verts",
    GL: "pvl",
  },
  2: {
    "M-E": "centre",
    RL: "plr",
    V: "udc",
    S: "ps",
    G: "verts",
    GL: "pvl",
    FRAKTIONSLOS: "ni",
  },
};

interface Member {
  ParlGroupAbbreviation: string | null;
  ParlGroupName: string | null;
}

/**
 * The service's JSON is not consistent in shape: it wraps an unbounded
 * result set (no $top) as `d.results`, and returns a bounded one as `d`
 * itself. Both are accepted.
 */
export interface ODataResponse {
  d: Member[] | { results: Member[] };
}

/** Seats per group, keyed by ParlGroupAbbreviation. */
export function countMembers(data: ODataResponse): SourceGroup[] {
  const members = Array.isArray(data?.d) ? data.d : data?.d?.results;
  if (!Array.isArray(members)) {
    throw new Error("unexpected response: no list of members");
  }
  return tally(
    members,
    (member) => member.ParlGroupAbbreviation ?? "",
    (member) => member.ParlGroupName ?? "no parliamentary group",
  );
}

export function parlamentCh(council: Council): Fetcher {
  return {
    source: "parlament-ch-odata",
    groups: GROUPS[council],
    async read() {
      return countMembers(
        await requestJson(membersUrl(council)) as ODataResponse,
      );
    },
  };
}
