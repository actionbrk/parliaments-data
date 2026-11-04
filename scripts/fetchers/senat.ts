/**
 * France's Senate, from the Sénat's public API (source senat-api): a JSON
 * array of every sitting senator, each with their group.
 */
import { type Fetcher, request, type SourceGroup, tally } from "./fetcher.ts";

const API_URL = "https://www.senat.fr/api-senat/senateurs.json";

interface Senateur {
  groupe: { code: string; libelle: string } | null;
}

/** Seats per group, keyed by groupe.code. */
export function countSenators(senateurs: Senateur[]): SourceGroup[] {
  if (!Array.isArray(senateurs)) {
    throw new Error("unexpected response: not an array of senators");
  }
  return tally(
    senateurs,
    (senateur) => {
      if (!senateur.groupe) {
        throw new Error("unexpected response: a senator has no groupe");
      }
      return senateur.groupe.code;
    },
    (senateur) => senateur.groupe?.libelle ?? "",
  );
}

export const senat: Fetcher = {
  source: "senat-api",
  // Keyed by groupe.code, which is stable, rather than groupe.libelleCourt,
  // which is not even consistently an abbreviation ("Les Républicains" for
  // the LR group).
  groups: {
    UMP: "lr",
    UC: "uci",
    SOC: "ser",
    CRC: "crce-k",
    RDSE: "rdse",
    LREM: "rdpi",
    GEST: "gest",
    RTLI: "lirt",
    UNT: "unt",
    NI: "ni",
  },
  async read() {
    const response = await request(API_URL);
    return countSenators(await response.json());
  },
};
