// The fetchers' parsing, on hand-made answers shaped like their sources'.
import { assertEquals, assertThrows } from "@std/assert";

import { countDeputies, findExportUrl } from "./congreso.ts";
import { countGroups } from "./datan.ts";
import type { SourceGroup } from "./fetcher.ts";
import { countMandates } from "./parlament_at.ts";
import { countMembers } from "./parlament_ch.ts";
import { countSenators } from "./senat.ts";

/** key → seats, to compare readings regardless of order and labels. */
function bySeats(groups: SourceGroup[]): Record<string, number> {
  return Object.fromEntries(groups.map((group) => [group.key, group.seats]));
}

Deno.test("parlament.gv.at: members with an open mandate in the chamber", () => {
  const person = (...mandates: object[]) => [
    "Name",
    { mandate_detail: mandates },
  ];
  const data = {
    header: [{ label: "Name" }, { label: "Attribute" }],
    rows: [
      person({ mand_code: "BR", fraktionscode: "V", fraktion: "ÖVP" }),
      person({ mand_code: "BR", fraktionscode: "V", mandat_bis: null }),
      // Left the Bundesrat, now in the Nationalrat.
      person(
        { mand_code: "BR", fraktionscode: "S", mandat_bis: "01.01.2025" },
        { mand_code: "NR", fraktionscode: "S" },
      ),
      person({ mand_code: "BR", fraktionscode: "A", fraktion: "ohne" }),
    ],
  };
  assertEquals(bySeats(countMandates(data, "BR")), { V: 2, A: 1 });
  assertEquals(bySeats(countMandates(data, "NR")), { S: 1 });
  assertThrows(() => countMandates({ header: [], rows: [] }, "NR"));
});

Deno.test("data.gouv.fr: Datan's CSV, quoted fields and empty groups included", () => {
  const csv = "﻿id,libelle,libelleAbrev,libelleAbrege,effectif\r\n" +
    'PO1,"Libertés, Indépendants, Outre-mer et Territoires",LIOT,LIOT,23\r\n' +
    'PO2,"Le groupe ""fictif""",FIC,FIC,0\r\n' +
    "PO3,Non inscrit,,NI,11\r\n";
  assertEquals(countGroups(csv), [
    {
      key: "LIOT",
      label: "Libertés, Indépendants, Outre-mer et Territoires",
      seats: 23,
    },
    { key: "NI", label: "Non inscrit", seats: 11 },
  ]);
  assertThrows(() => countGroups("id,libelle\nPO1,Groupe\n"));
  assertThrows(() =>
    countGroups("libelle,libelleAbrev,effectif\nGroupe,G,beaucoup\n")
  );
});

Deno.test("senat.fr: senators by groupe.code", () => {
  const senator = (code: string) => ({ groupe: { code, libelle: code } });
  assertEquals(
    bySeats(countSenators([senator("UMP"), senator("NI"), senator("UMP")])),
    { UMP: 2, NI: 1 },
  );
  assertThrows(() => countSenators([{ groupe: null }]));
});

Deno.test("congreso.es: the export linked from the listing, deputies by group", () => {
  assertEquals(
    findExportUrl(
      '<a href="/webpublica/opendata/diputados/DiputadosActivos__20261103050008.csv">' +
        '<a href="/webpublica/opendata/diputados/DiputadosActivos__20261103050009.json">',
    ),
    "https://www.congreso.es/webpublica/opendata/diputados/DiputadosActivos__20261103050009.json",
  );
  assertThrows(() => findExportUrl("<html></html>"));

  assertEquals(
    bySeats(countDeputies([
      { GRUPOPARLAMENTARIO: "Grupo Parlamentario Mixto" },
      { GRUPOPARLAMENTARIO: null },
      { GRUPOPARLAMENTARIO: "Grupo Parlamentario Mixto" },
    ])),
    { "Grupo Parlamentario Mixto": 2, "": 1 },
  );
});

Deno.test("ws.parlament.ch: members by group code, either shape of answer", () => {
  const member = (code: string) => ({
    ParlGroupAbbreviation: code,
    ParlGroupName: code,
  });
  const members = [member("V"), member("M-E"), member("V")];
  assertEquals(bySeats(countMembers({ d: members })), { V: 2, "M-E": 1 });
  assertEquals(bySeats(countMembers({ d: { results: members } })), {
    V: 2,
    "M-E": 1,
  });
  assertThrows(() => countMembers({ d: {} } as never));
});
