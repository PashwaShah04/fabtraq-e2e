# SKU answered-at-origination + shade colour (2026-07-27 → 2026-07-29)

Canonical spec + plans live in the umbrella repo:
`docs/brainstorms/2026-07-27-sku-mandatory-shade-colour.md` and
`docs/plans/2026-07-27-sku-shade-*.md` (incl. the binding guardian checklist).

Summary: SKU became required-to-be-answered at origination forms (yarn
purchase items, JW-in lots, beam yarn rows) via the shared NO_SHADE
("No shade / greige") sentinel; the wire skuId stays optional everywhere.
Dyed JW-in lots require a real SKU (SKU_REQUIRED_FOR_DYED_LOT) with shadeNo
derived server-side and its input retired. Optional shadeColorHex on the SKU
master with swatches on read surfaces (zero extra fetches). Aggregated-lots
query gained ?skuId=NO_SHADE ⇒ IS NULL. Colourway cells stay nullable with
usage-time enforcement (prefill prompts + unmapped badge). Lots drill-down
route disambiguated (explicit skuId=NO_SHADE).

This repo's branch: feat/sku-shade-e2e. Cross-repo verification: full e2e
suite 99/99 (2026-07-29). Shared version: 1.10.0.
