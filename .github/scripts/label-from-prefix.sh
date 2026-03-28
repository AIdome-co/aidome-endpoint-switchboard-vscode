#!/usr/bin/env bash
set -euo pipefail

prefix=$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')

case "$prefix" in
  feat|feature|frontend|forntend|perf)
    echo "enhancement"
    ;;
  fix|bugfix|security)
    echo "bug"
    ;;
  hotfix)
    echo "hotfix bug"
    ;;
  docs)
    echo "documentation"
    ;;
  ci)
    echo "ci"
    ;;
  build|docker|chore)
    echo "infrastructure"
    ;;
  patch)
    echo "patch"
    ;;
  release)
    echo "release"
    ;;
  test|tests)
    echo "tests"
    ;;
  *)
    exit 0
    ;;
esac