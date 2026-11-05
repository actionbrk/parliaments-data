/**
 * Portugal's Assembly of the Republic, from the Assembly's open data (source
 * parlamento-pt-opendata): the "Informação Base" JSON file of the current
 * legislature, which lists every deputy who sat in it, substitutes included,
 * with their situation and groups over time.
 */
import {
  type Fetcher,
  requestJson,
  requestText,
  type SourceGroup,
  tally,
} from "./fetcher.ts";

const ORIGIN = "https://www.parlamento.pt";

/**
 * The page listing the legislatures' files, newest first. The files' own
 * addresses carry encrypted tokens, so they are found from here: the page of
 * the first legislature, then the JSON file linked from it.
 */
const LISTING_URL = `${ORIGIN}/Cidadania/Paginas/DAInformacaoBase.aspx`;

/** The situations (sioDes) of a deputy who sits, as opposed to a substitute. */
const SITTING = ["Efetivo", "Efetivo Temporário", "Efetivo Definitivo"];

interface Situation {
  sioDes: string;
  sioDtFim: string | null;
}

interface Membership {
  gpSigla: string;
  gpDtInicio: string;
}

export interface Deputy {
  DepSituacao: Situation[] | null;
  DepGP: Membership[] | null;
}

export interface BaseInformation {
  Deputados: Deputy[];
  GruposParlamentares?: { sigla: string; nome: string }[];
}

function decodeEntities(value: string): string {
  return value.replaceAll("&amp;", "&");
}

/** The address of the first link whose text is `text`. */
function findLink(html: string, text: RegExp, what: string): string {
  for (
    const link of html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)
  ) {
    if (text.test(link[2].replace(/<[^>]*>/g, "").trim())) {
      return new URL(decodeEntities(link[1]), LISTING_URL).href;
    }
  }
  throw new Error(`no ${what} is linked from ${LISTING_URL}`);
}

/** The page of the current (first listed) legislature, from the listing. */
export function findLegislaturePage(html: string): string {
  return findLink(html, /^[IVXL]+ Legislatura$/, "legislature");
}

/** The JSON file of a legislature, from its page. */
export function findJsonFile(html: string): string {
  return findLink(html, /^InformacaoBase\w*_json\.txt$/, "JSON file");
}

/**
 * Seats per group, keyed by its abbreviation (sigla): one per deputy sitting
 * now, in the group they joined last. The end date of a membership is no
 * guide, since the file sets it to the day it was generated for everyone.
 */
export function countDeputies(data: BaseInformation): SourceGroup[] {
  if (!Array.isArray(data?.Deputados)) {
    throw new Error('unexpected file: no "Deputados" list');
  }
  const names = new Map(
    (data.GruposParlamentares ?? []).map((group) => [group.sigla, group.nome]),
  );

  const sitting = data.Deputados.filter((deputy) =>
    (deputy.DepSituacao ?? []).some((situation) =>
      !situation.sioDtFim && SITTING.includes(situation.sioDes)
    )
  );
  return tally(
    sitting,
    (deputy) => latestGroup(deputy) ?? "",
    (deputy) => names.get(latestGroup(deputy) ?? "") ?? "no group",
  );
}

function latestGroup(deputy: Deputy): string | undefined {
  const memberships = [...(deputy.DepGP ?? [])].sort((a, b) =>
    a.gpDtInicio < b.gpDtInicio ? -1 : a.gpDtInicio > b.gpDtInicio ? 1 : 0
  );
  return memberships.at(-1)?.gpSigla;
}

export const parlamentoPt: Fetcher = {
  source: "parlamento-pt-opendata",
  groups: {
    PSD: "psd",
    CH: "ch",
    PS: "ps",
    IL: "il",
    L: "l",
    PCP: "pcp",
    "CDS-PP": "cds-pp",
    BE: "be",
    PAN: "pan",
    JPP: "jpp",
  },
  async read() {
    const page = findLegislaturePage(await requestText(LISTING_URL));
    const file = findJsonFile(await requestText(page));
    return countDeputies(await requestJson(file) as BaseInformation);
  },
};
