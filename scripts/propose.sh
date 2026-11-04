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
# reading:
#
# - nothing changed: close the open pull request, if any. The source is back
#   to the counts on main, so there is nothing left to propose.
# - the open pull request already proposes these counts: leave it.
# - it proposes other counts: replace its commit with one holding the new
#   counts, on top of the current main. Unless someone else pushed to it: it
#   is theirs then, and only gets a warning in the run.
# - the chamber's latest pull request proposed these counts and was closed
#   without merging: they were turned down; don't propose them again.
# - otherwise: open a pull request.
#
# Pushes made with the workflow's GITHUB_TOKEN don't trigger other workflows,
# so Validate is dispatched on the branch: its checks then show on the pull
# request like on any other.
set -euo pipefail

chamber=$1
report=$2
file="data/$chamber.yaml"
branch="fetch/${chamber//\//-}"
base=$(git branch --show-current)
bot_name="github-actions[bot]"
bot_email="41898282+github-actions[bot]@users.noreply.github.com"

# The chamber file as $1 has it, without its date: two readings of the same
# counts on different days are the same proposal.
counts_at() { git show "$1:$file" | grep -v '^updated:' || true; }

# The chamber's latest pull request, in any state (OPEN, CLOSED or MERGED).
latest=$(gh pr list --head "$branch" --base "$base" --state all --limit 1 \
  --json number,state --jq '.[] | "\(.number) \(.state)"')
number="" state=""
read -r number state <<<"$latest" || true

# What it proposed, when that matters: it is open, or was turned down.
proposed=""
if [ "$state" = OPEN ] || [ "$state" = CLOSED ]; then
  git fetch --quiet origin "refs/pull/$number/head"
  proposed=$(counts_at FETCH_HEAD)
fi

# Whether anyone but this workflow committed to the open pull request.
others_pushed() {
  gh pr view "$number" --json commits --jq '.commits[].authors[].email' |
    grep --quiet --invert-match --line-regexp --fixed-strings "$bot_email"
}

if git diff --quiet -- "$file"; then
  if [ "$state" = OPEN ]; then
    if others_pushed; then
      echo "::warning::The source is back to the counts on $base, but #$number has commits from someone else: leaving it open."
    else
      gh pr close "$number" --delete-branch --comment \
        "The source is back to the seat counts on \`$base\`: nothing left to propose."
    fi
  fi
  exit 0
fi

if [ -n "$proposed" ] && [ "$(grep -v '^updated:' "$file")" = "$proposed" ]; then
  case $state in
    OPEN)
      echo "#$number already proposes these seat counts."
      exit 0
      ;;
    CLOSED)
      echo "#$number proposed these seat counts and was closed without merging: not proposing them again."
      exit 0
      ;;
  esac
fi

if [ "$state" = OPEN ] && others_pushed; then
  echo "::warning::The source reports new seat counts, but #$number has commits from someone else: leaving it as it is."
  exit 0
fi

title=$(head -n 1 "$report")
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
body="$(tail -n +3 "$report")

---

Read by the [daily fetch]($run_url) on $(date -u +%Y-%m-%d). Check the counts against the source before merging. Until then, later readings update this pull request; closing it without merging keeps these counts from being proposed again."

git config user.name "$bot_name"
git config user.email "$bot_email"
git switch --quiet --force-create "$branch"
git commit --quiet --message "$title" -- "$file"
git push --quiet --force origin "$branch"

if [ "$state" = OPEN ]; then
  gh pr edit "$number" --title "$title" --body "$body"
  echo "Updated #$number."
else
  gh pr create --base "$base" --head "$branch" --title "$title" --body "$body"
fi

gh workflow run validate.yml --ref "$branch"
