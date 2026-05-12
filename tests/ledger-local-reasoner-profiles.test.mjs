import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocalReasonerRestoreCandidatesFromProfiles,
  DEFAULT_LOCAL_REASONER_PROFILE_LIMIT,
  syncLocalReasonerProfileRuntimeStateInStore,
} from "../src/ledger-local-reasoner-profiles.js";

test("local reasoner restore candidates rank restorable profiles by freshest health", () => {
  const candidates = buildLocalReasonerRestoreCandidatesFromProfiles(
    [
      {
        profileId: "stale-ready",
        provider: "local_mock",
        config: {
          enabled: true,
          provider: "local_mock",
          model: "stale-model",
        },
        updatedAt: "2026-01-01T00:00:00.000Z",
        useCount: 10,
        lastWarm: {
          warmedAt: "2026-01-02T00:00:00.000Z",
          provider: "local_mock",
          status: "ready",
          reachable: true,
          model: "stale-model",
        },
      },
      {
        profileId: "fresh-ready",
        provider: "local_mock",
        config: {
          enabled: true,
          provider: "local_mock",
          model: "fresh-model",
        },
        updatedAt: "2026-01-01T00:00:01.000Z",
        useCount: 1,
        lastWarm: {
          warmedAt: "2026-01-03T00:00:00.000Z",
          provider: "local_mock",
          status: "ready",
          reachable: true,
          model: "fresh-model",
        },
      },
      {
        profileId: "not-checked",
        provider: "ollama_local",
        config: {
          enabled: true,
          provider: "ollama_local",
          model: "gemma4:e4b",
          baseUrl: "http://127.0.0.1:11434",
        },
        updatedAt: "2026-01-04T00:00:00.000Z",
        useCount: 100,
      },
    ],
    {
      limit: 2,
    }
  );

  assert.equal(DEFAULT_LOCAL_REASONER_PROFILE_LIMIT, 12);
  assert.equal(candidates.counts.total, 3);
  assert.equal(candidates.counts.restorable, 2);
  assert.deepEqual(
    candidates.restoreCandidates.map((entry) => entry.profileId),
    ["fresh-ready", "stale-ready"]
  );
  assert.equal(candidates.restoreCandidates[0].rank, 1);
  assert.equal(candidates.restoreCandidates[0].recommended, true);
  assert.equal(candidates.restoreCandidates[1].rank, 2);
  assert.equal(candidates.restoreCandidates[1].recommended, false);
});

test("local reasoner restore candidates honor scoped profile filters", () => {
  const candidates = buildLocalReasonerRestoreCandidatesFromProfiles(
    [
      {
        profileId: "one",
        provider: "local_mock",
        config: {
          enabled: true,
          provider: "local_mock",
          model: "one-model",
        },
      },
      {
        profileId: "two",
        provider: "local_mock",
        config: {
          enabled: true,
          provider: "local_mock",
          model: "two-model",
        },
      },
    ],
    {
      profileIds: ["two"],
    }
  );

  assert.equal(candidates.counts.total, 1);
  assert.equal(candidates.restoreCandidates[0].profileId, "two");
});

test("local reasoner profile runtime sync updates health and activation state in store", () => {
  const store = {
    localReasonerProfiles: [
      {
        profileId: "profile-1",
        provider: "local_mock",
        config: {
          enabled: true,
          provider: "local_mock",
          model: "before-model",
        },
        updatedAt: "2026-01-01T00:00:00.000Z",
        useCount: 2,
        lastHealthyAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };

  const synced = syncLocalReasonerProfileRuntimeStateInStore(
    store,
    "profile-1",
    {
      lastProbe: {
        checkedAt: "2026-01-02T00:00:00.000Z",
        provider: "local_mock",
        status: "ready",
        reachable: true,
        model: "after-model",
      },
      lastWarm: {
        warmedAt: "2026-01-03T00:00:00.000Z",
        provider: "local_mock",
        status: "ready",
        reachable: true,
        model: "after-model",
      },
    },
    {
      incrementUseCount: true,
      activatedAt: "2026-01-04T00:00:00.000Z",
    }
  );

  assert.equal(synced, store.localReasonerProfiles[0]);
  assert.equal(synced.useCount, 3);
  assert.equal(synced.lastActivatedAt, "2026-01-04T00:00:00.000Z");
  assert.equal(synced.lastHealthyAt, "2026-01-03T00:00:00.000Z");
  assert.equal(synced.lastProbe.checkedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(synced.lastWarm.warmedAt, "2026-01-03T00:00:00.000Z");
});

test("local reasoner profile runtime sync ignores missing profile stores", () => {
  assert.equal(syncLocalReasonerProfileRuntimeStateInStore({}, "profile-1"), null);
  assert.equal(syncLocalReasonerProfileRuntimeStateInStore({ localReasonerProfiles: [] }, "profile-1"), null);
});
