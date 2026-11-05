/**
 * Italy's Chamber of Deputies, from the Chamber's linked open data (source
 * camera-opendata): its SPARQL endpoint, queried for the deputies with an
 * open mandate and an open membership of a parliamentary group.
 */
import {
  type Fetcher,
  requestSparql,
  type SourceGroup,
  tally,
} from "./fetcher.ts";

const ENDPOINT = "https://dati.camera.it/sparql";

/**
 * One row per sitting deputy: one whose mandate (mandatoCamera) has no end
 * date, and whose membership of a group (aderisce) has none either. No
 * legislature is named: a past legislature's mandates all have an end date,
 * so the query needs no editing after an election.
 */
const QUERY = `
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX dcterms: <http://purl.org/dc/terms/>
SELECT DISTINCT ?deputy ?code
WHERE {
  ?deputy a ocd:deputato ; ocd:rif_mandatoCamera ?mandate ; ocd:aderisce ?membership .
  FILTER NOT EXISTS { ?mandate ocd:endDate ?mandateEnd }
  ?membership ocd:rif_gruppoParlamentare ?group .
  FILTER NOT EXISTS { ?membership ocd:endDate ?membershipEnd }
  ?group dcterms:alternative ?code .
}`;

/**
 * Seats per group, keyed by the group's abbreviation (dcterms:alternative).
 * A deputy in two groups at once would be counted twice, so it is an error.
 */
export function countDeputies(rows: Record<string, string>[]): SourceGroup[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.deputy || !row.code) {
      throw new Error("unexpected answer: a row has no deputy or no group");
    }
    if (seen.has(row.deputy)) {
      throw new Error(
        `unexpected answer: ${row.deputy} sits in more than one group`,
      );
    }
    seen.add(row.deputy);
  }
  return tally(rows, (row) => row.code, (row) => row.code);
}

export const camera: Fetcher = {
  source: "camera-opendata",
  groups: {
    FDI: "fdi",
    "PD-IDP": "pd",
    LEGA: "lega",
    "FI-PPE": "fi",
    M5S: "m5s",
    MISTO: "misto",
    AVS: "avs",
    "AZ-PER-RE": "az",
    "NM(N-C-U-I)M-CP": "nm",
    "IV-CR": "iv",
  },
  async read() {
    return countDeputies(await requestSparql(ENDPOINT, QUERY));
  },
};
