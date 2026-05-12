import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocalReasonerRestoreActivationPayload,
  buildLocalReasonerRestoreCandidatesFromProfiles,
  buildLocalReasonerRestorePrewarmPayload,
  DEFAULT_LOCAL_REASONER_PROFILE_LIMIT,
  resolveLocalReasonerRestoreTarget,
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

test("local reasoner restore target honors an explicit profile selection", () => {
  const profiles = [
    {
      profileId: "best-ready",
      provider: "local_mock",
      config: {
        enabled: true,
        provider: "local_mock",
        model: "best-model",
      },
      lastWarm: {
        warmedAt: "2026-01-03T00:00:00.000Z",
        provider: "local_mock",
        status: "ready",
        reachable: true,
        model: "best-model",
      },
    },
    {
      profileId: "requested",
      provider: "local_mock",
      config: {
        enabled: true,
        provider: "local_mock",
        model: "requested-model",
      },
    },
  ];

  const target = resolveLocalReasonerRestoreTarget(profiles, {
    profileId: "requested",
  });

  assert.equal(target.profileRecord, profiles[1]);
  assert.equal(target.selectedProfileRecord, profiles[1]);
  assert.equal(target.selectedCandidate.profileId, "requested");
  assert.equal(target.selectedCandidate.rank, 1);
  assert.equal(target.selectedCandidate.recommended, false);
});

test("local reasoner restore target prefers the first restorable candidate", () => {
  const profiles = [
    {
      profileId: "not-ready",
      provider: "local_mock",
      config: {
        enabled: true,
        provider: "local_mock",
        model: "not-ready-model",
      },
      updatedAt: "2026-01-04T00:00:00.000Z",
      useCount: 99,
    },
    {
      profileId: "ready",
      provider: "local_mock",
      config: {
        enabled: true,
        provider: "local_mock",
        model: "ready-model",
      },
      lastProbe: {
        checkedAt: "2026-01-02T00:00:00.000Z",
        provider: "local_mock",
        status: "ready",
        reachable: true,
        model: "ready-model",
      },
    },
  ];

  const target = resolveLocalReasonerRestoreTarget(profiles);

  assert.equal(target.selectedCandidate.profileId, "ready");
  assert.equal(target.selectedProfileRecord, profiles[1]);
  assert.equal(target.selectedCandidate.recommended, true);
});

test("local reasoner restore target preserves restore error messages", () => {
  assert.throws(
    () => resolveLocalReasonerRestoreTarget([], { profileId: "missing-profile" }),
    /Unknown local reasoner profile: missing-profile/
  );
  assert.throws(
    () => resolveLocalReasonerRestoreTarget([]),
    /No local reasoner restore candidate is available/
  );
});

test("local reasoner restore activation payload merges profile state with caller overrides", () => {
  const lastProbe = {
    checkedAt: "2026-01-02T00:00:00.000Z",
    provider: "local_mock",
    status: "ready",
    reachable: true,
    model: "profile-model",
  };
  const lastWarm = {
    warmedAt: "2026-01-03T00:00:00.000Z",
    provider: "local_mock",
    status: "ready",
    reachable: true,
    model: "profile-model",
  };
  const payload = buildLocalReasonerRestoreActivationPayload(
    {
      provider: "local_mock",
      config: {
        enabled: true,
        provider: "local_mock",
        model: "profile-model",
        timeoutMs: 1000,
      },
      lastProbe,
      lastWarm,
    },
    {
      reason: "manual-restore",
      dryRun: false,
      localReasoner: {
        model: "override-model",
        temperature: 0,
      },
    },
    {
      dryRun: true,
    }
  );

  assert.equal(payload.reason, "manual-restore");
  assert.equal(payload.dryRun, true);
  assert.equal(payload.localReasoner.enabled, true);
  assert.equal(payload.localReasoner.provider, "local_mock");
  assert.equal(payload.localReasoner.model, "override-model");
  assert.equal(payload.localReasoner.timeoutMs, 1000);
  assert.equal(payload.localReasoner.temperature, 0);
  assert.equal(payload.localReasoner.lastProbe, lastProbe);
  assert.equal(payload.localReasoner.lastWarm, lastWarm);
});

test("local reasoner restore prewarm payload clones profile config for fallback prewarm", () => {
  const profile = {
    provider: "local_mock",
    config: {
      enabled: true,
      provider: "local_mock",
      model: "profile-model",
      metadata: {
        source: "profile",
      },
    },
  };
  const payload = buildLocalReasonerRestorePrewarmPayload(
    {
      profileId: "profile-1",
    },
    profile,
    {
      requestId: "restore-request",
      profileId: "caller-profile",
      localReasoner: {
        model: "caller-model",
      },
    },
    {
      dryRun: true,
    }
  );

  payload.localReasoner.metadata.source = "mutated";

  assert.equal(payload.requestId, "restore-request");
  assert.equal(payload.dryRun, true);
  assert.equal(payload.profileId, "profile-1");
  assert.equal(payload.provider, "local_mock");
  assert.equal(payload.localReasoner.model, "profile-model");
  assert.equal(profile.config.metadata.source, "profile");
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
