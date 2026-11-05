/**
 * Germany's Bundestag, from the Bundestag's open data (source
 * bundestag-opendata): the master data of every member since 1949
 * (MdB-Stammdaten), an XML file in a ZIP archive. The Bundestag publishes a
 * new version from time to time, not daily, so the counts follow its pace.
 */
import {
  type Fetcher,
  requestBytes,
  requestText,
  type SourceGroup,
  tally,
} from "./fetcher.ts";

const OPEN_DATA_URL = "https://www.bundestag.de/services/opendata";

/** The archive's address changes with each version: it is found on this page. */
export function findArchiveUrl(html: string): string {
  const match = html.match(/href="([^"]*MdB-Stammdaten\.zip)"/);
  if (!match) {
    throw new Error(`no MdB-Stammdaten.zip is linked from ${OPEN_DATA_URL}`);
  }
  return new URL(match[1], OPEN_DATA_URL).href;
}

/**
 * The content of the first file in a ZIP archive whose name satisfies `wanted`.
 * Only what the Bundestag's archive uses is supported: files stored or
 * deflated, no encryption, no ZIP64.
 */
export async function unzip(
  archive: Uint8Array,
  wanted: (name: string) => boolean,
): Promise<Uint8Array> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.length);

  // The end-of-central-directory record is the last 22 bytes, plus a comment.
  let end = archive.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a ZIP archive");

  let offset = view.getUint32(end + 16, true);
  for (let entries = view.getUint16(end + 10, true); entries > 0; entries--) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("corrupt ZIP archive: bad central directory");
    }
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(
      archive.subarray(offset + 46, offset + 46 + nameLength),
    );
    offset += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;

    if (view.getUint32(local, true) !== 0x04034b50) {
      throw new Error("corrupt ZIP archive: bad local header");
    }
    const start = local + 30 + view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    const data = archive.subarray(start, start + size);
    if (method === 0) return data;
    if (method !== 8) throw new Error(`ZIP compression method ${method}`);
    const inflated = new Blob([data as BlobPart]).stream().pipeThrough(
      new DecompressionStream("deflate-raw"),
    );
    return new Uint8Array(await new Response(inflated).arrayBuffer());
  }
  throw new Error("the archive holds no matching file");
}

/** The text of the first <tag> in `xml`, "" for an empty or missing one. */
function text(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1].trim() ?? "";
}

function blocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))]
    .map((match) => match[1]);
}

/**
 * Seats per Fraktion (or Gruppe), keyed by its name: one per member whose
 * mandate in the latest legislature has no end date. The file holds every
 * member since 1949; the latest legislature is the highest number in it.
 *
 * A member has one Fraktion at a time, but the file may repeat it. Two
 * different open ones is an error.
 */
export function countMembers(xml: string): SourceGroup[] {
  const terms = blocks(xml, "MDB").map((member) =>
    blocks(member, "WAHLPERIODE").map((term) => ({
      number: Number(text(term, "WP")),
      open: text(term, "MDBWP_BIS") === "",
      groups: [
        ...new Set(
          blocks(term, "INSTITUTION")
            .filter((institution) =>
              text(institution, "INSART_LANG") === "Fraktion/Gruppe" &&
              text(institution, "MDBINS_BIS") === ""
            )
            .map((institution) => text(institution, "INS_LANG")),
        ),
      ],
    }))
  );

  const latest = Math.max(0, ...terms.flat().map((term) => term.number));
  if (latest === 0) throw new Error("unexpected file: no legislature found");

  const sitting = terms.flatMap((memberTerms) =>
    memberTerms.filter((term) => term.number === latest && term.open)
  );
  return tally(
    sitting,
    (term) => {
      if (term.groups.length > 1) {
        throw new Error(
          `unexpected file: a member sits in ${term.groups.length} Fraktionen at once (${
            term.groups.join(", ")
          })`,
        );
      }
      return term.groups[0] ?? "";
    },
    (term) => term.groups[0] ?? "no Fraktion",
  );
}

export const bundestag: Fetcher = {
  source: "bundestag-opendata",
  groups: {
    "Fraktion der Christlich Demokratischen Union/Christlich - Sozialen Union":
      "cducsu",
    "Fraktion Alternative für Deutschland": "afd",
    "Fraktion der Sozialdemokratischen Partei Deutschlands": "spd",
    "Fraktion BÜNDNIS 90/DIE GRÜNEN": "gruene",
    "Fraktion Die Linke": "linke",
    Fraktionslos: "fraktionslos",
  },
  async read() {
    const archive = await requestBytes(
      findArchiveUrl(await requestText(OPEN_DATA_URL)),
    );
    const file = await unzip(archive, (name) => name.endsWith(".XML"));
    return countMembers(new TextDecoder().decode(file));
  },
};
