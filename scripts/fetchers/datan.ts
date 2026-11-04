/**
 * France's National Assembly, from Datan's "Groupes politiques actifs de
 * l'Assemblée nationale" dataset on data.gouv.fr (source datan): a CSV of the
 * Assembly's active groups, each with its current membership (effectif).
 */
import { parse } from "@std/csv";

import { type Fetcher, requestText, type SourceGroup } from "./fetcher.ts";

/** The CSV resource itself; sources.yaml cites the dataset's page. */
const CSV_URL =
  "https://www.data.gouv.fr/api/1/datasets/r/4612d596-9a78-4ec6-b60c-ccc1ee11f8c0";

const COLUMNS = ["libelle", "libelleAbrev", "effectif"];

/** One entry per group with members, keyed by its abbreviation (libelleAbrev). */
export function countGroups(csv: string): SourceGroup[] {
  const rows = parse(csv.replace(/^﻿/, ""), { skipFirstRow: true });
  const missing = COLUMNS.filter((column) => rows[0] && !(column in rows[0]));
  if (rows.length === 0 || missing.length > 0) {
    throw new Error(
      `unexpected CSV: ${
        rows.length === 0 ? "no rows" : `no ${missing.join(", ")} column`
      }`,
    );
  }

  return rows.flatMap((row) => {
    const effectif = row.effectif?.trim() ?? "";
    if (!/^\d+$/.test(effectif)) {
      throw new Error(
        `unexpected CSV: group "${row.libelle}" has effectif "${effectif}"`,
      );
    }
    const seats = Number(effectif);
    if (seats === 0) return [];
    return [{
      key: row.libelleAbrev || row.libelleAbrege || "",
      label: row.libelle ?? "",
      seats,
    }];
  });
}

export const datan: Fetcher = {
  source: "datan",
  groups: {
    RN: "rn",
    EPR: "epr",
    "LFI-NFP": "lfi-nfp",
    SOC: "soc",
    DR: "dr",
    ECOS: "ecos",
    DEM: "dem",
    HOR: "hor",
    LIOT: "liot",
    GDR: "gdr",
    UDDPLR: "uddplr",
    NI: "ni",
  },
  async read() {
    return countGroups(await requestText(CSV_URL));
  },
};
