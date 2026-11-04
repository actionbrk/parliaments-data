#!/usr/bin/env bash
# Proposes what `deno task fetch <chamber>` changed as that chamber's pull
# request. .github/workflows/fetch.yml runs it from a checkout of main, with
# the fetched chamber file in the working tree:
#
#   scripts/propose.sh fra/upper report.md
#
# report.md is what the fetch printed: the pull request's title on its first
# line, its body after a blank line; empty when nothing changed. GH_TOKEN must
# be allowed to push, to write pull requests and to dispatch workflows.
#
# Each chamber has one branch, fetch/<country>-<chamber> (fetch/fra-upper),
# and at most one pull request open from it, always showing the latest
# reading. Readings are compared on their seat counts alone (fetch.ts
# --counts), whatever else differs in the file:
#
# - nothing changed: close the open pull request, if any, labelled
#   "fetch: withdrawn". The source is back to the counts on main, so there is
#   nothing left to propose; the label says the counts weren't turned down.
# - the open pull request already proposes these counts: leave it.
# - a pull request closed without merging, and without that label, proposed
#   these counts: they were turned down; don't propose them again. Labelling
#   it "fetch: withdrawn" lets them be proposed again.
# - the open pull request proposes other counts: replace its commit with one
#   holding the new counts, on top of the current main. Unless someone else
#   pushed to it: it is theirs then, and only gets a warning in the run.
# - otherwise: open a pull request.
#
# Only this repository's pull requests count: gh matches a branch by its name
# alone, so a fork's branch of the same name is set aside. The open pull
# request is this workflow's while the commit its branch ends with is one the
# workflow committed; any other push (a maintainer's fix, an amended or
# rebased commit, an edit on GitHub) makes it someone else's. Anything gh
# fails to answer stops the run before it changes anything.
#
# Pushes made with the workflow's GITHUB_TOKEN don't trigger other workflows,
# so Validate is dispatched on the branch: its checks then show on the pull
# request like on any other.
set -euo pipefail
shopt -s inherit_errexit

chamber=$1
report=$2
file="data/$chamber.yaml"
branch="fetch/${chamber//\//-}"
base=$(git branch --show-current)
scripts=$(dirname "${BASH_SOURCE[0]}")
bot_name="github-actions[bot]"
bot_email="41898282+github-actions[bot]@users.noreply.github.com"
withdrawn="fetch: withdrawn"

# The seat counts of the chamber file on stdin, as one line to compare.
counts() { deno task --quiet --config "$scripts/../deno.json" fetch --counts; }

# This repository's pull requests from the branch, newest first.
prs=$(gh pr list --head "$branch" --base "$base" --state all --limit 1000 \
  --json number,state,isCrossRepository,labels)
prs=$(jq --compact-output '[.[] | select(.isCrossRepository | not)]' <<<"$prs")
open=$(jq --raw-output \
  'first(.[] | select(.state == "OPEN") | .number) // empty' <<<"$prs")
turned_down=$(jq --raw-output --arg withdrawn "$withdrawn" \
  '.[] | select(.state == "CLOSED" and all(.labels[]; .name != $withdrawn))
       | .number' <<<"$prs")

# What the open and the turned-down pull requests proposed, as
# refs/proposals/<number>. The open one is read from its branch, which a push
# moves at once, unlike refs/pull/<number>/head.
refspecs=()
for number in $turned_down; do
  refspecs+=("+refs/pull/$number/head:refs/proposals/$number")
done
if [ -n "$open" ]; then refspecs+=("+refs/heads/$branch:refs/proposals/$open"); fi
if [ ${#refspecs[@]} -gt 0 ]; then
  git fetch --quiet --no-tags --depth=1 origin "${refspecs[@]}"
fi

# Whether the open pull request is still this workflow's, and the commit its
# branch ends with.
owned=false
head=""
if [ -n "$open" ]; then
  head=$(git rev-parse "refs/proposals/$open")
  committer=$(git log -1 --format=%ce "$head")
  if [ "$committer" = "$bot_email" ]; then owned=true; fi
fi

if git diff --quiet -- "$file"; then
  if [ -n "$open" ]; then
    if [ "$owned" = true ]; then
      gh label create "$withdrawn" --force --color ededed --description \
        "Closed by the daily fetch, the source being back to the counts on main: not turned down"
      gh pr edit "$open" --add-label "$withdrawn"
      gh pr close "$open" --delete-branch --comment \
        "The source is back to the seat counts on \`$base\`: nothing left to propose."
    else
      echo "::warning::The source is back to the counts on $base, but #$open has commits from someone else: leaving it open."
    fi
  fi
  exit 0
fi

reading=$(counts <"$file")
proposed() {
  # A pull request someone made from the branch may not hold the file.
  if git cat-file -e "refs/proposals/$1:$file" 2>/dev/null; then
    git show "refs/proposals/$1:$file" | counts
  fi
}

if [ -n "$open" ]; then
  proposal=$(proposed "$open")
  if [ "$proposal" = "$reading" ]; then
    echo "#$open already proposes these seat counts."
    exit 0
  fi
fi

for number in $turned_down; do
  proposal=$(proposed "$number")
  if [ "$proposal" = "$reading" ]; then
    echo "::notice::#$number proposed these seat counts and was closed without merging: not proposing them again. Label it \"$withdrawn\" to have them proposed."
    exit 0
  fi
done

if [ -n "$open" ] && [ "$owned" != true ]; then
  echo "::warning::The source reports new seat counts, but #$open has commits from someone else: leaving it as it is."
  exit 0
fi

title=$(head -n 1 "$report")
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

git config user.name "$bot_name"
git config user.email "$bot_email"
git switch --quiet --force-create "$branch"
git commit --quiet --message "$title" -- "$file"

body="$(tail -n +3 "$report")

---

Read by the [daily fetch]($run_url) on $(date -u +%Y-%m-%d). Check the counts against the source before merging. Until then, later readings update this pull request, unless someone else pushes to it; closing it without merging keeps these counts from being proposed again."

if [ -n "$open" ]; then
  # The description first: should the push fail, the branch still ends with
  # this workflow's commit, and the next run tries again.
  gh pr edit "$open" --title "$title" --body "$body"
  # Only over the commit read above: a push since then makes it someone else's.
  git push --quiet --force-with-lease="refs/heads/$branch:$head" \
    origin "$branch"
  echo "Updated #$open."
else
  git push --quiet --force origin "$branch"
  gh pr create --base "$base" --head "$branch" --title "$title" --body "$body"
fi

gh workflow run validate.yml --ref "$branch"
