# Coding Standards

## Throw errors with `cause`, log at the catch site

Attach diagnostic context to thrown errors using the `Error` constructor's
`{ cause }` option rather than logging before throwing. Let the catching boundary
decide how to log or report the error and its `cause`.

## Prefer library primitives

Use the established library operation when it expresses the task directly.
For AST traversal, prefer `visit()` with a node predicate over hand-written
recursion.

Check traversal order and predicate behavior before relying on them.

## Narrow types at the boundary

Use predicates to select the exact node type the operation handles.
Inside the callback, work directly with that type’s fields.

Prefer `RangeEntry<Text>` over `RangeEntry<Exclude<Text, Parent>>`.
Types should express the domain distinction with the fewest moving parts.

## Keep one source of truth

Store the information the operation needs, then derive other representations
from it.

For example, collect text-node ranges and derive the flattened text from those
entries. Keep the text in that single collection.

## Match the intended scope

Handle the node types relevant to the operation. Broader coverage requires
an explicit reason.

A text-node operation should select text nodes. Supporting every possible
leaf node introduces behavior that needs its own justification.

## Keep local operations readable locally

Prefer a short library callback that exposes the transformation directly.
Introduce helpers when they name a meaningful operation or remove meaningful
complexity.

## Commit checks

Run `prek install` from the repository root to install the workspace Git hooks.
The pipeline's `prek.toml` pins Biome to the version in `biome.json`.
The pipeline's Biome configuration is nested (`root: false`) so hooks can run
from the repository root. The lint hook runs `biome lint` directly, keeping
lint checks separate from formatting and import organization.

On commit, Biome formats staged pipeline files and checks lint rules with
warnings treated as errors. When formatting changes a file, stage the result
and commit again. Lint errors must be fixed before the commit succeeds.

Run `prek run --all-files` from `pipeline/` to check all tracked pipeline files.

On push, the pipeline test hook runs `bun run test` from `pipeline/`, executing
the full test suite with coverage even when no pipeline files changed.
Run `prek run pipeline:test --stage pre-push --all-files` from the repository
root to exercise the same hook manually.
