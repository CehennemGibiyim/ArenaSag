import test from "node:test";
import assert from "node:assert/strict";
import { schemaDriftReport } from "../scripts/schema-drift-report.mjs";

test("bilinmeyen zarf alanları issue gövdesine düz metin olarak eklenir", () => {
  const body = schemaDriftReport(
    {
      health: {
        unknownEnvelopeSamples: [
          {
            type: "WebcastEnvelopeMessageV9",
            fields: ["envelopeInfo.diamondCount", "envelopeInfo.yeniAlan"],
          },
        ],
      },
    },
    { runUrl: "https://github.com/example/actions/runs/1" },
  );
  assert.ok(body.includes("WebcastEnvelopeMessageV9"));
  assert.ok(body.includes("envelopeInfo.diamondCount"));
  assert.ok(body.includes("envelopeInfo.yeniAlan"));
  assert.ok(body.includes("watch.unknownSamples"));
  assert.ok(body.includes("https://github.com/example/actions/runs/1"));
});

test("bilinmeyen zarf örneği yoksa boş gövde üretir", () => {
  assert.equal(schemaDriftReport({ health: {} }), "");
  assert.equal(schemaDriftReport({ health: { unknownEnvelopeSamples: [] } }), "");
});
