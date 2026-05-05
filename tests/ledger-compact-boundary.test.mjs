import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompactBoundaryRecord,
  buildCompactBoundaryView,
} from "../src/ledger-compact-boundary.js";

test("compact boundary views are detached clones", () => {
  const boundary = {
    compactBoundaryId: "cbnd_1",
    archivedMemoryIds: ["mem_1"],
    nested: {
      value: "original",
    },
  };
  const view = buildCompactBoundaryView(boundary);

  boundary.archivedMemoryIds.push("mem_2");
  boundary.nested.value = "mutated";

  assert.deepEqual(view, {
    compactBoundaryId: "cbnd_1",
    archivedMemoryIds: ["mem_1"],
    nested: {
      value: "original",
    },
  });
  assert.notEqual(view, boundary);
});

test("compact boundary records return null without a triggered checkpoint", () => {
  const agent = { agentId: "agent_1" };

  assert.equal(buildCompactBoundaryRecord({}, agent, { checkpoint: null }), null);
  assert.equal(
    buildCompactBoundaryRecord({}, agent, {
      checkpoint: {
        triggered: false,
        checkpointMemoryId: "mem_checkpoint",
      },
    }),
    null
  );
  assert.equal(
    buildCompactBoundaryRecord({}, agent, {
      checkpoint: {
        triggered: true,
        checkpointMemoryId: null,
      },
    }),
    null
  );
});

test("compact boundary records build fresh chain roots and detach checkpoint arrays", () => {
  const checkpoint = {
    triggered: true,
    checkpointMemoryId: "mem_checkpoint",
    checkpoint: {
      payload: {
        currentGoal: " ship boundary ",
      },
      summary: " checkpoint summary ",
    },
    archivedCount: 2,
    retainedCount: 1,
    archivedKinds: ["conversation_turn"],
    archivedMemoryIds: ["mem_old_1", "mem_old_2"],
    retainedMemoryIds: ["mem_recent"],
  };
  const record = buildCompactBoundaryRecord(
    {},
    { agentId: "agent_1" },
    {
      didMethod: "openneed",
      runId: " run_1 ",
      checkpoint,
      contextBuilder: {
        contextHash: "ctx_hash",
      },
      sourceWindowId: " win_1 ",
    }
  );

  checkpoint.archivedKinds.push("mutated");
  checkpoint.archivedMemoryIds.push("mem_mutated");
  checkpoint.retainedMemoryIds.push("mem_retained_mutated");

  assert.match(record.compactBoundaryId, /^cbnd_[0-9a-f-]+$/);
  assert.equal(record.agentId, "agent_1");
  assert.equal(record.didMethod, "openneed");
  assert.equal(record.runId, "run_1");
  assert.equal(record.previousCompactBoundaryId, null);
  assert.equal(record.resumedFromCompactBoundaryId, null);
  assert.equal(record.chainRootCompactBoundaryId, record.compactBoundaryId);
  assert.equal(record.resumeDepth, 0);
  assert.deepEqual(record.lineageCompactBoundaryIds, [record.compactBoundaryId]);
  assert.equal(record.checkpointMemoryId, "mem_checkpoint");
  assert.equal(record.contextHash, "ctx_hash");
  assert.equal(record.currentGoal, "ship boundary");
  assert.equal(record.summary, "checkpoint summary");
  assert.equal(record.archivedCount, 2);
  assert.equal(record.retainedCount, 1);
  assert.deepEqual(record.archivedKinds, ["conversation_turn"]);
  assert.deepEqual(record.archivedMemoryIds, ["mem_old_1", "mem_old_2"]);
  assert.deepEqual(record.retainedMemoryIds, ["mem_recent"]);
  assert.equal(record.sourceWindowId, "win_1");
  assert.match(record.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("compact boundary records preserve previous boundary lineage", () => {
  const previousCompactBoundary = {
    compactBoundaryId: "cbnd_previous",
    chainRootCompactBoundaryId: "cbnd_root",
    resumeDepth: 2,
    lineageCompactBoundaryIds: ["cbnd_root", "cbnd_previous"],
  };
  const record = buildCompactBoundaryRecord(
    {},
    { agentId: "agent_1" },
    {
      didMethod: "agentpassport",
      checkpoint: {
        triggered: true,
        checkpointMemoryId: "mem_checkpoint",
        checkpoint: {
          content: "fallback checkpoint content",
        },
      },
      resumeBoundaryId: " cbnd_previous ",
      previousCompactBoundary,
    }
  );

  assert.equal(record.previousCompactBoundaryId, "cbnd_previous");
  assert.equal(record.resumedFromCompactBoundaryId, "cbnd_previous");
  assert.equal(record.chainRootCompactBoundaryId, "cbnd_root");
  assert.equal(record.resumeDepth, 3);
  assert.deepEqual(record.lineageCompactBoundaryIds, [
    "cbnd_root",
    "cbnd_previous",
    record.compactBoundaryId,
  ]);
  assert.equal(record.summary, "fallback checkpoint content");
});
