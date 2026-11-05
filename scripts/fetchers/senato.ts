/**
 * Italy's Senate, from the Senate's linked open data (source senato-opendata):
 * its SPARQL endpoint, queried for the senators with an open mandate and an
 * open membership of a parliamentary group. The senators for life are among
 * them, as members of a group like any other.
 */
import {
  type Fetcher,
  requestSparql,
  type SourceGroup,
  tally,
} from "./fetcher.ts";

const ENDPOINT = "https://dati.senato.it/sparql";

/**
 * One row per sitting senator, with the group's current short name. As for
 * the Chamber, no legislature is named.
 *
 * Keep the variable names short: the endpoint's firewall answered HTTP 403
 * to this query with longer ones (mandateEnd and the like).
 */
const QUERY = `
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX osr: <http://dati.senato.it/osr/>
SELECT DISTINCT ?senator ?group ?name
WHERE {
  ?senator a osr:Senatore ; ocd:aderisce ?membership ; osr:mandato ?mandate .
  ?mandate osr:legislatura ?term .
  FILTER NOT EXISTS { ?mandate osr:fine ?x }
  ?membership a ocd:adesioneGruppo ; osr:legislatura ?term ; osr:gruppo ?group .
  FILTER NOT EXISTS { ?membership osr:fine ?y }
  ?group osr:denominazione ?title .
  ?title osr:titoloBreve ?name .
  FILTER NOT EXISTS { ?title osr:fine ?z }
}`;

/**
 * Seats per group, keyed by the number ending the group's URI
 * (http://dati.senato.it/gruppo/85), which a group keeps through its renames.
 */
export function countSenators(rows: Record<string, string>[]): SourceGroup[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.senator || !row.group) {
      throw new Error("unexpected answer: a row has no senator or no group");
    }
    if (seen.has(row.senator)) {
      throw new Error(
        `unexpected answer: ${row.senator} sits in more than one group`,
      );
    }
    seen.add(row.senator);
  }
  return tally(
    rows,
    (row) => row.group.slice(row.group.lastIndexOf("/") + 1),
    (row) => row.name ?? "",
  );
}

export const senato: Fetcher = {
  source: "senato-opendata",
  groups: {
    "85": "fdi",
    "49": "pd",
    "33": "lega",
    "71": "m5s",
    "56": "fi",
    "9": "misto",
    "91": "iv",
    "69": "aut",
    "92": "nm",
  },
  async read() {
    return countSenators(await requestSparql(ENDPOINT, QUERY));
  },
};
