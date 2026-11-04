/**
 * Austria's Nationalrat and Bundesrat, from the Austrian Parliament's
 * "Parlamentarier:innen ab 1918" open-data dataset (source
 * parlament-at-opendata).
 *
 * Both are read through the API the dataset's documentation gives. That
 * matters for reuse: only data the parliament marks as open data is licensed
 * CC BY 4.0 ("die Ergebnislisten der Filter und der API"); the lists behind
 * the website's own member pages (FBEZ=WFW_002 / WFW_005) are not, and fall
 * under the site's general terms, which exclude any commercial use.
 */
import {
  type Fetcher,
  requestJson,
  type SourceGroup,
  tally,
} from "./fetcher.ts";

const API_URL =
  "https://www.parlament.gv.at/Filter/api/filter/data/409?1=1&showAll=true&export=true";

/**
 * The API identifies a Klub (Nationalrat) or Fraktion (Bundesrat) by a
 * one-letter code, the same in both chambers. "A" gathers the members without
 * one. In the Bundesrat, that is where the Greens and NEOS sit: they hold too
 * few seats there to form a Fraktion (five are required). They stay one
 * non-attached group, as chamber files list parliamentary groups, not parties.
 */
const CHAMBERS = {
  NR: {
    gremium: "Nationalrat",
    groups: {
      F: "fpoe",
      V: "oevp",
      S: "spoe",
      N: "neos",
      G: "gruene",
      A: "ok",
    },
  },
  BR: {
    gremium: "Bundesrat",
    groups: { V: "oevp", S: "spoe", F: "fpoe", A: "of" },
  },
} as const;

export type AustrianChamber = keyof typeof CHAMBERS;

interface Mandate {
  mand_code?: string;
  fraktionscode?: string;
  /** The Klub's or Fraktion's name. */
  fraktion?: string;
  mandat_bis?: string | null;
}

export interface ApiResponse {
  header: { label: string }[];
  rows: unknown[][];
}

/**
 * Seats per Klub/Fraktion code in `chamber`: one per member whose mandate
 * there has no end date (mandat_bis).
 *
 * The request filters on the chamber only. The dataset holds one row per
 * person who ever sat in it, so the current members are picked out here.
 * Filtering on the legislative period instead would match everyone who sat
 * during it, members who have since left included, would need editing after
 * every election, and doesn't apply to the Bundesrat, which has none.
 */
export function countMandates(
  data: ApiResponse,
  chamber: AustrianChamber,
): SourceGroup[] {
  const column = data.header.findIndex((h) => h.label === "Attribute");
  if (column === -1) {
    throw new Error('unexpected response: no "Attribute" column');
  }

  const mandates = data.rows.flatMap((row) => {
    const attributes = row[column] as { mandate_detail?: Mandate[] } | null;
    const mandate = attributes?.mandate_detail?.find((m) =>
      m.mand_code === chamber && !m.mandat_bis
    );
    return mandate ? [mandate] : [];
  });

  return tally(
    mandates,
    (mandate) => mandate.fraktionscode ?? "",
    (mandate) => mandate.fraktion ?? "no Klub/Fraktion",
  );
}

export function parlamentAt(chamber: AustrianChamber): Fetcher {
  const { gremium, groups } = CHAMBERS[chamber];
  return {
    source: "parlament-at-opendata",
    groups,
    async read() {
      const data = await requestJson(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "ATTR_JSON.mandate_detail.gremium_name": [gremium],
        }),
      });
      return countMandates(data as ApiResponse, chamber);
    },
  };
}
