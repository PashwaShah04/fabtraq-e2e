// UI copy contract — mirrored byte-for-byte from the plans below, never
// retyped. Per lead ruling (2026-07-27, R7 in docs/plans/2026-07-27-sku-shade-e2e.md)
// this suite stays black-box and takes NO dependency on
// @pashwashah04/fabtraq-shared: these constants are the drift-detection
// fixture, and E8's live-render assertion is what catches shared/e2e
// disagreeing. If a live-render assertion fails, update the constant here
// and tell the lead — do not relax the assertion.
//
// Source: docs/plans/2026-07-27-sku-shade-fe.md, "UI copy contract" section
// (lines ~1038-1099) plus the two lead addenda dated 2026-07-28 (lines
// ~1436-1458). Two constants below carry non-ASCII characters (U+2014,
// U+2192) — copy those from source, never hand-type them.

/**
 * Sentinel option label rendered as a SelectItem in QualitySkuSelect.
 * Upstream: FE plan "1. Sentinel option label".
 */
export const SENTINEL_OPTION_LABEL = 'No shade / greige';

/**
 * Unanswered-SKU validation message, identical across all three origination
 * forms (yarn purchase, JW-in, beam receipt).
 * Upstream: SKU_ANSWER_REQUIRED_MESSAGE in @pashwashah04/fabtraq-shared
 * (arch-shared's skuAnswerSchema). ASCII straight double quotes (U+0022).
 */
export const SKU_ANSWER_REQUIRED = 'Select a SKU, or choose "No shade / greige".';

/**
 * D5 empty-SKU-quality hint, rendered inside QualitySkuSelect when a
 * selected quality has zero SKUs. Advisory only — never a blocker (the
 * sentinel is always selectable); do not assert this as an error.
 * Upstream: spec rev-2 D5. Contains em dash U+2014 and rightwards arrow
 * U+2192 — not a hyphen/en-dash and not "->".
 */
export const EMPTY_SKU_QUALITY_HINT =
  'No SKUs defined for this quality — add one under Qualities → SKUs';

/**
 * O4 dyed-lot copy: shown as the disabled-sentinel explanation
 * (title/aria-describedby) on dyed rows, and as the submit-time validation
 * message if a dyed row somehow holds NO_SHADE. Consumed by E10.
 * Upstream: FE plan "Lead addendum (2026-07-28) — O4 dyed-lot UI copy".
 * ASCII only: plain hyphen (not em dash), straight quotes.
 */
export const DYED_LOT_SKU_REQUIRED = 'Dyed lots need a specific SKU - "No shade / greige" is not allowed here.';

/**
 * Task 10 (colourway) ratified copy — HELD PENDING O1 upstream (FE Task 10
 * not dispatched; e2e E7 blocked on O1). Recorded now per lead instruction
 * so the fixture exists when E7 unblocks. Do not write E7 assertions before
 * O1 resolves.
 * Upstream: FE plan "Lead addendum (2026-07-28) — Task 10 copy ratified".
 */
export const COLOURWAY_COPY = {
  /** Fixed tail phrase of the prefill note; the leading group list (e.g.
   * "Unmapped for this colour-way: A (Quality X).") varies per design and
   * is not part of the assertable constant. */
  prefillNoteTail: 'Choose a SKU for each below, or "No shade / greige", to continue.',
  /** aria-label template for the per-group SKU picker; `${label}` is the
   * colour-way group letter (e.g. "A"). */
  perGroupPickerAriaLabel: (label: string) => `sku for unmapped group ${label}`,
  /** Badge text is count-aware natural pluralization. */
  unmappedShadeBadge: (count: number) => `${count} unmapped shade${count === 1 ? '' : 's'}`,
};
