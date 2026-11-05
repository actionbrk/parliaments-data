/**
 * The Netherlands' House of Representatives, from the Tweede Kamer's open
 * data portal (source tweedekamer-opendata): its OData API, which lists the
 * active factions (Fractie) and who holds a seat in each (FractieZetelPersoon).
 */
import {
  type Fetcher,
  requestJson,
  type SourceGroup,
  tally,
} from "./fetcher.ts";

const SERVICE_URL = "https://gegevensmagazijn.tweedekamer.nl/OData/v4/2.0/";

/** More pages than the API has ever needed: a bound, so a loop cannot spin. */
const MAX_PAGES = 20;

export interface Faction {
  Id: string;
  /** The faction's short name: "D66", "ChristenUnie", "Groep Markuszower". */
  Afkorting: string | null;
  NaamNL: string | null;
}

export interface SeatHolder {
  FractieZetel: { Fractie_Id: string | null } | null;
}

interface Page<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

/** Every entity of `entity` matching `filter`, following the API's paging. */
async function readAll<T>(
  entity: string,
  params: Record<string, string>,
): Promise<T[]> {
  let url: string | undefined = `${SERVICE_URL}${entity}?${new URLSearchParams(
    params,
  )}`;
  const all: T[] = [];
  for (let pages = 0; url; pages++) {
    if (pages === MAX_PAGES) {
      throw new Error(`${entity} has more than ${MAX_PAGES} pages`);
    }
    const page = await requestJson(url, {
      headers: { Accept: "application/json" },
    }) as Page<T>;
    if (!Array.isArray(page?.value)) {
      throw new Error(`unexpected answer for ${entity}: no "value" list`);
    }
    all.push(...page.value);
    url = page["@odata.nextLink"];
  }
  return all;
}

/**
 * Seats per active faction, keyed by its short name (Afkorting): one per
 * holder of a seat that has not ended. A holder in a faction that is not
 * listed as active is an error.
 */
export function countSeats(
  factions: Faction[],
  holders: SeatHolder[],
): SourceGroup[] {
  const byId = new Map(factions.map((faction) => [faction.Id, faction]));
  const members = holders.map((holder) => {
    const faction = byId.get(holder.FractieZetel?.Fractie_Id ?? "");
    if (!faction?.Afkorting) {
      throw new Error(
        "unexpected answer: a seat holder belongs to no active faction",
      );
    }
    return faction;
  });
  return tally(
    members,
    (faction) => faction.Afkorting ?? "",
    (faction) => faction.NaamNL ?? "",
  );
}

export const tweedekamer: Fetcher = {
  source: "tweedekamer-opendata",
  groups: {
    PRO: "pro",
    D66: "d66",
    VVD: "vvd",
    PVV: "pvv",
    CDA: "cda",
    JA21: "ja21",
    "Groep Markuszower": "markuszower",
    FVD: "fvd",
    SGP: "sgp",
    DENK: "denk",
    ChristenUnie: "cu",
    SP: "sp",
    BBB: "bbb",
    PvdD: "pvdd",
    "50PLUS": "50plus",
    "Lid Keijzer": "keijzer",
    Volt: "volt",
  },
  async read() {
    const [factions, holders] = await Promise.all([
      readAll<Faction>("Fractie", {
        $filter: "Verwijderd eq false and DatumInactief eq null",
        $select: "Id,Afkorting,NaamNL",
      }),
      readAll<SeatHolder>("FractieZetelPersoon", {
        $filter: "Verwijderd eq false and TotEnMet eq null",
        $select: "Id",
        $expand: "FractieZetel($select=Fractie_Id)",
      }),
    ]);
    return countSeats(factions, holders);
  },
};
