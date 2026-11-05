/**
 * The Netherlands' Senate, from the Eerste Kamer's website (source
 * eerstekamer-website): its page of factions, which gives each one's number of
 * seats. The Eerste Kamer has no open data service.
 *
 * Its terms ask for the address read and the date of extraction on any reuse:
 * the address is the source's url in sources.yaml, and the date is `updated`
 * in the chamber file, the day the counts were read.
 */
import { type Fetcher, requestText, type SourceGroup } from "./fetcher.ts";

const FACTIONS_URL = "https://www.eerstekamer.nl/fracties";

/**
 * The factions of the page: each is a link to /fractie/<slug> reading
 * "PRO (14 zetels)", "50PLUS (1 zetel)". The key is the slug, which a faction
 * keeps when its short name changes.
 */
export function parseFactions(html: string): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (
    const link of html.matchAll(
      /<a [^>]*href="\/fractie\/([a-z0-9_]+)"[^>]*>([\s\S]*?)<\/a>/g,
    )
  ) {
    const text = link[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const parts = text.match(/^(.+?) \((\d+) zetels?\)$/);
    if (!parts) {
      throw new Error(`unexpected page: faction "${link[1]}" reads "${text}"`);
    }
    groups.push({ key: link[1], label: parts[1], seats: Number(parts[2]) });
  }
  if (groups.length === 0) {
    throw new Error(`no faction is listed on ${FACTIONS_URL}`);
  }
  return groups;
}

export const eerstekamer: Fetcher = {
  source: "eerstekamer-website",
  groups: {
    progressief_nederland_pro: "pro",
    boerburgerbeweging: "bbb",
    volkspartij_voor_vrijheid_en: "vvd",
    democraten_1966: "d66",
    christen_democratisch_appel: "cda",
    partij_voor_de_vrijheid: "pvv",
    socialistische_partij: "sp",
    christenunie: "cu",
    forum_voor_democratie: "fvd",
    partij_voor_de_dieren: "pvdd",
    ja21: "ja21",
    volt: "volt",
    staatkundig_gereformeerde_partij: "sgp",
    "50plus": "50plus",
    onafhankelijke_politiek_nederland: "opnl",
    visseren_hamakers: "visseren-hamakers",
    beukering: "beukering",
    walenkamp: "walenkamp",
    van_de_sanden: "van-de-sanden",
    fractie_van_gasteren: "van-gasteren",
  },
  async read() {
    return parseFactions(await requestText(FACTIONS_URL));
  },
};
