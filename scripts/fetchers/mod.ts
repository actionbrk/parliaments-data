/**
 * The chambers read automatically, each under the path of its file in data/
 * without the extension ("fra/upper" for data/fra/upper.yaml).
 *
 * The modules are named after the source they read (its id in
 * data/sources.yaml), since one source can serve several chambers.
 */
import { congreso } from "./congreso.ts";
import { datan } from "./datan.ts";
import type { Fetcher } from "./fetcher.ts";
import { parlamentAt } from "./parlament_at.ts";
import { parlamentCh } from "./parlament_ch.ts";
import { senat } from "./senat.ts";

export type { Fetcher, SourceGroup } from "./fetcher.ts";

export const FETCHERS: Readonly<Record<string, Fetcher>> = {
  "aut/lower": parlamentAt("NR"),
  "aut/upper": parlamentAt("BR"),
  "che/lower": parlamentCh(1),
  "che/upper": parlamentCh(2),
  "esp/lower": congreso,
  "fra/lower": datan,
  "fra/upper": senat,
};
