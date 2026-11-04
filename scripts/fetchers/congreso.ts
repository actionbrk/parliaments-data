/**
 * Spain's Congress of Deputies, from the Congreso's open-data portal (source
 * congreso-opendata): its export of the active deputies, each with their
 * parliamentary group.
 */
import {
  type Fetcher,
  requestJson,
  requestText,
  type SourceGroup,
  tally,
} from "./fetcher.ts";

/**
 * The export's file name embeds the time it was generated
 * (DiputadosActivos__20260811050007.json), which changes daily. This page is
 * stable and always links to the current one, so the export is found there
 * first. It is also the URL sources.yaml cites.
 */
const LISTING_URL = "https://www.congreso.es/es/opendata/diputados";

/** congreso.es answers HTTP 403 to requests without a browser-like User-Agent. */
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

interface Diputado {
  GRUPOPARLAMENTARIO: string | null;
}

/** The URL of the current DiputadosActivos JSON export, from the listing page. */
export function findExportUrl(html: string): string {
  const match = html.match(
    /href="(\/webpublica\/opendata\/diputados\/DiputadosActivos__\d+\.json)"/,
  );
  if (!match) {
    throw new Error(
      `no DiputadosActivos JSON export is linked from ${LISTING_URL}`,
    );
  }
  return new URL(match[1], LISTING_URL).href;
}

/** Seats per group, keyed by the group's full name (GRUPOPARLAMENTARIO). */
export function countDeputies(diputados: Diputado[]): SourceGroup[] {
  if (!Array.isArray(diputados)) {
    throw new Error("unexpected export: not an array of deputies");
  }
  return tally(
    diputados,
    (diputado) => diputado.GRUPOPARLAMENTARIO ?? "",
    (diputado) => diputado.GRUPOPARLAMENTARIO ?? "no GRUPOPARLAMENTARIO",
  );
}

export const congreso: Fetcher = {
  source: "congreso-opendata",
  groups: {
    "Grupo Parlamentario Popular en el Congreso": "pp",
    "Grupo Parlamentario Socialista": "psoe",
    "Grupo Parlamentario VOX": "vox",
    "Grupo Parlamentario Plurinacional SUMAR": "sumar",
    "Grupo Parlamentario Mixto": "mixto",
    "Grupo Parlamentario Republicano": "erc",
    "Grupo Parlamentario Junts per Catalunya": "junts",
    "Grupo Parlamentario Euskal Herria Bildu": "eh-bildu",
    "Grupo Parlamentario Vasco (EAJ-PNV)": "pnv",
  },
  async read() {
    const listing = await requestText(LISTING_URL, { headers: HEADERS });
    const url = findExportUrl(listing);
    return countDeputies(
      await requestJson(url, { headers: HEADERS }) as Diputado[],
    );
  },
};
