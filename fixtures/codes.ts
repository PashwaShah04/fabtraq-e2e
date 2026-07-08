// Run-scoped counter. Seeds SKU codes at 900+ to avoid colliding with the
// seed's SKU-001..00N. A short base36 run tag keeps names unique across
// re-runs on a DB that was not reset (defensive; the suite normally reseeds).
let counter = 900;
const runTag = Date.now().toString(36).slice(-5);
const next = () => ++counter;

export const codes = {
  skuCode: () => `SKU-${next()}`,
  unique: (prefix: string) => `${prefix}-${runTag}-${next()}`,
  vendorName: () => `E2E Vendor ${runTag}-${next()}`,
  qualityName: () => `E2E Quality ${runTag}-${next()}`,
  jobWorkerName: () => `E2E JobWorker ${runTag}-${next()}`,
  transporterName: () => `E2E Transporter ${runTag}-${next()}`,
  locationName: () => `E2E Location ${runTag}-${next()}`,
  designCode: () => `E2E-DSN-${next()}`,
};
