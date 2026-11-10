# Contributing

Corrections and new chambers are welcome as pull requests. CI checks every pull request and points at the lines that need fixing; a maintainer then reviews the numbers against the source before merging.

## Ground rules

- **Use an official source.** Seat counts come from the parliament itself: its open-data portal or API when it has one, its website otherwise. Do not copy them from Wikipedia or other aggregators: they cannot be checked against the parliament, and their licences may not allow reuse here.
- **Record the source's terms.** Every entry in `data/sources.yaml` carries the licence or terms of use the data is published under. A source whose terms forbid reuse cannot be used.
- **Never change an id.** Ids (`id` fields) are how the data is followed over time. A renamed group keeps its id; a new group gets a new one.
- **Link your evidence.** Say in the pull request where you checked the numbers, with a link.
- **Licensing.** By contributing, you agree that your contribution is published under this repository's licences: CC BY 4.0 for data (see [LICENSE-DATA.md](LICENSE-DATA.md)), MIT for code (see [LICENSE](LICENSE)).

## Updating a chamber

Chambers with a fetcher (`scripts/fetchers/mod.ts`) get a pull request on their own whenever their source changes: see [Updates](README.md#updates). By hand:

1. Edit the groups' `seats` in `data/<iso3>/<chamber>.yaml`. Add a group that appeared, remove one that was dissolved.
2. Keep the total right: the groups' seats plus `vacant` (seats nobody holds right now) must equal `seats`.
3. Set `updated` to the date the composition changed.

## Adding a chamber

1. **The source.** If it is not in `data/sources.yaml` yet, add it:
   - `id`: a short lowercase name, e.g. `senado-opendata`;
   - `name`: shown as the credit next to the seats. If the source prescribes how to credit it, use that wording verbatim;
   - `url`: the dataset or page the numbers are read from, as an `https://` (or `http://`) address;
   - `citation` (optional): what the source is and how the seat counts are derived from it;
   - `license` and `license_url`: the terms the data is published under.
2. **The country.** If `data/<iso3>/` does not exist yet, create it, named after the country's lowercase [ISO 3166-1 alpha-3](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-3) code, with a `country.yaml`:

   ```yaml
   # yaml-language-server: $schema=../../schema/country.schema.json
   name: Spain
   parties:
     - id: pp
       name: Partido Popular
       abbreviation: PP
       color: "#1D84CE"
       partyfacts_id: 441
   ```

   - `id`: the abbreviation in lowercase ASCII, words joined by hyphens (`EH Bildu` → `eh-bildu`, `ÖVP` → `oevp`);
   - `color`: the party's colour, as `#RRGGBB`, taken from its [Wikidata](https://www.wikidata.org/) item's "sRGB colour hex triplet" ([P465](https://www.wikidata.org/wiki/Property:P465)), the preferred one when there are several. Wikidata is CC0, so its colours can be reused here. If it gives the party none, use the colour of the group the party alone makes up and say so in a comment above the party;
   - `partyfacts_id`: look the party up on [Party Facts](https://partyfacts.herokuapp.com/). Leave it out if the party is not there. It is the party's only link to other datasets (expert surveys and the like): Party Facts maps it to their ids, so do not add those ids here.
3. **The chamber.** Create `lower.yaml` and `upper.yaml`, or `unicameral.yaml` for a single-chamber parliament:

   ```yaml
   # yaml-language-server: $schema=../../schema/chamber.schema.json
   name: Congress of Deputies # in English
   name_local: Congreso de los Diputados
   seats: 350 # all seats, vacant ones included
   source: congreso-opendata
   updated: 2026-08-11
   groups:
     - id: pp
       name: Grupo Parlamentario Popular en el Congreso # official name, in the chamber's language
       abbreviation: PP
       color: "#1D84CE"
       seats: 137
       parties: [pp]
       parties_source: https://www.congreso.es/es/opendata/diputados
   ```

   - group `id`: built like party ids, from the group's abbreviation;
   - `color`: the colour the group is usually shown in, as `#RRGGBB`;
   - `parties`: the ids, from `country.yaml`, of the parties the group is made of. Use `[]` for a group tied to no party, such as non-attached members. See [Linking a group to its parties](#linking-a-group-to-its-parties);
   - `parties_source`: where that link can be checked, required as soon as `parties` lists a party.
4. **Its fetcher** (optional), when the source can be read by a program: a module in `scripts/fetchers/`, named after the source's id, that reads the seat counts and maps each of the source's group keys (a code, or the group's name) to the group's id, registered in `scripts/fetchers/mod.ts`. The tests check that it reaches every group of the chamber file. The daily fetch then keeps the chamber up to date.

## Linking a group to its parties

Seats are known per group only, so whoever uses the data counts a group's seats for the parties it lists, together. A party listed with no member in the group, or a large one left out, skews every chart built on them.

- **Check the members, not the name.** Every party listed has members in the group, and no party that a sizeable share of the group belongs to is missing. A group's name records the alliance it was formed by and can outlive it: the Italian Senate's _Lega Salvini Premier - Partito Sardo d'Azione_ has no member of the Partito Sardo d'Azione.
- **Small parties.** A party with a member or two may be listed when it sits in the group as such: the parliament records it among the group's members' parties (the Swiss Federal Assembly gives each member's), the group bears its name, or it is a national party whose members sit there by agreement. Leave out local parties sitting with a group through a member or two.
- **Funding declarations.** Where members declare the party they attach to for public funding (France), some attach to an umbrella that does not tell its parties apart (_Ensemble !_) or to another party's vehicle for convenience. Read the declarations alongside what the group says of itself, and say in a comment how they were read.
- **No party.** Non-attached members, and groups whose members come from parties none of which makes up the group (France's LIOT, mixed groups), list `[]`. A comment can say whose members they are, so that nobody adds them back.
- **The source.** `parties_source` is, by preference: a record of the members' parties kept by the parliament (its open data, the declarations of party attachment); the group's or the parties' own page; a secondary source such as Wikipedia, when neither exists or they don't settle it. Give the address that shows the most of the link, and say in a comment above the group what it doesn't show. Wikipedia is fine here, unlike for seat counts: the links are this repository's own data, and the address is there to check them.
- **Check them again** when a chamber is elected or renewed, and when a group appears: parliaments publish their members' parties later than their groups' seats (the French Senate's declarations come out each December).

## Checking locally

CI runs the checks for you, so this is optional. With [Deno](https://deno.com/) 2 installed:

```sh
deno task validate
```
