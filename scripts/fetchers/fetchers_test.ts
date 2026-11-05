// The fetchers' parsing, on hand-made answers shaped like their sources'.
import { assertEquals, assertRejects, assertThrows } from "@std/assert";

import {
  countMembers as countBundestag,
  findArchiveUrl,
  unzip,
} from "./bundestag.ts";
import { countDeputies as countItalianDeputies } from "./camera.ts";
import { countDeputies, findExportUrl } from "./congreso.ts";
import { countGroups } from "./datan.ts";
import { parseFactions } from "./eerstekamer.ts";
import {
  requestJson,
  requestSparql,
  RETRY,
  type SourceGroup,
} from "./fetcher.ts";
import { countMandates } from "./parlament_at.ts";
import { countMembers } from "./parlament_ch.ts";
import {
  countDeputies as countPortuguese,
  findJsonFile,
  findLegislaturePage,
} from "./parlamento_pt.ts";
import { countSenators } from "./senat.ts";
import { countSenators as countItalianSenators } from "./senato.ts";
import { countSeats } from "./tweedekamer.ts";

/** key → seats, to compare readings regardless of order and labels. */
function bySeats(groups: SourceGroup[]): Record<string, number> {
  return Object.fromEntries(groups.map((group) => [group.key, group.seats]));
}

Deno.test("every failure to read a source names its URL", async () => {
  const url = "https://example.org/export.json";
  const answer = (response: () => Response) => {
    globalThis.fetch = () => Promise.resolve(response());
  };
  const realFetch = globalThis.fetch;
  const realPauses = RETRY.delaysMs;
  RETRY.delaysMs = [0, 0];
  try {
    answer(() => new Response('{"ok": true}'));
    assertEquals(await requestJson(url), { ok: true });

    // A bot-check page served with HTTP 200.
    answer(() => new Response("<!DOCTYPE html><title>Checking</title>"));
    await assertRejects(
      () => requestJson(url),
      Error,
      `${url} did not answer JSON (Unexpected token`,
    );

    answer(() => new Response("Forbidden", { status: 403 }));
    await assertRejects(
      () => requestJson(url),
      Error,
      `${url} answered HTTP 403`,
    );

    // The connection drops while the body is read.
    answer(() =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"rows": ['));
            controller.error(new TypeError("connection reset"));
          },
        }),
      )
    );
    await assertRejects(
      () => requestJson(url),
      Error,
      `${url} could not be read (connection reset)`,
    );
  } finally {
    globalThis.fetch = realFetch;
    RETRY.delaysMs = realPauses;
  }
});

Deno.test("a dropped connection is tried again, an answer or a timeout is not", async () => {
  const url = "https://example.org/export.json";
  const realFetch = globalThis.fetch;
  const realPauses = RETRY.delaysMs;
  RETRY.delaysMs = [0, 0];
  let calls = 0;
  const answerWith = (answer: () => Promise<Response>) => {
    calls = 0;
    globalThis.fetch = () => {
      calls++;
      return answer();
    };
  };
  const reset = () =>
    new Response(
      new ReadableStream({
        start: (controller) => controller.error(new TypeError("reset")),
      }),
    );

  try {
    // Cut twice, whole the third time: the last attempt allowed.
    answerWith(() =>
      calls < 3
        ? Promise.reject(new TypeError("fetch failed"))
        : Promise.resolve(new Response('{"ok": true}'))
    );
    assertEquals(await requestJson(url), { ok: true });
    assertEquals(calls, 3);

    // The body cut while it is read, then whole.
    answerWith(() =>
      Promise.resolve(calls === 1 ? reset() : new Response('{"ok": 1}'))
    );
    assertEquals(await requestJson(url), { ok: 1 });
    assertEquals(calls, 2);

    // Cut every time: out of attempts, and the error names the URL.
    answerWith(() => Promise.reject(new TypeError("fetch failed")));
    await assertRejects(
      () => requestJson(url),
      Error,
      `${url} could not be read (fetch failed)`,
    );
    assertEquals(calls, 3);

    // A refusal is the source's answer: asked once.
    answerWith(() => Promise.resolve(new Response("", { status: 403 })));
    await assertRejects(() => requestJson(url), Error, "answered HTTP 403");
    assertEquals(calls, 1);

    // A timeout is final too: trying again would only multiply the wait.
    answerWith(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError"))
    );
    await assertRejects(
      () => requestJson(url),
      Error,
      `${url} could not be read (no complete answer within 90 s)`,
    );
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    RETRY.delaysMs = realPauses;
  }
});

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

Deno.test("SPARQL endpoints: rows of plain values, and a refusal of anything else", async () => {
  const realFetch = globalThis.fetch;
  try {
    let requested = "";
    globalThis.fetch = (input) => {
      requested = String(input);
      return Promise.resolve(
        new Response(JSON.stringify({
          head: { vars: ["a", "b"] },
          results: {
            bindings: [{
              a: { type: "uri", value: "http://example.org/1" },
              b: { type: "literal", value: "x" },
            }, { a: { type: "uri", value: "http://example.org/2" } }],
          },
        })),
      );
    };
    assertEquals(
      await requestSparql("https://example.org/sparql", "SELECT ?a ?b"),
      [{ a: "http://example.org/1", b: "x" }, { a: "http://example.org/2" }],
    );
    assertEquals(
      new URL(requested).searchParams.get("query"),
      "SELECT ?a ?b",
    );

    // A firewall's page served with HTTP 200.
    globalThis.fetch = () => Promise.resolve(new Response("{}"));
    await assertRejects(
      () => requestSparql("https://example.org/sparql", "SELECT ?a"),
      Error,
      "https://example.org/sparql did not answer SPARQL results",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("dati.camera.it: deputies by group abbreviation, one group each", () => {
  assertEquals(
    bySeats(countItalianDeputies([
      { deputy: "d/1", code: "FDI" },
      { deputy: "d/2", code: "MISTO" },
      { deputy: "d/3", code: "FDI" },
    ])),
    { FDI: 2, MISTO: 1 },
  );
  // A deputy listed under two groups would be counted twice.
  assertThrows(() =>
    countItalianDeputies([
      { deputy: "d/1", code: "FDI" },
      { deputy: "d/1", code: "PD-IDP" },
    ])
  );
  assertThrows(() => countItalianDeputies([{ deputy: "d/1" }]));
});

Deno.test("dati.senato.it: senators by the number ending their group's URI", () => {
  assertEquals(
    countItalianSenators([
      { senator: "s/1", group: "http://dati.senato.it/gruppo/85", name: "FdI" },
      {
        senator: "s/2",
        group: "http://dati.senato.it/gruppo/9",
        name: "Misto",
      },
      { senator: "s/3", group: "http://dati.senato.it/gruppo/85", name: "FdI" },
    ]),
    [
      { key: "85", label: "FdI", seats: 2 },
      { key: "9", label: "Misto", seats: 1 },
    ],
  );
  assertThrows(() =>
    countItalianSenators([
      { senator: "s/1", group: "http://dati.senato.it/gruppo/85", name: "FdI" },
      {
        senator: "s/1",
        group: "http://dati.senato.it/gruppo/9",
        name: "Misto",
      },
    ])
  );
});

Deno.test("tweedekamer.nl: seat holders by the short name of their active faction", () => {
  const factions = [
    { Id: "f1", Afkorting: "D66", NaamNL: "Democraten 66" },
    { Id: "f2", Afkorting: "Lid Keijzer", NaamNL: "Lid Keijzer" },
  ];
  const holder = (id: string) => ({ FractieZetel: { Fractie_Id: id } });
  assertEquals(
    countSeats(factions, [holder("f1"), holder("f2"), holder("f1")]),
    [
      { key: "D66", label: "Democraten 66", seats: 2 },
      { key: "Lid Keijzer", label: "Lid Keijzer", seats: 1 },
    ],
  );
  // A seat of a faction that is not active, or of none.
  assertThrows(() => countSeats(factions, [holder("gone")]));
  assertThrows(() => countSeats(factions, [{ FractieZetel: null }]));
});

Deno.test("eerstekamer.nl: factions and their seats from the page's links", () => {
  const link = (slug: string, text: string) =>
    `<li><div><a href="/fractie/${slug}" class="grid-x"><div class="glyph"><svg><use></use></svg></div>${text}</a></div></li>`;
  assertEquals(
    parseFactions(
      '<a href="/fracties">Fracties</a><ul class="ladder">' +
        link("progressief_nederland_pro", "PRO (14 zetels)") +
        link("50plus", "50PLUS (1 zetel)") +
        link("beukering", "Fractie-Beukering (1 zetel)") +
        "</ul>",
    ),
    [
      { key: "progressief_nederland_pro", label: "PRO", seats: 14 },
      { key: "50plus", label: "50PLUS", seats: 1 },
      { key: "beukering", label: "Fractie-Beukering", seats: 1 },
    ],
  );
  assertThrows(() => parseFactions("<html></html>"));
  assertThrows(() => parseFactions(link("pro", "PRO (veel zetels)")));
});

Deno.test("parlamento.pt: the legislature's page and file, deputies who sit by their latest group", () => {
  const listing =
    '<a href="/Cidadania/Paginas/DAInformacaoBase.aspx?t=a&amp;Path=b%2Bc">XVII Legislatura</a>' +
    '<a href="/Cidadania/Paginas/DAInformacaoBase.aspx?t=d&amp;Path=e">XVI Legislatura</a>';
  assertEquals(
    findLegislaturePage(listing),
    "https://www.parlamento.pt/Cidadania/Paginas/DAInformacaoBase.aspx?t=a&Path=b%2Bc",
  );
  assertThrows(() => findLegislaturePage("<html></html>"));

  const page =
    '<a href="https://app.parlamento.pt/webutils/docs/doc.xml?path=x">InformacaoBaseXVII.xml</a>' +
    '<a href="https://app.parlamento.pt/webutils/docs/doc.txt?path=y%3D">InformacaoBaseXVII_json.txt</a>';
  assertEquals(
    findJsonFile(page),
    "https://app.parlamento.pt/webutils/docs/doc.txt?path=y%3D",
  );
  assertThrows(() => findJsonFile("<html></html>"));

  const deputy = (
    situation: string,
    end: string | null,
    ...groups: string[]
  ) => ({
    DepSituacao: [{ sioDes: situation, sioDtFim: end }],
    // The end date of a group is the day the file was made, whoever sits.
    DepGP: groups.map((gpSigla, index) => ({
      gpSigla,
      gpDtInicio: `2025-0${index + 1}-01`,
      gpDtFim: "2026-11-04",
    })),
  });
  assertEquals(
    countPortuguese({
      GruposParlamentares: [{ sigla: "PS", nome: "Partido Socialista" }],
      Deputados: [
        deputy("Efetivo", null, "PS"),
        deputy("Efetivo Temporário", null, "PSD", "PS"),
        deputy("Efetivo Definitivo", null, "PSD"),
        deputy("Suplente", null, "PSD"),
        deputy("Suspenso(Eleito)", null, "PSD"),
        deputy("Renunciou", "2026-01-01", "PSD"),
        deputy("Efetivo", "2026-01-01", "PSD"),
      ],
    }),
    [
      { key: "PS", label: "Partido Socialista", seats: 2 },
      { key: "PSD", label: "no group", seats: 1 },
    ],
  );
  assertThrows(() => countPortuguese({} as never));
});

/** A one-file ZIP archive, as the Bundestag's: `content` stored or deflated. */
async function zip(name: string, content: string, deflate: boolean) {
  const raw = new TextEncoder().encode(content);
  const data = deflate
    ? new Uint8Array(
      await new Response(
        new Blob([raw]).stream().pipeThrough(
          new CompressionStream("deflate-raw"),
        ),
      ).arrayBuffer(),
    )
    : raw;
  const fileName = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + fileName.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(8, deflate ? 8 : 0, true);
  localView.setUint32(18, data.length, true);
  localView.setUint32(22, raw.length, true);
  localView.setUint16(26, fileName.length, true);
  local.set(fileName, 30);

  const central = new Uint8Array(46 + fileName.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(10, deflate ? 8 : 0, true);
  centralView.setUint32(20, data.length, true);
  centralView.setUint32(24, raw.length, true);
  centralView.setUint16(28, fileName.length, true);
  centralView.setUint32(42, 0, true);
  central.set(fileName, 46);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length + data.length, true);

  return Uint8Array.from([...local, ...data, ...central, ...end]);
}

Deno.test("bundestag.de: the archive's link, the file in it, members by Fraktion", async () => {
  assertEquals(
    findArchiveUrl('<a href="/resource/blob/472878/MdB-Stammdaten.zip">'),
    "https://www.bundestag.de/resource/blob/472878/MdB-Stammdaten.zip",
  );
  assertThrows(() => findArchiveUrl("<html></html>"));

  for (const deflate of [false, true]) {
    const archive = await zip("DATA/MDB.XML", "<a>Fraktion äöü</a>", deflate);
    assertEquals(
      new TextDecoder().decode(await unzip(archive, (n) => n.endsWith(".XML"))),
      "<a>Fraktion äöü</a>",
    );
    await assertRejects(() => unzip(archive, (n) => n.endsWith(".DTD")));
  }
  await assertRejects(() => unzip(new Uint8Array(40), () => true));

  const term = (
    wp: number,
    end: string,
    ...groups: [string, string][]
  ) =>
    `<WAHLPERIODE><WP>${wp}</WP><MDBWP_VON>01.01.2000</MDBWP_VON>` +
    (end ? `<MDBWP_BIS>${end}</MDBWP_BIS>` : "<MDBWP_BIS/>") +
    "<INSTITUTIONEN>" +
    groups.map(([kind, name]) =>
      `<INSTITUTION><INSART_LANG>${kind}</INSART_LANG><INS_LANG>${name}</INS_LANG>` +
      (kind === "Fraktion/Gruppe" && name.startsWith("Alt")
        ? "<MDBINS_BIS>01.02.2020</MDBINS_BIS>"
        : "<MDBINS_BIS/>") +
      "</INSTITUTION>"
    ).join("") +
    "</INSTITUTIONEN></WAHLPERIODE>";
  const member = (...terms: string[]) =>
    `<MDB><ID>1</ID><WAHLPERIODEN>${terms.join("")}</WAHLPERIODEN></MDB>`;
  const fraktion = (
    name: string,
  ): [string, string] => ["Fraktion/Gruppe", name];

  const xml = "<DOCUMENT>" +
    // Sits in the latest legislature (2), the Fraktion listed twice.
    member(
      term(1, "01.01.2005", fraktion("Fraktion A")),
      term(
        2,
        "",
        fraktion("Fraktion B"),
        fraktion("Fraktion B"),
        ["Ausschuss", "Ausschuss X"],
      ),
    ) +
    // Changed Fraktion during the term: only the open membership counts.
    member(term(2, "", fraktion("Alt"), fraktion("Fraktionslos"))) +
    // Left, or sat in a past legislature only.
    member(term(2, "05.06.2025", fraktion("Fraktion B"))) +
    member(term(1, "", fraktion("Fraktion A"))) +
    "</DOCUMENT>";
  assertEquals(bySeats(countBundestag(xml)), {
    "Fraktion B": 1,
    "Fraktionslos": 1,
  });

  assertThrows(() => countBundestag("<DOCUMENT></DOCUMENT>"));
  assertThrows(() =>
    countBundestag(
      "<DOCUMENT>" +
        member(term(2, "", fraktion("Fraktion A"), fraktion("Fraktion B"))) +
        "</DOCUMENT>",
    )
  );
});
