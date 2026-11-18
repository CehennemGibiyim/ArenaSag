import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, isNewerVersion } from "../src/lib/app-version";

test("version comparison handles v prefix and numeric segments", () => {
  assert.equal(compareVersions("v1.2.0", "1.2.0"), 0);
  assert.equal(compareVersions("1.10.0", "1.2.0") > 0, true);
  assert.equal(isNewerVersion("1.2.1", "1.2.0"), true);
  assert.equal(isNewerVersion("1.2.0", "1.2.0"), false);
  assert.equal(isNewerVersion("1.1.9", "1.2.0"), false);
});
