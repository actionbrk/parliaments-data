# parliaments-data

Open, versioned data on the composition of national parliaments: how many seats each parliamentary group holds in each chamber, which parties those groups are made of, and where the numbers come from.

Every change is a commit, so the history of a chamber is the history of its file: `git log -p data/fra/lower.yaml`.

## Layout

```
data/
  sources.yaml        where seat counts come from, with each source's licence
  <iso3>/             one directory per country, named after its lowercase ISO 3166-1 alpha-3 code
    country.yaml      the country and the parties its groups are made of
    lower.yaml        the lower chamber  ┐
    upper.yaml        the upper chamber  ┘ or unicameral.yaml for a single-chamber parliament
schema/               JSON Schemas for those three kinds of file, and the formats they share
scripts/validate.ts   the checks CI runs on every change
scripts/build.ts      builds the published JSON document and its landing page
scripts/fetch.ts      reads the chambers' seat counts from their sources, through
scripts/fetchers/     one module per source
scripts/propose.sh    proposes what the daily fetch changed as a pull request
```

A chamber file, abridged:

```yaml
name: National Assembly
name_local: Assemblée nationale
seats: 577
source: datan # an id from data/sources.yaml
updated: 2026-09-28 # when these seat counts last changed
groups:
  - id: soc
    name: Socialistes et apparentés
    abbreviation: SOC
    color: "#F5B4CE"
    seats: 67
    parties: [ps, pp] # ids from data/fra/country.yaml
    parties_source: https://data.assemblee-nationale.fr/acteurs/deputes-en-exercice # where that can be checked
  - id: liot
    name: Libertés, Indépendants, Outre-mer et Territoires
    abbreviation: LIOT
    color: "#FFD96F"
    seats: 23
    parties: [] # not tied to any party
```

A few rules hold everywhere:

- **Seats belong to parliamentary groups, not to parties.** A group lists the parties it is made of: several (the Swiss UDC group gathers four), one, or none (non-attached members). Parties are linked to other datasets through their [Party Facts](https://partyfacts.herokuapp.com/) id alone: Party Facts maps it to the ids of expert surveys, election datasets and the like.
- **Every link between a group and its parties names its source.** A group tied to parties gives, in `parties_source`, the address where that can be checked: a record of its members' parties where the parliament keeps one, else the group's or the parties' own page, else a secondary source. A comment above the group says what the address alone doesn't show.
- **Groups and parties each have a colour.** A group's colour draws its seats; a party's, taken from [Wikidata](https://www.wikidata.org/wiki/Property:P465), shows the party on its own: on a chart of party positions, say, or within a group that gathers several.
- **Ids never change once published.** A renamed group keeps its id; a new group gets a new one. Downstream users rely on them to follow a group over time.
- **A chamber adds up.** Its groups' seats plus `vacant` equal `seats`.
- **Every chamber names its source**, and every source records its licence or terms of use.

## Using the data

Every change merged into `main` is validated, then published as a single JSON document:

**https://actionbrk.github.io/parliaments-data/v1/parliaments.json**

```
{
  "version": 1,                         format version, also in the URL
  "commit": "4f7cb2e…",                 the commit of this repository it was built from
  "generated_at": "2026-11-03T14:32:00.000Z",
  "sources": [ … ],                     as in data/sources.yaml
  "countries": [
    {
      "code": "fra",                    the country's directory
      "name": "France",
      "parties": [ … ],                 as in its country.yaml
      "chambers": [
        {
          "type": "lower",              the chamber's file name
          "name": "National Assembly",
          "seats": 577,
          "vacant": 0,                  always present, 0 when the file leaves it out
          "groups": [ … ],              as in the chamber file
          …
        }
      ]
    }
  ]
}
```

Fields are named as in the YAML files. Within `/v1/`, fields are only ever added: removing one or changing its meaning publishes a `/v2/` next to it. To know whether anything changed since you last read it, compare `commit`. GitHub Pages may take about ten minutes to serve a new version after a merge.

## Updates

Every day, the [Fetch](.github/workflows/fetch.yml) workflow reads each chamber's seat counts from its source, the parliament's open data, and proposes any change as a pull request: one per chamber, titled after it, from the branch `fetch/<country>-<chamber>`, for a maintainer to check against the source and merge. Until then, the pull request follows the source: a later change replaces its commit, and a source back to the counts on `main` closes it, labelled `fetch: withdrawn`. Counts turned down by closing a pull request without merging are not proposed again, whatever else changes in the file; labelling that pull request `fetch: withdrawn` lets them be proposed again. A pull request someone else pushed to is left alone.

Only seats change that way: each group's `seats`, `vacant`, and `updated`, set to the day the new counts were read. A group left with no member is removed from the file; its key stays in the fetcher, so that if the source reports members for it again, the run stops until a person adds the group back. A group the source reports but the chamber file doesn't list stops that chamber's run too, as does a reading leaving more than a tenth of the chamber vacant, more than the file records (a truncated export, a dissolved chamber): both need a person, to add the group with its id, colour, parties and their source, or to judge the reading. If it is right, write its counts into the file by hand, `vacant` included: later readings with no more vacancies then go through. The run fails and says why; the other chambers carry on.

The workflow opens pull requests with its own token, which the repository has to allow: Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests".

## Checking the data

CI validates every pull request and reports problems as annotations on the offending lines. To run the same checks locally, install [Deno](https://deno.com/) 2, then:

```sh
deno task validate   # the data
deno task build      # dist/: the JSON document and its landing page, as published
deno task test       # the scripts' own tests
deno task check      # formatting, lint and types of the scripts
deno task fetch      # rewrite data/ with the sources' current seat counts (or: deno task fetch fra/upper)
```

Each data file starts with a `# yaml-language-server: $schema=…` comment: editors with YAML language support (such as the YAML extension for VS Code) use it for completion, inline documentation and errors as you type.

## Licences

- **Seat counts** stay under the terms of the source they come from, recorded with each source in `data/sources.yaml` (`license`, `license_url`). Reusing them means following those terms, including the credit a source prescribes (`name`).
- **The rest of `data/`**, i.e. which parties each group is made of, the party list and its links to other datasets, colours and ids, is under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): see [LICENSE-DATA.md](LICENSE-DATA.md).
- **The code** (`scripts/`, `schema/`, `.github/`) is under the [MIT licence](LICENSE).

## Contributing

Corrections and new chambers are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
