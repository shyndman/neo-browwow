# Upstream Provenance

- **Source repository**: `https://github.com/dmmulroy/anti-slop`
- **Source commit**: `13909c9e07590f5a85d93c62712259fe14a883f7`
- **Installed plugin paths**:
  - `tools/oxlint/anti-slop/index.ts` (enabled in `.oxlintrc.json`)
  - `tools/oxlint/anti-slop/effect/index.ts` (present, not enabled — `effect` is not a dependency)
- **Intentional deviations**: Added `tools/oxlint/anti-slop/package.json` (`{ "type": "module" }`) so Node loads the plugin as ESM without `MODULE_TYPELESS_PACKAGE_JSON`.
