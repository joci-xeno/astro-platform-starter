// Unified programme M5: retrieval quality evaluation. Metrics and a small labelled corpus so BM25-only, BM25+n-gram and neural/hybrid retrieval can be compared on the same questions.
// The corpus is synthetic. Results obtained with the TEST_FIXTURE embedder prove the plumbing only; they say nothing about how a real model performs on the owner's data.
export function caseMetrics(ranked, relevant, k) {
  const rel = new Set(relevant), top = ranked.slice(0, k); let hits = 0, dcg = 0, rr = 0;
  top.forEach((id, i) => { if (rel.has(id)) { hits++; dcg += 1 / Math.log2(i + 2); if (!rr) rr = 1 / (i + 1); } });
  let ideal = 0; for (let i = 0; i < Math.min(rel.size, k); i++) ideal += 1 / Math.log2(i + 2);
  return { recall: rel.size ? hits / rel.size : 0, rr, ndcg: ideal ? dcg / ideal : 0 };
}
/** run(query) -> Promise<string[]> ranked note keys. cases: [{query, relevant:[key], kind}] */
export async function evaluate({ run, cases, k = 3 }) {
  const per = []; for (const c of cases) { let ranked = []; try { ranked = await run(c.query); } catch { ranked = []; } per.push({ query: c.query, kind: c.kind, ...caseMetrics(ranked, c.relevant, k), top: ranked.slice(0, k) }); }
  const avg = (rows, f) => (rows.length ? Number((rows.reduce((a, r) => a + r[f], 0) / rows.length).toFixed(3)) : null);
  const by = kind => { const rows = per.filter(r => r.kind === kind); return { n: rows.length, recallAtK: avg(rows, "recall"), mrr: avg(rows, "rr"), ndcgAtK: avg(rows, "ndcg") }; };
  return { k, n: per.length, recallAtK: avg(per, "recall"), mrr: avg(per, "rr"), ndcgAtK: avg(per, "ndcg"), lexicalCases: by("lexical"), paraphraseCases: by("paraphrase"), perCase: per };
}

export const CORPUS = Object.freeze([
  ["roof1", "Roof repair quote", "Customer needs shingles replaced after a leak above the bedroom ceiling. Quote includes gutter flashing and two days of labour."],
  ["roof2", "Gutter cleaning schedule", "Spring and autumn gutter cleaning for the apartment block, including downspout checks."],
  ["inv1", "Invoice 2026-114 sent", "Invoice for the kitchen renovation was emailed to the client. Payment terms are 14 days."],
  ["inv2", "Late payment reminder", "Second reminder about the unpaid bill for the garden wall. A charge for late payment applies after 30 days."],
  ["tax1", "Quarterly VAT filing", "Prepare the quarterly VAT return and reconcile the duty paid on imported tiles."],
  ["tax2", "Income tax instalments", "Dates for the income tax instalments and the levy on side income."],
  ["car1", "Van maintenance", "The work vehicle needs new brake pads and an oil change before the long drive to the site."],
  ["car2", "Truck rental terms", "Rental of a truck for moving scaffolding: daily rate, insurance, mileage limits."],
  ["mail1", "Email template for quotes", "Standard letter to send with every quote: greeting, scope, price, validity period."],
  ["mail2", "Newsletter message draft", "Draft of the seasonal mail to previous customers with a discount offer."],
  ["paint1", "Interior painting checklist", "Painting walls: mask the trim, one primer coat, two coats of paint, clean the brushes."],
  ["paint2", "Exterior wall coating", "Brush and roller coat for the exterior wall, weather window, scaffold needed."],
  ["misc1", "Supplier contacts", "Phone numbers of the tile supplier and the timber yard."],
  ["misc2", "Team holiday calendar", "Who is away in August and how site cover is arranged."]
].map(([key, title, body]) => ({ key, title, body })));
export const CASES = Object.freeze([
  { kind: "lexical", query: "gutter cleaning", relevant: ["roof2"] }, { kind: "lexical", query: "quarterly VAT return", relevant: ["tax1"] }, { kind: "lexical", query: "interior painting checklist", relevant: ["paint1"] },
  { kind: "lexical", query: "truck rental", relevant: ["car2"] }, { kind: "lexical", query: "invoice kitchen renovation", relevant: ["inv1"] },
  { kind: "paraphrase", query: "automobile servicing before driving", relevant: ["car1"] }, { kind: "paraphrase", query: "ceiling leak fix", relevant: ["roof1"] }, { kind: "paraphrase", query: "bill nobody paid yet", relevant: ["inv2"] },
  { kind: "paraphrase", query: "levy payments timetable", relevant: ["tax2"] }, { kind: "paraphrase", query: "coat the wall with a brush", relevant: ["paint2"] }, { kind: "paraphrase", query: "letter to send customers", relevant: ["mail1", "mail2"] }
]);
