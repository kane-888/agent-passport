import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrePublicArtifactProof,
  buildPrePublicDeployPendingGoLive,
  buildPrePublicSetupPackageRequestBody,
  buildPrePublicReadinessSummary,
  fetchJson,
  hasPrePublicDeployBaseUrl,
  isLoopbackHttpBaseUrl,
  resolvePrePublicFetchTimeoutMs,
  resolvePrePublicLocalReasonerProfileLimit,
  shouldAutoStartLocalRuntime,
} from "../scripts/prepare-self-hosted-pre-public.mjs";

test("prepare pre-public auto-starts only loopback http runtimes by default", () => {
  const previousAutoStart = process.env.AGENT_PASSPORT_PRE_PUBLIC_AUTO_START;
  delete process.env.AGENT_PASSPORT_PRE_PUBLIC_AUTO_START;
  try {
    assert.equal(isLoopbackHttpBaseUrl("http://127.0.0.1:4319"), true);
    assert.equal(isLoopbackHttpBaseUrl("http://localhost:4319"), true);
    assert.equal(isLoopbackHttpBaseUrl("http://[::1]:4319"), true);
    assert.equal(isLoopbackHttpBaseUrl("https://127.0.0.1:4319"), false);
    assert.equal(isLoopbackHttpBaseUrl("http://10.0.0.2:4319"), false);
    assert.equal(shouldAutoStartLocalRuntime({ value: "http://127.0.0.1:4319" }), true);
    assert.equal(shouldAutoStartLocalRuntime({ value: "http://localhost:4319" }), true);
    assert.equal(shouldAutoStartLocalRuntime({ value: "http://[::1]:4319" }), false);
    assert.equal(shouldAutoStartLocalRuntime({ value: "http://10.0.0.2:4319" }), false);
  } finally {
    if (previousAutoStart == null) {
      delete process.env.AGENT_PASSPORT_PRE_PUBLIC_AUTO_START;
    } else {
      process.env.AGENT_PASSPORT_PRE_PUBLIC_AUTO_START = previousAutoStart;
    }
  }
});

test("prepare pre-public auto-start can be disabled explicitly", () => {
  const previousAutoStart = process.env.AGENT_PASSPORT_PRE_PUBLIC_AUTO_START;
  process.env.AGENT_PASSPORT_PRE_PUBLIC_AUTO_START = "0";
  try {
    assert.equal(shouldAutoStartLocalRuntime({ value: "http://127.0.0.1:4319" }), false);
  } finally {
    if (previousAutoStart == null) {
      delete process.env.AGENT_PASSPORT_PRE_PUBLIC_AUTO_START;
    } else {
      process.env.AGENT_PASSPORT_PRE_PUBLIC_AUTO_START = previousAutoStart;
    }
  }
});

test("prepare pre-public fetch timeout is configurable and bounded", async () => {
  assert.equal(resolvePrePublicFetchTimeoutMs(), 45000);
  assert.equal(resolvePrePublicFetchTimeoutMs("25"), 25);
  assert.equal(resolvePrePublicFetchTimeoutMs("0"), 45000);

  let sawAbort = false;
  await assert.rejects(
    fetchJson("/api/hung", {
      baseUrl: "http://127.0.0.1:4319",
      token: "test-token",
      timeoutMs: 5,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => {
              sawAbort = true;
              reject(init.signal.reason);
            },
            { once: true }
          );
        }),
    }),
    /超时|timeout/u
  );
  assert.equal(sawAbort, true);
});

test("prepare pre-public fetch timeout also covers hung response bodies", async () => {
  let sawAbort = false;
  await assert.rejects(
    fetchJson("/api/body-hung", {
      baseUrl: "http://127.0.0.1:4319",
      token: "test-token",
      timeoutMs: 5,
      fetchImpl: async (_url, init) => {
        init.signal.addEventListener(
          "abort",
          () => {
            sawAbort = true;
          },
          { once: true }
        );
        return {
          ok: true,
          status: 200,
          text: async () => new Promise(() => {}),
        };
      },
    }),
    /超时|timeout/u
  );
  assert.equal(sawAbort, true);
});

test("prepare pre-public fetchJson rejects successful non-JSON responses with route context", async () => {
  await assert.rejects(
    fetchJson("/api/device/setup", {
      baseUrl: "http://127.0.0.1:4319",
      token: "test-token",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => "<html>not json</html>",
      }),
    }),
    /GET \/api\/device\/setup returned invalid JSON/u
  );
});

test("prepare pre-public setup package keeps local reasoner profile export lightweight", () => {
  const previousLimit = process.env.AGENT_PASSPORT_PRE_PUBLIC_LOCAL_REASONER_PROFILE_LIMIT;
  try {
    delete process.env.AGENT_PASSPORT_PRE_PUBLIC_LOCAL_REASONER_PROFILE_LIMIT;
    assert.equal(resolvePrePublicLocalReasonerProfileLimit(), 1);
    assert.equal(buildPrePublicSetupPackageRequestBody("2026-04-19T00:00:00.000Z").localReasonerProfileLimit, 1);

    process.env.AGENT_PASSPORT_PRE_PUBLIC_LOCAL_REASONER_PROFILE_LIMIT = "3";
    assert.equal(resolvePrePublicLocalReasonerProfileLimit(), 3);
    assert.equal(buildPrePublicSetupPackageRequestBody("2026-04-19T00:00:00.000Z").localReasonerProfileLimit, 3);

    process.env.AGENT_PASSPORT_PRE_PUBLIC_LOCAL_REASONER_PROFILE_LIMIT = "0";
    assert.equal(resolvePrePublicLocalReasonerProfileLimit(), 1);
  } finally {
    if (previousLimit == null) {
      delete process.env.AGENT_PASSPORT_PRE_PUBLIC_LOCAL_REASONER_PROFILE_LIMIT;
    } else {
      process.env.AGENT_PASSPORT_PRE_PUBLIC_LOCAL_REASONER_PROFILE_LIMIT = previousLimit;
    }
  }
});

test("prepare pre-public distinguishes deploy-pending from full go-live verification", () => {
  const missingDeployOverlay = {
    values: {
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: "deploy-token",
    },
    sourcePaths: {
      AGENT_PASSPORT_DEPLOY_ADMIN_TOKEN: "/tmp/agent-passport.env",
    },
    loadedFiles: ["/tmp/agent-passport.env"],
  };
  const deployPending = buildPrePublicDeployPendingGoLive({ overlay: missingDeployOverlay });

  assert.equal(hasPrePublicDeployBaseUrl({ overlay: missingDeployOverlay }), false);
  assert.equal(deployPending.ok, false);
  assert.equal(deployPending.skipped, true);
  assert.equal(deployPending.errorClass, "missing_deploy_base_url");
  assert.equal(deployPending.blockedBy.length, 1);
  assert.equal(deployPending.blockedBy[0].id, "deploy_base_url_present");
  assert.equal(deployPending.deploy.adminTokenProvided, true);
  assert.equal(deployPending.smoke.skipped, true);

  const readySummary = buildPrePublicReadinessSummary({
    artifactProof: {
      ok: true,
    },
    setupStatus: {
      setupComplete: true,
    },
    securityStatus: {
      releaseReadiness: {
        status: "ready",
      },
      automaticRecovery: {
        formalFlowReady: true,
      },
    },
    selfHostedVerdict: deployPending,
  });

  assert.equal(readySummary.ok, true);
  assert.equal(readySummary.readinessClass, "pre_public_ready_deploy_pending");
  assert.equal(readySummary.deployUrlOnlyPending, true);
  assert.equal(
    hasPrePublicDeployBaseUrl({
      overlay: {
        values: {
          AGENT_PASSPORT_BASE_URL: "http://127.0.0.1:4319",
        },
      },
    }),
    false
  );
  assert.equal(
    hasPrePublicDeployBaseUrl({
      overlay: {
        values: {
          AGENT_PASSPORT_DEPLOY_BASE_URL: "https://agent-passport.example.com",
        },
      },
    }),
    true
  );
});

function buildLinkedArtifacts({
  bundleId = "recovery_fresh",
  bundlePath = "/tmp/recovery_fresh.json",
  rehearsalId = "rhr_fresh",
  packageId = "setup_fresh",
  packagePath = "/tmp/setup_fresh.json",
  setupBundleId = bundleId,
  setupRehearsalId = rehearsalId,
} = {}) {
  return {
    exportRecovery: {
      summary: {
        bundleId,
        bundlePath,
      },
      bundle: {
        format: "agent-passport-store-recovery-v1",
        bundleId,
        ledger: {
          envelope: {
            format: "encrypted-ledger",
          },
        },
      },
    },
    recoveryRehearsal: {
      rehearsal: {
        rehearsalId,
        bundleId,
        status: "passed",
        bundle: {
          bundleId,
        },
      },
    },
    setupPackage: {
      summary: {
        packageId,
        packagePath,
        latestRecoveryBundleId: setupBundleId,
        latestRecoveryRehearsalId: setupRehearsalId,
      },
      package: {
        packageId,
        recovery: {
          latestBundle: {
            bundleId: setupBundleId,
          },
          latestPassedRehearsal: {
            rehearsalId: setupRehearsalId,
          },
        },
      },
    },
  };
}

test("buildPrePublicArtifactProof accepts freshly linked recovery and setup artifacts", () => {
  const proof = buildPrePublicArtifactProof(buildLinkedArtifacts());

  assert.equal(proof.ok, true);
  assert.deepEqual(proof.failedChecks, []);
  assert.equal(proof.bundleId, "recovery_fresh");
  assert.equal(proof.rehearsalId, "rhr_fresh");
  assert.equal(proof.packageId, "setup_fresh");
});

test("buildPrePublicArtifactProof rejects stale setup package recovery references", () => {
  const proof = buildPrePublicArtifactProof(
    buildLinkedArtifacts({
      setupBundleId: "recovery_stale",
      setupRehearsalId: "rhr_stale",
    })
  );

  assert.equal(proof.ok, false);
  assert(proof.failedChecks.includes("setup_package_references_fresh_bundle"));
  assert(proof.failedChecks.includes("setup_package_references_fresh_rehearsal"));
});

test("buildPrePublicArtifactProof rejects setup packages that captured stale local reasoner gaps", () => {
  const artifacts = buildLinkedArtifacts();
  artifacts.setupPackage.package.setupStatus = {
    setupComplete: false,
    missingRequiredCodes: ["local_reasoner_reachable"],
  };
  const proof = buildPrePublicArtifactProof(artifacts);

  assert.equal(proof.ok, false);
  assert(proof.failedChecks.includes("setup_package_setup_status_clear"));
});

test("buildPrePublicArtifactProof rejects heavyweight local reasoner profile payloads", () => {
  const artifacts = buildLinkedArtifacts();
  artifacts.setupPackage.summary.localReasonerProfileCount = 2;
  artifacts.setupPackage.package.localReasonerProfiles = [
    { profileId: "profile_1" },
    { profileId: "profile_2" },
  ];
  const proof = buildPrePublicArtifactProof(artifacts);

  assert.equal(proof.ok, false);
  assert(proof.failedChecks.includes("setup_package_local_reasoner_profiles_bounded"));
});

test("buildPrePublicReadinessSummary treats deploy URL as the only remaining public blocker", () => {
  const result = buildPrePublicReadinessSummary({
    setupStatus: {
      setupComplete: true,
    },
    securityStatus: {
      releaseReadiness: {
        status: "ready",
      },
      automaticRecovery: {
        formalFlowReady: true,
      },
    },
    selfHostedVerdict: {
      ok: false,
      errorClass: "missing_deploy_base_url",
      blockedBy: [
        {
          id: "deploy_base_url_present",
        },
      ],
      nextAction: "set deploy url",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.readinessClass, "pre_public_ready_deploy_pending");
  assert.equal(result.deployUrlOnlyPending, true);
  assert.match(result.summary, /公网前准备已经完成/u);
});

test("buildPrePublicReadinessSummary stays blocked when fresh artifact proof fails", () => {
  const result = buildPrePublicReadinessSummary({
    artifactProof: {
      ok: false,
      failedChecks: ["setup_package_references_fresh_bundle"],
    },
    setupStatus: {
      setupComplete: true,
    },
    securityStatus: {
      releaseReadiness: {
        status: "ready",
      },
      automaticRecovery: {
        formalFlowReady: true,
      },
    },
    selfHostedVerdict: {
      ok: false,
      errorClass: "missing_deploy_base_url",
      blockedBy: [
        {
          id: "deploy_base_url_present",
        },
      ],
      nextAction: "set deploy url",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.readinessClass, "pre_public_artifact_proof_failed");
  assert.equal(result.artifactsFresh, false);
  assert.match(result.summary, /没有形成可证明的新鲜闭环/u);
});

test("buildPrePublicReadinessSummary stays blocked when formal recovery is not ready", () => {
  const result = buildPrePublicReadinessSummary({
    setupStatus: {
      setupComplete: false,
    },
    securityStatus: {
      releaseReadiness: {
        status: "blocked",
        nextAction: "执行恢复演练",
      },
      automaticRecovery: {
        formalFlowReady: false,
      },
    },
    selfHostedVerdict: {
      ok: false,
      errorClass: "missing_deploy_base_url",
      blockedBy: [
        {
          id: "deploy_base_url_present",
        },
      ],
      nextAction: "set deploy url",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.readinessClass, "formal_recovery_blocked");
  assert.equal(result.deployUrlOnlyPending, true);
  assert.equal(result.nextAction, "执行恢复演练");
});

test("buildPrePublicReadinessSummary separates device setup gaps from formal recovery gaps", () => {
  const result = buildPrePublicReadinessSummary({
    setupStatus: {
      setupComplete: false,
      missingRequiredCodes: ["local_reasoner_reachable"],
    },
    securityStatus: {
      releaseReadiness: {
        status: "ready",
        nextAction: "保持巡检",
      },
      automaticRecovery: {
        formalFlowReady: true,
      },
    },
    selfHostedVerdict: {
      ok: false,
      errorClass: "missing_deploy_base_url",
      blockedBy: [
        {
          id: "deploy_base_url_present",
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.readinessClass, "device_setup_blocked");
  assert.match(result.nextAction, /local_reasoner_reachable/u);
});
