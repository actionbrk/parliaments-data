# Contributing

Corrections and new chambers are welcome as pull requests. CI checks every pull request and points at the lines that need fixing; a maintainer then reviews the numbers against the source before merging.

## Ground rules

- **Use an official source.** Seat counts come from the parliament itself: its open-data portal or API when it has one, its website otherwise. Do not copy them from Wikipedia or other aggregators: they cannot be checked against the parliament, and their licences may not allow reuse here.
- **Record the source's terms.** Every entry in `data/sources.yaml` carries the licence or terms of use the data is published under. A source whose terms forbid reuse cannot be used.
- **Never change an id.** Ids (`id` fields) are how the data is followed over time. A renamed group keeps its id; a new group gets a new one.
- **Link your evidence.** Say in the pull request where you checked the numbers, with a link.

## Updating a chamber

1. Edit the groups' `seats` in `data/<iso3>/<chamber>.yaml`. Add a group that appeared, remove one that was dissolved.
2. Keep the total right: the groups' seats plus `vacant` (seats nobody holds right now) must equal `seats`.
3. Set `updated` to the date the composition changed.

## Adding a chamber

1. **The source.** If it is not in `data/sources.yaml` yet, add it:
   - `id`: a short lowercase name, e.g. `senado-opendata`;
   - `name`: shown as the credit next to the seats. If the source prescribes how to credit it, use that wording verbatim;
   - `url`: the dataset or page the numbers are read from;
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
       partyfacts_id: 441
       ches_id: 502
   ```

   - `id`: the abbreviation in lowercase ASCII, words joined by hyphens (`EH Bildu` → `eh-bildu`, `ÖVP` → `oevp`);
   - `partyfacts_id`: look the party up on [Party Facts](https://partyfacts.herokuapp.com/). Leave it out if the party is not there;
   - `ches_id`: the party's `party_id` in the [Chapel Hill Expert Survey](https://www.chesdata.eu/), if it is covered.
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
   ```

   - group `id`: built like party ids, from the group's abbreviation;
   - `color`: the colour the group is usually shown in, as `#RRGGBB`;
   - `parties`: the ids, from `country.yaml`, of the parties the group is made of. Use `[]` for a group tied to no party, such as non-attached members.

## Checking locally

CI runs the checks for you, so this is optional. With [Deno](https://deno.com/) 2 installed:

```sh
deno task validate
```
