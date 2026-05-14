import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultLocalReasonerProfileMigrationEventPayload,
  buildDefaultLocalReasonerProfileMigrationPlan,
  buildDefaultLocalReasonerProfileMigrationResult,
  buildDefaultMigratedLocalReasonerProfile,
  buildDryRunActivatedLocalReasonerProfile,
  buildLocalReasonerProfileActivatedEventPayload,
  buildLocalReasonerProfileActivationPayload,
  buildLocalReasonerProfileActivationResult,
  buildLocalReasonerProfileDeletedEventPayload,
  buildLocalReasonerProfileDeletePlan,
  buildLocalReasonerProfileDeleteResult,
  buildLocalReasonerProfileList,
  buildLocalReasonerProfileLoadResult,
  buildLocalReasonerProfileSavePlan,
  buildLocalReasonerProfileSavedEventPayload,
  buildLocalReasonerProfileSaveResult,
  buildLocalReasonerRestoreActivationPayload,
  buildLocalReasonerRestoreCandidatesFromProfiles,
  buildLocalReasonerRestorePrewarmPayload,
  DEFAULT_LOCAL_REASONER_PROFILE_LIMIT,
  resolveLocalReasonerProfileRecord,
  resolveLocalReasonerRestoreTarget,
  syncLocalReasonerProfileRuntimeStateInStore,
} from "../src/ledger-local-reasoner-profiles.js";
import {
  buildDefaultDeviceLocalReasonerTargetConfig,
} from "../src/ledger-local-reasoner-defaults.js";
import {
  buildDefaultLocalReasonerProfileLabel,
  DEFAULT_DEVICE_LOCAL_REASONER_MODEL,
  DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER,
  DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS,
} from "../src/ledger-device-runtime.js";

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

test("local reasoner profile list scopes sorts and clamps limits", () => {
  const listed = buildLocalReasonerProfileList(
    [
      {
        profileId: "old",
        provider: "local_mock",
        config: {
          enabled: true,
          provider: "local_mock",
          model: "old-model",
        },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        profileId: "new",
        provider: "ollama_local",
        config: {
          enabled: true,
          provider: "ollama_local",
          model: "gemma4:e4b",
        },
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
      {
        profileId: "middle",
        provider: "local_mock",
        config: {
          enabled: true,
          provider: "local_mock",
          model: "middle-model",
        },
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    {
      limit: 0,
      profileId: "old",
      profileIds: ["new", "missing"],
      nowImpl: () => "2026-01-04T00:00:00.000Z",
    }
  );
  const empty = buildLocalReasonerProfileList(
    [
      {
        profileId: "only",
        provider: "local_mock",
        config: {
          enabled: true,
          provider: "local_mock",
          model: "only-model",
        },
      },
    ],
    {
      profileIds: ["missing"],
    }
  );

  assert.equal(listed.listedAt, "2026-01-04T00:00:00.000Z");
  assert.equal(listed.counts.total, 2);
  assert.deepEqual(
    listed.profiles.map((entry) => entry.profileId),
    ["new"]
  );
  assert.equal(empty.counts.total, 0);
  assert.deepEqual(empty.profiles, []);
});

test("local reasoner profile load helpers preserve errors and clone full profiles", () => {
  const profile = {
    profileId: "profile-1",
    provider: "local_mock",
    config: {
      enabled: true,
      provider: "local_mock",
      model: "profile-model",
      metadata: {
        source: "saved",
      },
    },
  };
  const { profile: resolved } = resolveLocalReasonerProfileRecord([profile], "profile-1");
  const loaded = buildLocalReasonerProfileLoadResult(resolved, {
    nowImpl: () => "2026-01-04T00:00:00.000Z",
  });
  const summaryOnly = buildLocalReasonerProfileLoadResult(resolved, {
    includeProfile: false,
    nowImpl: () => "2026-01-04T00:00:01.000Z",
  });

  loaded.profile.config.metadata.source = "mutated";

  assert.throws(() => resolveLocalReasonerProfileRecord([profile], ""), /profileId is required/);
  assert.throws(
    () => resolveLocalReasonerProfileRecord([profile], "missing"),
    /Unknown local reasoner profile: missing/
  );
  assert.equal(loaded.loadedAt, "2026-01-04T00:00:00.000Z");
  assert.equal(loaded.summary.profileId, "profile-1");
  assert.notEqual(loaded.profile, profile);
  assert.equal(profile.config.metadata.source, "saved");
  assert.equal(summaryOnly.loadedAt, "2026-01-04T00:00:01.000Z");
  assert.equal(summaryOnly.profile, null);
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

test("local reasoner profile save plan captures current runtime state with injected ids and timestamps", () => {
  const store = {
    deviceRuntime: {
      residentAgentId: "resident-1",
      localReasoner: {
        enabled: true,
        provider: "local_mock",
        model: "runtime-model",
        command: "run-local",
        args: ["--model", "runtime-model"],
        lastProbe: {
          checkedAt: "2026-01-02T00:00:00.000Z",
          provider: "local_mock",
          status: "ready",
          reachable: true,
          model: "runtime-model",
        },
        lastWarm: {
          warmedAt: "2026-01-03T00:00:00.000Z",
          provider: "local_mock",
          status: "ready",
          reachable: true,
          model: "runtime-model",
        },
      },
    },
  };
  const plan = buildLocalReasonerProfileSavePlan(
    store,
    {
      sourceWindowId: "window-1",
    },
    {
      createRecordIdImpl: (prefix) => `${prefix}_fixed`,
      nowImpl: (() => {
        const values = ["2026-01-04T00:00:00.000Z", "2026-01-04T00:00:01.000Z"];
        return () => values.shift();
      })(),
    }
  );
  const eventPayload = buildLocalReasonerProfileSavedEventPayload(plan.nextProfile);
  const result = buildLocalReasonerProfileSaveResult(plan.nextProfile, {
    dryRun: true,
    nowImpl: () => "2026-01-04T00:00:02.000Z",
  });

  assert.equal(plan.profileId, "lrp_fixed");
  assert.equal(plan.existingIndex, -1);
  assert.equal(plan.nextProfiles.length, 1);
  assert.equal(plan.nextProfile.profileId, "lrp_fixed");
  assert.equal(plan.nextProfile.label, "mock:runtime-model");
  assert.equal(plan.nextProfile.provider, "local_mock");
  assert.equal(plan.nextProfile.config.command, "run-local");
  assert.deepEqual(plan.nextProfile.config.args, ["--model", "runtime-model"]);
  assert.equal(plan.nextProfile.createdAt, "2026-01-04T00:00:00.000Z");
  assert.equal(plan.nextProfile.updatedAt, "2026-01-04T00:00:01.000Z");
  assert.equal(plan.nextProfile.createdByAgentId, "resident-1");
  assert.equal(plan.nextProfile.sourceWindowId, "window-1");
  assert.equal(plan.nextProfile.lastProbe.checkedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(plan.nextProfile.lastWarm.warmedAt, "2026-01-03T00:00:00.000Z");
  assert.equal(plan.nextProfile.lastHealthyAt, "2026-01-03T00:00:00.000Z");
  assert.deepEqual(eventPayload, {
    profileId: "lrp_fixed",
    provider: "local_mock",
    label: "mock:runtime-model",
  });
  assert.equal(result.savedAt, "2026-01-04T00:00:02.000Z");
  assert.equal(result.dryRun, true);
  assert.equal(result.summary.profileId, "lrp_fixed");
  assert.notEqual(result.profile, plan.nextProfile);
});

test("local reasoner profile save plan updates explicit profiles without widening runtime state", () => {
  const existingProfile = {
    profileId: "profile-1",
    label: "Existing label",
    note: "Existing note",
    provider: "local_mock",
    config: {
      enabled: true,
      provider: "local_mock",
      model: "old-model",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByAgentId: "creator-1",
    createdByWindowId: "creator-window",
    sourceWindowId: "source-window",
    useCount: 3,
    lastActivatedAt: "2026-01-01T00:00:01.000Z",
    lastProbe: {
      checkedAt: "2026-01-01T00:00:02.000Z",
      provider: "local_mock",
      status: "ready",
      reachable: true,
    },
    lastWarm: {
      warmedAt: "2026-01-01T00:00:03.000Z",
      provider: "local_mock",
      status: "ready",
      reachable: true,
    },
    lastHealthyAt: "2026-01-01T00:00:03.000Z",
  };
  const store = {
    deviceRuntime: {
      residentAgentId: "resident-1",
      localReasoner: {
        enabled: true,
        provider: "local_mock",
        model: "runtime-should-not-win",
      },
    },
    localReasonerProfiles: [existingProfile],
  };
  const plan = buildLocalReasonerProfileSavePlan(
    store,
    {
      source: "payload",
      profileId: "profile-1",
      label: "",
      note: "",
      updatedByAgentId: "updater-1",
      localReasoner: {
        enabled: true,
        provider: "ollama_local",
        model: "payload-model",
        baseUrl: "http://127.0.0.1:11434",
        lastProbe: {
          checkedAt: "2026-01-02T00:00:00.000Z",
        },
      },
    },
    {
      createRecordIdImpl: () => {
        throw new Error("createRecordId should not be called");
      },
      nowImpl: () => "2026-01-04T00:00:00.000Z",
    }
  );

  assert.equal(plan.profileId, "profile-1");
  assert.equal(plan.existingIndex, 0);
  assert.equal(plan.nextProfiles.length, 1);
  assert.equal(plan.nextProfiles[0], plan.nextProfile);
  assert.equal(plan.nextProfile.label, "Existing label");
  assert.equal(plan.nextProfile.note, "Existing note");
  assert.equal(plan.nextProfile.provider, "ollama_local");
  assert.equal(plan.nextProfile.config.model, "payload-model");
  assert.equal(plan.nextProfile.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(plan.nextProfile.updatedAt, "2026-01-04T00:00:00.000Z");
  assert.equal(plan.nextProfile.createdByAgentId, "creator-1");
  assert.equal(plan.nextProfile.createdByWindowId, "creator-window");
  assert.equal(plan.nextProfile.sourceWindowId, "source-window");
  assert.equal(plan.nextProfile.useCount, 3);
  assert.equal(plan.nextProfile.lastActivatedAt, "2026-01-01T00:00:01.000Z");
  assert.equal(plan.nextProfile.lastProbe.checkedAt, "2026-01-01T00:00:02.000Z");
  assert.equal(plan.nextProfile.lastWarm.warmedAt, "2026-01-01T00:00:03.000Z");
  assert.equal(plan.nextProfile.lastHealthyAt, "2026-01-01T00:00:03.000Z");
});

test("local reasoner profile delete plan builds next profiles and stable result shapes", () => {
  const profiles = [
    {
      profileId: "keep",
      label: "Keep",
      provider: "local_mock",
      config: {
        enabled: true,
        provider: "local_mock",
        model: "keep-model",
      },
    },
    {
      profileId: "delete-me",
      label: "Delete me",
      provider: "ollama_local",
      config: {
        enabled: true,
        provider: "ollama_local",
        model: "gemma4:e4b",
      },
    },
  ];
  const plan = buildLocalReasonerProfileDeletePlan(profiles, "delete-me");
  const eventPayload = buildLocalReasonerProfileDeletedEventPayload(plan);
  const result = buildLocalReasonerProfileDeleteResult(plan.profile, {
    dryRun: true,
    nowImpl: () => "2026-01-04T00:00:00.000Z",
  });

  assert.throws(() => buildLocalReasonerProfileDeletePlan(profiles, ""), /profileId is required/);
  assert.throws(
    () => buildLocalReasonerProfileDeletePlan(profiles, "missing"),
    /Unknown local reasoner profile: missing/
  );
  assert.equal(plan.normalizedId, "delete-me");
  assert.equal(plan.profile, profiles[1]);
  assert.deepEqual(plan.nextProfiles, [profiles[0]]);
  assert.deepEqual(eventPayload, {
    profileId: "delete-me",
    provider: "ollama_local",
    label: "Delete me",
  });
  assert.equal(result.deletedAt, "2026-01-04T00:00:00.000Z");
  assert.equal(result.dryRun, true);
  assert.equal(result.summary.profileId, "delete-me");
});

test("local reasoner profile activation helpers preserve merge precedence and result shapes", () => {
  const profile = {
    profileId: "profile-1",
    label: "Profile 1",
    provider: "local_mock",
    config: {
      enabled: true,
      provider: "local_mock",
      model: "profile-model",
      timeoutMs: 1000,
      baseUrl: "http://127.0.0.1:9999",
    },
    lastHealthyAt: "2026-01-01T00:00:00.000Z",
  };
  const activationPayload = buildLocalReasonerProfileActivationPayload(profile, {
    localReasonerProvider: "ollama_local",
    model: "top-level-model",
    localReasoner: {
      model: "nested-model",
      temperature: 0,
    },
  });
  const explicitProviderPayload = buildLocalReasonerProfileActivationPayload(profile, {
    provider: "ollama_local",
    localReasonerProvider: "local_mock",
  });
  const dryRunProfile = buildDryRunActivatedLocalReasonerProfile(profile, {
    lastProbe: {
      checkedAt: "2026-01-02T00:00:00.000Z",
      provider: "ollama_local",
      status: "ready",
      reachable: true,
      model: "nested-model",
    },
    lastWarm: {
      warmedAt: "2026-01-03T00:00:00.000Z",
      provider: "ollama_local",
      status: "ready",
      reachable: true,
      model: "nested-model",
    },
  });
  const eventPayload = buildLocalReasonerProfileActivatedEventPayload("profile-1", dryRunProfile);
  const result = buildLocalReasonerProfileActivationResult(
    dryRunProfile,
    {
      configuredAt: "2026-01-04T00:00:00.000Z",
      dryRun: true,
    },
    {
      activatedAt: "2026-01-04T00:00:01.000Z",
      dryRun: true,
    }
  );

  assert.equal(activationPayload.provider, "ollama_local");
  assert.equal(explicitProviderPayload.provider, "ollama_local");
  assert.equal(activationPayload.model, "top-level-model");
  assert.equal(activationPayload.localReasoner.provider, "local_mock");
  assert.equal(activationPayload.localReasoner.model, "nested-model");
  assert.equal(activationPayload.localReasoner.timeoutMs, 1000);
  assert.equal(activationPayload.localReasoner.temperature, 0);
  assert.equal(dryRunProfile.lastProbe.checkedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(dryRunProfile.lastWarm.warmedAt, "2026-01-03T00:00:00.000Z");
  assert.equal(dryRunProfile.lastHealthyAt, "2026-01-03T00:00:00.000Z");
  assert.deepEqual(eventPayload, {
    profileId: "profile-1",
    provider: "local_mock",
    label: "Profile 1",
  });
  assert.equal(result.activatedAt, "2026-01-04T00:00:01.000Z");
  assert.equal(result.dryRun, true);
  assert.equal(result.summary.profileId, "profile-1");
  assert.equal(result.runtime.configuredAt, "2026-01-04T00:00:00.000Z");
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

test("default migrated local reasoner profile preserves custom labels and clears stale health", () => {
  const migratedAutoLabel = buildDefaultMigratedLocalReasonerProfile(
    {
      profileId: "auto-label",
      label: "mock:old-model",
      provider: "local_mock",
      config: {
        enabled: true,
        provider: "local_mock",
        model: "old-model",
      },
      lastProbe: {
        checkedAt: "2026-01-01T00:00:00.000Z",
        provider: "local_mock",
        status: "ready",
        reachable: true,
      },
      lastWarm: {
        warmedAt: "2026-01-01T00:00:01.000Z",
        provider: "local_mock",
        status: "ready",
        reachable: true,
      },
      lastHealthyAt: "2026-01-01T00:00:01.000Z",
    },
    {},
    {
      nowImpl: () => "2026-01-02T00:00:00.000Z",
    }
  );
  const migratedCustomLabel = buildDefaultMigratedLocalReasonerProfile(
    {
      profileId: "custom-label",
      label: "My local profile",
      provider: "local_mock",
      config: {
        enabled: true,
        provider: "local_mock",
        model: "old-model",
      },
    },
    {},
    {
      nowImpl: () => "2026-01-02T00:00:00.000Z",
    }
  );

  assert.equal(migratedAutoLabel.label, buildDefaultLocalReasonerProfileLabel(migratedAutoLabel.config));
  assert.equal(migratedAutoLabel.provider, DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER);
  assert.equal(migratedAutoLabel.config.provider, DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER);
  assert.equal(migratedAutoLabel.config.model, DEFAULT_DEVICE_LOCAL_REASONER_MODEL);
  assert.equal(migratedAutoLabel.updatedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(migratedAutoLabel.lastProbe, null);
  assert.equal(migratedAutoLabel.lastWarm, null);
  assert.equal(migratedAutoLabel.lastHealthyAt, null);
  assert.equal(migratedCustomLabel.label, "My local profile");
});

test("default local reasoner profile migration plan builds next profiles counts and views", () => {
  const targetConfig = buildDefaultDeviceLocalReasonerTargetConfig({}, {});
  const plan = buildDefaultLocalReasonerProfileMigrationPlan(
    [
      {
        profileId: "legacy-auto",
        label: "mock:old-model",
        provider: "local_mock",
        config: {
          enabled: true,
          provider: "local_mock",
          model: "old-model",
        },
      },
      {
        profileId: "already-default",
        label: "Current default",
        provider: targetConfig.provider,
        config: targetConfig,
      },
      {
        profileId: "outside-scope",
        label: "Outside scope",
        provider: "local_mock",
        config: {
          enabled: true,
          provider: "local_mock",
          model: "outside-model",
        },
      },
    ],
    {
      profileIds: ["legacy-auto", "already-default"],
    },
    {
      dryRun: false,
      nowImpl: () => "2026-01-02T00:00:00.000Z",
    }
  );
  const eventPayload = buildDefaultLocalReasonerProfileMigrationEventPayload(plan);
  const result = buildDefaultLocalReasonerProfileMigrationResult(plan, {
    dryRun: false,
    nowImpl: () => "2026-01-03T00:00:00.000Z",
  });

  assert.equal(plan.counts.totalProfiles, 3);
  assert.equal(plan.counts.scopedProfiles, 2);
  assert.equal(plan.counts.needsMigration, 1);
  assert.equal(plan.counts.migrated, 1);
  assert.equal(plan.counts.unchanged, 1);
  assert.equal(plan.counts.labelUpdated, 1);
  assert.equal(plan.nextProfiles[0].provider, DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER);
  assert.equal(plan.nextProfiles[0].updatedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(plan.nextProfiles[1].provider, DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER);
  assert.equal(plan.nextProfiles[2].provider, "local_mock");
  assert.deepEqual(
    plan.results.map((entry) => entry.profileId),
    ["legacy-auto", "already-default"]
  );
  assert.equal(plan.results[0].needsMigration, true);
  assert.equal(plan.results[0].migrated, true);
  assert.equal(plan.results[0].before.provider, "local_mock");
  assert.equal(plan.results[0].after.provider, DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER);
  assert.equal(plan.results[1].needsMigration, false);
  assert.deepEqual(eventPayload.profileIds, ["legacy-auto"]);
  assert.equal(eventPayload.migratedCount, 1);
  assert.equal(eventPayload.labelUpdatedCount, 1);
  assert.equal(eventPayload.provider, DEFAULT_DEVICE_LOCAL_REASONER_PROVIDER);
  assert.equal(result.migratedAt, "2026-01-03T00:00:00.000Z");
  assert.equal(result.target.timeoutMs, DEFAULT_DEVICE_LOCAL_REASONER_TIMEOUT_MS);
  assert.deepEqual(result.counts, plan.counts);
  assert.equal(result.profiles, plan.results);
});

test("default local reasoner profile migration plan reports dry runs without mutating next profiles", () => {
  const plan = buildDefaultLocalReasonerProfileMigrationPlan(
    [
      {
        profileId: "legacy-auto",
        label: "mock:old-model",
        provider: "local_mock",
        config: {
          enabled: true,
          provider: "local_mock",
          model: "old-model",
        },
      },
    ],
    {},
    {
      dryRun: true,
      nowImpl: () => "2026-01-02T00:00:00.000Z",
    }
  );
  const result = buildDefaultLocalReasonerProfileMigrationResult(plan, {
    dryRun: true,
    nowImpl: () => "2026-01-03T00:00:00.000Z",
  });

  assert.equal(plan.counts.needsMigration, 1);
  assert.equal(plan.counts.migrated, 0);
  assert.equal(plan.nextProfiles[0].provider, "local_mock");
  assert.equal(plan.results[0].migrated, false);
  assert.equal(result.counts.migrated, 0);
  assert.equal(result.dryRun, true);
});
