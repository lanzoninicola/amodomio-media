import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import {
  extensionFromMimetype,
  isMimetypeAllowedForKind,
  readLegacyCompatFields,
  resolveUploadTarget,
  resolveV2UploadTarget,
  sanitizeFolderPath,
  uploadSizeLimitByKind
} from "./server";

function reqWithQuery(query: Record<string, unknown>): Request {
  return { query } as unknown as Request;
}

test("sanitizeFolderPath accepts nested path and normalizes slashes", () => {
  assert.equal(sanitizeFolderPath("campaigns\\summer-2026//hero"), "campaigns/summer-2026/hero");
});

test("sanitizeFolderPath rejects traversal and invalid characters", () => {
  assert.equal(sanitizeFolderPath("../secret"), null);
  assert.equal(sanitizeFolderPath("campaigns/.."), null);
  assert.equal(sanitizeFolderPath("campaigns/summer 2026"), null);
});

test("resolveUploadTarget supports new contract with folderPath + assetKey", () => {
  const target = resolveUploadTarget(reqWithQuery({
    kind: "image",
    folderPath: "brands/amodomio",
    assetKey: "logo"
  }));

  assert.deepEqual(target, {
    folderPath: "brands/amodomio",
    assetKey: "logo",
    legacyMenuItemId: null,
    legacySlot: null
  });
});

test("resolveV2UploadTarget accepts only folderPath/path + assetKey", () => {
  const withFolderPath = resolveV2UploadTarget(reqWithQuery({
    kind: "image",
    folderPath: "brands/amodomio",
    assetKey: "logo"
  }));
  assert.deepEqual(withFolderPath, {
    folderPath: "brands/amodomio",
    assetKey: "logo",
    legacyMenuItemId: null,
    legacySlot: null
  });

  const withPathAlias = resolveV2UploadTarget(reqWithQuery({
    kind: "image",
    path: "brands/amodomio",
    assetKey: "logo"
  }));
  assert.deepEqual(withPathAlias, {
    folderPath: "brands/amodomio",
    assetKey: "logo",
    legacyMenuItemId: null,
    legacySlot: null
  });

  const legacyOnly = resolveV2UploadTarget(reqWithQuery({
    kind: "image",
    menuItemId: "margherita",
    slot: "cover"
  }));
  assert.equal(legacyOnly, null);
});

test("resolveUploadTarget keeps legacy fallback with menuItemId + slot", () => {
  const target = resolveUploadTarget(reqWithQuery({
    kind: "image",
    menuItemId: "margherita",
    slot: "cover"
  }));

  assert.deepEqual(target, {
    folderPath: "margherita",
    assetKey: "cover",
    legacyMenuItemId: "margherita",
    legacySlot: "cover"
  });
});

test("readLegacyCompatFields only returns data for legacy requests", () => {
  const newContractTarget = resolveUploadTarget(reqWithQuery({
    kind: "image",
    folderPath: "brands/amodomio",
    assetKey: "logo"
  }));
  assert.ok(newContractTarget);
  assert.equal(readLegacyCompatFields(newContractTarget), null);

  const legacyTarget = resolveUploadTarget(reqWithQuery({
    kind: "image",
    menuItemId: "margherita",
    slot: "cover"
  }));
  assert.ok(legacyTarget);
  assert.deepEqual(readLegacyCompatFields(legacyTarget), {
    menuItemId: "margherita",
    slot: "cover"
  });
});

test("resolveUploadTarget does not fallback to legacy when folderPath is provided but invalid", () => {
  const target = resolveUploadTarget(reqWithQuery({
    kind: "image",
    folderPath: "../secret",
    menuItemId: "margherita",
    slot: "cover"
  }));

  assert.equal(target, null);
});

test("mimetype and size validations remain aligned with existing behavior", () => {
  assert.equal(extensionFromMimetype("image/jpeg"), "jpg");
  assert.equal(extensionFromMimetype("video/mp4"), "mp4");
  assert.equal(extensionFromMimetype("text/plain"), null);

  assert.equal(isMimetypeAllowedForKind("image", "image/png"), true);
  assert.equal(isMimetypeAllowedForKind("image", "video/mp4"), false);
  assert.equal(isMimetypeAllowedForKind("video", "video/mp4"), true);
  assert.equal(isMimetypeAllowedForKind("video", "image/jpeg"), false);

  assert.equal(uploadSizeLimitByKind("image"), 10 * 1024 * 1024);
  assert.equal(uploadSizeLimitByKind("video"), 20 * 1024 * 1024);
});
