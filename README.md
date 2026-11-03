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
schema/               JSON Schemas for those three kinds of file
scripts/validate.ts   the checks CI runs on every change
```

A chamber file, abridged:

```yaml
name: National Assembly
name_local: Assemblée Nationale
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
  - id: liot
    name: Libertés, Indépendants, Outre-mer et Territoires
    abbreviation: LIOT
    color: "#FFD96F"
    seats: 23
    parties: [] # not tied to any party
```

A few rules hold everywhere:

- **Seats belong to parliamentary groups, not to parties.** A group lists the parties it is made of: several (the Swiss UDC group gathers four), one, or none (non-attached members). Parties are linked to other datasets through their [Party Facts](https://partyfacts.herokuapp.com/) id, and through their Chapel Hill Expert Survey id when they have one.
- **Ids never change once published.** A renamed group keeps its id; a new group gets a new one. Downstream users rely on them to follow a group over time.
- **A chamber adds up.** Its groups' seats plus `vacant` equal `seats`.
- **Every chamber names its source**, and every source records its licence or terms of use.

## Status

The files were exported on 2026-11-03 from the database they used to live in. Nothing updates them automatically yet: fetchers reading each parliament's open data come next.

## Checking the data

CI validates every pull request and reports problems as annotations on the offending lines. To run the same checks locally, install [Deno](https://deno.com/) 2, then:

```sh
deno task validate   # the data
deno task test       # the validator's own tests
deno task check      # formatting, lint and types of the scripts
```

Each data file starts with a `# yaml-language-server: $schema=…` comment: editors with YAML language support (such as the YAML extension for VS Code) use it for completion, inline documentation and errors as you type.

## Licences

Seat counts are reused under the terms of their source, recorded with each source in `data/sources.yaml` (`license`, `license_url`). Reusing them means following those terms, including the credit a source prescribes (`name`).

## Contributing

Corrections and new chambers are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
