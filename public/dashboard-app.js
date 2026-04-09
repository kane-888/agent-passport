      function setDashboardMode(mode) {
        const note = document.getElementById("view-mode-note");
        activeDashboardMode = mode === "lab" ? "lab" : mode === "full" ? "full" : "recommended";

        if (mode === "lab") {
          document.body.classList.remove("beginner-mode");
          document.body.classList.add("lab-mode");
          if (note) {
            note.textContent = "当前是高级工具页：主线步骤已收起，只显示身份实验、归档、治理和底层工具。";
          }
          syncDashboardUrlState();
          return;
        }

        document.body.classList.remove("lab-mode");
        if (mode === "full") {
          document.body.classList.remove("beginner-mode");
          if (note) {
            note.textContent = "当前是完整视图：已显示多人确认、证据、修复、恢复和受限操作等高级区域。";
          }
          syncDashboardUrlState();
          return;
        }

        document.body.classList.add("beginner-mode");
        if (note) {
          note.textContent = "当前是推荐视图：先看最常用的 4 步，支撑工具默认收起。";
        }
        syncDashboardUrlState();
      }

      function scrollToPanel(panelId) {
        const element = document.getElementById(panelId);
        if (!element) return;
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      const initialDashboardSearch = new URLSearchParams(window.location.search);
      const linkHelpers = globalThis.AgentPassportLinks || {};
      const {
        normalizeDashboardDidMethod,
        dashboardDidMethodLabel,
        formDataToObject,
        summarizeSignatureRecords,
        summarizeExecutionReceipt,
        summarizeTimelineEntries,
        friendlyTimelineKind,
        summarizeTimelineDetail,
        friendlyCredentialKind,
        summarizeMigrationRepairCard,
        buildCompactRepairView,
        summarizeWindowBinding,
      } = globalThis.AgentPassportDashboardUtils || {};
      const RECOMMENDED_GEMMA_PROFILE_ID = "lrp_gemma4_local_60000ms";
      const RECOMMENDED_GEMMA_PROFILE_LABEL = "gemma4-local-60000ms";
      const RECOMMENDED_GEMMA_PROFILE_NOTE = "Passport 推荐本地 Gemma 配置：Ollama /api/chat / 60000ms";

      async function request(url, options = {}) {
        const storedToken = getStoredAdminToken();
        const nextHeaders = {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        };
        if (storedToken) {
          nextHeaders.Authorization = `Bearer ${storedToken}`;
        }
        const response = await fetch(url, {
          headers: nextHeaders,
          ...options,
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Request failed");
        }
        return data;
      }

      function normalizeText(value) {
        return typeof value === "string" ? value.trim() : "";
      }

      function stringifyJsonValue(value) {
        const seen = new WeakSet();
        try {
          const json = JSON.stringify(
            value,
            (_, current) => {
              if (typeof current === "bigint") {
                return `${current}n`;
              }
              if (current instanceof Error) {
                return {
                  name: current.name,
                  message: current.message,
                  stack: current.stack,
                };
              }
              if (!current || typeof current !== "object") {
                return current;
              }
              if (seen.has(current)) {
                return "[Circular]";
              }
              seen.add(current);
              return current;
            },
            2
          );
          return typeof json === "string" ? json : "null";
        } catch (error) {
          return `JSON 渲染失败：${error instanceof Error ? error.message : String(error)}`;
        }
      }

      function stringifyJsonInline(value) {
        return stringifyJsonValue(value).replace(/\s+/g, " ").trim();
      }

      function setJsonText(root, value, emptyText = "暂无 JSON 数据。") {
        if (!root) {
          return;
        }
        root.textContent = value == null ? emptyText : stringifyJsonValue(value);
      }

      function formatReasonerProviderLabel(provider) {
        const normalized = normalizeText(provider);
        const labels = {
          ollama_local: "Ollama 本地引擎",
          local_command: "自定义本地命令",
          openai_compatible: "OpenAI 兼容本地网关",
          local_mock: "本地兜底引擎",
          passthrough: "候选回复直通",
          mock: "模拟回答",
          http: "HTTP 回答接口",
          deterministic_fallback: "确定性兜底",
          passport_fast_memory: "Passport 快速记忆",
        };
        return labels[normalized] || normalized || "未命名回答方式";
      }

      function formatLocalModeLabel(mode) {
        const normalized = normalizeText(mode);
        if (normalized === "local_only") {
          return "纯本地";
        }
        if (normalized === "online_enhanced") {
          return "联网增强";
        }
        return normalized || "未命名模式";
      }

      function formatStatusLabel(status) {
        const normalized = normalizeText(status);
        const labels = {
          active: "进行中",
          armed: "可启动",
          armed_with_gaps: "可启动但有缺口",
          bounded: "受限放行",
          bounded_auto_recovery: "有限自动恢复",
          blocked: "受阻",
          bootstrap_required: "需要补齐启动包",
          paused: "暂停",
          completed: "已完成",
          degraded: "需收紧",
          gated: "受门禁保护",
          human_review_required: "需人工接管",
          locked: "已锁定",
          loop_detected: "检测到循环",
          max_attempts_reached: "达到上限",
          negotiation_required: "需要协商",
          needs_human_review: "需人工复核",
          not_needed: "本轮未触发",
          partial: "部分就绪",
          planned: "已规划",
          prepared: "已准备",
          present: "已存在",
          protected: "已保护",
          ready: "已就绪",
          rehydrate_required: "需要恢复包续跑",
          resumed: "已续跑",
          resumed_with_followup: "已续跑待后续",
          resume_boundary_unavailable: "缺少恢复边界",
          passed: "已通过",
          failed: "失败",
          fresh: "较新",
          enforced: "已强制",
          disabled: "已关闭",
          running: "运行中",
          triggered: "已触发",
          unavailable: "不可用",
          unplanned: "未规划",
          manual_only: "人工接管",
          not_requested: "未请求",
          not_reported: "未回传",
          not_run: "未执行",
          idle: "空闲",
          restricted: "最小权限",
          stale: "过旧",
          pending: "等待中",
        };
        return labels[normalized] || normalized || "未命名状态";
      }

      function formatSecurityPostureLabel(mode) {
        const normalized = normalizeText(mode);
        const labels = {
          normal: "正常",
          read_only: "只读",
          disable_exec: "禁执行",
          panic: "Panic",
        };
        return labels[normalized] || normalized || "未知姿态";
      }

      function formatRecoveryRequirementLabel(code) {
        const normalized = normalizeText(code);
        const labels = {
          resident_agent_bound: "绑定常驻助手",
          bootstrap_ready: "补齐 bootstrap",
          store_key_protected: "配置 store key",
          store_key_system_protected: "把 store key 放进系统保护层",
          signing_key_ready: "准备 signing key",
          signing_key_system_protected: "把 signing key 放进系统保护层",
          local_reasoner_ready: "配置本地回答引擎",
          local_reasoner_reachable: "恢复本地回答引擎可达性",
          recovery_bundle_present: "导出恢复包",
          recovery_rehearsal_recent: "跑最近一次恢复演练",
          setup_package_present: "保留初始化包",
        };
        return labels[normalized] || normalized || "未知缺项";
      }

      function formatAutoRecoveryActionLabel(action) {
        const normalized = normalizeText(action);
        const labels = {
          reload_rehydrate_pack: "从恢复边界续跑",
          resume_from_rehydrate_pack: "从恢复边界续跑",
          bootstrap_runtime: "补齐 bootstrap",
          bootstrap_and_retry: "补齐 bootstrap 后重试",
          restore_local_reasoner: "恢复本地回答引擎",
          restore_reasoner_and_retry: "恢复回答引擎后重试",
          retry_without_execution: "转入非执行续跑",
          request_human_review: "请求人工复核",
          resumeFromRehydratePack: "恢复边界续跑",
          bootstrapRuntime: "补齐 bootstrap",
          restoreLocalReasoner: "恢复本地回答引擎",
          retryWithoutExecution: "转入非执行续跑",
        };
        return labels[normalized] || normalized || "未知动作";
      }

      function formatAutoRecoveryPhaseLabel(phase) {
        const normalized = normalizeText(phase);
        const labels = {
          trigger: "触发",
          plan: "规划",
          gate: "门禁",
          execution: "执行",
          verification: "校验",
          outcome: "收口",
        };
        return labels[normalized] || normalized || "未知阶段";
      }

      function formatCompactTimestamp(value) {
        const normalized = normalizeText(value);
        if (!normalized) {
          return "未记录";
        }

        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) {
          return normalized;
        }
        return parsed.toISOString().slice(0, 16).replace("T", " ");
      }

      function formatRiskStrategyLabel(strategy) {
        const normalized = normalizeText(strategy);
        const labels = {
          auto_execute: "自动执行",
          discuss: "先讨论",
          confirm: "明确确认",
          multisig: "多人确认",
        };
        return labels[normalized] || normalized || "未命名策略";
      }

      function formatRetrievalStrategyLabel(strategy) {
        const normalized = normalizeText(strategy);
        if (normalized === "local_first_non_vector") {
          return "本地优先（不走向量）";
        }
        return normalized || "未命名搜索方式";
      }

      function formatNegotiationModeLabel(mode) {
        const normalized = normalizeText(mode);
        if (normalized === "confirm_before_execute") {
          return "执行前确认";
        }
        if (normalized === "discuss_first") {
          return "先讨论再决定";
        }
        return normalized || "未命名协商模式";
      }

      function formatDidMethodChoice(value) {
        const normalized = normalizeText(value);
        if (normalized === "agentpassport") {
          return "Agent Passport";
        }
        if (normalized === "openneed") {
          return "OpenNeed";
        }
        return normalized || "未命名方式";
      }

      function formatReadViewLabel(value) {
        const normalized = normalizeText(value);
        const labels = {
          summary_only: "仅摘要",
          metadata_only: "仅元数据",
          standard_read: "标准只读",
        };
        return labels[normalized] || normalized || "按角色默认";
      }

      function formatReadSessionRoleLabel(role) {
        const normalized = normalizeText(role);
        const labels = {
          all_read: "全量只读",
          security_delegate: "安全代理",
          runtime_observer: "运行观察者",
          runtime_summary_observer: "运行摘要观察者",
          recovery_observer: "恢复观察者",
          agent_auditor: "助手审计员",
          agent_metadata_observer: "助手元数据观察者",
          credential_metadata_observer: "证据元数据观察者",
          transcript_observer: "对话观察者",
          window_observer: "窗口观察者",
        };
        return labels[normalized] || normalized || "不指定";
      }

      function formatRiskTierLabel(tier) {
        const normalized = normalizeText(tier);
        const labels = {
          low: "低",
          medium: "中",
          high: "高",
          critical: "关键",
        };
        return labels[normalized] || normalized || "未命名风险";
      }

      function formatCredentialStatusLabel(status) {
        const normalized = normalizeText(status);
        const labels = {
          active: "有效",
          revoked: "已撤销",
          stale: "过旧",
          fresh: "较新",
          unknown: "未知",
        };
        return labels[normalized] || normalized || "未知";
      }

      function formatCredentialFreshnessLabel(value) {
        const normalized = normalizeText(value);
        const labels = {
          fresh: "较新",
          stale: "过旧",
          unknown: "未知",
        };
        return labels[normalized] || normalized || "未知";
      }

      function applyFriendlySelectLabels(root = document) {
        const fieldOptionLabels = {
          "dashboard-did-method": {
            "": "默认跟随当前视角",
            agentpassport: "Agent Passport",
            openneed: "OpenNeed",
          },
          localMode: {
            local_only: "纯本地",
            online_enhanced: "联网增强",
          },
          allowOnlineReasoner: {
            false: "不允许",
            true: "允许",
          },
          localReasonerEnabled: {
            true: "开启",
            false: "关闭",
          },
          enabled: {
            true: "开启",
            false: "关闭",
          },
          dryRun: {
            false: "正式执行",
            true: "仅预演",
          },
          removeFile: {
            false: "保留本地文件",
            true: "迁移后删除本地文件",
          },
          saveToFile: {
            true: "保存到本地目录",
            false: "只返回结果",
          },
          canDelegate: {
            "": "按角色默认",
            false: "不允许继续派发",
            true: "允许继续派发",
          },
          role: {
            "": "不指定（直接按范围）",
            all_read: "全量只读",
            security_delegate: "安全代理",
            runtime_observer: "运行观察者",
            runtime_summary_observer: "运行摘要观察者",
            recovery_observer: "恢复观察者",
            agent_auditor: "助手审计员",
            agent_metadata_observer: "助手元数据观察者",
            credential_metadata_observer: "证据元数据观察者",
            transcript_observer: "对话观察者",
            window_observer: "窗口观察者",
          },
          residentDidMethod: {
            agentpassport: "Agent Passport",
            openneed: "OpenNeed",
          },
          didMethod: {
            agentpassport: "Agent Passport",
            openneed: "OpenNeed",
          },
          compareIssuerDidMethod: {
            agentpassport: "Agent Passport",
            openneed: "OpenNeed",
          },
          issuerDidMethod: {
            agentpassport: "Agent Passport",
            openneed: "OpenNeed",
          },
          negotiationMode: {
            confirm_before_execute: "执行前确认",
            discuss_first: "先讨论再决定",
          },
          autoExecuteLowRisk: {
            false: "不自动执行",
            true: "自动执行",
          },
          lowRiskStrategy: {
            auto_execute: "自动执行",
            discuss: "先讨论",
            confirm: "明确确认",
            multisig: "多人确认",
          },
          mediumRiskStrategy: {
            discuss: "先讨论",
            confirm: "明确确认",
          },
          highRiskStrategy: {
            confirm: "明确确认",
            multisig: "多人确认",
          },
          criticalRiskStrategy: {
            multisig: "多人确认",
          },
          requireExplicitConfirmation: {
            true: "要求确认",
            false: "按策略决定",
          },
          retrievalStrategy: {
            local_first_non_vector: "本地优先（不走向量）",
          },
          allowVectorIndex: {
            false: "关闭",
            true: "开启",
          },
          requireRecoveryBundle: {
            true: "要求恢复包",
            false: "按需",
          },
          requireRecentRecoveryRehearsal: {
            true: "要求最近演练",
            false: "按需",
          },
          requireSetupPackage: {
            false: "按需",
            true: "要求初始化包",
          },
          requireKeychainWhenAvailable: {
            true: "强制使用钥匙串",
            false: "按环境决定",
          },
          allowResidentRebind: {
            false: "不允许",
            true: "允许",
          },
          createDefaultCommitment: {
            true: "默认创建",
            false: "先不创建",
          },
          claimResidentAgent: {
            true: "设为常驻",
            false: "先不设置",
          },
          includeProfiles: {
            true: "包含历史配置",
            false: "只迁当前配置",
          },
          prewarm: {
            true: "立即预热",
            false: "先不预热",
          },
          source: {
            current: "当前启用配置",
          },
          status: {
            active: "进行中",
            blocked: "受阻",
            paused: "暂停",
            completed: "已完成",
          },
          deviceRuntimeView: {
            "": "按角色默认",
            summary_only: "仅摘要",
            metadata_only: "仅元数据",
            standard_read: "标准只读",
          },
          deviceSetupView: {
            "": "按角色默认",
            summary_only: "仅摘要",
            metadata_only: "仅元数据",
            standard_read: "标准只读",
          },
          recoveryView: {
            "": "按角色默认",
            summary_only: "仅摘要",
            metadata_only: "仅元数据",
            standard_read: "标准只读",
          },
          agentRuntimeView: {
            "": "按角色默认",
            summary_only: "仅摘要",
            metadata_only: "仅元数据",
            standard_read: "标准只读",
          },
          transcriptView: {
            "": "按角色默认",
            summary_only: "仅摘要",
            metadata_only: "仅元数据",
            standard_read: "标准只读",
          },
          sandboxAuditsView: {
            "": "按角色默认",
            summary_only: "仅摘要",
            metadata_only: "仅元数据",
            standard_read: "标准只读",
          },
          confirmExecution: {
            false: "未确认",
            true: "已确认",
          },
        };

        root.querySelectorAll("select").forEach((select) => {
          const optionLabels = fieldOptionLabels[select.name || select.id || ""];
          if (!optionLabels) {
            return;
          }
          Array.from(select.options).forEach((option) => {
            const mapped = optionLabels[option.value];
            if (mapped) {
              option.textContent = mapped;
            }
          });
        });
      }

      async function loadSecurityStatus() {
        const root = document.getElementById("security-summary");
        const tokenInput = document.getElementById("admin-token-input");
        if (tokenInput) {
          tokenInput.value = getStoredAdminToken();
        }

        try {
          const data = await request("/api/security");
          activeSecurityStatus = data || null;
          if (root) {
            const tokenState = getStoredAdminToken() ? "本地已保存 token" : "当前未保存 token";
            root.textContent = [
              `绑定地址：${data.hostBinding || "unknown"}`,
              `写接口鉴权：${data.apiWriteProtection?.tokenRequired ? "开启" : "关闭"}`,
              `敏感读接口：${data.readProtection?.sensitiveGetRequiresToken ? "开启" : "关闭"}`,
              data.readProtection?.scopedReadSessions ? "读会话：开启" : null,
              data.securityPosture?.mode ? `安全姿态 ${data.securityPosture.mode}` : null,
              `Keychain：${data.keyManagement?.keychainAvailable ? "可用" : "不可用"}`,
              data.keyManagement?.storeKey?.source ? `store key：${data.keyManagement.storeKey.source}` : null,
              data.keyManagement?.signingKey?.source ? `signing key：${data.keyManagement.signingKey.source}` : null,
              data.localStorageFormalFlow?.status
                ? `恢复流程 ${formatStatusLabel(data.localStorageFormalFlow.status)}`
                : null,
              data.constrainedExecution?.status
                ? `受限执行 ${formatStatusLabel(data.constrainedExecution.status)}`
                : null,
              data.constrainedExecution?.systemBrokerSandbox?.status
                ? `系统 sandbox ${formatStatusLabel(data.constrainedExecution.systemBrokerSandbox.status)}`
                : null,
              data.automaticRecovery?.status
                ? `自动续跑 ${formatStatusLabel(data.automaticRecovery.status)}`
                : null,
              data.authorized ? "安全详情：已解锁" : "安全详情：受保护",
              tokenState,
            ].filter(Boolean).join(" · ");
          }
          renderOperationalArchitectureCards();
          return data;
        } catch (error) {
          activeSecurityStatus = null;
          if (root) {
            root.textContent = `安全状态读取失败：${error.message}`;
          }
          renderOperationalArchitectureCards();
          return null;
        }
      }

      function buildEmptyOperationsCard(title, message) {
        return {
          title,
          empty: true,
          statusLabel: "待读取",
          summary: message,
          rows: [],
          chips: [],
          warnings: [],
          actions: [],
        };
      }

      function summarizeOperationsList(items = []) {
        return Array.from(new Set((Array.isArray(items) ? items : []).filter(Boolean)));
      }

      function renderOperationsCard(rootId, card) {
        const root = document.getElementById(rootId);
        if (!root) {
          return;
        }

        const safeCard = card || buildEmptyOperationsCard("状态卡片", "当前暂无数据。");
        const rows = summarizeOperationsList(safeCard.rows);
        const chips = summarizeOperationsList(safeCard.chips);
        const warnings = summarizeOperationsList(safeCard.warnings);
        const actions = summarizeOperationsList(safeCard.actions);

        root.className = `ops-card${safeCard.empty ? " is-empty" : ""}`;
        root.innerHTML = `
          <div class="ops-card-head">
            <div>
              <strong>${escapeHtml(safeCard.title || "状态卡片")}</strong>
              <div class="ops-card-summary">${escapeHtml(safeCard.summary || "当前暂无摘要。")}</div>
            </div>
            <span class="tag">${escapeHtml(safeCard.statusLabel || "待读取")}</span>
          </div>
          ${chips.length ? `
            <div class="ops-card-chip-row">
              ${chips.map((chip) => `<span class="tag">${escapeHtml(chip)}</span>`).join("")}
            </div>
          ` : ""}
          ${rows.length ? `
            <div class="ops-card-list">
              ${rows.map((row) => `<div class="ops-card-row">${escapeHtml(row)}</div>`).join("")}
            </div>
          ` : ""}
          ${warnings.length ? `
            <div class="ops-card-note warning">
              <strong>风险提醒</strong><br />
              ${warnings.map((warning) => escapeHtml(warning)).join("<br />")}
            </div>
          ` : ""}
          ${actions.length ? `
            <div class="ops-card-note">
              <strong>下一步 / 可用动作</strong><br />
              ${actions.map((action) => escapeHtml(action)).join("<br />")}
            </div>
          ` : ""}
        `;
      }

      function buildSecurityArchitectureCardState() {
        const security = activeSecurityStatus;
        if (!security) {
          return buildEmptyOperationsCard("安全架构", "尚未从本地安全接口读取控制面、密钥和信任边界状态。");
        }

        const trustBoundaries = Array.isArray(security.securityArchitecture?.trustBoundaries)
          ? security.securityArchitecture.trustBoundaries
          : [];
        const healthyStatuses = new Set(["ready", "enforced", "bounded", "restricted"]);
        const healthyBoundaryCount = trustBoundaries.filter((entry) => healthyStatuses.has(normalizeText(entry?.status))).length;
        const degradedBoundaries = trustBoundaries
          .filter((entry) => !healthyStatuses.has(normalizeText(entry?.status)))
          .map((entry) => `${entry?.boundaryId || "boundary"}：${entry?.summary || entry?.status || "状态未知"}`);

        return {
          title: "安全架构",
          statusLabel: `姿态 ${formatSecurityPostureLabel(security.securityPosture?.mode)}`,
          summary:
            security.securityArchitecture?.incidentResponse?.summary ||
            security.securityPosture?.summary ||
            "当前安全姿态尚未返回摘要。",
          rows: [
            `控制面：写接口 ${security.apiWriteProtection?.tokenRequired ? "强制 token" : "未强制"}，敏感读 ${security.readProtection?.sensitiveGetRequiresToken ? "受保护" : "开放"}`,
            `密钥：store key ${security.keyManagement?.storeKey?.source || "missing"}，signing key ${security.keyManagement?.signingKey?.source || "missing"}`,
            `Keychain：${security.keyManagement?.keychainAvailable ? "可用" : "不可用"}，偏好 ${security.keyManagement?.keychainPreferred ? "已启用" : "未强制"}`,
            `信任边界：${healthyBoundaryCount}/${trustBoundaries.length || 0} 当前处于受控状态`,
          ],
          chips: Array.isArray(security.securityArchitecture?.principles)
            ? security.securityArchitecture.principles.slice(0, 4)
            : [],
          warnings: [
            ...(security.securityPosture?.mode && security.securityPosture.mode !== "normal"
              ? [security.securityPosture.summary || `当前姿态 ${security.securityPosture.mode}`]
              : []),
            ...degradedBoundaries,
          ],
          actions: Array.isArray(security.securityArchitecture?.incidentResponse?.availablePostures)
            ? [`可切换姿态：${security.securityArchitecture.incidentResponse.availablePostures.map(formatSecurityPostureLabel).join(" / ")}`]
            : [],
        };
      }

      function buildFormalRecoveryCardState() {
        const setupStatus = activeSetupState?.status || activeSetupState || null;
        const flow =
          setupStatus?.formalRecoveryFlow ||
          activeRunnerResult?.autoRecovery?.setupStatus?.formalRecoveryFlow ||
          activeSecurityStatus?.localStorageFormalFlow ||
          null;
        if (!flow) {
          return buildEmptyOperationsCard("正式恢复流程", "尚未拿到本地恢复包、恢复演练和初始化包的正式流程状态。");
        }

        const missingRequiredCodes = Array.isArray(flow.missingRequiredCodes) ? flow.missingRequiredCodes : [];
        const runbook = flow.runbook || null;
        const latestEvidence = runbook?.latestEvidence || null;
        const rehearsalAgeHours =
          flow.rehearsal?.latestPassedRecoveryRehearsalAgeHours != null
            ? Math.round(Number(flow.rehearsal.latestPassedRecoveryRehearsalAgeHours))
            : null;

        return {
          title: "正式恢复流程",
          statusLabel: formatStatusLabel(flow.status),
          summary: flow.summary || "当前暂无正式恢复流程摘要。",
          rows: [
            `正式基线：${flow.durableRestoreReady ? "已达到" : "尚未达到"}，导入目标 ${flow.preferredImportTarget || "unknown"}`,
            runbook?.nextStepLabel
              ? `当前主线：${runbook.nextStepLabel}${runbook.nextStepRequired === false ? "（建议）" : ""}`
              : runbook
                ? "当前主线已全部完成"
                : null,
            missingRequiredCodes.length ? `当前缺口：${missingRequiredCodes.map(formatRecoveryRequirementLabel).join(" / ")}` : "当前没有正式恢复缺口",
            `账本密钥：${formatStatusLabel(flow.storeEncryption?.status)} / ${flow.storeEncryption?.source || "missing"}，系统保护 ${flow.storeEncryption?.systemProtected === true ? "已启用" : flow.storeEncryption?.systemProtected === false ? "未启用" : "按环境"}`,
            `签名密钥：${formatStatusLabel(flow.signingKey?.status)} / ${flow.signingKey?.source || "missing"}，系统保护 ${flow.signingKey?.systemProtected === true ? "已启用" : flow.signingKey?.systemProtected === false ? "未启用" : "按环境"}`,
            `恢复包：${flow.backupBundle?.total || 0} 份，最新状态 ${formatStatusLabel(flow.backupBundle?.status)}`,
            `恢复演练：${flow.rehearsal?.passed || 0}/${flow.rehearsal?.total || 0}，${flow.rehearsal?.status ? formatStatusLabel(flow.rehearsal.status) : "未记录"}${rehearsalAgeHours != null ? `，距今 ${rehearsalAgeHours}h` : ""}`,
            `初始化包：${flow.setupPackage?.total || 0} 份，当前 ${formatStatusLabel(flow.setupPackage?.status)}`,
            latestEvidence
              ? `最近证据：恢复包 ${formatCompactTimestamp(latestEvidence.recoveryBundleCreatedAt)} / 演练 ${formatCompactTimestamp(latestEvidence.recoveryRehearsalCreatedAt)} / 初始化包 ${formatCompactTimestamp(latestEvidence.setupPackageExportedAt)}`
              : null,
          ],
          chips: summarizeOperationsList([
            runbook ? `${runbook.completedStepCount || 0}/${runbook.totalStepCount || 0} 步` : null,
            runbook?.readyToRehearse ? "可直接演练" : null,
            runbook?.readyToExportSetupPackage ? "可导出初始化包" : null,
            flow.integritySignals?.latestBundleIncludesLedgerEnvelope ? "Ledger envelope" : null,
            flow.integritySignals?.latestBundleHasLastEventHash ? "带 lastEventHash" : null,
            flow.integritySignals?.latestBundleHasChainId ? "带 chainId" : null,
            flow.integritySignals?.latestBundleWrappedKeyMode ? `wrapped ${flow.integritySignals.latestBundleWrappedKeyMode}` : null,
          ]),
          warnings: summarizeOperationsList([
            ...missingRequiredCodes.map((code) => `缺项：${formatRecoveryRequirementLabel(code)}`),
            ...(Array.isArray(runbook?.blockingSteps)
              ? runbook.blockingSteps.map((step) => `${step.label || step.code || step.stepId}：${step.summary || "待补齐"}`)
              : []),
          ]),
          actions: summarizeOperationsList([
            runbook?.nextStepLabel
              ? `下一步：${runbook.nextStepLabel}${runbook.nextStepRequired === false ? "（建议）" : ""}`
              : null,
            runbook?.nextStepSummary || null,
            ...(Array.isArray(runbook?.recommendedSteps)
              ? runbook.recommendedSteps.slice(0, 2).map((step) => `建议：${step.label}`)
              : []),
            ...missingRequiredCodes.map((code) => `补齐：${formatRecoveryRequirementLabel(code)}`),
          ]),
        };
      }

      function buildConstrainedExecutionCardState() {
        const runtime = activeRuntime || null;
        const baseline =
          runtime?.deviceRuntime?.constrainedExecutionSummary ||
          activeSecurityStatus?.constrainedExecution ||
          null;
        const policy =
          runtime?.deviceRuntime?.constrainedExecutionPolicy ||
          runtime?.deviceRuntime?.sandboxPolicy ||
          {};
        const latestExecution =
          activeRunnerResult?.constrainedExecution ||
          activeRunnerResult?.sandboxExecution ||
          activeSandboxResult ||
          null;

        if (!baseline && !latestExecution) {
          return buildEmptyOperationsCard("受限执行层", "尚未读取受限执行白名单、预算或最近一次受限执行结果。");
        }

        const allowedCapabilities = Array.isArray(policy.allowedCapabilities) ? policy.allowedCapabilities : [];
        const latestExecutionStatus =
          latestExecution?.executed
            ? "已执行"
            : latestExecution?.blocked
              ? "已阻断"
              : latestExecution?.error
                ? "执行失败"
                : "未执行";
        const latestBrokerIsolation = latestExecution?.output?.brokerIsolation || null;
        const latestWorkerIsolation = latestExecution?.output?.workerIsolation || null;
        const latestSystemSandbox = latestBrokerIsolation?.systemSandbox || null;
        const brokerRuntime = baseline?.brokerRuntime || null;
        const workerRuntime = baseline?.workerRuntime || null;

        return {
          title: "受限执行层",
          statusLabel: baseline?.status ? formatStatusLabel(baseline.status) : latestExecutionStatus,
          summary:
            latestExecution?.summary ||
            baseline?.summary ||
            "当前暂无受限执行摘要。",
          rows: [
            baseline ? `执行层级：${formatStatusLabel(baseline.status)} / ${baseline.capabilityTier || "unknown"}` : null,
            baseline
              ? `隔离与预算：broker ${baseline.brokerIsolationEnabled ? "开启" : "关闭"}，worker ${baseline.workerIsolationEnabled ? "开启" : "关闭"}，读取 ${baseline.budgets?.maxReadBytes || 0}B，列表 ${baseline.budgets?.maxListEntries || 0}`
              : null,
            brokerRuntime
              ? `Broker 基线：边界 ${brokerRuntime.backend || "unknown"}，env ${brokerRuntime.brokerEnvMode || "unknown"}，工作区 ${brokerRuntime.workspaceMode || "unknown"}`
              : null,
            baseline?.systemBrokerSandbox
              ? `Broker 系统层：${formatStatusLabel(baseline.systemBrokerSandbox.status)}，${baseline.systemBrokerSandbox.backend || "unknown"}`
              : null,
            workerRuntime
              ? `Worker 基线：worker env ${workerRuntime.workerEnvMode || "unknown"}，进程 env ${workerRuntime.processEnvMode || "unknown"}，工作区 ${workerRuntime.processWorkspaceMode || "unknown"}`
              : null,
            baseline ? `Shell / 外网：${baseline.allowShellExecution ? "按 allowlist 放行" : "关闭"} / ${baseline.allowExternalNetwork ? "受限开启" : "关闭"}` : null,
            baseline ? `白名单能力 ${baseline.allowedCapabilityCount || 0} 项，命令钉住 ${baseline.pinnedCommandCount || 0}，文件根 ${baseline.filesystemRootCount || 0}` : null,
            latestExecution ? `最近一次：${latestExecution.capability || "无 capability"}，${latestExecutionStatus}` : null,
            latestBrokerIsolation
              ? `最近 broker：边界 ${latestBrokerIsolation.boundary || "unknown"}，env ${latestBrokerIsolation.brokerEnvMode || "unknown"}，工作区 ${latestBrokerIsolation.workspaceMode || "unknown"}，清理 ${latestBrokerIsolation.cleanupStatus || "unknown"}`
              : null,
            latestSystemSandbox
              ? `最近系统 sandbox：${formatStatusLabel(latestSystemSandbox.status)}，${latestSystemSandbox.backend || "unknown"}，读根 ${latestSystemSandbox.readRootCount || 0}，网络口 ${latestSystemSandbox.networkPortCount || 0}`
              : null,
            latestWorkerIsolation
              ? `最近 worker：worker env ${latestWorkerIsolation.workerEnvMode || "unknown"}，进程 env ${latestWorkerIsolation.processEnvMode || "unknown"}，工作区 ${latestWorkerIsolation.workspaceMode || "unknown"}，清理 ${latestWorkerIsolation.cleanupStatus || "unknown"}`
              : null,
          ],
          chips: allowedCapabilities.slice(0, 5),
          warnings: summarizeOperationsList([
            ...(Array.isArray(baseline?.warnings) ? baseline.warnings : []),
            ...(Array.isArray(baseline?.blockedReasons) ? baseline.blockedReasons : []),
            ...(Array.isArray(latestExecution?.gateReasons) ? latestExecution.gateReasons : []),
            ...(Array.isArray(latestSystemSandbox?.warnings) ? latestSystemSandbox.warnings : []),
            latestExecution?.error ? `最近错误：${latestExecution.error}` : null,
          ]),
          actions: latestExecution?.capability
            ? [`最近能力：${latestExecution.capability}`]
            : allowedCapabilities.length
              ? [`当前 allowlist：${allowedCapabilities.join(" / ")}`]
              : [],
        };
      }

      function buildAutomaticRecoveryCardState() {
        const setupStatus = activeSetupState?.status || activeSetupState || null;
        const latestAudit = Array.isArray(activeRunnerHistory?.autoRecoveryAudits)
          ? activeRunnerHistory.autoRecoveryAudits.at(-1) || null
          : null;
        const latestAutoRecovery = activeRunnerResult?.autoRecovery || latestAudit || null;
        const readiness =
          latestAutoRecovery?.setupStatus?.activePlanReadiness ||
          latestAutoRecovery?.setupStatus?.automaticRecoveryReadiness ||
          setupStatus?.automaticRecoveryReadiness ||
          activeSecurityStatus?.automaticRecovery ||
          null;
        const actionMatrix =
          latestAutoRecovery?.setupStatus?.activePlanReadiness?.actions ||
          latestAutoRecovery?.setupStatus?.automaticRecoveryReadiness?.actions ||
          setupStatus?.automaticRecoveryReadiness?.actions ||
          null;
        const activePlan = latestAutoRecovery?.plan || null;
        const closure = latestAutoRecovery?.closure || null;
        const closurePhases = Array.isArray(closure?.phases) ? closure.phases : [];
        const gatePhase = closurePhases.find((entry) => normalizeText(entry?.phaseId) === "gate") || null;
        const executionPhase = closurePhases.find((entry) => normalizeText(entry?.phaseId) === "execution") || null;
        const verificationPhase = closurePhases.find((entry) => normalizeText(entry?.phaseId) === "verification") || null;
        const outcomePhase = closurePhases.find((entry) => normalizeText(entry?.phaseId) === "outcome") || null;

        if (!latestAutoRecovery && !readiness) {
          return buildEmptyOperationsCard("自动恢复 / 续跑", "尚未读取自动恢复 readiness，也还没有最近一次自动接力结果。");
        }

        const availableActions = actionMatrix && typeof actionMatrix === "object"
          ? Object.entries(actionMatrix).map(([key, value]) =>
              value?.ready
                ? `${formatAutoRecoveryActionLabel(key)}：可接力`
                : `${formatAutoRecoveryActionLabel(key)}：待门禁 ${Array.isArray(value?.gateReasons) && value.gateReasons.length ? value.gateReasons.join(", ") : "未就绪"}`
            )
          : [];
        const chainLength = Array.isArray(latestAutoRecovery?.chain) ? latestAutoRecovery.chain.length : 0;
        const warningItems = summarizeOperationsList([
          ...(Array.isArray(latestAutoRecovery?.gateReasons) ? latestAutoRecovery.gateReasons : []),
          ...(Array.isArray(latestAutoRecovery?.dependencyWarnings) ? latestAutoRecovery.dependencyWarnings : []),
          ...(!latestAutoRecovery && Array.isArray(readiness?.gateReasons) ? readiness.gateReasons : []),
          latestAutoRecovery?.error ? `最近失败：${latestAutoRecovery.error}` : null,
        ]);

        return {
          title: "自动恢复 / 续跑",
          statusLabel: latestAutoRecovery?.status ? formatStatusLabel(latestAutoRecovery.status) : formatStatusLabel(readiness?.status),
          summary:
            latestAutoRecovery?.summary ||
            readiness?.summary ||
            "当前暂无自动恢复摘要。",
          rows: [
            activePlan?.action ? `当前计划：${formatAutoRecoveryActionLabel(activePlan.action)}` : null,
            latestAutoRecovery?.attempt != null && latestAutoRecovery?.maxAttempts != null
              ? `尝试次数：${latestAutoRecovery.attempt}/${latestAutoRecovery.maxAttempts}`
              : readiness?.maxAutomaticRecoveryAttempts != null
                ? `默认上限：${readiness.maxAutomaticRecoveryAttempts}`
                : null,
            closurePhases.length
              ? `闭环阶段：${closurePhases.map((entry) => `${formatAutoRecoveryPhaseLabel(entry.phaseId)} ${formatStatusLabel(entry.status)}`).join(" -> ")}`
              : null,
            gatePhase?.summary ? `门禁：${gatePhase.summary}` : null,
            executionPhase?.summary ? `执行：${executionPhase.summary}` : null,
            verificationPhase?.summary ? `校验：${verificationPhase.summary}` : null,
            outcomePhase?.summary ? `收口：${outcomePhase.summary}` : null,
            latestAudit?.timestamp ? `最近审计：${formatCompactTimestamp(latestAudit.timestamp)}` : null,
            chainLength ? `恢复链条：${chainLength} 步` : null,
            latestAutoRecovery?.finalStatus ? `最终运行状态：${formatStatusLabel(latestAutoRecovery.finalStatus)}` : null,
            latestAutoRecovery?.triggerRunId ? `触发运行：${latestAutoRecovery.triggerRunId}` : null,
            setupStatus?.formalRecoveryFlow?.durableRestoreReady != null
              ? `正式恢复基线：${setupStatus.formalRecoveryFlow.durableRestoreReady ? "已满足" : "未满足"}`
              : null,
          ],
          chips: summarizeOperationsList([
            latestAutoRecovery?.resumed ? "已自动接力" : null,
            latestAutoRecovery?.ready ? "计划可执行" : null,
            readiness?.formalFlowReady ? "正式恢复已就绪" : null,
            closure?.status ? `闭环 ${formatStatusLabel(closure.status)}` : null,
            latestAudit ? "最近闭环已落盘" : null,
          ]),
          warnings: warningItems,
          actions: activePlan?.summary
            ? [activePlan.summary, ...availableActions.slice(0, 3)]
            : availableActions.slice(0, 4),
        };
      }

      function renderOperationalArchitectureCards() {
        renderOperationsCard("security-architecture-card", buildSecurityArchitectureCardState());
        renderOperationsCard("formal-recovery-card", buildFormalRecoveryCardState());
        renderOperationsCard("constrained-execution-card", buildConstrainedExecutionCardState());
        renderOperationsCard("automatic-recovery-card", buildAutomaticRecoveryCardState());
      }

      function renderCapabilityBoundary(boundary = null) {
        const root = document.getElementById("capability-boundary-grid");
        if (!root) {
          return;
        }

        const boundaryLabels = {
          identity: "本地身份",
          verification: "本地校验",
          cognition: "运行状态摘要",
          recovery: "恢复位置",
          ledger: "本地账本",
        };
        const statusLabels = {
          bounded_local: "本地受限成立",
          bounded_auto_recovery: "有限自动恢复",
          locally_verifiable: "本地可校验",
          heuristic_state_layer: "启发式状态层",
          guided_recovery: "引导式恢复",
          integrity_protected_local_store: "本地加密账本",
          needs_review: "需要复核",
        };

        const entries = boundary && typeof boundary === "object" ? Object.entries(boundary) : [];
        if (!entries.length) {
          root.innerHTML = `
            <div class="guide-card">
              <strong>暂时不可用</strong>
              当前还没有从能力接口读取到能力边界。
            </div>
          `;
          return;
        }

        root.innerHTML = entries.map(([key, value]) => {
          const guaranteed = Array.isArray(value?.guaranteed) ? value.guaranteed.slice(0, 3) : [];
          const notYet = Array.isArray(value?.notYet) ? value.notYet.slice(0, 2) : [];
          return `
            <div class="guide-card">
              <strong>${boundaryLabels[key] || key}</strong>
              <div class="meta">${value?.summary || "暂无摘要"}</div>
              <div class="meta">当前状态：${statusLabels[value?.status] || value?.status || "unknown"}</div>
              <div class="meta">已经做到：${guaranteed.join(" / ") || "暂无"}</div>
              <div class="meta">还没做到：${notYet.join(" / ") || "暂无"}</div>
            </div>
          `;
        }).join("");
      }

      async function loadCapabilityBoundary() {
        try {
          const capabilities = await request("/api/capabilities");
          renderCapabilityBoundary(capabilities?.capabilityBoundary || null);
          return capabilities?.capabilityBoundary || null;
        } catch (error) {
          renderCapabilityBoundary(null);
          return null;
        }
      }

      async function loadAgentRuntimeSummary(agentId) {
        if (!agentId) {
          return null;
        }
        try {
          return await request(`/api/agents/${encodeURIComponent(agentId)}/runtime-summary`);
        } catch (error) {
          return null;
        }
      }

      function setArchiveActionStatus(message) {
        const root = document.getElementById("archive-action-status");
        if (root) {
          root.textContent = message || "当前还没有归档操作。";
        }
      }

      function downloadJsonFile(filename, payload) {
        const blob = new Blob([stringifyJsonValue(payload)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      }

      function buildArchiveEvidencePack() {
        return {
          kind: "archive_evidence_pack",
          exportedAt: new Date().toISOString(),
          agentId: activeAgentId,
          windowId,
          filters: buildArchivesOptionsFromForm(),
          archiveView: activeArchivedState,
          runtimeSummary: activeRuntime,
        };
      }

      function buildArchiveRestoreEvidencePack() {
        return {
          kind: "archive_restore_evidence_pack",
          exportedAt: new Date().toISOString(),
          agentId: activeAgentId,
          windowId,
          filters: buildArchiveRestoreOptionsFromForm(),
          restoreHistory: activeArchiveRestoreHistory,
          runtimeSummary: activeRuntime,
        };
      }

      function buildAutoRecoveryAuditEvidencePack(audit = activeAutoRecoveryAudit) {
        return {
          kind: "auto_recovery_audit_evidence_pack",
          exportedAt: new Date().toISOString(),
          agentId: activeAgentId,
          windowId,
          filter: getAutoRecoveryAuditFilterValue(),
          selectedAudit: audit,
          runnerHistoryCounts: activeRunnerHistory?.counts || null,
          runtimeSummary: activeRuntime,
          setupSummary: activeSetupState?.status || activeSetupState || null,
          securitySummary: activeSecurityStatus || null,
        };
      }

      function renderArchiveRestoreHistory(result = null) {
        const summaryRoot = document.getElementById("archive-restores-summary");
        const actionsRoot = document.getElementById("archive-restores-actions");
        const jsonRoot = document.getElementById("archive-restores-json");
        activeArchiveRestoreHistory = result || null;
        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载恢复历史";
          }
          if (actionsRoot) {
            actionsRoot.innerHTML = "";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "恢复历史会显示在这里。";
          }
          return;
        }
        const latest = Array.isArray(result.events) ? result.events[0] || null : null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            `最近恢复 ${result.counts?.total || 0} 条`,
            result.kind ? `筛选 ${result.kind}` : null,
            result.restoredFrom ? `起始 ${result.restoredFrom}` : null,
            result.restoredTo ? `结束 ${result.restoredTo}` : null,
            latest?.payload?.archiveKind ? `最近类型 ${latest.payload.archiveKind}` : null,
            latest?.payload?.restoredRecordId ? `最近记录 ${latest.payload.restoredRecordId}` : null,
            latest?.timestamp ? `最近时间 ${latest.timestamp}` : null,
          ].filter(Boolean).join(" · ");
        }
        if (actionsRoot) {
          const events = Array.isArray(result.events) ? result.events.slice(0, 6) : [];
          actionsRoot.innerHTML = events.length
            ? events.map((event, index) => `
                <button
                  class="secondary archive-restore-revert"
                  type="button"
                  data-restore-index="${index}"
                >
                  撤回 ${escapeHtml(String(event?.payload?.restoredRecordId || `restore_${index + 1}`).slice(0, 28))}
                </button>
              `).join("")
            : "";
        }
        if (jsonRoot) {
          setJsonText(jsonRoot, result, "恢复历史会显示在这里。");
        }
      }

      function renderRuntimeQuickSummary(summary = null) {
        const root = document.getElementById("runtime-quick-summary");
        if (!root) {
          return;
        }
        if (!summary) {
          root.textContent = "尚未加载运行摘要";
          return;
        }
        root.textContent = [
          summary.task?.title || summary.task?.objective || "暂无任务摘要",
          summary.task?.status ? `任务状态 ${formatStatusLabel(summary.task.status)}` : null,
          summary.hybridRuntime?.gemmaPreferred ? "Gemma 优先" : null,
          summary.hybridRuntime?.selectionNeedsMigration ? "当前仍沿用旧本地回答配置" : null,
          summary.hybridRuntime?.preferredProvider
            ? `回答方式 ${formatReasonerProviderLabel(summary.hybridRuntime.preferredProvider)}`
            : null,
          summary.hybridRuntime?.preferredModel ? `模型 ${summary.hybridRuntime.preferredModel}` : null,
          summary.hybridRuntime?.localReasoner?.timeoutMs
            ? `超时 ${summary.hybridRuntime.localReasoner.timeoutMs}ms`
            : null,
          summary.hybridRuntime?.selectionNeedsMigration && summary.hybridRuntime?.defaultPreferredProvider
            ? `默认应为 ${formatReasonerProviderLabel(summary.hybridRuntime.defaultPreferredProvider)}`
            : null,
          summary.hybridRuntime?.selectionNeedsMigration && summary.hybridRuntime?.defaultPreferredModel
            ? `默认模型 ${summary.hybridRuntime.defaultPreferredModel}`
            : null,
          summary.hybridRuntime?.selectionNeedsMigration && summary.hybridRuntime?.defaultPreferredTimeoutMs
            ? `默认超时 ${summary.hybridRuntime.defaultPreferredTimeoutMs}ms`
            : null,
          summary.hybridRuntime?.latestRunUsedGemma ? "最近实跑 Gemma4 成功" : null,
          summary.hybridRuntime?.latestFallbackActivated ? "最近一次已回退 fallback" : null,
          !summary.hybridRuntime?.latestFallbackActivated && !summary.hybridRuntime?.latestRunUsedGemma && summary.hybridRuntime?.latestRunProvider
            ? `最近实跑 ${formatReasonerProviderLabel(summary.hybridRuntime.latestRunProvider)}`
            : null,
          summary.hybridRuntime?.latestRunModel ? `最近实跑模型 ${summary.hybridRuntime.latestRunModel}` : null,
          summary.hybridRuntime?.latestRunInitialError
            ? `回退前错误 ${summary.hybridRuntime.latestRunInitialError}`
            : null,
          summary.hybridRuntime?.fallback?.recentFallbackRuns != null
            ? `本地 fallback ${summary.hybridRuntime.fallback.recentFallbackRuns}`
            : null,
          summary.runner?.degradedRuns != null ? `降级运行 ${summary.runner.degradedRuns}` : null,
          summary.cognition?.mode ? `当前状态模式 ${summary.cognition.mode}` : null,
          summary.cognition?.dominantStage ? `当前重点 ${summary.cognition.dominantStage}` : null,
          summary.cognition?.dynamics?.dominantRhythm
            ? `节律 ${friendlyCognitiveRhythm(summary.cognition.dynamics.dominantRhythm)}`
            : null,
          summary.cognition?.dynamics?.replayOrchestration?.replayMode
            ? `重放 ${friendlyReplayMode(summary.cognition.dynamics.replayOrchestration.replayMode)}`
            : null,
          Number.isFinite(Number(summary.memory?.activePassportMemories))
            ? `活跃记忆 ${summary.memory.activePassportMemories}`
            : null,
          Number.isFinite(Number(summary.memory?.archivedPassportMemories))
            ? `归档记忆 ${summary.memory.archivedPassportMemories}`
            : null,
          summary.memory?.hotCounts?.semantic != null ? `热经验 ${summary.memory.hotCounts.semantic}` : null,
          summary.memory?.coldCounts?.semantic != null ? `冷经验 ${summary.memory.coldCounts.semantic}` : null,
          Number.isFinite(Number(summary.memory?.physicalArchive?.passportMemoryCount))
            ? `已归档记忆文件 ${summary.memory.physicalArchive.passportMemoryCount}`
            : null,
          Number.isFinite(Number(summary.transcript?.physicalArchive?.transcriptCount))
            ? `已归档对话文件 ${summary.transcript.physicalArchive.transcriptCount}`
            : null,
          summary.residentGate?.required ? "当前仍需恢复或解锁" : "当前可继续",
        ].filter(Boolean).join(" · ");
      }

      function formatCognitiveScore(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          return null;
        }
        return numeric.toFixed(2);
      }

      function friendlyCognitiveRhythm(value) {
        const map = {
          theta_like: "theta-like",
          sharp_wave_ripple_like: "sharp-wave/ripple-like",
          slow_homeostatic_scaling_like: "slow-homeostatic",
        };
        return map[String(value || "").trim()] || value || null;
      }

      function friendlyCognitivePhase(value) {
        const map = {
          online_theta_like: "在线维持",
          offline_ripple_like: "离线重放",
          offline_homeostatic: "离线稳态",
        };
        return map[String(value || "").trim()] || value || null;
      }

      function friendlyReplayMode(value) {
        const map = {
          goal_maintenance_only: "仅维持目标",
          interleaved_theta_ripple: "交错重放",
          hippocampal_trace_replay: "痕迹重放",
          homeostatic_down_selection: "稳态下调",
        };
        return map[String(value || "").trim()] || value || null;
      }

      function formatCognitiveModeLabel(value) {
        const normalized = normalizeText(value);
        const labels = {
          stable: "稳定",
          learning: "学习中",
          self_calibrating: "自校准",
          recovering: "恢复中",
          bootstrap_required: "等待补齐启动包",
          resident_locked: "常驻锁定",
        };
        return labels[normalized] || normalized || "未命名模式";
      }

      function formatCognitiveStageLabel(value) {
        const normalized = normalizeText(value);
        const labels = {
          perception: "感知",
          working: "工作记忆",
          episodic: "情节",
          semantic: "抽象经验",
          identity: "身份",
        };
        return labels[normalized] || normalized || "未命名阶段";
      }

      function formatCognitiveReasonLabel(value) {
        const normalized = normalizeText(value);
        const labels = {
          runtime_recovery_bias: "恢复偏置",
          goal_maintenance_bias: "目标维持偏置",
          replay_window_bias: "重放窗口偏置",
          homeostatic_pressure_bias: "稳态压力偏置",
          session_initialized: "初始化会话",
          session_refreshed: "刷新会话",
          verification_runtime_integrity: "运行态检查",
          verification_resume_boundary: "恢复边界检查",
          runner_bootstrap_required: "等待 bootstrap",
        };
        return labels[normalized] || normalized || "未命名原因";
      }

      function summarizeCognitiveDynamics(state = null) {
        if (!state || typeof state !== "object") {
          return null;
        }

        const dynamics = state.dynamics && typeof state.dynamics === "object" ? state.dynamics : state;
        const interoceptiveState =
          dynamics.interoceptiveState && typeof dynamics.interoceptiveState === "object"
            ? dynamics.interoceptiveState
            : {};
        const schedule =
          dynamics.oscillationSchedule && typeof dynamics.oscillationSchedule === "object"
            ? dynamics.oscillationSchedule
            : {};
        const replay =
          dynamics.replayOrchestration && typeof dynamics.replayOrchestration === "object"
            ? dynamics.replayOrchestration
            : {};
        const targetTraceClasses = Array.isArray(replay.targetTraceClasses)
          ? replay.targetTraceClasses.slice(0, 2).join("/")
          : null;
        const summary = [
          dynamics.sleepPressure != null ? `睡压 ${formatCognitiveScore(dynamics.sleepPressure)}` : null,
          interoceptiveState.bodyBudget != null ? `体内预算 ${formatCognitiveScore(interoceptiveState.bodyBudget)}` : null,
          dynamics.dominantRhythm ? `节律 ${friendlyCognitiveRhythm(dynamics.dominantRhythm)}` : null,
          schedule.currentPhase ? `相位 ${friendlyCognitivePhase(schedule.currentPhase)}` : null,
          replay.replayMode
            ? `重放 ${friendlyReplayMode(replay.replayMode)}${replay.shouldReplay === false ? "（待机）" : ""}`
            : replay.shouldReplay === true
              ? "重放已打开"
              : null,
          targetTraceClasses ? `目标 ${targetTraceClasses}` : null,
        ].filter(Boolean);
        return summary.length ? summary.join(" · ") : null;
      }

      function buildCognitiveDynamicsEvidencePack() {
        const runtimeCognitiveState =
          activeRuntime?.cognitiveState && typeof activeRuntime.cognitiveState === "object"
            ? activeRuntime.cognitiveState
            : activeRuntime?.runtimeStateSummary && typeof activeRuntime.runtimeStateSummary === "object"
              ? activeRuntime.runtimeStateSummary
              : null;
        return {
          kind: "cognitive_dynamics_evidence_pack",
          exportedAt: new Date().toISOString(),
          agentId: activeAgentId || null,
          runtimeSummary: activeRuntime || null,
          cognitiveState: runtimeCognitiveState,
          cognitiveTransitions: activeCognitiveTransitions || null,
          offlineReplay:
            activeOfflineReplayResult && activeOfflineReplayResult.agentId === activeAgentId
              ? activeOfflineReplayResult
              : null,
        };
      }

      function renderCognitiveDynamicsPanel(runtime = activeRuntime) {
        const summaryRoot = document.getElementById("cognitive-dynamics-summary");
        const detailRoot = document.getElementById("cognitive-dynamics-detail");
        const listRoot = document.getElementById("cognitive-transition-list");
        const jsonRoot = document.getElementById("cognitive-dynamics-json");
        const transitionsJsonRoot = document.getElementById("cognitive-transitions-json");
        const replaySummaryRoot = document.getElementById("offline-replay-summary");
        const replayJsonRoot = document.getElementById("offline-replay-json");
        const state =
          runtime?.cognitiveState && typeof runtime.cognitiveState === "object"
            ? runtime.cognitiveState
            : runtime?.runtimeStateSummary && typeof runtime.runtimeStateSummary === "object"
              ? runtime.runtimeStateSummary
              : null;
        const dynamics = state?.dynamics && typeof state.dynamics === "object" ? state.dynamics : state;
        const interoception =
          dynamics?.interoceptiveState && typeof dynamics.interoceptiveState === "object"
            ? dynamics.interoceptiveState
            : {};
        const modulators =
          dynamics?.neuromodulators && typeof dynamics.neuromodulators === "object"
            ? dynamics.neuromodulators
            : {};
        const schedule =
          dynamics?.oscillationSchedule && typeof dynamics.oscillationSchedule === "object"
            ? dynamics.oscillationSchedule
            : {};
        const replay =
          dynamics?.replayOrchestration && typeof dynamics.replayOrchestration === "object"
            ? dynamics.replayOrchestration
            : {};
        const transitions = Array.isArray(activeCognitiveTransitions?.transitions)
          ? activeCognitiveTransitions.transitions
          : [];
        const offlineReplay =
          activeOfflineReplayResult && activeOfflineReplayResult.agentId === activeAgentId
            ? activeOfflineReplayResult
            : null;
        const offlineReplaySummary = offlineReplay?.maintenance?.offlineReplay || null;

        if (summaryRoot) {
          summaryRoot.textContent = state
            ? [
                state.mode ? `模式 ${formatCognitiveModeLabel(state.mode)}` : null,
                state.dominantStage ? `重点 ${formatCognitiveStageLabel(state.dominantStage)}` : null,
                state.continuityScore != null ? `连续性 ${state.continuityScore}` : null,
                state.calibrationScore != null ? `校准 ${state.calibrationScore}` : null,
                state.recoveryReadinessScore != null ? `续跑准备 ${state.recoveryReadinessScore}` : null,
                summarizeCognitiveDynamics(state),
              ].filter(Boolean).join(" · ")
            : "尚未加载认知动态";
        }

        if (detailRoot) {
          detailRoot.textContent = state
            ? [
                state.currentGoal ? `目标 ${state.currentGoal}` : null,
                dynamics?.bodyLoop?.overallLoad != null
                  ? `整体负荷 ${formatCognitiveScore(dynamics.bodyLoop.overallLoad)}`
                  : null,
                dynamics?.bodyLoop?.conflictDensity != null
                  ? `冲突密度 ${formatCognitiveScore(dynamics.bodyLoop.conflictDensity)}`
                  : null,
                interoception.bodyBudget != null
                  ? `体内预算 ${formatCognitiveScore(interoception.bodyBudget)}`
                  : null,
                interoception.interoceptivePredictionError != null
                  ? `预测误差 ${formatCognitiveScore(interoception.interoceptivePredictionError)}`
                  : null,
                modulators.dopamineRpe != null ? `RPE ${formatCognitiveScore(modulators.dopamineRpe)}` : null,
                modulators.norepinephrineSurprise != null
                  ? `惊异 ${formatCognitiveScore(modulators.norepinephrineSurprise)}`
                  : null,
                schedule.currentPhase ? `当前相位 ${friendlyCognitivePhase(schedule.currentPhase)}` : null,
                schedule.nextPhase ? `下一相位 ${friendlyCognitivePhase(schedule.nextPhase)}` : null,
                schedule.transitionReason
                  ? `切换原因 ${formatCognitiveReasonLabel(schedule.transitionReason)}`
                  : null,
                replay.gatingReason ? `重放门控 ${replay.gatingReason}` : null,
                replay.replayWindowHours != null ? `重放窗 ${replay.replayWindowHours}h` : null,
              ].filter(Boolean).join(" · ")
            : "认知动态细节会显示在这里。";
        }

        if (listRoot) {
          if (!transitions.length) {
            listRoot.innerHTML = '<div class="status-empty">最近迁移会显示在这里。</div>';
          } else {
            listRoot.innerHTML = transitions
              .slice()
              .reverse()
              .map((entry) => {
                const title =
                  entry?.fromMode || entry?.toMode
                    ? `${formatCognitiveModeLabel(entry.fromMode || "cold_start")} -> ${formatCognitiveModeLabel(entry.toMode || "stable")}`
                    : "认知状态迁移";
                const detail = [
                  entry?.toStage ? `重点 ${formatCognitiveStageLabel(entry.toStage)}` : null,
                  entry?.transitionReason
                    ? `原因 ${formatCognitiveReasonLabel(entry.transitionReason)}`
                    : null,
                  entry?.continuityScore != null ? `连续性 ${entry.continuityScore}` : null,
                  entry?.calibrationScore != null ? `校准 ${entry.calibrationScore}` : null,
                  entry?.recoveryReadinessScore != null ? `续跑准备 ${entry.recoveryReadinessScore}` : null,
                  entry?.driftScore != null ? `漂移 ${formatCognitiveScore(entry.driftScore)}` : null,
                  entry?.queryIteration != null ? `轮次 ${entry.queryIteration}` : null,
                  entry?.runId ? `运行 ${entry.runId}` : null,
                ].filter(Boolean).join(" · ");
                return `
                  <details class="status-panel">
                    <summary>
                      <span>${escapeHtml(title)}</span>
                      <span class="tag">${escapeHtml(formatCompactTimestamp(entry?.createdAt || ""))}</span>
                    </summary>
                    <div class="meta">${escapeHtml(detail || "暂无迁移细节。")}</div>
                    <pre class="status-json">${escapeJsonHtml(entry)}</pre>
                  </details>
                `;
              })
              .join("");
          }
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, state, "认知动态会显示在这里。");
        }

        if (transitionsJsonRoot) {
          setJsonText(transitionsJsonRoot, activeCognitiveTransitions, "认知迁移会显示在这里。");
        }

        if (replaySummaryRoot) {
          replaySummaryRoot.textContent = offlineReplaySummary
            ? [
                offlineReplaySummary.triggered ? "已触发" : "本轮未触发",
                offlineReplaySummary.reason ? `结果 ${offlineReplaySummary.reason}` : null,
                offlineReplaySummary.replayedPatternCount != null
                  ? `写入 ${offlineReplaySummary.replayedPatternCount}`
                  : null,
                Array.isArray(offlineReplaySummary.selectedGroupKeys) &&
                offlineReplaySummary.selectedGroupKeys.length
                  ? `模式簇 ${offlineReplaySummary.selectedGroupKeys.slice(0, 2).join("/")}`
                  : null,
                offlineReplay?.currentGoal ? `目标 ${offlineReplay.currentGoal}` : null,
              ].filter(Boolean).join(" · ")
            : "尚未执行离线 replay";
        }

        if (replayJsonRoot) {
          setJsonText(replayJsonRoot, offlineReplay, "离线 replay 结果会显示在这里。");
        }
      }

      function renderKeychainMigrationResult(result) {
        const root = document.getElementById("keychain-migration-json");
        if (!root) {
          return;
        }
        setJsonText(root, result, "钥匙串迁移结果会显示在这里。");
      }

      function renderReadSessionState(result) {
        const root = document.getElementById("read-session-json");
        if (!root) {
          return;
        }
        setJsonText(root, result, "只读访问列表和最新凭证会显示在这里。");
      }

      function formatRepairScopeLabel(scope) {
        const normalized = normalizeText(scope);
        const labels = {
          comparison_pair: "对比组合",
          agent_identity: "助手身份",
          authorization_receipt: "授权回执",
        };
        return labels[normalized] || normalized || "未命名范围";
      }

      function renderAgents(agents) {
        const root = document.getElementById("agents");
        const normalizedAgents = Array.isArray(agents) ? agents : [];
        activeAgentDirectory = normalizedAgents;

        if (!normalizedAgents.length) {
          root.innerHTML = `
            <article class="card">
              <strong>还没有助手身份</strong>
              <div class="meta">先在上面的“第 1 步：创建助手身份”里创建一个助手，后面的按钮才会逐步可用。</div>
            </article>
          `;
          syncWorkflowProgress();
          return;
        }

        if (!activeAgentId) {
          setActiveAgent(normalizedAgents[0].agentId);
        }

        root.innerHTML = normalizedAgents.map((agent) => `
          <article class="card">
            <strong>${agent.displayName}</strong>
            <span class="tag">${agent.agentId}</span>
            <div class="meta">
              角色：${agent.role}<br />
              控制人：${agent.controller}<br />
              父身份：${agent.parentAgentId || "无"}<br />
              DID：${agent.identity?.did || "无"}<br />
              钱包：${agent.identity?.walletAddress || "无"}<br />
              来源 DID：${agent.identity?.originDid || "无"}<br />
              多签：${agent.identity?.authorizationPolicy?.type || "single-sig"} / ${agent.identity?.authorizationPolicy?.threshold || 1}<br />
              签名者：${(agent.identity?.authorizationPolicy?.signers || []).map((signer) => signer.label || signer.walletAddress).join(" · ") || "无"}<br />
              Credits：${agent.balances.credits}
            </div>
            <div class="card-actions">
              <button class="secondary inspect-agent" type="button" data-agent-id="${agent.agentId}" data-agent-action="context">查看中枢</button>
              <button class="secondary" type="button" data-agent-id="${agent.agentId}" data-agent-action="credential">加载证据</button>
            </div>
          </article>
        `).join("");
        syncWorkflowProgress();
      }

      function renderWindowContextPanel() {
        const bindingRoot = document.getElementById("window-binding-summary");
        const referenceRoot = document.getElementById("window-reference-summary");
        const jsonRoot = document.getElementById("window-context-json");
        const focusButton = document.getElementById("focus-local-window-context");
        const followButton = document.getElementById("follow-window-context-agent");
        const refreshButton = document.getElementById("refresh-window-context");
        const localWindowId = localWindowBinding?.windowId || windowId;
        const referencedWindowId = activeWindowContextId || localWindowId;
        const referencedBinding =
          activeWindowContextBinding?.windowId === referencedWindowId
            ? activeWindowContextBinding
            : referencedWindowId === localWindowId
              ? localWindowBinding
              : null;
        const isCurrentWindow = referencedWindowId === localWindowId;
        const matchesActiveAgent = referencedBinding?.agentId
          ? referencedBinding.agentId === activeAgentId
          : null;

        if (bindingRoot) {
          bindingRoot.textContent = localWindowBinding
            ? `本地窗口绑定：${summarizeWindowBinding(localWindowBinding)}`
            : `本地窗口绑定：当前窗口 ${windowId} 尚未绑定`;
        }

        if (referenceRoot) {
          if (activeWindowContextError) {
            referenceRoot.textContent = `引用窗口：${referencedWindowId} · 读取失败：${activeWindowContextError}`;
          } else if (referencedBinding) {
            referenceRoot.textContent = isCurrentWindow
              ? `引用窗口：当前窗口 ${referencedWindowId} · ${referencedBinding.agentId || "未绑定"}`
              : `引用窗口：${summarizeWindowBinding(referencedBinding)} · ${matchesActiveAgent ? "与当前视角一致" : "与当前视角不同"}`;
          } else {
            referenceRoot.textContent = `引用窗口：${referencedWindowId} · 正在解析`;
          }
        }

        if (jsonRoot) {
          setJsonText(
            jsonRoot,
            {
              dashboardView: {
                agentId: activeAgentId || null,
                didMethod: dashboardDidMethodLabel(activeDashboardDidMethod),
                localWindowId,
                referencedWindowId,
              },
              localWindowBinding,
              referencedWindowBinding: referencedBinding,
              consistency: {
                referencedIsCurrentWindow: isCurrentWindow,
                referencedAgentMatchesDashboard: matchesActiveAgent,
              },
              error: activeWindowContextError || null,
            },
            "尚未读取窗口上下文。"
          );
        }

        if (focusButton) {
          focusButton.disabled = isCurrentWindow;
          focusButton.dataset.windowId = localWindowId;
        }

        if (followButton) {
          followButton.disabled = !referencedBinding?.agentId;
          followButton.dataset.agentId = referencedBinding?.agentId || "";
          followButton.dataset.windowId = referencedBinding?.windowId || referencedWindowId || "";
        }

        if (refreshButton) {
          refreshButton.dataset.windowId = referencedWindowId || "";
        }
      }

      function renderBootstrapResult(result) {
        const summaryRoot = document.getElementById("bootstrap-summary");
        const jsonRoot = document.getElementById("bootstrap-json");
        activeBootstrapResult = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未执行初始准备";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "初始准备结果会显示在这里。";
          }
          return;
        }

        const bootstrap = result.bootstrap || result;
        if (summaryRoot) {
          summaryRoot.textContent = [
            bootstrap.agentId || activeAgentId || "agent",
            bootstrap.dryRun ? "仅预览" : "已保存",
            bootstrap.summary?.snapshotCreated ? "任务快照已生成" : "任务快照未变化",
            bootstrap.summary?.claimedResidentAgent ? "已设为本机常驻助手" : null,
            bootstrap.summary?.profileWriteCount != null ? `身份资料 ${bootstrap.summary.profileWriteCount}` : null,
            bootstrap.summary?.workingWriteCount != null ? `工作记忆 ${bootstrap.summary.workingWriteCount}` : null,
            bootstrap.summary?.ledgerWriteCount != null ? `底层记录 ${bootstrap.summary.ledgerWriteCount}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "初始准备结果会显示在这里。");
        }
      }

      function renderRuntimeState(runtime) {
        const summaryRoot = document.getElementById("runtime-summary");
        const deviceSummaryRoot = document.getElementById("device-runtime-summary");
        const cognitiveSummaryRoot = document.getElementById("runtime-cognitive-summary");
        const jsonRoot = document.getElementById("runtime-json");
        activeRuntime = runtime || null;

        if (!runtime) {
          if (deviceSummaryRoot) {
            deviceSummaryRoot.textContent = "尚未绑定本机常驻助手";
          }
          if (cognitiveSummaryRoot) {
            cognitiveSummaryRoot.textContent = "尚未加载连续认知状态";
          }
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载当前状态";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "运行态会显示在这里。";
          }
          renderCognitiveDynamicsPanel(null);
          renderOperationalArchitectureCards();
          syncWorkflowProgress();
          return;
        }

        const constrainedExecutionPolicy =
          runtime.deviceRuntime?.constrainedExecutionPolicy ||
          runtime.deviceRuntime?.sandboxPolicy ||
          {};
        const setupPolicy = runtime.deviceRuntime?.setupPolicy || {};
        const displayedLocalReasonerProvider =
          runtime.deviceRuntime?.localReasoner?.activeProvider ||
          runtime.deviceRuntime?.localReasoner?.provider ||
          null;
        const needsGemmaMigration =
          Boolean(displayedLocalReasonerProvider) &&
          (
            displayedLocalReasonerProvider !== "ollama_local" ||
            (runtime.deviceRuntime?.localReasoner?.model && !/gemma/i.test(runtime.deviceRuntime.localReasoner.model))
          );
        const runtimeCognitiveState =
          runtime.cognitiveState && typeof runtime.cognitiveState === "object"
            ? runtime.cognitiveState
            : runtime.runtimeStateSummary && typeof runtime.runtimeStateSummary === "object"
              ? runtime.runtimeStateSummary
              : null;
        const cognitiveDynamicsSummary = summarizeCognitiveDynamics(runtimeCognitiveState);

        if (deviceSummaryRoot) {
          deviceSummaryRoot.textContent = [
            runtime.deviceRuntime?.residentAgentId ? `常驻助手 ${runtime.deviceRuntime.residentAgentId}` : "常驻助手未绑定",
            runtime.deviceRuntime?.localMode ? `运行模式 ${formatLocalModeLabel(runtime.deviceRuntime.localMode)}` : null,
            runtime.deviceRuntime?.allowOnlineReasoner ? "已允许联网补充" : "仅本地模式",
            runtime.deviceRuntime?.retrievalPolicy?.strategy
              ? `资料搜索 ${formatRetrievalStrategyLabel(runtime.deviceRuntime.retrievalPolicy.strategy)}`
              : null,
            runtime.deviceRuntime?.retrievalPolicy?.allowVectorIndex === false ? "未启用向量搜索" : "已启用向量搜索",
            displayedLocalReasonerProvider ? `回答方式 ${formatReasonerProviderLabel(displayedLocalReasonerProvider)}` : null,
            needsGemmaMigration ? "建议迁到 Gemma 默认本地引擎" : null,
            runtime.deviceRuntime?.localReasoner?.configured ? "回答引擎已就绪" : "回答引擎未配置",
            runtime.deviceRuntime?.localReasoner?.lastWarm?.status
              ? `预热 ${formatStatusLabel(runtime.deviceRuntime.localReasoner.lastWarm.status)}`
              : null,
            runtime.deviceRuntime?.localReasoner?.lastProbe?.status
              ? `探测 ${formatStatusLabel(runtime.deviceRuntime.localReasoner.lastProbe.status)}`
              : null,
            runtime.deviceRuntime?.localReasoner?.model ? `模型 ${runtime.deviceRuntime.localReasoner.model}` : null,
            runtime.deviceRuntime?.localReasoner?.timeoutMs
              ? `超时 ${runtime.deviceRuntime.localReasoner.timeoutMs}ms`
              : null,
            Array.isArray(constrainedExecutionPolicy.allowedCapabilities) && constrainedExecutionPolicy.allowedCapabilities.length
              ? `受限能力 ${constrainedExecutionPolicy.allowedCapabilities.length}`
              : null,
            runtime.deviceRuntime?.constrainedExecutionSummary?.status
              ? `执行层 ${formatStatusLabel(runtime.deviceRuntime.constrainedExecutionSummary.status)}`
              : null,
            runtime.deviceRuntime?.constrainedExecutionSummary?.pinnedCommandCount != null
              ? `命令钉住 ${runtime.deviceRuntime.constrainedExecutionSummary.pinnedCommandCount}`
              : null,
            setupPolicy.requireRecentRecoveryRehearsal ? `恢复演练窗口 ${setupPolicy.recoveryRehearsalMaxAgeHours || 0}h` : "恢复演练按需",
            setupPolicy.requireKeychainWhenAvailable ? "钥匙串可用时强制使用" : "钥匙串按环境决定",
            runtime.residentGate?.required ? `需要先解锁 ${runtime.residentGate.code || "required"}` : "当前可继续",
          ].filter(Boolean).join(" · ");
        }

        if (cognitiveSummaryRoot) {
          cognitiveSummaryRoot.textContent = [
            runtimeCognitiveState?.mode ? `模式 ${runtimeCognitiveState.mode}` : null,
            runtimeCognitiveState?.dominantStage ? `重点 ${runtimeCognitiveState.dominantStage}` : null,
            cognitiveDynamicsSummary,
          ].filter(Boolean).join(" · ") || "尚未加载连续认知状态";
        }

        if (summaryRoot) {
          summaryRoot.textContent = [
            runtime.taskSnapshot?.title || runtime.taskSnapshot?.objective || "暂无任务快照",
            runtime.taskSnapshot?.status ? `任务状态 ${formatStatusLabel(runtime.taskSnapshot.status)}` : null,
            runtime.deviceRuntime?.residentAgentId ? `常驻助手 ${runtime.deviceRuntime.residentAgentId}` : null,
            runtime.deviceRuntime?.localMode ? `运行模式 ${formatLocalModeLabel(runtime.deviceRuntime.localMode)}` : null,
            runtime.deviceRuntime?.commandPolicy?.riskStrategies?.low
              ? `低风险 ${formatRiskStrategyLabel(runtime.deviceRuntime.commandPolicy.riskStrategies.low)}`
              : null,
            runtime.deviceRuntime?.commandPolicy?.riskStrategies?.high
              ? `高风险 ${formatRiskStrategyLabel(runtime.deviceRuntime.commandPolicy.riskStrategies.high)}`
              : null,
            runtime.deviceRuntime?.commandPolicy?.riskStrategies?.critical
              ? `关键风险 ${formatRiskStrategyLabel(runtime.deviceRuntime.commandPolicy.riskStrategies.critical)}`
              : null,
            runtime.deviceRuntime?.retrievalPolicy?.strategy
              ? `搜索方式 ${formatRetrievalStrategyLabel(runtime.deviceRuntime.retrievalPolicy.strategy)}`
              : null,
            displayedLocalReasonerProvider ? `回答方式 ${formatReasonerProviderLabel(displayedLocalReasonerProvider)}` : null,
            needsGemmaMigration ? "仍沿用旧本地回答配置" : null,
            runtime.deviceRuntime?.localReasoner?.configured ? "回答引擎已就绪" : "回答引擎未配置",
            runtime.deviceRuntime?.localReasoner?.lastWarm?.status
              ? `预热 ${formatStatusLabel(runtime.deviceRuntime.localReasoner.lastWarm.status)}`
              : null,
            runtime.deviceRuntime?.localReasoner?.lastProbe?.status
              ? `探测 ${formatStatusLabel(runtime.deviceRuntime.localReasoner.lastProbe.status)}`
              : null,
            runtime.deviceRuntime?.localReasoner?.model ? `模型 ${runtime.deviceRuntime.localReasoner.model}` : null,
            runtime.deviceRuntime?.localReasoner?.timeoutMs
              ? `超时 ${runtime.deviceRuntime.localReasoner.timeoutMs}ms`
              : null,
            Array.isArray(constrainedExecutionPolicy.allowedCapabilities) && constrainedExecutionPolicy.allowedCapabilities.length
              ? `受限能力 ${constrainedExecutionPolicy.allowedCapabilities.join("/")}`
              : null,
            setupPolicy.requireRecoveryBundle ? "要求恢复包" : "恢复包按需",
            setupPolicy.requireRecentRecoveryRehearsal ? `恢复演练 ${setupPolicy.recoveryRehearsalMaxAgeHours || 0}h` : "恢复演练按需",
            setupPolicy.requireSetupPackage ? "要求初始化包" : null,
            `任务快照 ${runtime.counts?.taskSnapshots || 0}`,
            `对话纪要 ${runtime.counts?.conversationMinutes || 0}`,
            `决策 ${runtime.counts?.decisionLogs || 0}`,
            `证据 ${runtime.counts?.evidenceRefs || 0}`,
            `对话记录 ${runtime.counts?.transcriptEntries || 0}`,
            runtime.policy?.maxConversationTurns ? `轮次上限 ${runtime.policy.maxConversationTurns}` : null,
            runtime.policy?.maxContextChars ? `字符上限 ${runtime.policy.maxContextChars}` : null,
            runtime.policy?.maxContextTokens ? `Token 上限 ${runtime.policy.maxContextTokens}` : null,
            runtime.policy?.maxRecentConversationTurns ? `最近对话保留 ${runtime.policy.maxRecentConversationTurns}` : null,
            runtime.policy?.maxToolResults ? `工具结果保留 ${runtime.policy.maxToolResults}` : null,
            runtime.policy?.maxQueryIterations ? `搜索轮数上限 ${runtime.policy.maxQueryIterations}` : null,
            runtimeCognitiveState?.updatedAt ? `状态刷新 ${runtimeCognitiveState.updatedAt}` : null,
          ].filter(Boolean).join(" · ");
        }

        const deviceRuntimeForm = document.getElementById("device-runtime-form");
        if (deviceRuntimeForm) {
          const residentInput = deviceRuntimeForm.querySelector('[name="residentAgentId"]');
          const residentDidMethodInput = deviceRuntimeForm.querySelector('[name="residentDidMethod"]');
          const localModeInput = deviceRuntimeForm.querySelector('[name="localMode"]');
          const onlineInput = deviceRuntimeForm.querySelector('[name="allowOnlineReasoner"]');
          const negotiationInput = deviceRuntimeForm.querySelector('[name="negotiationMode"]');
          const autoExecuteInput = deviceRuntimeForm.querySelector('[name="autoExecuteLowRisk"]');
          const lowRiskStrategyInput = deviceRuntimeForm.querySelector('[name="lowRiskStrategy"]');
          const mediumRiskStrategyInput = deviceRuntimeForm.querySelector('[name="mediumRiskStrategy"]');
          const highRiskStrategyInput = deviceRuntimeForm.querySelector('[name="highRiskStrategy"]');
          const criticalRiskStrategyInput = deviceRuntimeForm.querySelector('[name="criticalRiskStrategy"]');
          const confirmInput = deviceRuntimeForm.querySelector('[name="requireExplicitConfirmation"]');
          const retrievalStrategyInput = deviceRuntimeForm.querySelector('[name="retrievalStrategy"]');
          const allowVectorIndexInput = deviceRuntimeForm.querySelector('[name="allowVectorIndex"]');
          const retrievalMaxHitsInput = deviceRuntimeForm.querySelector('[name="retrievalMaxHits"]');
          const requireRecoveryBundleInput = deviceRuntimeForm.querySelector('[name="requireRecoveryBundle"]');
          const requireRecentRecoveryRehearsalInput = deviceRuntimeForm.querySelector('[name="requireRecentRecoveryRehearsal"]');
          const recoveryRehearsalMaxAgeHoursInput = deviceRuntimeForm.querySelector('[name="recoveryRehearsalMaxAgeHours"]');
          const requireSetupPackageInput = deviceRuntimeForm.querySelector('[name="requireSetupPackage"]');
          const requireKeychainWhenAvailableInput = deviceRuntimeForm.querySelector('[name="requireKeychainWhenAvailable"]');
          const localReasonerEnabledInput = deviceRuntimeForm.querySelector('[name="localReasonerEnabled"]');
          const localReasonerProviderInput = deviceRuntimeForm.querySelector('[name="localReasonerProvider"]');
          const localReasonerCommandInput = deviceRuntimeForm.querySelector('[name="localReasonerCommand"]');
          const localReasonerArgsInput = deviceRuntimeForm.querySelector('[name="localReasonerArgs"]');
          const localReasonerCwdInput = deviceRuntimeForm.querySelector('[name="localReasonerCwd"]');
          const localReasonerBaseUrlInput = deviceRuntimeForm.querySelector('[name="localReasonerBaseUrl"]');
          const localReasonerModelInput = deviceRuntimeForm.querySelector('[name="localReasonerModel"]');
          const allowedCapabilitiesInput = deviceRuntimeForm.querySelector('[name="allowedCapabilities"]');
          const maxReadBytesInput = deviceRuntimeForm.querySelector('[name="maxReadBytes"]');
          const maxListEntriesInput = deviceRuntimeForm.querySelector('[name="maxListEntries"]');

          if (residentInput) {
            residentInput.value = runtime.deviceRuntime?.residentAgentId || activeAgentId || "";
          }
          if (residentDidMethodInput) {
            residentDidMethodInput.value = runtime.deviceRuntime?.residentDidMethod || "agentpassport";
          }
          if (localModeInput) {
            localModeInput.value = runtime.deviceRuntime?.localMode || "local_only";
          }
          if (onlineInput) {
            onlineInput.value = runtime.deviceRuntime?.allowOnlineReasoner ? "true" : "false";
          }
          if (negotiationInput) {
            negotiationInput.value = runtime.deviceRuntime?.commandPolicy?.negotiationMode || "confirm_before_execute";
          }
          if (autoExecuteInput) {
            autoExecuteInput.value = runtime.deviceRuntime?.commandPolicy?.autoExecuteLowRisk ? "true" : "false";
          }
          if (lowRiskStrategyInput) {
            lowRiskStrategyInput.value = runtime.deviceRuntime?.commandPolicy?.riskStrategies?.low || "discuss";
          }
          if (mediumRiskStrategyInput) {
            mediumRiskStrategyInput.value = runtime.deviceRuntime?.commandPolicy?.riskStrategies?.medium || "discuss";
          }
          if (highRiskStrategyInput) {
            highRiskStrategyInput.value = runtime.deviceRuntime?.commandPolicy?.riskStrategies?.high || "confirm";
          }
          if (criticalRiskStrategyInput) {
            criticalRiskStrategyInput.value = runtime.deviceRuntime?.commandPolicy?.riskStrategies?.critical || "multisig";
          }
          if (confirmInput) {
            confirmInput.value = runtime.deviceRuntime?.commandPolicy?.requireExplicitConfirmation === false ? "false" : "true";
          }
          if (retrievalStrategyInput) {
            retrievalStrategyInput.value = runtime.deviceRuntime?.retrievalPolicy?.strategy || "local_first_non_vector";
          }
          if (allowVectorIndexInput) {
            allowVectorIndexInput.value = runtime.deviceRuntime?.retrievalPolicy?.allowVectorIndex ? "true" : "false";
          }
          if (retrievalMaxHitsInput) {
            retrievalMaxHitsInput.value = String(runtime.deviceRuntime?.retrievalPolicy?.maxHits || 8);
          }
          if (requireRecoveryBundleInput) {
            requireRecoveryBundleInput.value = setupPolicy.requireRecoveryBundle === false ? "false" : "true";
          }
          if (requireRecentRecoveryRehearsalInput) {
            requireRecentRecoveryRehearsalInput.value =
              setupPolicy.requireRecentRecoveryRehearsal === false ? "false" : "true";
          }
          if (recoveryRehearsalMaxAgeHoursInput) {
            recoveryRehearsalMaxAgeHoursInput.value = String(setupPolicy.recoveryRehearsalMaxAgeHours || 720);
          }
          if (requireSetupPackageInput) {
            requireSetupPackageInput.value = setupPolicy.requireSetupPackage ? "true" : "false";
          }
          if (requireKeychainWhenAvailableInput) {
            requireKeychainWhenAvailableInput.value =
              setupPolicy.requireKeychainWhenAvailable === false ? "false" : "true";
          }
          if (localReasonerEnabledInput) {
            localReasonerEnabledInput.value = runtime.deviceRuntime?.localReasoner?.enabled ? "true" : "false";
          }
          if (localReasonerProviderInput) {
            localReasonerProviderInput.value = runtime.deviceRuntime?.localReasoner?.provider || "ollama_local";
          }
          if (localReasonerCommandInput) {
            localReasonerCommandInput.value = runtime.deviceRuntime?.localReasoner?.command || "";
          }
          if (localReasonerArgsInput) {
            localReasonerArgsInput.value = (runtime.deviceRuntime?.localReasoner?.args || []).join(", ");
          }
          if (localReasonerCwdInput) {
            localReasonerCwdInput.value = runtime.deviceRuntime?.localReasoner?.cwd || "";
          }
          if (localReasonerBaseUrlInput) {
            localReasonerBaseUrlInput.value = runtime.deviceRuntime?.localReasoner?.baseUrl || "";
          }
          if (localReasonerModelInput) {
            localReasonerModelInput.value = runtime.deviceRuntime?.localReasoner?.model || "gemma4:e4b";
          }
          if (allowedCapabilitiesInput) {
            allowedCapabilitiesInput.value = (
              runtime.deviceRuntime?.constrainedExecutionPolicy?.allowedCapabilities ||
              runtime.deviceRuntime?.sandboxPolicy?.allowedCapabilities ||
              []
            ).join(", ");
          }
          if (maxReadBytesInput) {
            maxReadBytesInput.value = String(
              runtime.deviceRuntime?.constrainedExecutionPolicy?.maxReadBytes ||
              runtime.deviceRuntime?.sandboxPolicy?.maxReadBytes ||
              8192
            );
          }
          if (maxListEntriesInput) {
            maxListEntriesInput.value = String(
              runtime.deviceRuntime?.constrainedExecutionPolicy?.maxListEntries ||
              runtime.deviceRuntime?.sandboxPolicy?.maxListEntries ||
              40
            );
          }
        }

        const deviceRuntimeQuickForm = document.getElementById("device-runtime-quick-form");
        if (deviceRuntimeQuickForm) {
          const residentInput = deviceRuntimeQuickForm.querySelector('[name="residentAgentId"]');
          const localModeInput = deviceRuntimeQuickForm.querySelector('[name="localMode"]');
          const onlineInput = deviceRuntimeQuickForm.querySelector('[name="allowOnlineReasoner"]');
          const localReasonerEnabledInput = deviceRuntimeQuickForm.querySelector('[name="localReasonerEnabled"]');
          const localReasonerProviderInput = deviceRuntimeQuickForm.querySelector('[name="localReasonerProvider"]');
          const localReasonerModelInput = deviceRuntimeQuickForm.querySelector('[name="localReasonerModel"]');

          if (residentInput) {
            residentInput.value = runtime.deviceRuntime?.residentAgentId || activeAgentId || "";
          }
          if (localModeInput) {
            localModeInput.value = runtime.deviceRuntime?.localMode || "local_only";
          }
          if (onlineInput) {
            onlineInput.value = runtime.deviceRuntime?.allowOnlineReasoner ? "true" : "false";
          }
          if (localReasonerEnabledInput) {
            localReasonerEnabledInput.value = runtime.deviceRuntime?.localReasoner?.enabled ? "true" : "false";
          }
          if (localReasonerProviderInput) {
            localReasonerProviderInput.value = runtime.deviceRuntime?.localReasoner?.provider || "ollama_local";
          }
          if (localReasonerModelInput) {
            localReasonerModelInput.value = runtime.deviceRuntime?.localReasoner?.model || "gemma4:e4b";
          }
        }

        const contextBuilderQuickForm = document.getElementById("context-builder-quick-form");
        if (contextBuilderQuickForm) {
          const currentGoalInput = contextBuilderQuickForm.querySelector('[name="currentGoal"]');
          if (currentGoalInput) {
            currentGoalInput.value = runtime.taskSnapshot?.objective || runtime.taskSnapshot?.title || "";
          }
        }

        const localReasonerSelectForm = document.getElementById("local-reasoner-select-form");
        if (localReasonerSelectForm) {
          const providerInput = localReasonerSelectForm.querySelector('[name="provider"]');
          const enabledInput = localReasonerSelectForm.querySelector('[name="enabled"]');
          const commandInput = localReasonerSelectForm.querySelector('[name="command"]');
          const argsInput = localReasonerSelectForm.querySelector('[name="args"]');
          const cwdInput = localReasonerSelectForm.querySelector('[name="cwd"]');
          const baseUrlInput = localReasonerSelectForm.querySelector('[name="baseUrl"]');
          const modelInput = localReasonerSelectForm.querySelector('[name="model"]');

          if (providerInput) {
            providerInput.value = runtime.deviceRuntime?.localReasoner?.provider || "ollama_local";
          }
          if (enabledInput) {
            enabledInput.value = runtime.deviceRuntime?.localReasoner?.enabled ? "true" : "false";
          }
          if (commandInput) {
            commandInput.value = runtime.deviceRuntime?.localReasoner?.command || "";
          }
          if (argsInput) {
            argsInput.value = (runtime.deviceRuntime?.localReasoner?.args || []).join(", ");
          }
          if (cwdInput) {
            cwdInput.value = runtime.deviceRuntime?.localReasoner?.cwd || "";
          }
          if (baseUrlInput) {
            baseUrlInput.value = runtime.deviceRuntime?.localReasoner?.baseUrl || "";
          }
          if (modelInput) {
            modelInput.value = runtime.deviceRuntime?.localReasoner?.model || "gemma4:e4b";
          }
        }

        const localReasonerPrewarmForm = document.getElementById("local-reasoner-prewarm-form");
        if (localReasonerPrewarmForm) {
          const providerInput = localReasonerPrewarmForm.querySelector('[name="provider"]');
          const modelInput = localReasonerPrewarmForm.querySelector('[name="model"]');
          const baseUrlInput = localReasonerPrewarmForm.querySelector('[name="baseUrl"]');
          if (providerInput) {
            providerInput.value = "";
          }
          if (modelInput) {
            modelInput.value = runtime.deviceRuntime?.localReasoner?.model || "";
          }
          if (baseUrlInput) {
            baseUrlInput.value = runtime.deviceRuntime?.localReasoner?.baseUrl || "";
          }
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, runtime, "运行态会显示在这里。");
        }
        renderCognitiveDynamicsPanel(runtime);
        renderOperationalArchitectureCards();
        syncWorkflowProgress();
      }

      function renderRehydratePack(rehydrate) {
        const summaryRoot = document.getElementById("rehydrate-summary");
        const jsonRoot = document.getElementById("rehydrate-json");
        activeRehydrate = rehydrate || null;

        if (!rehydrate) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未生成恢复包";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "恢复包会显示在这里。";
          }
          return;
        }

        if (summaryRoot) {
          summaryRoot.textContent = [
            `恢复包 ${rehydrate.packHash || "n/a"}`,
            rehydrate.taskSnapshot?.title || rehydrate.taskSnapshot?.objective || "暂无任务快照",
            `命中资料 ${rehydrate.localKnowledgeHits?.length || 0}`,
            `决策 ${rehydrate.activeDecisions?.length || 0}`,
            `证据 ${rehydrate.evidenceRefs?.length || 0}`,
            rehydrate.resumeBoundary?.compactBoundaryId ? `恢复位置 ${rehydrate.resumeBoundary.compactBoundaryId}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, rehydrate, "恢复包会显示在这里。");
        }
      }

      function renderDriftCheckResult(driftCheck) {
        const summaryRoot = document.getElementById("drift-check-summary");
        const jsonRoot = document.getElementById("drift-check-json");
        activeDriftCheck = driftCheck || null;

        if (!driftCheck) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未检查是否偏离原任务";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "任务偏移检查结果会显示在这里。";
          }
          return;
        }

        if (summaryRoot) {
          summaryRoot.textContent = [
            `偏移分 ${driftCheck.driftScore ?? 0}`,
            driftCheck.requiresRehydrate ? "需要重新整理恢复包" : "可继续执行",
            driftCheck.requiresHumanReview ? "建议人工接管" : null,
            Array.isArray(driftCheck.flags) && driftCheck.flags.length ? `${driftCheck.flags.length} 个提醒` : "没有异常提醒",
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, driftCheck, "任务偏移检查结果会显示在这里。");
        }
      }

      function renderConversationMinutes(result) {
        const summaryRoot = document.getElementById("conversation-minute-summary");
        const jsonRoot = document.getElementById("conversation-minute-json");
        activeConversationMinutes = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未写入本地对话纪要";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "本地对话纪要结果会显示在这里。";
          }
          return;
        }

        const latestMinute = result.minute || result.minutes?.at?.(-1) || result.minutes?.[0] || null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            result.minute ? "已记录" : "已加载",
            latestMinute?.title || latestMinute?.summary || latestMinute?.minuteId || "minute",
            result.counts?.total != null ? `总数 ${result.counts.total}` : null,
            latestMinute?.recordedAt ? `最近时间 ${latestMinute.recordedAt}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "本地对话纪要结果会显示在这里。");
        }
      }

      function renderRuntimeSearch(result) {
        const summaryRoot = document.getElementById("runtime-search-summary");
        const jsonRoot = document.getElementById("runtime-search-json");
        activeRuntimeSearch = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未搜索本地纪要 / 证据";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "本地搜索结果会显示在这里。";
          }
          return;
        }

        if (summaryRoot) {
          summaryRoot.textContent = [
            result.query ? `搜索词 ${result.query}` : "最近内容",
            result.retrieval?.strategy ? `搜索方式 ${result.retrieval.strategy}` : null,
            result.retrieval?.scorer ? `评分方式 ${result.retrieval.scorer}` : null,
            result.retrieval?.vectorUsed === false ? "未启用向量搜索" : null,
            `命中 ${result.hits?.length || 0}`,
            result.suggestedResumeBoundaryId ? `建议恢复位置 ${result.suggestedResumeBoundaryId}` : null,
            result.counts?.bySource
              ? Object.entries(result.counts.bySource)
                  .map(([key, value]) => `${key}:${value}`)
                  .join(" · ")
              : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "本地搜索结果会显示在这里。");
        }
      }

      function renderRecoveryState(result) {
        const summaryRoot = document.getElementById("recovery-summary");
        const jsonRoot = document.getElementById("recovery-json");
        activeRecoveryState = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未生成恢复包";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "恢复包结果会显示在这里。";
          }
          return;
        }

        const summary = result.summary || result.bundles?.[0] || null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            summary?.bundleId ? `恢复包 ${summary.bundleId}` : null,
            summary?.machineLabel || summary?.machineId || null,
            summary?.residentAgentId ? `常驻助手 ${summary.residentAgentId}` : null,
            summary?.includesLedgerEnvelope ? "包含底层记录" : null,
            result.recoveryDir ? `目录 ${result.recoveryDir}` : null,
            result.restoredLedger ? "底层记录已恢复" : null,
            result.dryRun ? "仅预览" : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "恢复包结果会显示在这里。");
        }
      }

      function renderTranscriptState(result) {
        const summaryRoot = document.getElementById("transcript-summary");
        const jsonRoot = document.getElementById("transcript-json");
        activeTranscriptState = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载对话记录";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "对话记录会显示在这里。";
          }
          return;
        }

        const transcript = result.transcript || null;
        const latestEntry =
          transcript?.entries?.at?.(-1) ||
          result.entries?.at?.(-1) ||
          result.entries?.[0] ||
          null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            transcript?.entryCount != null ? `条目 ${transcript.entryCount}` : null,
            result.counts?.filtered != null ? `筛选后 ${result.counts.filtered}` : null,
            Array.isArray(transcript?.families) && transcript.families.length ? `类型 ${transcript.families.join("/")}` : null,
            Array.isArray(transcript?.messageBlocks) ? `消息块 ${transcript.messageBlocks.length}` : null,
            latestEntry?.family ? `最近类型 ${latestEntry.family}` : null,
            latestEntry?.title || latestEntry?.summary || latestEntry?.transcriptEntryId || null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "对话记录会显示在这里。");
        }
      }

      function renderRecoveryRehearsalState(result) {
        const summaryRoot = document.getElementById("recovery-rehearsal-summary");
        const jsonRoot = document.getElementById("recovery-rehearsal-json");
        activeRecoveryRehearsals = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未执行恢复演练";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "恢复演练结果会显示在这里。";
          }
          return;
        }

        const rehearsal = result.rehearsal || result.rehearsals?.[0] || null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            rehearsal?.rehearsalId ? `演练 ${rehearsal.rehearsalId}` : null,
            rehearsal?.status || null,
            rehearsal?.passedCount != null && rehearsal?.checkCount != null ? `通过 ${rehearsal.passedCount}/${rehearsal.checkCount}` : null,
            result.counts?.total != null ? `总数 ${result.counts.total}` : null,
            rehearsal?.bundle?.bundleId || rehearsal?.bundleId || null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "恢复演练结果会显示在这里。");
        }
      }

      function renderSetupState(result) {
        const summaryRoot = document.getElementById("setup-summary");
        const jsonRoot = document.getElementById("setup-json");
        activeSetupState = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载本机初始化状态";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "本机初始化结果会显示在这里。";
          }
          renderOperationalArchitectureCards();
          return;
        }

        const status = result.status || result;
        const setupPolicy = status.setupPolicy || status.deviceRuntime?.setupPolicy || {};
        if (summaryRoot) {
          summaryRoot.textContent = [
            status.setupComplete ? "初始化已完成" : "初始化未完成",
            status.residentAgentId ? `常驻助手 ${status.residentAgentId}` : null,
            status.residentDidMethod ? `身份展示 ${formatDidMethodChoice(status.residentDidMethod)}` : null,
            status.localReasonerDiagnostics?.status
              ? `回答引擎 ${formatStatusLabel(status.localReasonerDiagnostics.status)}`
              : null,
            status.formalRecoveryFlow?.durableRestoreReady != null
              ? `正式恢复基线 ${status.formalRecoveryFlow.durableRestoreReady ? "已达到" : "待补齐"}`
              : null,
            Array.isArray(status.missingRequiredCodes) && status.missingRequiredCodes.length
              ? `缺少 ${status.missingRequiredCodes.join(",")}`
              : "没有缺项",
            setupPolicy.requireRecentRecoveryRehearsal
              ? `恢复演练窗口 ${setupPolicy.recoveryRehearsalMaxAgeHours || 0}h`
              : "恢复演练按需",
            setupPolicy.requireKeychainWhenAvailable ? "钥匙串可用时强制使用" : null,
            status.recoveryBundles?.counts?.total != null ? `恢复包 ${status.recoveryBundles.counts.total}` : null,
            status.recoveryRehearsals?.counts?.passed != null ? `演练通过 ${status.recoveryRehearsals.counts.passed}` : null,
            status.setupPackages?.counts?.total != null ? `初始化包 ${status.setupPackages.counts.total}` : null,
            status.formalRecoveryFlow?.status
              ? `恢复流程 ${formatStatusLabel(status.formalRecoveryFlow.status)}${Array.isArray(status.formalRecoveryFlow.missingRequiredCodes) && status.formalRecoveryFlow.missingRequiredCodes.length ? `（${status.formalRecoveryFlow.missingRequiredCodes.map(formatRecoveryRequirementLabel).join(" / ")}）` : ""}`
              : null,
            status.formalRecoveryFlow?.runbook?.nextStepLabel
              ? `恢复主线下一步 ${status.formalRecoveryFlow.runbook.nextStepLabel}${status.formalRecoveryFlow.runbook.nextStepRequired === false ? "（建议）" : ""}`
              : null,
            status.automaticRecoveryReadiness?.status
              ? `自动续跑 ${formatStatusLabel(status.automaticRecoveryReadiness.status)}${status.automaticRecoveryReadiness.formalFlowReady ? "（含正式恢复基线）" : "（正式恢复仍有缺口）"}`
              : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "本机初始化结果会显示在这里。");
        }
        renderOperationalArchitectureCards();
      }

      function renderSetupPackageState(result) {
        const summaryRoot = document.getElementById("setup-package-summary");
        const jsonRoot = document.getElementById("setup-package-json");
        activeSetupPackageState = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未导出本机初始化包";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "本机初始化包结果会显示在这里。";
          }
          return;
        }

        const summary = result.summary || null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            summary?.packageId ? `初始化包 ${summary.packageId}` : null,
            summary?.residentAgentId ? `常驻助手 ${summary.residentAgentId}` : null,
            summary?.residentDidMethod ? `身份展示 ${formatDidMethodChoice(summary.residentDidMethod)}` : null,
            summary?.setupComplete ? "初始化已完成" : "初始化未完成",
            summary?.localReasonerProfileCount != null ? `回答配置 ${summary.localReasonerProfileCount}` : null,
            Array.isArray(summary?.missingRequiredCodes) && summary.missingRequiredCodes.length
              ? `缺少 ${summary.missingRequiredCodes.join(",")}`
              : "没有缺项",
            summary?.packagePath ? "已保存" : "仅预览",
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "本机初始化包结果会显示在这里。");
        }
      }

      function renderSetupPackageList(result) {
        const summaryRoot = document.getElementById("setup-package-list-summary");
        const jsonRoot = document.getElementById("setup-package-list-json");
        activeSetupPackageList = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载已保存初始化包列表";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "已保存初始化包列表会显示在这里。";
          }
          return;
        }

        if (summaryRoot) {
          const latest = Array.isArray(result.packages) && result.packages.length ? result.packages[0] : null;
          summaryRoot.textContent = [
            `初始化包 ${result.counts?.total || 0}`,
            latest?.packageId ? `最近 ${latest.packageId}` : null,
            latest?.residentAgentId ? `常驻助手 ${latest.residentAgentId}` : null,
            latest?.localReasonerProfileCount != null ? `回答配置 ${latest.localReasonerProfileCount}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "已保存初始化包列表会显示在这里。");
        }
      }

      function renderSetupPackageMaintenance(result) {
        const summaryRoot = document.getElementById("setup-package-maintenance-summary");
        const jsonRoot = document.getElementById("setup-package-maintenance-json");
        activeSetupPackageMaintenance = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未执行已保存初始化包维护";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "已保存初始化包维护结果会显示在这里。";
          }
          return;
        }

        if (summaryRoot) {
          summaryRoot.textContent = [
            result.keepLatest != null ? `保留 ${result.keepLatest}` : null,
            result.counts?.matched != null ? `匹配到 ${result.counts.matched}` : null,
            result.counts?.deleted != null ? `删除 ${result.counts.deleted}` : null,
            result.counts?.kept != null ? `保留 ${result.counts.kept}` : null,
            result.dryRun ? "仅预览" : "已保存",
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "已保存初始化包维护结果会显示在这里。");
        }
      }

      function renderLocalReasonerCatalog(result) {
        const summaryRoot = document.getElementById("local-reasoner-catalog-summary");
        const jsonRoot = document.getElementById("local-reasoner-catalog-json");
        activeLocalReasonerCatalog = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载本地回答方式目录";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "本地回答方式目录会显示在这里。";
          }
          return;
        }

        const providers = Array.isArray(result.providers) ? result.providers : [];
        const selected = providers.find((entry) => entry.selected) || null;
        const selectedModel = selected?.diagnostics?.model || selected?.config?.model || null;
        const needsMigration =
          Boolean(selected?.provider) &&
          (
            selected.provider !== "ollama_local" ||
            (selectedModel && !/gemma/i.test(selectedModel))
          );
        if (summaryRoot) {
          summaryRoot.textContent = [
            result.selectedProvider ? `当前方式 ${formatReasonerProviderLabel(result.selectedProvider)}` : null,
            needsMigration ? "建议迁到 Gemma 默认本地引擎" : null,
            `可选方式 ${providers.length}`,
            selected?.diagnostics?.status ? `状态 ${formatStatusLabel(selected.diagnostics.status)}` : null,
            selectedModel ? `模型 ${selectedModel}` : null,
            selected?.config?.timeoutMs ? `超时 ${selected.config.timeoutMs}ms` : null,
            selected?.availableModels?.length ? `可选模型 ${selected.availableModels.length}` : null,
            selected?.lastWarm?.status ? `预热 ${formatStatusLabel(selected.lastWarm.status)}` : null,
            selected?.selection?.selectedAt ? `选择时间 ${selected.selection.selectedAt}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "本地回答方式目录会显示在这里。");
        }
      }

      function renderLocalReasonerProfiles(result) {
        const summaryRoot = document.getElementById("local-reasoner-profiles-summary");
        const jsonRoot = document.getElementById("local-reasoner-profiles-json");
        activeLocalReasonerProfiles = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载本地回答配置";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "本地回答配置会显示在这里。";
          }
          return;
        }

        const profiles = Array.isArray(result.profiles) ? result.profiles : [];
        const latest = profiles[0] || null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            `配置 ${result.counts?.total || 0}`,
            latest?.label
              ? `最近 ${latest.label}${latest?.profileId ? ` (${latest.profileId})` : ""}`
              : latest?.profileId
                ? `最近 ${latest.profileId}`
                : null,
            latest?.provider ? `回答方式 ${formatReasonerProviderLabel(latest.provider)}` : null,
            latest?.model ? `模型 ${latest.model}` : null,
            latest?.timeoutMs ? `超时 ${latest.timeoutMs}ms` : null,
            latest?.health?.status ? `健康状态 ${formatStatusLabel(latest.health.status)}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "本地回答配置会显示在这里。");
        }
      }

      function renderLocalReasonerRestore(result) {
        const summaryRoot = document.getElementById("local-reasoner-restore-summary");
        const jsonRoot = document.getElementById("local-reasoner-restore-json");
        activeLocalReasonerRestoreCandidates = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载可恢复的回答配置";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "可恢复的回答配置会显示在这里。";
          }
          return;
        }

        const candidates = Array.isArray(result.restoreCandidates) ? result.restoreCandidates : [];
        const recommended = candidates.find((entry) => entry.recommended) || candidates[0] || null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            `候选配置 ${result.counts?.total || 0}`,
            `可恢复 ${result.counts?.restorable || 0}`,
            recommended?.profileId ? `推荐 ${recommended.profileId}` : null,
            recommended?.provider ? `回答方式 ${formatReasonerProviderLabel(recommended.provider)}` : null,
            recommended?.health?.status ? `健康状态 ${formatStatusLabel(recommended.health.status)}` : null,
            recommended?.health?.lastHealthyAt ? `最近健康时间 ${recommended.health.lastHealthyAt}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "可恢复的回答配置会显示在这里。");
        }
      }

      function renderSandboxResult(result) {
        const summaryRoot = document.getElementById("sandbox-summary");
        const jsonRoot = document.getElementById("sandbox-json");
        activeSandboxResult = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未执行受限操作";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "受限操作结果会显示在这里。";
          }
          renderOperationalArchitectureCards();
          return;
        }

        const sandbox = result.constrainedExecution || result.sandboxExecution || result.sandbox || result;
        if (summaryRoot) {
          summaryRoot.textContent = [
            sandbox?.capability ? `能力 ${sandbox.capability}` : null,
            sandbox?.executed ? "已执行" : "已拦截",
            sandbox?.writeCount != null ? `写入 ${sandbox.writeCount}` : null,
            sandbox?.output?.brokerIsolation?.systemSandbox?.status
              ? `系统 sandbox ${formatStatusLabel(sandbox.output.brokerIsolation.systemSandbox.status)}`
              : null,
            sandbox?.summary || null,
            sandbox?.error ? `错误 ${sandbox.error}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "受限操作结果会显示在这里。");
        }
        renderOperationalArchitectureCards();
      }

      function renderSandboxAudits(result) {
        const summaryRoot = document.getElementById("sandbox-audit-summary");
        const jsonRoot = document.getElementById("sandbox-audit-json");
        activeSandboxAuditState = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载受限操作记录";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "受限操作记录会显示在这里。";
          }
          return;
        }

        const audits = Array.isArray(result.audits) ? result.audits : [];
        const latest = audits.at(-1) || null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            `记录 ${result.counts?.total || 0}`,
            latest?.auditId ? `最近 ${latest.auditId}` : null,
            latest?.capability ? `能力 ${latest.capability}` : null,
            latest?.status ? `状态 ${latest.status}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "受限操作记录会显示在这里。");
        }
      }

      function renderPassportMemories(result) {
        const summaryRoot = document.getElementById("passport-memory-summary");
        const jsonRoot = document.getElementById("passport-memory-json");
        activePassportMemories = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载已记住的内容";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "已记住的内容会显示在这里。";
          }
          syncWorkflowProgress();
          return;
        }

        if (summaryRoot) {
          if (Number(result.counts?.total || 0) === 0) {
            summaryRoot.textContent = "还没记任何内容，先用上面的快捷记录写一句摘要和一段内容。";
          } else {
            summaryRoot.textContent = [
              `总数 ${result.counts?.total || 0}`,
              `筛选后 ${result.counts?.filtered || 0}`,
              Array.isArray(result.memories) && result.memories.length ? `最近一层 ${result.memories.at(-1)?.layer || "memory"}` : "暂无记录",
            ].filter(Boolean).join(" · ");
          }
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "已记住的内容会显示在这里。");
        }
        syncWorkflowProgress();
      }

      function renderArchivedRecords(result) {
        const summaryRoot = document.getElementById("archives-summary");
        const actionsRoot = document.getElementById("archives-actions");
        const jsonRoot = document.getElementById("archives-json");
        activeArchivedState = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载归档内容";
          }
          if (actionsRoot) {
            actionsRoot.innerHTML = "";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "归档内容会显示在这里。";
          }
          return;
        }

        const latest = Array.isArray(result.records) ? result.records[0] || null : null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            result.kind ? `类型 ${result.kind}` : null,
            result.query ? `关键词 ${result.query}` : null,
            result.archivedFrom ? `起始 ${result.archivedFrom}` : null,
            result.archivedTo ? `结束 ${result.archivedTo}` : null,
            result.archive?.count != null ? `归档总数 ${result.archive.count}` : null,
            result.counts?.filtered != null ? `本次加载 ${result.counts.filtered}` : null,
            latest?.archivedAt ? `最近归档 ${latest.archivedAt}` : null,
            latest?.record?.layer ? `最近层 ${latest.record.layer}` : null,
            latest?.record?.entryType ? `最近记录 ${latest.record.entryType}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (actionsRoot) {
          const records = Array.isArray(result.records) ? result.records.slice(0, 6) : [];
          actionsRoot.innerHTML = records.length
            ? records.map((entry, index) => {
                const label =
                  entry?.record?.title ||
                  entry?.record?.summary ||
                  entry?.record?.transcriptEntryId ||
                  entry?.record?.passportMemoryId ||
                  `record_${index + 1}`;
                return `
                  <button
                    class="secondary archive-replay"
                    type="button"
                    data-archive-kind="${escapeHtml(result.kind || "")}"
                    data-archive-index="${index}"
                  >
                    回放 ${escapeHtml(String(label).slice(0, 32))}
                  </button>
                  <button
                    class="secondary archive-restore"
                    type="button"
                    data-archive-kind="${escapeHtml(result.kind || "")}"
                    data-archive-index="${index}"
                  >
                    恢复到热区
                  </button>
                `;
              }).join("")
            : "";
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "归档内容会显示在这里。");
        }
      }

      function replayArchivedRecord(index) {
        const result = activeArchivedState;
        const record = Array.isArray(result?.records) ? result.records[index] || null : null;
        if (!record?.record) {
          return;
        }

        if (result.kind === "transcript") {
          renderTranscriptState({
            transcript: {
              entryCount: 1,
              latestTranscriptEntryId: record.record?.transcriptEntryId || null,
              families: record.record?.family ? [record.record.family] : [],
              messageBlocks: [],
              entries: [record.record],
            },
            entries: [record.record],
            counts: {
              total: 1,
              filtered: 1,
            },
            replayedFromArchive: true,
            archivedAt: record.archivedAt || null,
          });
          scrollToPanel("runtime-panel");
          return;
        }

        renderPassportMemories({
          memories: [record.record],
          counts: {
            total: 1,
            filtered: 1,
          },
          replayedFromArchive: true,
          archivedAt: record.archivedAt || null,
        });
        scrollToPanel("passport-memory-panel");
      }

      async function restoreArchivedRecord(index) {
        const result = activeArchivedState;
        const archived = Array.isArray(result?.records) ? result.records[index] || null : null;
        if (!activeAgentId || !archived?.record) {
          return null;
        }

        const payload = {
          kind: result.kind || "passport-memory",
          archiveIndex: index,
          restoredByAgentId: activeAgentId,
          restoredByWindowId: windowId,
          sourceWindowId: windowId,
        };

        if (result.kind === "transcript") {
          payload.transcriptEntryId = archived.record.transcriptEntryId || null;
        } else {
          payload.passportMemoryId = archived.record.passportMemoryId || null;
        }

        const data = await request(`/api/agents/${activeAgentId}/archives/restore`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setArchiveActionStatus(`已恢复 ${payload.kind} 到热区：${data?.restored?.restoredRecord?.passportMemoryId || data?.restored?.restoredRecord?.transcriptEntryId || "record"}`);

        await Promise.all([
          loadAgentRuntimeSummary(activeAgentId).then((summary) => {
            renderRuntimeQuickSummary(summary?.summary || null);
          }),
          loadArchivedRecords(activeAgentId, buildArchivesOptionsFromForm()),
          loadArchiveRestoreHistory(activeAgentId, buildArchiveRestoreOptionsFromForm()),
          loadContext(activeAgentId),
          loadRehydrate(activeAgentId),
          result.kind === "transcript"
            ? loadTranscript(activeAgentId)
            : loadPassportMemories(activeAgentId),
        ]);

        if (result.kind === "transcript") {
          await runContextBuilder(activeAgentId, buildContextBuilderPayloadFromForm());
        }

        if (result.kind === "transcript") {
          scrollToPanel("runtime-panel");
        } else {
          scrollToPanel("context-panel");
        }

        return data?.restored || null;
      }

      async function revertArchiveRestore(index) {
        const result = activeArchiveRestoreHistory;
        const event = Array.isArray(result?.events) ? result.events[index] || null : null;
        if (!activeAgentId || !event?.payload?.restoredRecordId) {
          return null;
        }
        const confirmed = globalThis.confirm(
          `确定要撤回这次恢复吗？\\n类型：${event.payload.archiveKind || "unknown"}\\n记录：${event.payload.restoredRecordId || "unknown"}`
        );
        if (!confirmed) {
          setArchiveActionStatus("已取消撤回恢复。");
          return null;
        }
        setArchiveActionStatus(`正在撤回恢复：${event.payload.restoredRecordId || "record"} ...`);

        const data = await request(`/api/agents/${activeAgentId}/archive-restores/revert`, {
          method: "POST",
          body: JSON.stringify({
            restoredRecordId: event.payload.restoredRecordId,
            restoreEventHash: event.hash,
            archiveKind: event.payload.archiveKind,
            revertedByAgentId: activeAgentId,
            revertedByWindowId: windowId,
            sourceWindowId: windowId,
          }),
        });

        await Promise.all([
          loadAgentRuntimeSummary(activeAgentId).then((summary) => {
            renderRuntimeQuickSummary(summary?.summary || null);
          }),
          loadArchivedRecords(activeAgentId, buildArchivesOptionsFromForm()),
          loadArchiveRestoreHistory(activeAgentId, buildArchiveRestoreOptionsFromForm()),
          loadContext(activeAgentId),
          loadRehydrate(activeAgentId),
          event.payload.archiveKind === "transcript"
            ? loadTranscript(activeAgentId)
            : loadPassportMemories(activeAgentId),
        ]);

        setArchiveActionStatus(`已撤回恢复：${event.payload.restoredRecordId || "record"}`);

        return data?.reverted || null;
      }

      function renderContextBuilder(result) {
        const summaryRoot = document.getElementById("context-builder-summary");
        const jsonRoot = document.getElementById("context-builder-json");
        activeContextBuilder = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未整理当前资料";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "当前资料整理结果会显示在这里。";
          }
          syncWorkflowProgress();
          return;
        }

        if (summaryRoot) {
          const totalMemoryCount =
            Number(result.memoryLayers?.counts?.profile || 0) +
            Number(result.memoryLayers?.counts?.episodic || 0) +
            Number(result.memoryLayers?.counts?.semantic || 0) +
            Number(result.memoryLayers?.counts?.working || 0);
          const localHitCount = result.localKnowledge?.hits?.length || result.slots?.localKnowledgeHits?.length || 0;
          if (!result.contextHash && !result.slots?.currentGoal && totalMemoryCount === 0 && localHitCount === 0) {
            summaryRoot.textContent = "还没整理过资料，先用上面的快捷整理带一句目标或最近对话。";
          } else {
            summaryRoot.textContent = [
              `上下文编号 ${result.contextHash || "n/a"}`,
              result.slots?.currentGoal ? `当前目标 ${result.slots.currentGoal}` : "暂无当前目标",
              `身份资料 ${result.memoryLayers?.counts?.profile || 0}`,
              `经历记忆 ${result.memoryLayers?.counts?.episodic || 0}`,
              `抽象经验 ${result.memoryLayers?.counts?.semantic || 0}`,
              `工作记忆 ${result.memoryLayers?.counts?.working || 0}`,
              `命中资料 ${localHitCount}`,
            ].filter(Boolean).join(" · ");
          }
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "当前资料整理结果会显示在这里。");
        }
        syncWorkflowProgress();
      }

      function renderResponseVerification(result) {
        const summaryRoot = document.getElementById("response-verify-summary");
        const jsonRoot = document.getElementById("response-verify-json");
        activeResponseVerification = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未检查回复";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "回复检查结果会显示在这里。";
          }
          return;
        }

        if (summaryRoot) {
          summaryRoot.textContent = [
            result.valid ? "检查通过" : "发现冲突",
            Array.isArray(result.issues) ? `${result.issues.length} 个问题` : null,
            result.references?.did ? `身份标识 ${result.references.did}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "回复检查结果会显示在这里。");
        }
      }

      function renderRunnerResult(result) {
        const summaryRoot = document.getElementById("runner-summary");
        const jsonRoot = document.getElementById("runner-json");
        activeRunnerResult = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未执行自动流程";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "自动流程结果会显示在这里。";
          }
          renderOperationalArchitectureCards();
          return;
        }

        const runtimeIntegrity = result.runtimeIntegrity || result.verification || null;
        const constrainedExecution = result.constrainedExecution || result.sandboxExecution || null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            result.run?.status ? formatStatusLabel(result.run.status) : "已准备",
            result.run?.runId ? `执行 ${result.run.runId}` : null,
            result.run?.currentGoal ? `目标 ${result.run.currentGoal}` : null,
            result.run?.resumeBoundaryId ? `恢复位置 ${result.run.resumeBoundaryId}` : null,
            result.residentGate?.required ? `常驻助手限制 ${result.residentGate.code || "locked"}` : null,
            result.bootstrapGate?.required ? `初始准备缺失 ${result.bootstrapGate.missingRequiredCodes?.join(",") || "required"}` : null,
            result.negotiation?.actionable ? `协商结果 ${result.negotiation.decision}` : null,
            result.negotiation?.riskTier ? `风险等级 ${formatRiskTierLabel(result.negotiation.riskTier)}` : null,
            result.negotiation?.authorizationStrategy
              ? `授权方式 ${formatRiskStrategyLabel(result.negotiation.authorizationStrategy)}`
              : null,
            result.negotiation?.requiresMultisig ? "需要多人确认" : null,
            result.reasoner?.provider ? `回答方式 ${formatReasonerProviderLabel(result.reasoner.provider)}` : null,
            result.reasoner?.model ? `模型 ${result.reasoner.model}` : null,
            result.reasoner?.metadata?.fallbackActivated
              ? `已切到 ${formatReasonerProviderLabel(result.reasoner.provider || "deterministic_fallback")}`
              : null,
            result.reasonerPlan?.fallbackProvider
              ? `兜底 ${formatReasonerProviderLabel(result.reasonerPlan.fallbackProvider)}`
              : null,
            result.reasoner?.error ? `回答错误 ${result.reasoner.error}` : null,
            result.queryState?.currentIteration != null && result.queryState?.maxQueryIterations != null
              ? `搜索 ${result.queryState.currentIteration}/${result.queryState.maxQueryIterations}`
              : null,
            result.queryState?.budget?.truncatedFlags?.length
              ? `已裁剪 ${result.queryState.budget.truncatedFlags.join(",")}`
              : null,
            runtimeIntegrity ? (runtimeIntegrity.valid ? "回复检查通过" : `回复检查发现 ${runtimeIntegrity.issues?.length || 0} 个问题`) : "未提供候选回复",
            constrainedExecution?.capability ? `受限能力 ${constrainedExecution.capability}` : null,
            constrainedExecution?.executed ? "受限操作已执行" : constrainedExecution?.error ? "受限操作已拦截" : null,
            result.compaction ? `压缩写入 ${result.compaction.writeCount || 0}` : null,
            result.checkpoint?.triggered ? `归档 ${result.checkpoint.archivedCount || 0}` : null,
            result.driftCheck?.requiresRehydrate ? "建议重新整理恢复包" : null,
            result.driftCheck?.requiresHumanReview ? "建议人工接管" : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "自动流程结果会显示在这里。");
        }
        renderOperationalArchitectureCards();
      }

      function renderRunnerHistory(result) {
        const jsonRoot = document.getElementById("runner-history-json");
        activeRunnerHistory = result || null;

        if (!result) {
          if (jsonRoot) {
            jsonRoot.textContent = "自动流程历史会显示在这里。";
          }
          renderAutoRecoveryAuditTimeline(null);
          renderOperationalArchitectureCards();
          return;
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, {
            counts: result.counts,
            latestAutoRecoveryAudit: Array.isArray(result.autoRecoveryAudits)
              ? result.autoRecoveryAudits.at(-1) || null
              : null,
            runs: result.runs,
            autoRecoveryAudits: result.autoRecoveryAudits,
          }, "自动流程历史会显示在这里。");
        }
        renderAutoRecoveryAuditTimeline(result);
        renderOperationalArchitectureCards();
      }

      function formatAutoRecoveryAuditFilterLabel(filter) {
        const normalized = normalizeText(filter);
        const labels = {
          all: "全部闭环",
          resumed: "已续跑",
          gated: "门禁拦截",
          failed: "执行失败",
          human_review_required: "人工接管",
          planned: "仅规划",
        };
        return labels[normalized] || normalized || "全部闭环";
      }

      function getAutoRecoveryAuditFilterValue() {
        const select = document.getElementById("auto-recovery-audit-filter");
        if (select && typeof select.value === "string") {
          activeAutoRecoveryAuditFilter = select.value || "all";
        }
        return activeAutoRecoveryAuditFilter || "all";
      }

      function filterAutoRecoveryAudits(audits = [], filter = "all") {
        const normalizedFilter = normalizeText(filter);
        const items = Array.isArray(audits) ? audits : [];
        if (!normalizedFilter || normalizedFilter === "all") {
          return items;
        }

        return items.filter((audit) => {
          const status = normalizeText(audit?.status);
          const finalStatus = normalizeText(audit?.finalStatus);
          const closureStatus = normalizeText(audit?.closure?.status);
          if (normalizedFilter === "resumed") {
            return Boolean(audit?.resumed) || ["resumed", "resumed_with_followup"].includes(status) || ["resumed", "resumed_with_followup"].includes(finalStatus);
          }
          if (normalizedFilter === "gated") {
            return status === "gated" || closureStatus === "gated";
          }
          if (normalizedFilter === "failed") {
            return status === "failed" || finalStatus === "failed" || Boolean(audit?.error);
          }
          if (normalizedFilter === "human_review_required") {
            return status === "human_review_required" || closureStatus === "human_review_required";
          }
          if (normalizedFilter === "planned") {
            return status === "planned" || closureStatus === "planned" || (audit?.plan && !audit?.resumed);
          }
          return status === normalizedFilter || finalStatus === normalizedFilter || closureStatus === normalizedFilter;
        });
      }

      function getAutoRecoveryAuditId(audit = null) {
        return audit?.auditEventId || audit?.eventHash || audit?.runId || audit?.finalRunId || null;
      }

      function findAutoRecoveryAuditById(audits = [], auditId = null) {
        const normalizedAuditId = normalizeText(auditId);
        if (!normalizedAuditId) {
          return null;
        }
        return (Array.isArray(audits) ? audits : []).find((audit) => normalizeText(getAutoRecoveryAuditId(audit)) === normalizedAuditId) || null;
      }

      function renderAutoRecoveryAuditDetail(audit = activeAutoRecoveryAudit) {
        const summaryRoot = document.getElementById("auto-recovery-audit-detail-summary");
        const jsonRoot = document.getElementById("auto-recovery-audit-json");
        activeAutoRecoveryAudit = audit || null;

        if (!audit) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未选中闭环审计";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "当前选中的自动恢复闭环审计会显示在这里。";
          }
          return;
        }

        const closurePhases = Array.isArray(audit?.closure?.phases) ? audit.closure.phases : [];
        const runbook = audit?.setupStatus?.formalRecoveryFlow?.runbook || null;
        const readiness = audit?.setupStatus?.activePlanReadiness || audit?.setupStatus?.automaticRecoveryReadiness || null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            audit?.status ? `闭环 ${formatStatusLabel(audit.status)}` : null,
            audit?.timestamp ? `记录于 ${formatCompactTimestamp(audit.timestamp)}` : null,
            audit?.plan?.action ? `计划 ${formatAutoRecoveryActionLabel(audit.plan.action)}` : null,
            audit?.finalStatus ? `最终 ${formatStatusLabel(audit.finalStatus)}` : null,
            runbook?.nextStepLabel ? `正式恢复下一步 ${runbook.nextStepLabel}` : null,
            readiness?.status ? `计划门禁 ${formatStatusLabel(readiness.status)}` : null,
            closurePhases.length ? `${closurePhases.length} 个闭环阶段` : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, {
            audit,
            evidencePackPreview: buildAutoRecoveryAuditEvidencePack(audit),
          }, "当前选中的自动恢复闭环审计会显示在这里。");
        }
      }

      function renderAutoRecoveryAuditTimeline(result = activeRunnerHistory) {
        const summaryRoot = document.getElementById("auto-recovery-audit-summary");
        const listRoot = document.getElementById("auto-recovery-audit-list");
        const audits = Array.isArray(result?.autoRecoveryAudits)
          ? [...result.autoRecoveryAudits].sort((left, right) => (right?.timestamp || "").localeCompare(left?.timestamp || ""))
          : [];

        if (!audits.length) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载自动恢复闭环审计";
          }
          if (listRoot) {
            listRoot.innerHTML = '<div class="status-empty">自动恢复闭环审计会显示在这里。</div>';
          }
          renderAutoRecoveryAuditDetail(null);
          return;
        }

        const activeFilter = getAutoRecoveryAuditFilterValue();
        const filteredAudits = filterAutoRecoveryAudits(audits, activeFilter);
        const latestAudit = filteredAudits[0] || audits[0] || null;
        const selectedAudit =
          findAutoRecoveryAuditById(filteredAudits, getAutoRecoveryAuditId(activeAutoRecoveryAudit)) ||
          latestAudit ||
          null;
        activeAutoRecoveryAudit = selectedAudit;

        if (summaryRoot) {
          summaryRoot.textContent = [
            `${formatAutoRecoveryAuditFilterLabel(activeFilter)} ${filteredAudits.length} 条`,
            `总计 ${audits.length} 条`,
            latestAudit?.timestamp ? `最近 ${formatCompactTimestamp(latestAudit.timestamp)}` : null,
            latestAudit?.status ? `状态 ${formatStatusLabel(latestAudit.status)}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (!listRoot) {
          return;
        }

        if (!filteredAudits.length) {
          listRoot.innerHTML = `<div class="status-empty">当前筛选下没有闭环审计：${escapeHtml(formatAutoRecoveryAuditFilterLabel(activeFilter))}</div>`;
          renderAutoRecoveryAuditDetail(null);
          return;
        }

        listRoot.innerHTML = filteredAudits
          .slice(0, 12)
          .map((audit, index) => {
            const auditId = getAutoRecoveryAuditId(audit);
            const isActiveEntry = normalizeText(auditId) === normalizeText(getAutoRecoveryAuditId(selectedAudit));
            const closurePhases = Array.isArray(audit?.closure?.phases) ? audit.closure.phases : [];
            const phaseSummary = closurePhases.length
              ? closurePhases.map((entry) => `${formatAutoRecoveryPhaseLabel(entry?.phaseId)} ${formatStatusLabel(entry?.status)}`).join(" -> ")
              : "未记录闭环阶段";
            const gateReasons = summarizeOperationsList([
              ...(Array.isArray(audit?.gateReasons) ? audit.gateReasons : []),
              ...(Array.isArray(audit?.closure?.gateReasons) ? audit.closure.gateReasons : []),
            ]);
            const dependencyWarnings = summarizeOperationsList([
              ...(Array.isArray(audit?.dependencyWarnings) ? audit.dependencyWarnings : []),
              ...(Array.isArray(audit?.closure?.dependencyWarnings) ? audit.closure.dependencyWarnings : []),
            ]);
            const runbook = audit?.setupStatus?.formalRecoveryFlow?.runbook || null;
            const readiness = audit?.setupStatus?.activePlanReadiness || audit?.setupStatus?.automaticRecoveryReadiness || null;
            return `
              <details class="status-entry"${isActiveEntry || index === 0 ? " open" : ""}>
                <summary>
                  <span class="status-entry-title">${escapeHtml(formatStatusLabel(audit?.status || audit?.finalStatus || "unknown"))}</span>
                  <span>${escapeHtml(audit?.summary || phaseSummary || "无摘要")}</span>
                  <span class="tag">${escapeHtml(formatCompactTimestamp(audit?.timestamp || ""))}</span>
                  ${audit?.plan?.action ? `<span class="tag">${escapeHtml(formatAutoRecoveryActionLabel(audit.plan.action))}</span>` : ""}
                  ${isActiveEntry ? '<span class="tag">当前</span>' : ""}
                </summary>
                <div class="status-entry-body">
                  <div class="meta">
                    时间：${escapeHtml(audit?.timestamp || "无")}<br />
                    运行：${escapeHtml(audit?.runId || audit?.finalRunId || "无")}<br />
                    触发运行：${escapeHtml(audit?.triggerRunId || audit?.initialRunId || "无")}<br />
                    尝试次数：${escapeHtml(audit?.attempt != null && audit?.maxAttempts != null ? `${audit.attempt}/${audit.maxAttempts}` : "无")}<br />
                    闭环阶段：${escapeHtml(phaseSummary)}<br />
                    最终状态：${escapeHtml(formatStatusLabel(audit?.finalStatus || audit?.status || "unknown"))}<br />
                    计划：${escapeHtml(audit?.plan?.summary || audit?.plan?.action ? formatAutoRecoveryActionLabel(audit?.plan?.action) : "无")}<br />
                    正式恢复下一步：${escapeHtml(runbook?.nextStepLabel || "无")}<br />
                    正式恢复缺口：${escapeHtml((audit?.setupStatus?.formalRecoveryFlow?.missingRequiredCodes || []).map(formatRecoveryRequirementLabel).join(" / ") || "无")}<br />
                    计划门禁：${escapeHtml(readiness?.gateReasons?.join(", ") || "无")}<br />
                    恢复链：${escapeHtml(String(Array.isArray(audit?.chain) ? audit.chain.length : 0))} 步
                  </div>
                  <div class="status-entry-actions">
                    <button class="secondary auto-recovery-audit-select" type="button" data-audit-id="${escapeHtml(auditId || "")}">查看当前审计</button>
                    <button class="secondary auto-recovery-audit-download" type="button" data-audit-id="${escapeHtml(auditId || "")}">下载证据包</button>
                  </div>
                  ${gateReasons.length ? `
                    <details class="status-panel">
                      <summary>查看门禁原因</summary>
                      <pre class="status-json">${escapeHtml(gateReasons.join("\n"))}</pre>
                    </details>
                  ` : ""}
                  ${dependencyWarnings.length ? `
                    <details class="status-panel">
                      <summary>查看依赖缺口</summary>
                      <pre class="status-json">${escapeHtml(dependencyWarnings.join("\n"))}</pre>
                    </details>
                  ` : ""}
                  <details class="status-panel">
                    <summary>查看审计 JSON</summary>
                    <pre class="status-json">${escapeJsonHtml(audit)}</pre>
                  </details>
                </div>
              </details>
            `;
          })
          .join("");
        renderAutoRecoveryAuditDetail(selectedAudit);
      }

      function renderSessionState(result) {
        const summaryRoot = document.getElementById("session-state-summary");
        const jsonRoot = document.getElementById("session-state-json");
        activeSessionState = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载会话状态";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "会话状态会显示在这里。";
          }
          return;
        }

        if (summaryRoot) {
          summaryRoot.textContent = [
            result.sessionStateId ? `会话 ${result.sessionStateId}` : null,
            result.currentGoal ? `目标 ${result.currentGoal}` : null,
            result.latestRunStatus ? `最近执行 ${result.latestRunStatus}` : null,
            result.latestCompactBoundaryId ? `最近检查点 ${result.latestCompactBoundaryId}` : null,
            result.latestResumeBoundaryId ? `最近恢复位置 ${result.latestResumeBoundaryId}` : null,
            result.latestQueryStateId ? `最近搜索 ${result.latestQueryStateId}` : null,
            result.localMode ? `运行模式 ${result.localMode}` : null,
            result.latestNegotiationDecision ? `最近协商 ${result.latestNegotiationDecision}` : null,
            result.queryState?.currentIteration != null && result.queryState?.maxQueryIterations != null
              ? `${result.queryState.currentIteration}/${result.queryState.maxQueryIterations}`
              : null,
            result.currentTaskSnapshotId ? `任务快照 ${result.currentTaskSnapshotId}` : "暂无任务快照",
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "会话状态会显示在这里。");
        }
      }

      function renderCompactBoundaries(result) {
        const summaryRoot = document.getElementById("compact-boundary-summary");
        const jsonRoot = document.getElementById("compact-boundary-json");
        activeCompactBoundaries = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未读取恢复检查点";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "恢复检查点会显示在这里。";
          }
          return;
        }

        const latestBoundary = result.compactBoundaries?.at?.(-1) || result.compactBoundaries?.[0] || null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            `总数 ${result.counts?.filtered || result.compactBoundaries?.length || 0}`,
            latestBoundary?.compactBoundaryId ? `最近 ${latestBoundary.compactBoundaryId}` : null,
            latestBoundary?.archivedCount != null ? `已归档 ${latestBoundary.archivedCount}` : null,
            latestBoundary?.retainedCount != null ? `已保留 ${latestBoundary.retainedCount}` : null,
            latestBoundary?.resumeDepth != null ? `继续深度 ${latestBoundary.resumeDepth}` : null,
            latestBoundary?.previousCompactBoundaryId ? `上一个 ${latestBoundary.previousCompactBoundaryId}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (latestBoundary?.compactBoundaryId) {
          const rehydrateInput = document.querySelector('#rehydrate-form [name="resumeFromCompactBoundaryId"]');
          const runnerInput = document.querySelector('#runner-form [name="resumeFromCompactBoundaryId"]');
          if (rehydrateInput && !rehydrateInput.value) {
            rehydrateInput.value = latestBoundary.compactBoundaryId;
          }
          if (runnerInput && !runnerInput.value) {
            runnerInput.value = latestBoundary.compactBoundaryId;
          }
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "恢复检查点会显示在这里。");
        }
      }

      function renderVerificationRunResult(result) {
        const summaryRoot = document.getElementById("verification-run-summary");
        const jsonRoot = document.getElementById("verification-run-json");
        activeVerificationRunResult = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未执行正确性检查";
          }
          if (jsonRoot) {
            jsonRoot.textContent = "检查结果会显示在这里。";
          }
          return;
        }

        const verificationRun = result.integrityRun || result.verificationRun || result;
        if (summaryRoot) {
          summaryRoot.textContent = [
            verificationRun.status || "部分完成",
            (verificationRun.integrityRunId || verificationRun.verificationRunId) ? `检查 ${verificationRun.integrityRunId || verificationRun.verificationRunId}` : null,
            (verificationRun.integritySummary || verificationRun.summary)
              ? `通过 ${(verificationRun.integritySummary || verificationRun.summary).pass || 0} / 未通过 ${(verificationRun.integritySummary || verificationRun.summary).fail || 0}`
              : null,
            (verificationRun.relatedResumeBoundaryId || verificationRun.relatedCompactBoundaryId)
              ? `关联检查点 ${verificationRun.relatedResumeBoundaryId || verificationRun.relatedCompactBoundaryId}`
              : null,
          ].filter(Boolean).join(" · ");
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "检查结果会显示在这里。");
        }
      }

      function renderVerificationRunHistory(result) {
        const jsonRoot = document.getElementById("verification-run-history-json");
        activeVerificationRunHistory = result || null;

        if (!result) {
          if (jsonRoot) {
            jsonRoot.textContent = "检查历史会显示在这里。";
          }
          return;
        }

        if (jsonRoot) {
          setJsonText(jsonRoot, result, "检查历史会显示在这里。");
        }
      }

      function extractActiveCredentialId() {
        return (
          activeCredentialRecord?.credentialRecordId ||
          activeCredentialRecord?.credentialId ||
          activeCredential?.id ||
          pendingDashboardCredentialId ||
          null
        );
      }

      function buildDashboardSearch() {
        if (typeof linkHelpers.buildDashboardSearch === "function") {
          return linkHelpers.buildDashboardSearch({
            agentId: activeAgentId || null,
            didMethod: normalizeDashboardDidMethod(activeDashboardDidMethod),
            windowId: activeWindowContextId || windowId,
            repairId: activeCredentialRepairContext?.repairId || null,
            credentialId: extractActiveCredentialId(),
            statusListId: activeStatusListId || null,
            statusListCompareId: activeStatusListCompareId || null,
            repairLimit: activeCredentialRepairPage.limit || null,
            repairOffset: activeCredentialRepairPage.offset || null,
            compareLeftAgentId: activeCompareParams?.leftAgentId || null,
            compareRightAgentId: activeCompareParams?.rightAgentId || null,
            compareIssuerAgentId: activeCompareParams?.issuerAgentId || null,
            compareIssuerDidMethod: activeCompareParams?.issuerDidMethod || null,
          });
        }

        const search = new URLSearchParams();
        const dashboardDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        const repairId = activeCredentialRepairContext?.repairId || null;
        const credentialId = extractActiveCredentialId();
        const dashboardView = activeDashboardMode && activeDashboardMode !== "recommended"
          ? activeDashboardMode
          : null;

        if (activeAgentId) {
          search.set("agentId", activeAgentId);
        }
        if (dashboardView) {
          search.set("view", dashboardView);
        }
        if (dashboardDidMethod) {
          search.set("didMethod", dashboardDidMethod);
        }
        if (activeWindowContextId || windowId) {
          search.set("windowId", activeWindowContextId || windowId);
        }
        if (repairId) {
          search.set("repairId", repairId);
        }
        if (credentialId) {
          search.set("credentialId", credentialId);
        }
        if (activeStatusListId) {
          search.set("statusListId", activeStatusListId);
        }
        if (activeStatusListCompareId) {
          search.set("statusListCompareId", activeStatusListCompareId);
        }
        if (activeCredentialRepairPage.limit) {
          search.set("repairLimit", String(activeCredentialRepairPage.limit));
        }
        if (activeCredentialRepairPage.offset) {
          search.set("repairOffset", String(activeCredentialRepairPage.offset));
        }
        if (activeCompareParams?.leftAgentId) {
          search.set("compareLeftAgentId", activeCompareParams.leftAgentId);
        }
        if (activeCompareParams?.rightAgentId) {
          search.set("compareRightAgentId", activeCompareParams.rightAgentId);
        }
        if (activeCompareParams?.issuerAgentId) {
          search.set("compareIssuerAgentId", activeCompareParams.issuerAgentId);
        }
        if (activeCompareParams?.issuerDidMethod) {
          search.set("compareIssuerDidMethod", activeCompareParams.issuerDidMethod);
        }

        return search;
      }

      function syncDashboardUrlState() {
        const search = buildDashboardSearch();
        const nextUrl = typeof linkHelpers.buildDashboardHref === "function"
          ? linkHelpers.buildDashboardHref({
              agentId: activeAgentId || null,
              didMethod: normalizeDashboardDidMethod(activeDashboardDidMethod),
              windowId: activeWindowContextId || windowId,
              repairId: activeCredentialRepairContext?.repairId || null,
              credentialId: extractActiveCredentialId(),
              statusListId: activeStatusListId || null,
              statusListCompareId: activeStatusListCompareId || null,
              repairLimit: activeCredentialRepairPage.limit || null,
              repairOffset: activeCredentialRepairPage.offset || null,
              compareLeftAgentId: activeCompareParams?.leftAgentId || null,
              compareRightAgentId: activeCompareParams?.rightAgentId || null,
              compareIssuerAgentId: activeCompareParams?.issuerAgentId || null,
              compareIssuerDidMethod: activeCompareParams?.issuerDidMethod || null,
            })
          : search.toString()
            ? `${window.location.pathname}?${search.toString()}`
            : window.location.pathname;
        const normalizedUrl = new URL(nextUrl, window.location.origin);
        if (activeDashboardMode && activeDashboardMode !== "recommended") {
          normalizedUrl.searchParams.set("view", activeDashboardMode);
        } else {
          normalizedUrl.searchParams.delete("view");
        }
        history.replaceState(null, "", `${normalizedUrl.pathname}${normalizedUrl.search}${normalizedUrl.hash}`);
      }

      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function escapeJsonHtml(value) {
        return escapeHtml(stringifyJsonValue(value));
      }

      function credentialStatusEntryKey(entry) {
        return entry?.credentialRecordId || entry?.credentialId || entry?.statusListEntryId || null;
      }

      function statusListComparisonEntryKey(entry) {
        return credentialStatusEntryKey(entry) || entry?.statusListEntryId || null;
      }

      function summarizeStatusEntry(entry) {
        return [
          entry?.statusListIndex != null ? `#${entry.statusListIndex}` : null,
          entry?.subjectLabel || entry?.subjectId || entry?.credentialId || "unknown",
          entry?.status || "unknown",
          entry?.revokedAt ? `revoked ${entry.revokedAt}` : null,
        ].filter(Boolean).join(" · ");
      }

      function normalizeStatusListReference(value) {
        if (!value) {
          return null;
        }

        return String(value)
          .trim()
          .replace(/#credential$/, "")
          .replace(/#entry-\d+$/, "");
      }

      function currentCredentialStatusListId() {
        return normalizeStatusListReference(
          activeCredentialStatus?.credentialStatus?.statusListId ||
            activeCredentialStatus?.statusListSummary?.statusListId ||
            activeCredentialStatus?.statusList?.summary?.statusListId ||
            activeCredentialRecord?.statusListId ||
            activeCredentialRecord?.credentialStatus?.statusListId ||
            activeCredentialRecord?.statusListCredentialId ||
            null
        );
      }

      function formatStatusListOption(statusList) {
        const issuer = statusList?.issuerLabel || statusList?.issuerDid || "unknown";
        const totalEntries = statusList?.totalEntries != null ? `${statusList.totalEntries} 项` : "0 项";
        return `${issuer} · ${totalEntries}`;
      }

      function renderStatusListSelector(statusLists = [], preferredStatusListId = null) {
        const root = document.getElementById("status-list-selector");
        const normalizedLists = Array.isArray(statusLists) ? statusLists.filter(Boolean) : [];
        const availableIds = new Set(normalizedLists.map((item) => item.statusListId).filter(Boolean));
        const preferredId = normalizeStatusListReference(preferredStatusListId);
        const storedId = normalizeStatusListReference(activeStatusListId);
        const currentValue = root ? normalizeStatusListReference(root.value) : null;
        const nextValue =
          (preferredId && availableIds.has(preferredId) ? preferredId : null) ||
          (storedId && availableIds.has(storedId) ? storedId : null) ||
          (currentValue && availableIds.has(currentValue) ? currentValue : null) ||
          normalizedLists[0]?.statusListId ||
          null;

        activeStatusLists = normalizedLists;

        if (!root) {
          return nextValue;
        }

        root.innerHTML = normalizedLists.length
          ? normalizedLists
              .map((statusList) => {
                const selected = nextValue && statusList.statusListId === nextValue ? " selected" : "";
                return `<option value="${escapeHtml(statusList.statusListId)}"${selected}>${escapeHtml(formatStatusListOption(statusList))}</option>`;
              })
              .join("")
          : '<option value="">暂无状态列表</option>';
        root.disabled = normalizedLists.length === 0;

        if (nextValue) {
          root.value = nextValue;
        } else {
          root.value = "";
        }

        activeStatusListId = nextValue;
        try {
          if (activeStatusListId) {
            localStorage.setItem(ACTIVE_STATUS_LIST_KEY, activeStatusListId);
          } else {
            localStorage.removeItem(ACTIVE_STATUS_LIST_KEY);
          }
        } catch {}

        return activeStatusListId;
      }

      function renderStatusListCompareSelector(statusLists = [], preferredStatusListId = null, excludedStatusListId = null) {
        const root = document.getElementById("status-list-compare-selector");
        const normalizedLists = Array.isArray(statusLists) ? statusLists.filter(Boolean) : [];
        const excludedId = normalizeStatusListReference(excludedStatusListId);
        const compareLists = excludedId
          ? normalizedLists.filter((item) => normalizeStatusListReference(item.statusListId) !== excludedId)
          : normalizedLists;
        const availableIds = new Set(compareLists.map((item) => item.statusListId).filter(Boolean));
        const preferredId = normalizeStatusListReference(preferredStatusListId);
        const storedId = normalizeStatusListReference(activeStatusListCompareId);
        const currentValue = root ? normalizeStatusListReference(root.value) : null;
        const nextValue =
          (preferredId && availableIds.has(preferredId) ? preferredId : null) ||
          (storedId && availableIds.has(storedId) ? storedId : null) ||
          (currentValue && availableIds.has(currentValue) ? currentValue : null) ||
          compareLists[0]?.statusListId ||
          null;

        activeStatusLists = normalizedLists;

        if (!root) {
          return nextValue;
        }

        root.innerHTML = compareLists.length
          ? compareLists
              .map((statusList) => {
                const selected = nextValue && statusList.statusListId === nextValue ? " selected" : "";
                return `<option value="${escapeHtml(statusList.statusListId)}"${selected}>${escapeHtml(formatStatusListOption(statusList))}</option>`;
              })
              .join("")
          : '<option value="">暂无可对比列表</option>';
        root.disabled = compareLists.length === 0;

        if (nextValue) {
          root.value = nextValue;
        } else {
          root.value = "";
        }

        activeStatusListCompareId = nextValue;
        try {
          if (activeStatusListCompareId) {
            localStorage.setItem(ACTIVE_STATUS_LIST_COMPARE_KEY, activeStatusListCompareId);
          } else {
            localStorage.removeItem(ACTIVE_STATUS_LIST_COMPARE_KEY);
          }
        } catch {}

        return activeStatusListCompareId;
      }

      function renderStatusListBrowser(result, errorMessage = null) {
        const summaryRoot = document.getElementById("status-list-browser-summary");
        const detailRoot = document.getElementById("status-list-browser-detail");
        const root = document.getElementById("status-list-browser");

        if (!result) {
          activeStatusListView = null;
          if (summaryRoot) {
            summaryRoot.textContent = errorMessage ? `状态列表加载失败：${errorMessage}` : "尚未选择状态列表";
          }
          if (detailRoot) {
            detailRoot.textContent = errorMessage || "先从上方选择一个状态列表，或定位当前证据列表。";
          }
          if (root) {
            root.innerHTML = `<div class="status-empty">${escapeHtml(
              errorMessage || "当前没有可浏览的状态列表。"
            )}</div>`;
          }
          return;
        }

        activeStatusListView = result;
        const summary = result.summary || {};
        const statusListCredential = result.statusList || null;
        const entries = Array.isArray(result.entries) ? result.entries : [];
        const selectedCredentialRecordId = activeCredentialRecord?.credentialRecordId || activeCredentialRecord?.credentialId || activeCredential?.id || null;
        const currentCredentialStatusListIdValue = currentCredentialStatusListId();
        const activeEntry =
          entries.find((entry) => credentialStatusEntryKey(entry) === selectedCredentialRecordId) ||
          entries.find((entry) => entry.credentialId === selectedCredentialRecordId) ||
          null;

        if (summaryRoot) {
          summaryRoot.textContent = [
            summary.issuerLabel || summary.issuerDid || "unknown issuer",
            summary.statusListId || "unknown list",
            summary.totalEntries != null ? `${summary.totalEntries} 项` : null,
            summary.activeCount != null ? `active ${summary.activeCount}` : null,
            summary.revokedCount != null ? `revoked ${summary.revokedCount}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
        }

        if (detailRoot) {
          detailRoot.textContent = [
            `状态列表凭证：${summary.statusListCredentialId || "无"}`,
            `issuer ${summary.issuerLabel || summary.issuerDid || "unknown"}`,
            summary.bitstring != null ? `bits ${summary.bitstring}` : null,
            summary.proofValue ? `hash ${summary.proofValue.slice(0, 12)}` : null,
            currentCredentialStatusListIdValue && currentCredentialStatusListIdValue === summary.statusListId ? "当前证据所属列表" : null,
            activeEntry ? `当前证据条目 ${summarizeStatusEntry(activeEntry)}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
        }

        if (root) {
          root.innerHTML = `
            <details class="status-panel" open>
              <summary>
                <span>选中状态列表</span>
                <span class="tag">${escapeHtml(summary.issuerLabel || summary.issuerDid || "unknown")}</span>
              </summary>
              <div class="status-entry-body">
                <div class="meta">
                  状态列表：${escapeHtml(summary.statusListId || "无")}<br />
                  凭证：${escapeHtml(summary.statusListCredentialId || "无")}<br />
                  条目：${escapeHtml(String(summary.totalEntries || 0))} 个<br />
                  活跃：${escapeHtml(String(summary.activeCount || 0))} · 撤销：${escapeHtml(String(summary.revokedCount || 0))}<br />
                  状态位串：${escapeHtml(summary.bitstring || "")}
                </div>
                <details class="status-panel">
                  <summary>查看选中列表 JSON</summary>
                  <pre class="status-json">${escapeJsonHtml({
                    statusListId: result.statusListId,
                    summary,
                    statusListCredential,
                    entries,
                  })}</pre>
                </details>
              </div>
            </details>
            <div class="status-list">
              ${entries.length === 0
                ? '<div class="status-empty">当前状态列表没有条目。</div>'
                : entries
                    .map((entry) => {
                      const entryKey = credentialStatusEntryKey(entry);
                      const isActiveEntry = Boolean(selectedCredentialRecordId && (entryKey === selectedCredentialRecordId || entry.credentialId === selectedCredentialRecordId));
                      const isCurrentCredentialList =
                        currentCredentialStatusListIdValue &&
                        normalizeStatusListReference(entry.statusListId) === currentCredentialStatusListIdValue;
                      return `
                        <details class="status-entry"${isActiveEntry ? " open" : ""}>
                          <summary>
                            <span class="status-entry-title">${escapeHtml(entry.statusListIndex != null ? `#${entry.statusListIndex}` : "entry")}</span>
                            <span>${escapeHtml(entry.subjectLabel || entry.subjectId || entry.credentialId || "unknown")}</span>
                            <span class="tag">${escapeHtml(entry.status || "unknown")}</span>
                            ${entry.revokedAt ? '<span class="tag">revoked</span>' : ""}
                            ${isCurrentCredentialList ? '<span class="tag">当前证据</span>' : ""}
                          </summary>
                          <div class="status-entry-body">
                            <div class="meta">
                              条目 ID：${escapeHtml(entry.statusListEntryId || "无")}<br />
                              证据 ID：${escapeHtml(entry.credentialId || "无")}<br />
                              记录 ID：${escapeHtml(entry.credentialRecordId || "无")}<br />
                              对象：${escapeHtml(entry.subjectType || "unknown")} / ${escapeHtml(entry.subjectId || "unknown")}<br />
                              发行者：${escapeHtml(entry.issuerLabel || entry.issuerDid || "无")}<br />
                              状态：${escapeHtml(entry.status || "unknown")}<br />
                              状态位：${entry.statusBit != null ? escapeHtml(String(entry.statusBit)) : "无"}<br />
                              状态列表：${escapeHtml(entry.statusListId || "无")}<br />
                              凭证：${escapeHtml(entry.statusListCredentialId || "无")}<br />
                              发行时间：${escapeHtml(entry.issuedAt || "无")}<br />
                              更新时间：${escapeHtml(entry.updatedAt || "无")}<br />
                              撤销时间：${escapeHtml(entry.revokedAt || "无")}<br />
                              撤销原因：${escapeHtml(entry.revocationReason || "无")}<br />
                              证据哈希：${escapeHtml(entry.proofValue || "无")}<br />
                              账本哈希：${escapeHtml(entry.ledgerHash || "无")}
                            </div>
                            <details class="status-panel">
                              <summary>查看条目 JSON</summary>
                              <pre class="status-json">${escapeJsonHtml(entry)}</pre>
                            </details>
                            <div class="status-entry-actions">
                              <button class="secondary status-entry-load" type="button" data-credential-id="${escapeHtml(entry.credentialId || "")}" data-credential-record-id="${escapeHtml(entry.credentialRecordId || "")}">查看证据</button>
                              <button class="secondary status-entry-timeline" type="button" data-credential-id="${escapeHtml(entry.credentialId || "")}" data-credential-record-id="${escapeHtml(entry.credentialRecordId || "")}">查看时间线</button>
                            </div>
                          </div>
                        </details>
                      `;
                    })
            .join("")}
            </div>
          `;
        }
      }

      function renderStatusListComparison(result, errorMessage = null) {
        const summaryRoot = document.getElementById("status-list-compare-summary");
        const detailRoot = document.getElementById("status-list-compare-detail");
        const root = document.getElementById("status-list-compare");

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = errorMessage ? `对比加载失败：${errorMessage}` : "尚未加载对比";
          }
          if (detailRoot) {
            detailRoot.textContent = errorMessage || "选择一个不同的状态列表即可查看并排比较。";
          }
          if (root) {
            root.innerHTML = `<div class="status-empty">${escapeHtml(errorMessage || "当前没有可对比的状态列表。")}</div>`;
          }
          return;
        }

        const left = result.left || null;
        const right = result.right || null;
        const leftSummary = left?.summary || {};
        const rightSummary = right?.summary || {};
        const leftIdentity = left?.issuerIdentity || {};
        const rightIdentity = right?.issuerIdentity || {};
        const comparison = result.comparison || {};
        const leftEntries = Array.isArray(left?.entries) ? left.entries : [];
        const rightEntries = Array.isArray(right?.entries) ? right.entries : [];
        const sameChainId = comparison.sameChainId ?? Boolean(leftSummary.chainId && leftSummary.chainId === rightSummary.chainId);
        const sameIssuerDid = comparison.sameIssuerDid ?? Boolean(leftIdentity.did && leftIdentity.did === rightIdentity.did);
        const sameWalletAddress = comparison.sameWalletAddress ?? Boolean(leftIdentity.walletAddress && leftIdentity.walletAddress === rightIdentity.walletAddress);
        const samePolicyType = comparison.samePolicyType ?? Boolean(leftIdentity.policyType && leftIdentity.policyType === rightIdentity.policyType);
        const sameThreshold = comparison.sameThreshold ?? Boolean(
          Number.isFinite(Number(leftIdentity.threshold)) &&
            Number.isFinite(Number(rightIdentity.threshold)) &&
            Number(leftIdentity.threshold) === Number(rightIdentity.threshold)
        );
        const sameSignerSet = comparison.sameSignerSet ?? false;
        const sameControllerSet = comparison.sameControllerSet ?? false;
        const sameLedgerHash = comparison.sameLedgerHash ?? Boolean(leftSummary.ledgerHash && leftSummary.ledgerHash === rightSummary.ledgerHash);
        const sameProofValue = comparison.sameProofValue ?? Boolean(leftSummary.proofValue && leftSummary.proofValue === rightSummary.proofValue);
        const samePurpose = comparison.samePurpose ?? Boolean(leftSummary.statusPurpose && leftSummary.statusPurpose === rightSummary.statusPurpose);

        const leftEntryMap = new Map();
        for (const entry of leftEntries) {
          const key = statusListComparisonEntryKey(entry);
          if (key && !leftEntryMap.has(key)) {
            leftEntryMap.set(key, entry);
          }
        }

        const rightEntryMap = new Map();
        for (const entry of rightEntries) {
          const key = statusListComparisonEntryKey(entry);
          if (key && !rightEntryMap.has(key)) {
            rightEntryMap.set(key, entry);
          }
        }

        const sharedEntries = [];
        const leftOnlyEntries = [];
        for (const [key, entry] of leftEntryMap.entries()) {
          if (rightEntryMap.has(key)) {
            sharedEntries.push(entry);
          } else {
            leftOnlyEntries.push(entry);
          }
        }
        const rightOnlyEntries = [];
        for (const [key, entry] of rightEntryMap.entries()) {
          if (!leftEntryMap.has(key)) {
            rightOnlyEntries.push(entry);
          }
        }

        const leftEntryCount = comparison.leftEntryCount ?? leftEntries.length;
        const rightEntryCount = comparison.rightEntryCount ?? rightEntries.length;
        const sharedCount = comparison.sharedCount ?? sharedEntries.length;
        const leftOnlyCount = comparison.leftOnlyCount ?? leftOnlyEntries.length;
        const rightOnlyCount = comparison.rightOnlyCount ?? rightOnlyEntries.length;
        const diffSummary = [
          sameIssuerDid ? "同一 DID" : "不同 DID",
          sameWalletAddress ? "同一钱包" : "不同钱包",
          samePolicyType ? `policy ${leftIdentity.policyType || "unknown"}` : "policy 不同",
          sameThreshold ? `threshold ${leftIdentity.threshold ?? "unknown"}` : "threshold 不同",
          sameSignerSet ? "签名者集合一致" : "签名者集合不同",
          sameControllerSet ? "控制人集合一致" : "控制人集合不同",
          sameChainId ? "同一 chain" : "chain 不同",
          sameLedgerHash ? "共享同一 ledger 快照" : "ledger 快照不同",
          sameProofValue ? "proof 相同" : "proof 不同",
          samePurpose ? `purpose ${leftSummary.statusPurpose || "unknown"}` : "purpose 不同",
          `条目：${leftEntryCount} ↔ ${rightEntryCount}`,
        ].filter(Boolean).join(" · ");

        if (summaryRoot) {
          summaryRoot.textContent = [
            `${leftSummary.issuerLabel || leftSummary.issuerDid || "左侧"} ↔ ${rightSummary.issuerLabel || rightSummary.issuerDid || "右侧"}`,
            diffSummary,
          ].join(" · ");
        }

        if (detailRoot) {
          detailRoot.textContent = [
            `左侧：${leftSummary.statusListId || "无"} · ${leftSummary.totalEntries != null ? `${leftSummary.totalEntries} 项` : "0 项"} · ${leftSummary.bitstring != null ? `bits ${leftSummary.bitstring}` : "bits 无"}`,
            `右侧：${rightSummary.statusListId || "无"} · ${rightSummary.totalEntries != null ? `${rightSummary.totalEntries} 项` : "0 项"} · ${rightSummary.bitstring != null ? `bits ${rightSummary.bitstring}` : "bits 无"}`,
            comparison.summary || null,
          ]
            .filter(Boolean)
            .join(" ｜ ");
        }

        if (root) {
          const renderSide = (label, side, actionClass) => {
            const summary = side?.summary || {};
            const entries = Array.isArray(side?.entries) ? side.entries : [];
            const identity = side?.issuerIdentity || {};
            const snippet = {
              statusListId: side?.statusListId || null,
              summary: {
                statusListId: summary.statusListId || null,
                statusListCredentialId: summary.statusListCredentialId || null,
                issuerLabel: summary.issuerLabel || null,
                issuerDid: summary.issuerDid || null,
                totalEntries: summary.totalEntries ?? 0,
                activeCount: summary.activeCount ?? 0,
                revokedCount: summary.revokedCount ?? 0,
                bitstring: summary.bitstring || "",
                proofValue: summary.proofValue || null,
                ledgerHash: summary.ledgerHash || null,
              },
              issuerIdentity: {
                agentId: identity.agentId || null,
                displayName: identity.displayName || null,
                did: identity.did || null,
                walletAddress: identity.walletAddress || null,
                policyType: identity.policyType || null,
                threshold: identity.threshold ?? null,
                signerCount: identity.signerCount ?? 0,
              },
              sampleEntries: entries.slice(0, 5),
            };
            const signersText = Array.isArray(identity.signers) && identity.signers.length
              ? identity.signers.map((signer) => signer.label || signer.walletAddress || "signer").join(" · ")
              : "无";
            const controllersText = Array.isArray(identity.controllers) && identity.controllers.length
              ? identity.controllers.map((controller) => controller.label || controller.walletAddress || "controller").join(" · ")
              : "无";

            return `
              <details class="status-panel status-compare-card" open>
                <summary>
                  <span>${escapeHtml(label)}</span>
                  <span class="tag">${escapeHtml(summary.issuerLabel || summary.issuerDid || "unknown")}</span>
                </summary>
                <div class="status-entry-body">
                  <div class="meta">
                    状态列表：${escapeHtml(summary.statusListId || "无")}<br />
                    凭证：${escapeHtml(summary.statusListCredentialId || "无")}<br />
                    Issuer：${escapeHtml(identity.displayName || identity.agentId || summary.issuerDid || "无")}<br />
                    DID：${escapeHtml(identity.did || summary.issuerDid || "无")}<br />
                    钱包：${escapeHtml(identity.walletAddress || "无")}<br />
                    多签：${escapeHtml(identity.policyType || "unknown")} / ${escapeHtml(String(identity.threshold ?? 0))}<br />
                    签名者：${escapeHtml(signersText)}<br />
                    控制人：${escapeHtml(controllersText)}<br />
                    条目：${escapeHtml(String(summary.totalEntries || 0))} 个<br />
                    活跃：${escapeHtml(String(summary.activeCount || 0))} · 撤销：${escapeHtml(String(summary.revokedCount || 0))}<br />
                    状态位串：${escapeHtml(summary.bitstring || "")}<br />
                    证明哈希：${escapeHtml(summary.proofValue || "无")}
                  </div>
                  <details class="status-panel">
                    <summary>查看${escapeHtml(label)}摘要 JSON</summary>
                    <pre class="status-json">${escapeJsonHtml(snippet)}</pre>
                  </details>
                  <div class="status-entry-actions">
                    <button class="secondary status-compare-load ${escapeHtml(actionClass)}" type="button" data-status-list-id="${escapeHtml(side?.statusListId || "")}">在浏览器查看</button>
                  </div>
                </div>
              </details>
            `;
          };

          const diffCards = [
            {
              title: `共享条目 ${sharedEntries.length}`,
              body: sharedEntries.length
                ? sharedEntries.slice(0, 5).map((entry) => escapeHtml(summarizeStatusEntry(entry))).join("<br />")
                : "无",
            },
            {
              title: `左侧独有 ${leftOnlyEntries.length}`,
              body: leftOnlyEntries.length
                ? leftOnlyEntries.slice(0, 5).map((entry) => escapeHtml(summarizeStatusEntry(entry))).join("<br />")
                : "无",
            },
            {
              title: `右侧独有 ${rightOnlyEntries.length}`,
              body: rightOnlyEntries.length
                ? rightOnlyEntries.slice(0, 5).map((entry) => escapeHtml(summarizeStatusEntry(entry))).join("<br />")
                : "无",
            },
          ];

          root.innerHTML = `
            <div class="status-compare-grid">
              ${renderSide("左侧", left, "status-compare-load-left")}
              ${renderSide("右侧", right, "status-compare-load-right")}
            </div>
            <details class="status-panel" open>
              <summary>
                <span>差异视图</span>
                <span class="tag">${escapeHtml(`${sharedCount} shared`)}</span>
              </summary>
              <div class="status-entry-body">
                <div class="meta">${escapeHtml(diffSummary)}</div>
                <div class="cards">
                  ${diffCards
                    .map(
                      (card) => `
                        <article class="card">
                          <strong>${escapeHtml(card.title)}</strong>
                          <div class="meta">${card.body}</div>
                        </article>
                      `
                    )
                    .join("")}
                </div>
              </div>
            </details>
          `;
        }
      }

      function renderCredential(label, credential, credentialRecord = null) {
        const summaryRoot = document.getElementById("credential-summary");
        const verificationRoot = document.getElementById("credential-verification");
        const timelineSummaryRoot = document.getElementById("credential-timeline-summary");
        const timelineRoot = document.getElementById("credential-timeline");
        const statusSummaryRoot = document.getElementById("credential-status-summary");
        const statusDetailRoot = document.getElementById("credential-status-detail");
        const statusRoot = document.getElementById("credential-status");
        const root = document.getElementById("credential");
        if (!credential) {
          activeCredential = null;
          activeCredentialLabel = null;
          activeCredentialRecord = null;
          activeCredentialTimeline = null;
          activeCredentialStatus = null;
          summaryRoot.textContent = "尚未加载证据";
          verificationRoot.textContent = "尚未校验";
          if (timelineSummaryRoot) {
            timelineSummaryRoot.textContent = "尚未读取时间线";
          }
          if (timelineRoot) {
            timelineRoot.textContent = "点击证据后，这里会显示签发 / 撤销时间线。";
          }
          if (statusSummaryRoot) {
            statusSummaryRoot.textContent = "尚未读取状态证明";
          }
          if (statusDetailRoot) {
            statusDetailRoot.textContent = "尚未加载状态列表";
          }
          if (statusRoot) {
            statusRoot.innerHTML = '<div class="status-empty">点击证据后，这里会显示状态列表快照和本地可校验的撤销状态证明。</div>';
          }
          renderCredentialRepairContext(activeCredentialRepairContext);
          root.textContent = "点击上方按钮后，这里会显示本地可校验的证据包。";
          return;
        }

        activeCredential = credential;
        activeCredentialLabel = label;
        activeCredentialRecord = credentialRecord;
        const typeText = Array.isArray(credential.type) ? credential.type.join(" · ") : credential.type || "证据";
        summaryRoot.textContent = `${label} · ${typeText} · ${credential.id || "无 ID"}${credentialRecord?.status ? ` · ${formatCredentialStatusLabel(credentialRecord.status)}` : ""}${credentialRecord?.statusListIndex != null ? ` · #${credentialRecord.statusListIndex}` : ""}${credentialRecord?.timelineCount ? ` · ${credentialRecord.timelineCount} 节点` : ""}${credentialRecord?.repairCount ? ` · 修复 ${credentialRecord.repairCount}` : ""}`;
        verificationRoot.textContent = credentialRecord?.status
          ? `登记状态：${formatCredentialStatusLabel(credentialRecord.status)}，点击“校验证据”检查哈希、发行者和撤销状态。${credentialRecord?.repairedBy ? ` 最近修复：${credentialRecord.repairedBy.repairId} · ${credentialRecord.repairedBy.summary || ""}` : ""}`
          : "证据已加载，点击“校验证据”检查哈希、发行者和撤销状态。";
        if (timelineSummaryRoot) {
          timelineSummaryRoot.textContent = credentialRecord?.timelineCount
            ? `时间线：${credentialRecord.timelineCount} 个节点，最新节点 ${credentialRecord.latestTimelineAt || "未知"}`
            : "时间线：等待加载";
        }
        if (timelineRoot) {
          timelineRoot.textContent = "点击加载时间线后，这里会显示签发 / 撤销节点。";
        }
        if (statusSummaryRoot) {
          statusSummaryRoot.textContent = credentialRecord?.statusListIndex != null
            ? `状态索引：#${credentialRecord.statusListIndex} · 状态列表：${credentialRecord.statusListId || "无"}`
            : "状态证明：等待加载";
        }
        if (statusDetailRoot) {
          statusDetailRoot.textContent = credentialRecord?.statusListCredentialId
            ? `状态列表凭证：${credentialRecord.statusListCredentialId}`
            : "状态列表凭证：等待加载";
        }
        if (statusRoot) {
          statusRoot.innerHTML = '<div class="status-empty">点击“刷新状态证明”后，这里会显示状态列表快照和本地可校验的撤销状态证明。</div>';
        }
        renderCredentialRepairContext(activeCredentialRepairContext);
        setJsonText(
          root,
          credentialRecord
            ? {
                credential,
                credentialRecord,
              }
            : credential,
          "点击上方按钮后，这里会显示本地可校验的证据包。"
        );
      }

      function renderCredentialVerification(result) {
        const root = document.getElementById("credential-verification");
        if (!result) {
          root.textContent = "尚未校验";
          return;
        }

        const parts = [
          result.valid ? "检查通过" : "检查未通过",
          result.registryKnown ? `登记状态-${formatCredentialStatusLabel(result.registryStatus || "unknown")}` : "未登记",
          result.issuerKnown ? "签发方已识别" : "签发方未识别",
          result.isRevoked ? "已撤销" : null,
          result.statusListKnown ? `状态列表-${formatCredentialStatusLabel(result.statusListStatus || "unknown")}` : null,
          result.statusListMatches === false ? "状态列表不一致" : null,
          result.snapshotFresh === null ? null : result.snapshotFresh ? "快照较新" : "快照过旧",
          result.credentialId || null,
        ].filter(Boolean);
        root.textContent = `${activeCredentialLabel || "当前证据"} · ${parts.join(" · ")}`;
      }

      function renderCredentialStatus(result) {
        const summaryRoot = document.getElementById("credential-status-summary");
        const detailRoot = document.getElementById("credential-status-detail");
        const root = document.getElementById("credential-status");
        activeCredentialStatus = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未读取状态证明";
          }
          if (detailRoot) {
            detailRoot.textContent = "尚未加载状态列表";
          }
          if (root) {
            root.innerHTML = '<div class="status-empty">点击证据后，这里会显示状态列表快照和本地可校验的撤销状态证明。</div>';
          }
          return;
        }

        const proof = result.statusProof || {};
        const statusListSummary = result.statusListSummary || result.statusList?.summary || {};
        const statusListCredential = result.statusListCredential || result.statusList?.credential || null;
        const statusEntries = Array.isArray(result.statusList?.entries) ? result.statusList.entries : [];
        const currentCredentialKey = activeCredentialRecord?.credentialRecordId || activeCredentialRecord?.credentialId || activeCredential?.id || null;
        const activeEntry = statusEntries.find((entry) => credentialStatusEntryKey(entry) === currentCredentialKey || entry.credentialId === currentCredentialKey) || null;
        if (summaryRoot) {
          summaryRoot.textContent = [
            formatCredentialStatusLabel(proof.status || "unknown"),
            proof.statusBit != null ? `状态位 ${proof.statusBit}` : null,
            proof.statusListIndex != null ? `#${proof.statusListIndex}` : null,
            proof.registryKnown ? `登记状态-${formatCredentialStatusLabel(proof.registryStatus || "unknown")}` : "未登记",
            statusEntries.length ? `${statusEntries.length} 项` : null,
          ].filter(Boolean).join(" · ");
        }
        if (detailRoot) {
          detailRoot.textContent = [
            `状态列表 ${statusListSummary.statusListId || proof.statusListId || "无"}`,
            statusListSummary.issuerLabel || statusListSummary.issuerDid ? `签发方 ${statusListSummary.issuerLabel || statusListSummary.issuerDid}` : null,
            statusListSummary.totalEntries != null ? `条目 ${statusListSummary.totalEntries}` : null,
            statusListSummary.activeCount != null ? `有效 ${statusListSummary.activeCount}` : null,
            statusListSummary.revokedCount != null ? `撤销 ${statusListSummary.revokedCount}` : null,
            statusListSummary.bitstring ? `状态位串 ${statusListSummary.bitstring}` : null,
            statusListSummary.proofValue ? `证明哈希 ${statusListSummary.proofValue.slice(0, 12)}` : null,
          ].filter(Boolean).join(" · ");
        }
        if (root) {
          const statusProofSummary = [
            `状态：${formatCredentialStatusLabel(proof.status || "unknown")}`,
            proof.statusBit != null ? `状态位 ${proof.statusBit}` : null,
            proof.statusListIndex != null ? `#${proof.statusListIndex}` : null,
            proof.statusListId ? `列表 ${proof.statusListId}` : null,
            proof.statusListCredential ? `凭证 ${proof.statusListCredential}` : null,
            proof.registryKnown ? `登记状态-${formatCredentialStatusLabel(proof.registryStatus || "unknown")}` : "未登记",
            proof.statusMatchesRegistry === false ? "登记信息不一致" : null,
            proof.statusListHash ? `列表哈希 ${proof.statusListHash.slice(0, 12)}` : null,
            proof.statusListLedgerHash ? `底层记录哈希 ${proof.statusListLedgerHash.slice(0, 12)}` : null,
          ].filter(Boolean).join(" · ");
          const statusListSummaryText = [
            `状态列表 ${statusListSummary.statusListId || proof.statusListId || "无"}`,
            statusListSummary.issuerLabel || statusListSummary.issuerDid ? `签发方 ${statusListSummary.issuerLabel || statusListSummary.issuerDid}` : null,
            statusListSummary.totalEntries != null ? `条目 ${statusListSummary.totalEntries}` : null,
            statusListSummary.activeCount != null ? `有效 ${statusListSummary.activeCount}` : null,
            statusListSummary.revokedCount != null ? `撤销 ${statusListSummary.revokedCount}` : null,
            statusListSummary.bitstring ? `状态位串 ${statusListSummary.bitstring}` : null,
          ].filter(Boolean).join(" · ");
          root.innerHTML = `
            <div class="status-overview">
              <details class="status-panel" open>
                <summary>
                  <span>当前状态证明</span>
                  <span class="tag">${escapeHtml(formatCredentialStatusLabel(proof.status || "unknown"))}</span>
                </summary>
                <div class="status-entry-body">
                  <div class="meta">${escapeHtml(statusProofSummary || "无")}</div>
                  <div class="meta">当前证据：${escapeHtml(activeCredential?.id || activeCredentialRecord?.credentialId || "无")}</div>
                  <details class="status-panel">
                    <summary>查看当前状态证明 JSON</summary>
                    <pre class="status-json">${escapeJsonHtml({
                      credentialStatus: result.credentialStatus,
                      statusProof: proof,
                      statusListSummary,
                      statusListCredential,
                    })}</pre>
                  </details>
                </div>
              </details>

              <details class="status-panel">
                <summary>
                  <span>状态列表证明</span>
                  <span class="tag">${escapeHtml(`${statusEntries.length || statusListSummary.totalEntries || 0} 项`)}</span>
                </summary>
                <div class="status-entry-body">
                  <div class="meta">${escapeHtml(statusListSummaryText || "无")}</div>
                  <div class="meta">当前条目：${escapeHtml(activeEntry ? summarizeStatusEntry(activeEntry) : "未定位")}</div>
                  <details class="status-panel">
                    <summary>查看状态列表 JSON</summary>
                    <pre class="status-json">${escapeJsonHtml(statusListCredential)}</pre>
                  </details>
                </div>
              </details>
            </div>

            <div class="status-list">
              ${statusEntries.length === 0 ? '<div class="status-empty">当前状态列表没有条目。</div>' : statusEntries.map((entry) => {
                const entryKey = credentialStatusEntryKey(entry);
                const isActiveEntry = Boolean(currentCredentialKey && (entryKey === currentCredentialKey || entry.credentialId === currentCredentialKey));
                return `
                  <details class="status-entry"${isActiveEntry ? " open" : ""}>
                    <summary>
                      <span class="status-entry-title">${escapeHtml(entry.statusListIndex != null ? `#${entry.statusListIndex}` : "entry")}</span>
                      <span>${escapeHtml(entry.subjectLabel || entry.subjectId || entry.credentialId || "unknown")}</span>
                      <span class="tag">${escapeHtml(entry.status || "unknown")}</span>
                      ${entry.revokedAt ? '<span class="tag">revoked</span>' : ""}
                    </summary>
                    <div class="status-entry-body">
                      <div class="meta">
                        条目 ID：${escapeHtml(entry.statusListEntryId || "无")}<br />
                        证据 ID：${escapeHtml(entry.credentialId || "无")}<br />
                        记录 ID：${escapeHtml(entry.credentialRecordId || "无")}<br />
                        对象：${escapeHtml(entry.subjectType || "unknown")} / ${escapeHtml(entry.subjectId || "unknown")}<br />
                        发行者：${escapeHtml(entry.issuerLabel || entry.issuerDid || "无")}<br />
                        状态：${escapeHtml(entry.status || "unknown")}<br />
                        状态位：${entry.statusBit != null ? escapeHtml(String(entry.statusBit)) : "无"}<br />
                        状态列表：${escapeHtml(entry.statusListId || "无")}<br />
                        凭证：${escapeHtml(entry.statusListCredentialId || "无")}<br />
                        发行时间：${escapeHtml(entry.issuedAt || "无")}<br />
                        更新时间：${escapeHtml(entry.updatedAt || "无")}<br />
                        撤销时间：${escapeHtml(entry.revokedAt || "无")}<br />
                        撤销原因：${escapeHtml(entry.revocationReason || "无")}<br />
                        证据哈希：${escapeHtml(entry.proofValue || "无")}<br />
                        账本哈希：${escapeHtml(entry.ledgerHash || "无")}
                      </div>
                      <details class="status-panel">
                        <summary>查看条目 JSON</summary>
                        <pre class="status-json">${escapeJsonHtml(entry)}</pre>
                      </details>
                      <div class="status-entry-actions">
                        <button class="secondary status-entry-load" type="button" data-credential-id="${escapeHtml(entry.credentialId || "")}" data-credential-record-id="${escapeHtml(entry.credentialRecordId || "")}">查看证据</button>
                        <button class="secondary status-entry-timeline" type="button" data-credential-id="${escapeHtml(entry.credentialId || "")}" data-credential-record-id="${escapeHtml(entry.credentialRecordId || "")}">查看时间线</button>
                      </div>
                    </div>
                  </details>
                `;
              }).join("")}
            </div>
          `;
        }
      }

      function renderCredentialTimeline(timeline, timelineCount = null, latestTimelineAt = null) {
        const summaryRoot = document.getElementById("credential-timeline-summary");
        const root = document.getElementById("credential-timeline");
        activeCredentialTimeline = Array.isArray(timeline) ? timeline : null;

        if (!timeline || timeline.length === 0) {
          if (summaryRoot) {
            summaryRoot.textContent = timelineCount != null
              ? `时间线：${timelineCount} 个节点，暂无可展开节点`
              : "尚未读取时间线";
          }
          if (root) {
            root.innerHTML = '<div class="status-empty">点击证据后，这里会显示签发 / 撤销时间线。</div>';
          }
          return;
        }

        if (summaryRoot) {
          const repairedCount = timeline.filter((entry) => entry.kind === "credential_repaired").length;
          summaryRoot.textContent = `时间线：${timeline.length} 个节点，修复 ${repairedCount} 次，最新节点 ${latestTimelineAt || timeline.at(-1)?.timestamp || "未知"}`;
        }
        if (root) {
          root.innerHTML = timeline
            .map((entry, index) => {
              const isRepair = entry.kind === "credential_repaired";
              const actorText = entry.actorLabel || entry.actorAgentId || entry.actorDid || entry.actorWindowId || "system";
              const detailText = summarizeTimelineDetail(entry);
              return `
                <details class="status-entry"${isRepair || index === timeline.length - 1 ? " open" : ""}>
                  <summary>
                    <span class="status-entry-title">${escapeHtml(friendlyTimelineKind(entry.kind))}</span>
                    <span>${escapeHtml(entry.summary || "无摘要")}</span>
                    <span class="tag">${escapeHtml(entry.timestamp || "未知")}</span>
                    ${isRepair ? '<span class="tag">修复</span>' : ""}
                  </summary>
                  <div class="status-entry-body">
                    <div class="meta">
                      时间：${escapeHtml(entry.timestamp || "无")}<br />
                      操作方：${escapeHtml(actorText)}<br />
                      操作方 DID：${escapeHtml(entry.actorDid || "无")}<br />
                      窗口：${escapeHtml(entry.actorWindowId || "无")}<br />
                      来源：${escapeHtml(entry.source || "无")}<br />
                      ${detailText ? `${escapeHtml(detailText)}<br />` : ""}
                      事件哈希：${escapeHtml(entry.eventHash || "无")}
                    </div>
                    <details class="status-panel">
                      <summary>查看节点 JSON</summary>
                      <pre class="status-json">${escapeJsonHtml(entry)}</pre>
                    </details>
                  </div>
                </details>
              `;
            })
            .join("");
        }
      }

      function syncCredentialRepairPagination(repairPage = null, statusMessage = null, agentId = activeAgentId) {
        const pageRoot = document.getElementById("credential-repair-page");
        const prevButton = document.getElementById("prev-credential-repairs");
        const nextButton = document.getElementById("next-credential-repairs");
        const scopeAgentId = agentId || "__all__";

        if (!repairPage) {
          activeCredentialRepairPage = {
            ...activeCredentialRepairPage,
            agentId: scopeAgentId,
            total: 0,
            hasMore: false,
            latestIssuedAt: null,
          };
          if (pageRoot) {
            pageRoot.textContent = statusMessage || "修复分页未加载";
          }
          if (prevButton) {
            prevButton.disabled = true;
          }
          if (nextButton) {
            nextButton.disabled = true;
          }
          return;
        }

        activeCredentialRepairPage = {
          agentId: scopeAgentId,
          limit: Number(repairPage.limit || activeCredentialRepairPage.limit || 6),
          offset: Number(repairPage.offset || 0),
          total: Number(repairPage.total || 0),
          hasMore: Boolean(repairPage.hasMore),
          latestIssuedAt: repairPage.latestIssuedAt || null,
        };

        const currentPage = activeCredentialRepairPage.total > 0
          ? Math.floor(activeCredentialRepairPage.offset / Math.max(1, activeCredentialRepairPage.limit)) + 1
          : 1;
        const totalPages = activeCredentialRepairPage.total > 0
          ? Math.ceil(activeCredentialRepairPage.total / Math.max(1, activeCredentialRepairPage.limit))
          : 1;

        if (pageRoot) {
          pageRoot.textContent = `修复第 ${currentPage}/${totalPages} 页 · 偏移 ${activeCredentialRepairPage.offset} · 最新 ${activeCredentialRepairPage.latestIssuedAt || "无"}`;
        }
        if (prevButton) {
          prevButton.disabled = activeCredentialRepairPage.offset <= 0;
        }
        if (nextButton) {
          nextButton.disabled = !activeCredentialRepairPage.hasMore;
        }
      }

      function renderCredentialRepairs(repairs = [], repairPage = null, statusMessage = null, agentId = activeAgentId) {
        const summaryRoot = document.getElementById("credential-repair-summary");
        const root = document.getElementById("credential-repairs");
        syncCredentialRepairPagination(repairPage, statusMessage, agentId);

        if (summaryRoot) {
          if (statusMessage) {
            summaryRoot.textContent = statusMessage;
          } else if (!repairs || repairs.length === 0) {
            summaryRoot.textContent = "暂无修复聚合";
          } else {
            summaryRoot.textContent = `修复聚合 ${repairs.length} 组 / 共 ${repairPage?.total || repairs.length} 组 · 最新 ${repairPage?.latestIssuedAt || repairs[0]?.latestIssuedAt || "未知"}`;
          }
        }

        if (!root) {
          return;
        }

        if (!repairs || repairs.length === 0) {
          root.innerHTML = statusMessage
            ? `<div class="meta">${statusMessage}</div>`
            : '<div class="meta">当前这批证据没有关联的修复聚合。</div>';
          return;
        }

        root.innerHTML = repairs
          .map((repair) => `
            <article class="card">
              <strong>${escapeHtml(repair.summary || repair.repairId || "修复")}</strong>
              <span class="tag">${escapeHtml(repair.repairId || "修复")}</span>
              <div class="meta">
                范围：${escapeHtml(formatRepairScopeLabel(repair.scope))}<br />
                签发者：${escapeHtml(repair.issuerAgentId || repair.issuerDid || "无")}<br />
                DID：${escapeHtml(repair.issuerDid || "无")}<br />
                签发方式：${escapeHtml((repair.issuedDidMethods || []).map((item) => formatDidMethodChoice(item)).join(" · ") || "无")}<br />
                关联证据：${escapeHtml(String(repair.linkedCredentialCount || 0))}<br />
                关联类型：${escapeHtml((repair.linkedCredentialKinds || []).join(" · ") || "无")}<br />
                已修复：${escapeHtml(`${repair.repairedCount || 0}/${repair.plannedRepairCount || 0}`)}<br />
                最近签发：${escapeHtml(repair.latestIssuedAt || "无")}
              </div>
              <details class="status-panel">
                <summary>查看修复 JSON</summary>
                <pre class="status-json">${escapeJsonHtml(repair)}</pre>
              </details>
              <div class="card-actions">
                <button class="secondary credential-repair-timeline" type="button" data-repair-id="${escapeHtml(repair.repairId || "")}">查看修复时间线</button>
                <button class="secondary credential-repair-linked" type="button" data-repair-id="${escapeHtml(repair.repairId || "")}" ${Number(repair.linkedCredentialCount || 0) > 0 ? "" : "disabled"}>查看受影响证据</button>
                <button class="secondary credential-repair-hub" type="button" data-repair-id="${escapeHtml(repair.repairId || "")}" data-repair-method="${escapeHtml((repair.issuedDidMethods || [])[0] || "agentpassport")}">打开修复中心</button>
              </div>
            </article>
          `)
          .join("");
      }

      function renderCredentials(credentials, counts = null, statusMessage = null) {
        const root = document.getElementById("credentials");
        const filterRoot = document.getElementById("credential-filter-agent");
        const countsRoot = document.getElementById("credential-counts");
        if (filterRoot) {
          filterRoot.textContent = activeAgentId || "全部";
        }

        if (countsRoot) {
          if (statusMessage) {
            countsRoot.textContent = statusMessage;
          } else {
            const stats = counts || { total: 0, active: 0, revoked: 0, fresh: 0, stale: 0, repaired: 0, unrepaired: 0, repairGroups: 0 };
            countsRoot.textContent = `总计 ${stats.total || 0} · 有效 ${stats.active || 0} · 已撤销 ${stats.revoked || 0} · 较新 ${stats.fresh || 0} · 过旧 ${stats.stale || 0} · 已修复 ${stats.repaired || 0} · 未修复 ${stats.unrepaired || 0} · 修复组 ${stats.repairGroups || 0}`;
          }
        }

        if (!credentials || credentials.length === 0) {
          root.innerHTML = statusMessage
            ? `<div class="meta">${statusMessage}</div>`
            : '<div class="meta">当前没有证据状态记录。先加载一个助手证据或提案证据，状态会出现在这里。</div>';
          return;
        }

        root.innerHTML = credentials.map((record) => {
          const kindText = friendlyCredentialKind(record.kind);
          const freshnessText = record.snapshotFresh === null ? "未知" : record.snapshotFresh ? "fresh" : "stale";
          const statusText = record.status || "active";
          const issuedAtText = record.issuedAt || "未知";
          const revokedAtText = record.revokedAt || "无";
          const revocationReasonText = record.revocationReason || "无";
          return `
            <article class="card">
              <strong>${record.subjectLabel || record.subjectId || record.credentialId}</strong>
              <span class="tag">${record.credentialId}</span>
              <div class="meta">
                类型：${kindText}<br />
                对象：${record.subjectType || "未命名"} / ${record.subjectId || "未命名"}<br />
                发行者：${record.issuerLabel || record.issuerDid || "无"}<br />
                状态：${formatCredentialStatusLabel(statusText)}<br />
                状态索引：${record.statusListIndex != null ? `#${record.statusListIndex}` : "无"}<br />
                状态列表：${record.statusListId || "无"}<br />
                状态凭证：${record.statusListCredentialId || "无"}<br />
                最近修复：${record.repairedBy ? `${record.repairedBy.repairId} · ${record.repairedBy.latestIssuedAt || "无"}` : "无"}<br />
                修复次数：${record.repairCount || 0}<br />
                时间线：${record.timelineCount || 0} 节点<br />
                最新节点：${record.latestTimelineAt || "无"}<br />
                发行时间：${issuedAtText}<br />
                撤销时间：${revokedAtText}<br />
                撤销原因：${revocationReasonText}<br />
                新鲜度：${formatCredentialFreshnessLabel(freshnessText)}<br />
                证据哈希：${record.proofValue || "无"}<br />
                账本哈希：${record.ledgerHash || "无"}
              </div>
              <div class="card-actions">
                <button class="secondary credential-load" type="button" data-credential-id="${record.credentialId}" data-credential-record-id="${record.credentialRecordId}">载入证据</button>
                <button class="secondary credential-revoke" type="button" data-credential-id="${record.credentialId}" data-credential-record-id="${record.credentialRecordId}" ${record.status === "revoked" ? "disabled" : ""}>撤销证据</button>
              </div>
            </article>
          `;
        }).join("");
      }

      function renderAuthorizations(authorizations) {
        const root = document.getElementById("authorizations");
        if (!authorizations || authorizations.length === 0) {
          root.innerHTML = '<div class="meta">当前没有提案。可以先创建一个多签授权提案。</div>';
          return;
        }

        root.innerHTML = authorizations.map((proposal) => `
          <article class="card">
            <strong>${proposal.title || proposal.proposalId}</strong>
            <span class="tag">${proposal.proposalId}</span>
            <div class="meta">
              状态：${formatStatusLabel(proposal.status)}<br />
              动作：${proposal.actionType}<br />
              Policy Agent：${proposal.policyAgentId}<br />
              审批：${proposal.approvalCount}/${proposal.threshold}<br />
              签名：${proposal.signatureCount || 0}/${proposal.threshold}<br />
              签名记录：${summarizeSignatureRecords(proposal.signatures || proposal.signatureRecords)}<br />
              最近签名：${proposal.latestSignatureAt || "无"}<br />
              最近签署者：${proposal.lastSignedByLabel || proposal.lastSignedByAgentId || "无"}<br />
              时间线：${summarizeTimelineEntries(proposal.timeline)}<br />
              时间线条数：${proposal.timelineCount || 0}<br />
              释放时间：${proposal.availableAt || "立即"}<br />
              过期时间：${proposal.expiresAt || "无"}<br />
              创建者：${proposal.createdByLabel || proposal.createdByAgentId || proposal.createdBy || "无"}<br />
              创建窗口：${proposal.createdByWindowId || "无"}<br />
              执行者：${proposal.executedByLabel || proposal.executedByAgentId || "无"}<br />
              执行窗口：${proposal.executedByWindowId || "无"}<br />
              撤销者：${proposal.revokedByLabel || proposal.revokedByAgentId || "无"}<br />
              撤销窗口：${proposal.revokedByWindowId || "无"}<br />
              相关身份：${(proposal.relatedAgentIds || []).join(" · ") || "无"}<br />
              执行回执：${summarizeExecutionReceipt(proposal.executionReceipt)}<br />
              执行结果：${proposal.executionResult ? escapeHtml(stringifyJsonInline(proposal.executionResult)) : "无"}<br />
              错误：${proposal.lastError || "无"}
            </div>
            <div class="meta">
              <pre>${escapeJsonHtml(proposal.payload || {})}</pre>
            </div>
            <div class="card-actions">
              <button class="secondary proposal-load" type="button" data-proposal-id="${proposal.proposalId}" data-proposal-action="load">载入提案</button>
              <button class="secondary proposal-credential" type="button" data-proposal-id="${proposal.proposalId}" data-proposal-action="credential">加载证据</button>
            </div>
          </article>
        `).join("");
      }

      function applyOptionalListField(body, key) {
        if (!body[key]) {
          return;
        }
        body[key] = body[key]
          .split(/[,;]+/)
          .map((part) => part.trim())
          .filter(Boolean);
      }

      function applyJsonField(body, key, fallback = {}) {
        if (!body[key]) {
          body[key] = fallback;
          return;
        }

        body[key] = JSON.parse(body[key]);
      }

      function syncActiveAgentFields() {
        const proposalPolicyField = document.getElementById("proposal-policy-agent-id");
        const windowAgentField = document.getElementById("window-agent-id");
        const credentialAgentField = document.getElementById("credential-agent-id");
        const dashboardDidMethodField = document.getElementById("dashboard-did-method");
        const compareLeftField = document.getElementById("compare-left-agent-id");
        const compareRightField = document.getElementById("compare-right-agent-id");
        const compareIssuerField = document.getElementById("compare-issuer-agent-id");
        const compareDidMethodField = document.getElementById("compare-issuer-did-method");
        if (windowAgentField) {
          windowAgentField.value = activeAgentId;
        }
        if (proposalPolicyField) {
          proposalPolicyField.value = activeAgentId;
        }
        if (credentialAgentField) {
          credentialAgentField.value = activeAgentId;
        }
        if (dashboardDidMethodField) {
          dashboardDidMethodField.value = normalizeDashboardDidMethod(activeDashboardDidMethod) || "";
        }
        activeCompareParams = {
          ...activeCompareParams,
          leftAgentId: activeCompareParams.leftAgentId || activeAgentId,
          rightAgentId: activeCompareParams.rightAgentId || "agent_treasury",
          issuerAgentId: activeCompareParams.issuerAgentId || "agent_treasury",
          issuerDidMethod: activeCompareParams.issuerDidMethod || "agentpassport",
        };
        if (compareLeftField) {
          compareLeftField.value = activeCompareParams.leftAgentId || activeAgentId;
        }
        if (compareRightField) {
          compareRightField.value = activeCompareParams.rightAgentId || "agent_treasury";
        }
        if (compareIssuerField) {
          compareIssuerField.value = activeCompareParams.issuerAgentId || "agent_treasury";
        }
        if (compareDidMethodField) {
          compareDidMethodField.value = activeCompareParams.issuerDidMethod || "agentpassport";
        }
      }

      function syncDashboardViewSummary() {
        const root = document.getElementById("dashboard-view-summary");
        if (!root) {
          return;
        }

        root.textContent = `当前视角：助手 ${activeAgentId || "未指定"} · 身份展示 ${dashboardDidMethodLabel(activeDashboardDidMethod)}`;
      }

      function syncActionReadiness() {
        const summaryRoot = document.getElementById("action-readiness-summary");
        const detailRoot = document.getElementById("action-readiness-detail");
        if (!summaryRoot || !detailRoot) {
          return;
        }
        syncWorkflowProgress();

        const hasAgent = Boolean(activeAgentId);
        const hasWindowBinding = Boolean(localWindowBinding?.agentId);
        const windowMatchesAgent = hasAgent && hasWindowBinding ? localWindowBinding.agentId === activeAgentId : false;
        const hasCredentialContext = Boolean(activeCredential || activeCredentialRecord);
        const hasRepairContext = Boolean(activeCredentialRepairContext?.repairId);
        const hasToken = Boolean(getStoredAdminToken());

        if (!hasAgent) {
          summaryRoot.textContent = "现在只能做最前面的创建和选择助手。";
          detailRoot.textContent = "先在“第 1 步：创建助手身份”里新建一个助手，或者在“已有助手列表”里点进一个助手，后面的状态、记忆、证据类按钮才会真正可用。";
          return;
        }

        if (!hasWindowBinding) {
          summaryRoot.textContent = `已经选中助手 ${activeAgentId}，但当前窗口还没绑定。`;
          detailRoot.textContent = "请先到“第 2 步：绑定当前窗口 / 选定当前助手”里点“绑定当前窗口”。很多和当前状态、记忆、自动流程相关的按钮，都依赖这一步。";
          return;
        }

        if (!windowMatchesAgent) {
          summaryRoot.textContent = `当前选中的助手是 ${activeAgentId}，但这个窗口绑定的是 ${localWindowBinding.agentId}。`;
          detailRoot.textContent = "如果按钮表现怪异，通常是因为“当前查看的助手”和“当前窗口绑定的助手”不是同一个。你可以重新绑定窗口，或在助手列表里重新选中正确的助手。";
          return;
        }

        if (!hasToken) {
          summaryRoot.textContent = "大多数查看类按钮已经能用，写入类按钮可能还会被安全保护拦住。";
          detailRoot.textContent = "如果你要执行写入、恢复、受限操作之类的动作，先在“第 3 步：先看当前状态，再按需调整本机”里保存本地 Token。没有 Token 时，读操作通常可以，写操作可能会失败。";
          return;
        }

        if (!hasCredentialContext && !hasRepairContext) {
          summaryRoot.textContent = "常用按钮已经可以用了，证据和修复相关按钮还需要先加载一条证据。";
          detailRoot.textContent = "像“查看修复时间线”“打开修复中心”“清除修复上下文”这类按钮，本来就会先灰掉。先到“证据包 / 本地校验证明”里加载一个助手证据或提案证据，它们才会亮起来。";
          return;
        }

        if (hasCredentialContext && !hasRepairContext) {
          summaryRoot.textContent = "当前已经能看证据，但修复链路按钮还在等修复上下文。";
          detailRoot.textContent = "如果你还没从某条修复记录进入，这几个按钮会继续保持灰色，这是正常的。先打开某条证据对应的修复记录后，相关按钮才会解锁。";
          return;
        }

        summaryRoot.textContent = "当前常用按钮都应该可以正常使用。";
        detailRoot.textContent = "如果还有个别按钮是灰色，通常是因为它们只在特定场景下开放，比如需要先选中一条修复记录，或者需要先生成对应数据。";
      }

      function syncWorkflowProgress() {
        const summaryRoot = document.getElementById("workflow-progress-summary");
        const detailRoot = document.getElementById("workflow-progress-detail");
        const statusRoot = document.getElementById("workflow-progress-status");
        if (!summaryRoot || !detailRoot || !statusRoot) {
          return;
        }

        const hasSelectedAgent = Array.isArray(activeAgentDirectory)
          ? activeAgentDirectory.some((agent) => agent?.agentId === activeAgentId)
          : false;
        const hasWindowBinding = Boolean(localWindowBinding?.agentId && localWindowBinding.agentId === activeAgentId);
        const hasRuntime = Boolean(activeRuntime?.deviceRuntime || activeRuntime?.taskSnapshot);
        const hasMemoryContext =
          Boolean(activeContextBuilder?.contextHash) ||
          Number(activePassportMemories?.counts?.total || 0) > 0;

        const steps = [
          {
            done: hasSelectedAgent,
            currentSummary: "当前先做第 1 步：选一个助手。",
            currentDetail: "如果已经注册过，优先在“已有助手列表”里直接切过去；只有第一次上机或要新身份时，才需要展开注册表单。",
          },
          {
            done: hasWindowBinding,
            currentSummary: "当前做到第 1 步，下一步绑定当前窗口。",
            currentDetail: "把当前线程和当前助手对应上，后面状态、记忆、恢复和自动流程才不会串位。",
          },
          {
            done: hasRuntime,
            currentSummary: "当前做到第 2 步，下一步先确认当前状态。",
            currentDetail: "先看第 3 步上面的概览卡，确认运行模式、恢复条件和回答方式都正常，再决定要不要展开设置。",
          },
          {
            done: hasMemoryContext,
            currentSummary: "当前做到第 3 步，下一步记下这轮关键信息。",
            currentDetail: "先用快捷记录写一句摘要和一段内容就行；需要更细字段或要做一致性检查时，再展开详细工具。",
          },
        ];

        let currentIndex = steps.findIndex((step) => !step.done);
        const allDone = currentIndex === -1;
        if (allDone) {
          currentIndex = steps.length - 1;
        }

        steps.forEach((step, index) => {
          const card = document.getElementById(`workflow-step-card-${index + 1}`);
          const state = document.getElementById(`workflow-step-status-${index + 1}`);
          if (!card || !state) {
            return;
          }

          card.classList.remove("is-done", "is-current", "is-upcoming");
          if (step.done && !(allDone && index === currentIndex)) {
            card.classList.add("is-done");
            state.textContent = "已完成";
            return;
          }

          if (index === currentIndex) {
            card.classList.add(allDone ? "is-done" : "is-current");
            state.textContent = allDone ? "已完成" : "正在做";
            return;
          }

          card.classList.add("is-upcoming");
          state.textContent = "待进行";
        });

        const completedCount = steps.filter((step) => step.done).length;
        statusRoot.textContent = `当前做到 ${completedCount} / 4`;

        if (allDone) {
          summaryRoot.textContent = "主线 4 步已经跑通。";
          detailRoot.textContent = "现在可以继续留在首页做日常操作，或者直接进入高级工具页处理身份实验、归档、自动流程和治理工具。";
          return;
        }

        summaryRoot.textContent = steps[currentIndex].currentSummary;
        detailRoot.textContent = steps[currentIndex].currentDetail;
      }

      function syncWindowContextSummary() {
        const root = document.getElementById("window-context-summary");
        if (!root) {
          return;
        }

        const localWindowId = localWindowBinding?.windowId || windowId;
        const referencedWindowId = activeWindowContextId || localWindowId;
        const referencedAgent =
          activeWindowContextBinding?.windowId === referencedWindowId
            ? activeWindowContextBinding?.agentId
            : referencedWindowId === localWindowId
              ? localWindowBinding?.agentId
              : null;
        root.textContent = referencedWindowId === localWindowId
          ? `窗口上下文：当前窗口 ${localWindowId}${referencedAgent ? ` · 助手 ${referencedAgent}` : ""}`
          : `窗口上下文：当前窗口 ${localWindowId} · 引用窗口 ${referencedWindowId}${referencedAgent ? ` · 助手 ${referencedAgent}` : ""}`;
        syncActionReadiness();
      }

      function setActiveDashboardDidMethod(didMethod, { persist = true, sync = true } = {}) {
        activeDashboardDidMethod = normalizeDashboardDidMethod(didMethod);
        if (persist) {
          try {
            if (activeDashboardDidMethod) {
              localStorage.setItem(ACTIVE_DASHBOARD_DID_METHOD_KEY, activeDashboardDidMethod);
            } else {
              localStorage.removeItem(ACTIVE_DASHBOARD_DID_METHOD_KEY);
            }
          } catch {}
        }
        syncActiveAgentFields();
        syncDashboardViewSummary();
        renderWindowContextPanel();
        syncActionReadiness();
        if (sync) {
          syncDashboardUrlState();
        }
      }

      function setActiveWindowContextId(nextWindowId, { sync = true } = {}) {
        const resolvedWindowId = String(nextWindowId || localWindowBinding?.windowId || windowId);
        activeWindowContextId = resolvedWindowId;
        activeWindowContextError = null;
        activeWindowContextBinding =
          localWindowBinding?.windowId === resolvedWindowId
            ? localWindowBinding
            : null;
        syncWindowContextSummary();
        renderWindowContextPanel();
        syncActionReadiness();
        if (sync) {
          syncDashboardUrlState();
        }
      }

      function renderCredentialRepairContext(repair = activeCredentialRepairContext) {
        const summaryRoot = document.getElementById("credential-repair-context-summary");
        const detailRoot = document.getElementById("credential-repair-context-detail");
        const timelineButton = document.getElementById("credential-repair-context-timeline");
        const hubButton = document.getElementById("credential-repair-context-hub");
        const clearButton = document.getElementById("credential-repair-context-clear");
        const repairView = buildCompactRepairView(repair);

        if (!repairView?.repairId) {
          if (summaryRoot) {
            summaryRoot.textContent = "当前无修复上下文";
          }
          if (detailRoot) {
            detailRoot.textContent = "从修复聚合或修复中心跳进来后，这里会显示当前修复链接。";
          }
          if (timelineButton) {
            timelineButton.disabled = true;
            timelineButton.dataset.repairId = "";
          }
          if (hubButton) {
            hubButton.disabled = true;
            hubButton.dataset.repairId = "";
            hubButton.dataset.repairMethod = "agentpassport";
          }
        if (clearButton) {
          clearButton.disabled = true;
        }
        syncActionReadiness();
        return;
      }

        if (summaryRoot) {
          summaryRoot.textContent = [
            repairView.repairId,
            repairView.summary || null,
            repairView.scope ? formatRepairScopeLabel(repairView.scope) : null,
          ].filter(Boolean).join(" · ");
        }
        if (detailRoot) {
          detailRoot.textContent = [
            repairView.issuerAgentId || repairView.issuerDid || null,
            Array.isArray(repairView.issuedDidMethods) && repairView.issuedDidMethods.length
              ? `签发方式 ${repairView.issuedDidMethods.map((item) => formatDidMethodChoice(item)).join(" / ")}`
              : null,
            repairView.repairedCount != null && repairView.plannedRepairCount != null
              ? `修复进度 ${repairView.repairedCount}/${repairView.plannedRepairCount}`
              : null,
            repairView.latestIssuedAt ? `最近签发 ${repairView.latestIssuedAt}` : null,
          ].filter(Boolean).join(" ｜ ");
        }
        if (timelineButton) {
          timelineButton.disabled = false;
          timelineButton.dataset.repairId = repairView.repairId;
        }
        if (hubButton) {
          hubButton.disabled = false;
          hubButton.dataset.repairId = repairView.repairId;
          hubButton.dataset.repairMethod = repairView.issuedDidMethods?.[0] || "agentpassport";
        }
        if (clearButton) {
          clearButton.disabled = false;
        }
        syncActionReadiness();
      }

      function setActiveCredentialRepairContext(repair, { sync = true } = {}) {
        activeCredentialRepairContext = buildCompactRepairView(repair);
        renderCredentialRepairContext(activeCredentialRepairContext);
        if (sync) {
          syncDashboardUrlState();
        }
        return activeCredentialRepairContext;
      }

      async function loadMigrationRepairContext(repairId, { didMethod = activeDashboardDidMethod, sync = true } = {}) {
        if (!repairId) {
          return setActiveCredentialRepairContext(null, { sync });
        }

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(didMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }
        const target = `/api/migration-repairs/${encodeURIComponent(repairId)}${query.toString() ? `?${query.toString()}` : ""}`;
        const data = await request(target);
        return setActiveCredentialRepairContext(data.repair || { repairId }, { sync });
      }

      function syncProposalPayloadExample() {
        const actionType = document.getElementById("proposal-action-type")?.value || "grant_asset";
        const payloadField = document.getElementById("proposal-payload");
        if (!payloadField) {
          return;
        }

        const examples = {
          grant_asset: {
            targetAgentId: "agent_xxx",
            amount: 10,
            reason: "bootstrap grant",
          },
          fork_agent: {
            sourceAgentId: activeAgentId,
            displayName: "OpenNeed Agents v2",
            controller: "Kane",
          },
          update_policy: {
            agentId: activeAgentId,
            signers: ["Kane", "Alice"],
            multisigThreshold: 2,
          },
        };

        payloadField.placeholder = JSON.stringify(examples[actionType] || examples.grant_asset);
      }

      const WINDOW_ID_KEY = "openneed-agent-passport.window-id";
      const ACTIVE_AGENT_KEY = "openneed-agent-passport.active-agent-id";
      const ACTIVE_DASHBOARD_DID_METHOD_KEY = "openneed-agent-passport.active-dashboard-did-method";
      const ACTIVE_STATUS_LIST_KEY = "openneed-agent-passport.active-status-list-id";
      const ACTIVE_STATUS_LIST_COMPARE_KEY = "openneed-agent-passport.active-status-list-compare-id";
      const ADMIN_TOKEN_STORAGE_KEY = "openneed-agent-passport.admin-token";

      function createWindowId() {
        try {
          return localStorage.getItem(WINDOW_ID_KEY) || (() => {
            const generated = (crypto.randomUUID && crypto.randomUUID()) || `window_${Math.random().toString(36).slice(2, 10)}`;
            localStorage.setItem(WINDOW_ID_KEY, generated);
            return generated;
          })();
        } catch {
          return `window_${Math.random().toString(36).slice(2, 10)}`;
        }
      }

      function getStoredAdminToken() {
        try {
          return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "";
        } catch {
          return "";
        }
      }

      function setStoredAdminToken(token) {
        try {
          if (token) {
            localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
          } else {
            localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
          }
        } catch {}
      }

      const windowId = createWindowId();
      const parsedDashboardState = typeof linkHelpers.parseDashboardSearch === "function"
        ? linkHelpers.parseDashboardSearch(window.location.search, {
            agentId: null,
            didMethod: null,
            windowId: null,
            statusListId: null,
            statusListCompareId: null,
            repairLimit: 6,
            repairOffset: 0,
            compareRightAgentId: "agent_treasury",
            compareIssuerAgentId: "agent_treasury",
            compareIssuerDidMethod: "agentpassport",
          })
        : {
            agentId: initialDashboardSearch.get("agentId") || null,
            didMethod: initialDashboardSearch.get("didMethod") || null,
            windowId: initialDashboardSearch.get("windowId") || null,
            repairId: initialDashboardSearch.get("repairId") || null,
            credentialId: initialDashboardSearch.get("credentialId") || null,
            statusListId: initialDashboardSearch.get("statusListId") || null,
            statusListCompareId: initialDashboardSearch.get("statusListCompareId") || null,
            repairLimit: Number(initialDashboardSearch.get("repairLimit") || 6),
            repairOffset: Number(initialDashboardSearch.get("repairOffset") || 0),
            compareLeftAgentId: initialDashboardSearch.get("compareLeftAgentId") || initialDashboardSearch.get("agentId") || null,
            compareRightAgentId: initialDashboardSearch.get("compareRightAgentId") || "agent_treasury",
            compareIssuerAgentId: initialDashboardSearch.get("compareIssuerAgentId") || "agent_treasury",
            compareIssuerDidMethod: initialDashboardSearch.get("compareIssuerDidMethod") || "agentpassport",
          };
      const initialDashboardMode = (() => {
        const view = initialDashboardSearch.get("view");
        if (view === "lab") {
          return "lab";
        }
        if (view === "full") {
          return "full";
        }
        return "recommended";
      })();
      let activeAgentId = parsedDashboardState.agentId || "agent_openneed_agents";
      let activeAgentDirectory = [];
      let activeDashboardDidMethod = normalizeDashboardDidMethod(parsedDashboardState.didMethod);
      let activeDashboardMode = initialDashboardMode;
      let activeWindowContextId = parsedDashboardState.windowId || windowId;
      let activeCredential = null;
      let activeCredentialLabel = null;
      let activeCredentialRecord = null;
      let pendingDashboardCredentialId = parsedDashboardState.credentialId || initialDashboardSearch.get("credentialId") || null;
      let activeCredentialTimeline = null;
      let activeCredentialStatus = null;
      let activeBootstrapResult = null;
      let activeSecurityStatus = null;
      let activeRuntime = null;
      let activeRehydrate = null;
      let activeDriftCheck = null;
      let activeConversationMinutes = null;
      let activeRuntimeSearch = null;
      let activeRecoveryState = null;
      let activeRecoveryRehearsals = null;
      let activeSandboxResult = null;
      let activeSandboxAuditState = null;
      let activePassportMemories = null;
      let activeArchivedState = null;
      let activeArchiveRestoreHistory = null;
      let activeContextBuilder = null;
      let activeResponseVerification = null;
      let activeRunnerResult = null;
      let activeRunnerHistory = null;
      let activeAutoRecoveryAuditFilter = "all";
      let activeAutoRecoveryAudit = null;
      let activeCognitiveTransitions = null;
      let activeOfflineReplayResult = null;
      let activeSessionState = null;
      let activeCompactBoundaries = null;
      let activeTranscriptState = null;
      let activeSetupState = null;
      let activeSetupPackageState = null;
      let activeSetupPackageList = null;
      let activeSetupPackageMaintenance = null;
      let activeLocalReasonerCatalog = null;
      let activeLocalReasonerProfiles = null;
      let activeLocalReasonerRestoreCandidates = null;
      let activeVerificationRunResult = null;
      let activeVerificationRunHistory = null;
      let activeCredentialRepairContext = parsedDashboardState.repairId
        ? { repairId: parsedDashboardState.repairId }
        : null;
      let activeCompareDetail = null;
      let activeCompareParams = {
        leftAgentId: parsedDashboardState.compareLeftAgentId || activeAgentId,
        rightAgentId: parsedDashboardState.compareRightAgentId || "agent_treasury",
        issuerAgentId: parsedDashboardState.compareIssuerAgentId || "agent_treasury",
        issuerDidMethod: parsedDashboardState.compareIssuerDidMethod || "agentpassport",
      };
      let activeStatusLists = [];
      let activeStatusListId = parsedDashboardState.statusListId || null;
      let activeStatusListCompareId = parsedDashboardState.statusListCompareId || null;
      let activeStatusListView = null;
      let activeCredentialRepairPage = {
        agentId: activeAgentId,
        limit: Number(parsedDashboardState.repairLimit || 6),
        offset: Number(parsedDashboardState.repairOffset || 0),
        total: 0,
        hasMore: false,
        latestIssuedAt: null,
      };
      let localWindowBinding = null;
      let activeWindowContextBinding = null;
      let activeWindowContextError = null;
      try {
        activeAgentId = activeAgentId || localStorage.getItem(ACTIVE_AGENT_KEY) || "agent_openneed_agents";
        activeDashboardDidMethod =
          activeDashboardDidMethod || normalizeDashboardDidMethod(localStorage.getItem(ACTIVE_DASHBOARD_DID_METHOD_KEY));
        activeStatusListId = activeStatusListId || localStorage.getItem(ACTIVE_STATUS_LIST_KEY) || null;
        activeStatusListCompareId = activeStatusListCompareId || localStorage.getItem(ACTIVE_STATUS_LIST_COMPARE_KEY) || null;
      } catch {
        activeAgentId = activeAgentId;
      }
      if (!initialDashboardSearch.get("compareLeftAgentId") && !parsedDashboardState.agentId) {
        activeCompareParams = {
          ...activeCompareParams,
          leftAgentId: activeAgentId,
        };
      }

      function setActiveAgent(agentId) {
        activeAgentId = agentId || "agent_openneed_agents";
        setActiveWindowContextId(windowId, { sync: false });
        try {
          localStorage.setItem(ACTIVE_AGENT_KEY, activeAgentId);
        } catch {}
        const filterRoot = document.getElementById("credential-filter-agent");
        if (filterRoot) {
          filterRoot.textContent = activeAgentId;
        }
        syncActiveAgentFields();
        syncDashboardViewSummary();
        syncWindowContextSummary();
        renderWindowBinding(localWindowBinding);
        renderWindowContextPanel();
        syncActionReadiness();
        syncWorkflowProgress();
        syncProposalPayloadExample();
        syncDashboardUrlState();
      }

      function renderWindowBinding(binding) {
        const root = document.getElementById("active-agent");
        localWindowBinding = binding || null;
        if (!binding) {
          root.textContent = `当前窗口 ${windowId} 未绑定`;
          if ((activeWindowContextId || windowId) === windowId) {
            activeWindowContextBinding = null;
            activeWindowContextError = null;
          }
          syncDashboardViewSummary();
          syncWindowContextSummary();
          renderWindowContextPanel();
          syncActionReadiness();
          syncWorkflowProgress();
          return;
        }

        if ((activeWindowContextId || binding.windowId || windowId) === binding.windowId) {
          activeWindowContextBinding = binding;
          activeWindowContextError = null;
        }
        syncWindowContextSummary();
        root.textContent = `${binding.agentId} · ${binding.label || "window"} · ${binding.windowId}`;
        renderWindowContextPanel();
        syncActionReadiness();
        syncWorkflowProgress();
      }

      function renderContext(context) {
        const root = document.getElementById("context");
        const contextAgentRoot = document.getElementById("context-agent");
        if (!context) {
          contextAgentRoot.textContent = "未载入";
          root.textContent = "尚未载入中枢。先绑定当前窗口，或者点击 Agent 卡片查看中枢。";
          activeStatusLists = [];
          activeStatusListId = null;
          activeStatusListCompareId = null;
          activeStatusListView = null;
          renderStatusListSelector([], null);
          renderStatusListBrowser(null);
          renderStatusListCompareSelector([], null, null);
          renderStatusListComparison(null);
          syncDashboardViewSummary();
          syncWindowContextSummary();
          renderWindowContextPanel();
          return;
        }

        contextAgentRoot.textContent = `${context.agent?.agentId || context.identity?.did || "未知"} · DID ${dashboardDidMethodLabel(activeDashboardDidMethod)} · 状态列表 ${context.statusLists?.length || 0} · 修复 ${context.counts?.migrationRepairs || 0}`;
        const summary = {
          agent: {
            agentId: context.agent?.agentId,
            displayName: context.agent?.displayName,
            did: context.identity?.did,
            walletAddress: context.identity?.walletAddress,
            credits: context.assets?.credits,
          },
          counts: context.counts,
          windows: context.windows,
          memories: context.memories?.slice(-5),
          inbox: context.inbox?.slice(-5),
          outbox: context.outbox?.slice(-5),
          authorizations: context.authorizations?.slice(-5),
          credentials: context.credentials?.slice(0, 5),
          runtime: context.runtime
            ? {
                taskSnapshot: context.runtime.taskSnapshot,
                activeDecisions: context.runtime.activeDecisions?.slice(-5),
                evidenceRefs: context.runtime.evidenceRefs?.slice(-5),
                policy: context.runtime.policy,
                rehydratePreview: context.runtime.rehydratePreview,
              }
            : null,
          memoryLayers: context.memoryLayers
            ? {
                counts: context.memoryLayers.counts,
                relevant: {
                  profile: context.memoryLayers.relevant?.profile?.slice?.(-5) || [],
                  episodic: context.memoryLayers.relevant?.episodic?.slice?.(-5) || [],
                  working: context.memoryLayers.relevant?.working?.slice?.(-5) || [],
                  ledgerCommitments: context.memoryLayers.relevant?.ledgerCommitments?.slice?.(-5) || [],
                },
              }
            : null,
          credentialMethodCoverage: context.credentialMethodCoverage,
          migrationRepairs: (context.migrationRepairs || []).slice(0, 5).map((repair) => buildCompactRepairView(repair)),
          agentRuns: context.agentRuns?.slice?.(0, 5) || [],
          statusLists: context.statusLists?.slice(0, 10),
          statusList: context.statusList,
          didDocument: context.didDocument,
        };

        setJsonText(root, summary, "尚未载入中枢。");
        syncDashboardViewSummary();
        syncWindowContextSummary();
        renderWindowContextPanel();
      }

      function renderCompareDetail(result) {
        const summaryRoot = document.getElementById("compare-summary");
        const detailRoot = document.getElementById("compare-detail");
        const root = document.getElementById("compare-detail-json");
        activeCompareDetail = result || null;

        if (!result) {
          if (summaryRoot) {
            summaryRoot.textContent = "尚未加载对比";
          }
          if (detailRoot) {
            detailRoot.textContent = "会显示对比摘要、迁移差异和最近修复历史。";
          }
          if (root) {
            root.textContent = "提交对比后，这里会显示助手对比详情。";
          }
          return;
        }

        const comparison = result.comparison || {};
        const migrationDiff = comparison.migrationDiff || {};
        const repairs = Array.isArray(result.migrationRepairs) ? result.migrationRepairs : [];
        const evidenceCredentialId = result.evidence?.credential?.id || null;

        if (summaryRoot) {
          summaryRoot.textContent = [
            formatDidMethodChoice(result.didMethod || activeCompareParams.issuerDidMethod || "unknown"),
            comparison.summary || "无摘要",
            repairs.length ? `${repairs.length} 条修复记录` : "无修复记录",
            evidenceCredentialId ? `证据 ${evidenceCredentialId}` : null,
          ].filter(Boolean).join(" · ");
        }

        if (detailRoot) {
          detailRoot.textContent = [
            result.comparisonDigest ? `摘要哈希 ${result.comparisonDigest}` : null,
            migrationDiff.summary || null,
            Array.isArray(result.repairIds) && result.repairIds.length ? `修复 ID ${result.repairIds.join(", ")}` : "暂无修复历史",
          ].filter(Boolean).join(" ｜ ");
        }

        if (root) {
          setJsonText(
            root,
            {
              didMethod: result.didMethod || null,
              issuedDidMethods: result.issuedDidMethods || [],
              comparison: result.comparison || null,
              comparisonDigest: result.comparisonDigest || null,
              repairIds: result.repairIds || [],
              migrationRepairs: repairs.map((repair) => buildCompactRepairView(repair)),
              evidence: {
                credentialId: evidenceCredentialId,
                credentialRecordId: result.evidence?.credentialRecord?.credentialRecordId || null,
                issuer: result.evidence?.issuer || null,
              },
            },
            "提交对比后，这里会显示助手对比详情。"
          );
        }
      }

      async function loadAgents() {
        const data = await request("/api/agents");
        renderAgents(data.agents);
      }

      async function loadLedger() {
        const data = await request("/api/ledger");
        setJsonText(document.getElementById("ledger"), data.events.slice(-12), "账本事件会显示在这里。");
      }

      async function loadAuthorizations(agentId = activeAgentId) {
        if (!agentId) {
          renderAuthorizations([]);
          return null;
        }

        const data = await request(`/api/agents/${agentId}/authorizations`);
        renderAuthorizations(data.authorizations);
        return data.authorizations;
      }

      async function loadAgentCredential(agentId = activeAgentId, { didMethod = activeDashboardDidMethod } = {}) {
        if (!agentId) {
          renderCredential("助手证据", null);
          return null;
        }

        pendingDashboardCredentialId = null;
        setActiveCredentialRepairContext(null, { sync: false });
        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(didMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }
        const data = await request(`/api/agents/${agentId}/credential${query.toString() ? `?${query.toString()}` : ""}`);
        renderCredential(`助手 ${agentId}`, data.credential, data.credentialRecord || null);
        await loadCredentialTimeline(data.credentialRecord?.credentialRecordId || data.credentialRecord?.credentialId || data.credential?.id);
        await loadCredentialStatus(data.credentialRecord?.credentialRecordId || data.credentialRecord?.credentialId || data.credential?.id);
        await loadCredentialStatuses(activeAgentId, { didMethod: normalizedDidMethod });
        syncDashboardUrlState();
        return data.credential;
      }

      async function loadAuthorizationCredential(proposalId) {
        if (!proposalId) {
          renderCredential("提案证据", null);
          return null;
        }

        pendingDashboardCredentialId = null;
        setActiveCredentialRepairContext(null, { sync: false });
        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }
        const data = await request(`/api/authorizations/${proposalId}/credential${query.toString() ? `?${query.toString()}` : ""}`);
        renderCredential(`提案 ${proposalId}`, data.credential, data.credentialRecord || null);
        await loadCredentialTimeline(data.credentialRecord?.credentialRecordId || data.credentialRecord?.credentialId || data.credential?.id);
        await loadCredentialStatus(data.credentialRecord?.credentialRecordId || data.credentialRecord?.credentialId || data.credential?.id);
        await loadCredentialStatuses(activeAgentId, { didMethod: normalizedDidMethod });
        syncDashboardUrlState();
        return data.credential;
      }

      async function loadCredentialStatuses(agentId = activeAgentId, { resetRepairOffset = false, didMethod = activeDashboardDidMethod } = {}) {
        const filterRoot = document.getElementById("credential-filter-agent");
        const countsRoot = document.getElementById("credential-counts");
        if (filterRoot) {
          filterRoot.textContent = agentId || "全部";
        }

        const scopeAgentId = agentId || "__all__";
        if (resetRepairOffset || activeCredentialRepairPage.agentId !== scopeAgentId) {
          activeCredentialRepairPage = {
            ...activeCredentialRepairPage,
            agentId: scopeAgentId,
            offset: 0,
          };
        }

        try {
          const query = new URLSearchParams({
            limit: "20",
            repairLimit: String(activeCredentialRepairPage.limit),
            repairOffset: String(activeCredentialRepairPage.offset),
            repairSortBy: "latestIssuedAt",
            repairSortOrder: "desc",
          });
          const normalizedDidMethod = normalizeDashboardDidMethod(didMethod);
          if (agentId) {
            query.set("agentId", agentId);
          }
          if (normalizedDidMethod) {
            query.set("didMethod", normalizedDidMethod);
          }
          const data = await request(`/api/credentials?${query.toString()}`);
          if (
            data.repairsPage &&
            Number(data.repairsPage.total || 0) > 0 &&
            Number(data.repairsPage.offset || 0) >= Number(data.repairsPage.total || 0)
          ) {
            const pageLimit = Math.max(1, Number(data.repairsPage.limit || activeCredentialRepairPage.limit || 6));
            activeCredentialRepairPage = {
              ...activeCredentialRepairPage,
              offset: Math.max(0, Math.floor((Number(data.repairsPage.total || 0) - 1) / pageLimit) * pageLimit),
            };
            return loadCredentialStatuses(agentId);
          }

          renderCredentialRepairs(data.repairs, data.repairsPage, null, agentId);
          renderCredentials(data.credentials, data.counts);
          syncDashboardUrlState();
          return data.credentials;
        } catch (error) {
          renderCredentialRepairs([], null, `修复聚合暂时不可用：${error.message}`, agentId);
          renderCredentials([], null, `状态列表暂时不可用：${error.message}`);
          syncDashboardUrlState();
          return null;
        }
      }

      async function loadCredentialTimeline(credentialId) {
        if (!credentialId) {
          renderCredentialTimeline(null);
          return null;
        }

        try {
          const data = await request(`/api/credentials/${encodeURIComponent(credentialId)}/timeline`);
          renderCredentialTimeline(data.timeline, data.timelineCount, data.latestTimelineAt);
          return data.timeline;
        } catch (error) {
          renderCredentialTimeline([]);
          const summaryRoot = document.getElementById("credential-timeline-summary");
          if (summaryRoot) {
            summaryRoot.textContent = `时间线加载失败：${error.message}`;
          }
          return null;
        }
      }

      async function loadMigrationRepairTimeline(repairId, { sync = true, didMethod = null } = {}) {
        if (!repairId) {
          renderCredentialTimeline(null);
          return null;
        }

        try {
          await loadMigrationRepairContext(repairId, { didMethod, sync: false });
          const data = await request(`/api/migration-repairs/${encodeURIComponent(repairId)}/timeline`);
          renderCredentialTimeline(data.timeline, data.timelineCount, data.latestTimelineAt);
          const summaryRoot = document.getElementById("credential-timeline-summary");
          if (summaryRoot) {
            summaryRoot.textContent = `修复 ${repairId} · ${data.timelineCount || 0} 个节点 · 最新 ${data.latestTimelineAt || "未知"}`;
          }
          if (sync) {
            syncDashboardUrlState();
          }
          return data;
        } catch (error) {
          renderCredentialTimeline([]);
          const summaryRoot = document.getElementById("credential-timeline-summary");
          if (summaryRoot) {
            summaryRoot.textContent = `修复时间线加载失败：${error.message}`;
          }
          return null;
        }
      }

      async function loadRepairLinkedCredential(repairId) {
        if (!repairId) {
          return null;
        }

        await loadMigrationRepairContext(repairId, { sync: false });
        const data = await request(
          `/api/migration-repairs/${encodeURIComponent(repairId)}/credentials?sortBy=latestRepairAt&sortOrder=desc&limit=20`
        );
        const preferredCredential =
          data.credentials?.find((entry) => entry.issuerDidMethod === "agentpassport") ||
          data.credentials?.[0] ||
          null;
        const targetCredentialId =
          preferredCredential?.credentialRecordId ||
          preferredCredential?.credentialId ||
          null;

        if (!targetCredentialId) {
          const summaryRoot = document.getElementById("credential-summary");
          const verificationRoot = document.getElementById("credential-verification");
          if (summaryRoot) {
            summaryRoot.textContent = `修复 ${repairId} 当前没有受影响证据`;
          }
          if (verificationRoot) {
            verificationRoot.textContent = "可以继续查看修复时间线或打开修复中心。";
          }
          await loadMigrationRepairTimeline(repairId, { sync: true });
          return data;
        }

        await loadCredentialDetail(targetCredentialId, { repairId, sync: true });
        return data;
      }

      function openRepairHub(repairId, didMethod = normalizeDashboardDidMethod(activeDashboardDidMethod) || "agentpassport") {
        const target = typeof linkHelpers.buildRepairHubHref === "function"
          ? linkHelpers.buildRepairHubHref({
              agentId: activeAgentId,
              windowId: activeWindowContextId || windowId,
              repairId,
              credentialId: extractActiveCredentialId(),
              didMethod,
            })
          : (() => {
              const query = new URLSearchParams();
              if (activeAgentId) {
                query.set("agentId", activeAgentId);
              }
              if (activeWindowContextId || windowId) {
                query.set("windowId", activeWindowContextId || windowId);
              }
              if (repairId) {
                query.set("repairId", repairId);
              }
              const credentialId = extractActiveCredentialId();
              if (credentialId) {
                query.set("credentialId", credentialId);
              }
              if (didMethod) {
                query.set("didMethod", didMethod);
              }
              return `/repair-hub${query.toString() ? `?${query.toString()}` : ""}`;
            })();
        const opened = window.open(target, "_blank", "noopener,noreferrer");
        if (!opened) {
          window.location.href = target;
        }
      }

      async function loadCredentialStatus(credentialId) {
        if (!credentialId) {
          renderCredentialStatus(null);
          renderStatusListBrowser(null);
          renderStatusListComparison(null);
          return null;
        }

        try {
          const data = await request(`/api/credentials/${encodeURIComponent(credentialId)}/status`);
          renderCredentialStatus(data);
          await loadStatusListBrowser(
            data.statusListSummary?.statusListId ||
              data.statusList?.summary?.statusListId ||
              data.credentialStatus?.statusListId ||
              data.statusListId ||
              null,
            activeStatusLists.length > 0
              ? activeStatusLists
              : data.statusList?.summary
                ? [data.statusList.summary]
                : []
          );
          return data;
        } catch (error) {
          renderCredentialStatus(null);
          renderStatusListComparison(null, error.message);
          const summaryRoot = document.getElementById("credential-status-summary");
          const detailRoot = document.getElementById("credential-status-detail");
          if (summaryRoot) {
            summaryRoot.textContent = `状态证明加载失败：${error.message}`;
          }
          if (detailRoot) {
            detailRoot.textContent = "状态列表暂不可用";
          }
          return null;
        }
      }

      function getSelectedStatusListId() {
        const selector = document.getElementById("status-list-selector");
        return normalizeStatusListReference(selector?.value || activeStatusListId || currentCredentialStatusListId()) || null;
      }

      function getSelectedStatusListCompareId() {
        const selector = document.getElementById("status-list-compare-selector");
        return normalizeStatusListReference(selector?.value || activeStatusListCompareId) || null;
      }

      async function loadStatusListBrowser(statusListId = null, statusLists = activeStatusLists) {
        const preferredStatusListId =
          normalizeStatusListReference(statusListId) ||
          normalizeStatusListReference(activeStatusListId) ||
          currentCredentialStatusListId() ||
          normalizeStatusListReference(statusLists?.[0]?.statusListId) ||
          null;
        const selectedStatusListId = renderStatusListSelector(statusLists, preferredStatusListId);

        if (!selectedStatusListId) {
          renderStatusListBrowser(null);
          renderStatusListComparison(null);
          syncDashboardUrlState();
          return null;
        }

        try {
          const data = await request(`/api/status-lists/${encodeURIComponent(selectedStatusListId)}`);
          renderStatusListBrowser(data);
          await loadStatusListComparison(selectedStatusListId, activeStatusListCompareId, statusLists, data);
          syncDashboardUrlState();
          return data;
        } catch (error) {
          renderStatusListBrowser(null, error.message);
          renderStatusListComparison(null, error.message);
          syncDashboardUrlState();
          return null;
        }
      }

      async function loadStatusListComparison(leftStatusListId = null, compareStatusListId = null, statusLists = activeStatusLists, leftStatusListData = null) {
        const normalizedLists = Array.isArray(statusLists) ? statusLists.filter(Boolean) : [];
        const preferredLeftId =
          normalizeStatusListReference(leftStatusListId) ||
          normalizeStatusListReference(activeStatusListId) ||
          currentCredentialStatusListId() ||
          normalizedLists[0]?.statusListId ||
          null;
        const compareLists = preferredLeftId
          ? normalizedLists.filter((item) => normalizeStatusListReference(item.statusListId) !== preferredLeftId)
          : normalizedLists;
        const preferredCompareId =
          normalizeStatusListReference(compareStatusListId) ||
          normalizeStatusListReference(activeStatusListCompareId) ||
          compareLists[0]?.statusListId ||
          null;
        const selectedCompareId =
          preferredCompareId && compareLists.some((item) => item.statusListId === preferredCompareId)
            ? preferredCompareId
            : compareLists[0]?.statusListId || null;

        renderStatusListCompareSelector(normalizedLists, selectedCompareId, preferredLeftId);

        if (!preferredLeftId || !selectedCompareId) {
          renderStatusListComparison(null, preferredLeftId ? "当前只有一个状态列表，无法对比。" : null);
          syncDashboardUrlState();
          return null;
        }

        if (preferredLeftId === selectedCompareId) {
          renderStatusListComparison(null, "请选择两个不同的状态列表。");
          syncDashboardUrlState();
          return null;
        }

        try {
          const query = new URLSearchParams({
            leftStatusListId: preferredLeftId,
            rightStatusListId: selectedCompareId,
          });
          const data = await request(`/api/status-lists/compare?${query.toString()}`);
          renderStatusListComparison(data);
          syncDashboardUrlState();
          return data;
        } catch (error) {
          renderStatusListComparison(null, error.message);
          syncDashboardUrlState();
          return null;
        }
      }

      async function handleStatusEntryAction(event) {
        const loadButton = event.target.closest(".status-entry-load");
        const timelineButton = event.target.closest(".status-entry-timeline");
        const compareLoadButton = event.target.closest(".status-compare-load");

        if (loadButton) {
          const credentialId = loadButton.dataset.credentialRecordId || loadButton.dataset.credentialId;
          await loadCredentialDetail(credentialId);
          return true;
        }

        if (timelineButton) {
          const credentialId = timelineButton.dataset.credentialRecordId || timelineButton.dataset.credentialId;
          await loadCredentialTimeline(credentialId);
          return true;
        }

        if (compareLoadButton) {
          const statusListId = compareLoadButton.dataset.statusListId;
          await loadStatusListBrowser(statusListId, activeStatusLists);
          return true;
        }

        return false;
      }

      async function loadCredentialDetail(credentialId, { repairId = null, sync = true } = {}) {
        if (!credentialId) {
          renderCredential("证据", null);
          return null;
        }

        pendingDashboardCredentialId = credentialId;
        const data = await request(`/api/credentials/${encodeURIComponent(credentialId)}`);
        const label = data.credentialRecord?.subjectLabel || data.credentialRecord?.credentialId || credentialId;
        renderCredential(label, data.credential, data.credentialRecord || null);
        if (repairId) {
          await loadMigrationRepairContext(repairId, { sync: false });
        } else {
          setActiveCredentialRepairContext(null, { sync: false });
        }
        await loadCredentialTimeline(data.credentialRecord?.credentialRecordId || data.credentialRecord?.credentialId || data.credential?.id || credentialId);
        await loadCredentialStatus(data.credentialRecord?.credentialRecordId || data.credentialRecord?.credentialId || data.credential?.id || credentialId);
        if (sync) {
          syncDashboardUrlState();
        }
        return data;
      }

      async function revokeCredentialById(credentialId) {
        if (!credentialId) {
          return null;
        }

        const reason = window.prompt("请输入撤销原因", "手动撤销");
        if (reason === null) {
          return null;
        }

        const data = await request(`/api/credentials/${encodeURIComponent(credentialId)}/revoke`, {
          method: "POST",
          body: JSON.stringify({
            reason,
            revokedBy: activeAgentId,
            revokedByAgentId: activeAgentId,
            revokedByWindowId: windowId,
            sourceWindowId: windowId,
          }),
        });

        if (activeCredential?.id === data.credential?.id) {
          renderCredential(
            data.credentialRecord?.subjectLabel || data.credentialRecord?.credentialId || credentialId,
            data.credential,
            data.credentialRecord || null
          );
          const verification = await request("/api/credentials/verify", {
            method: "POST",
            body: JSON.stringify({ credential: data.credential }),
          });
          renderCredentialVerification(verification.verification);
        }
        await loadCredentialTimeline(data.credentialRecord?.credentialRecordId || data.credentialRecord?.credentialId || data.credential?.id || credentialId);
        await loadCredentialStatus(data.credentialRecord?.credentialRecordId || data.credentialRecord?.credentialId || data.credential?.id || credentialId);

        await Promise.all([
          loadCredentialStatuses(activeAgentId),
          loadContext(activeAgentId),
        ]);
        return data;
      }

      async function loadWindowBinding() {
        try {
          const data = await request(`/api/windows/${windowId}`);
          renderWindowBinding(data.window);
          await loadReferencedWindowContext(activeWindowContextId || data.window?.windowId || windowId, { sync: false });
          syncDashboardUrlState();
          return data.window;
        } catch {
          renderWindowBinding(null);
          await loadReferencedWindowContext(activeWindowContextId || windowId, { sync: false });
          syncDashboardUrlState();
          return null;
        }
      }

      async function loadRuntime(agentId = activeAgentId) {
        if (!agentId) {
          activeCognitiveTransitions = null;
          renderRuntimeQuickSummary(null);
          renderRuntimeState(null);
          return null;
        }

        activeCognitiveTransitions = null;

        loadAgentRuntimeSummary(agentId).then((data) => {
          renderRuntimeQuickSummary(data?.summary || null);
        });

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }
        const data = await request(`/api/agents/${agentId}/runtime${query.toString() ? `?${query.toString()}` : ""}`);
        renderRuntimeState(data.runtime);
        await loadAgentCognitiveTransitions(agentId);
        return data.runtime;
      }

      async function executeDeviceRuntimeConfig(payload = {}) {
        const data = await request("/api/device/runtime", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        await Promise.all([
          loadDeviceSetupState(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
          loadRuntime(activeAgentId),
          loadAgentSessionState(activeAgentId),
          loadContext(activeAgentId),
        ]);
        return data;
      }

      async function loadConversationMinutes(agentId = activeAgentId, { limit = 8 } = {}) {
        if (!agentId) {
          renderConversationMinutes(null);
          return null;
        }

        const search = new URLSearchParams();
        if (limit) {
          search.set("limit", String(limit));
        }
        const data = await request(`/api/agents/${agentId}/runtime/minutes${search.toString() ? `?${search.toString()}` : ""}`);
        renderConversationMinutes(data);
        return data;
      }

      async function recordConversationMinuteEntry(agentId = activeAgentId, payload = {}) {
        if (!agentId) {
          renderConversationMinutes(null);
          return null;
        }

        const data = await request(`/api/agents/${agentId}/runtime/minutes`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderConversationMinutes({
          minute: data.minute,
          counts: {
            total: activeConversationMinutes?.counts?.total != null
              ? activeConversationMinutes.counts.total + 1
              : 1,
          },
        });
        await Promise.all([
          loadConversationMinutes(agentId),
          loadRuntime(agentId),
          loadRehydrate(agentId),
          loadContext(agentId),
        ]);
        return data;
      }

      async function loadRuntimeSearch(agentId = activeAgentId, { query = "", sourceType = "", limit = 8 } = {}) {
        if (!agentId) {
          renderRuntimeSearch(null);
          return null;
        }

        const search = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          search.set("didMethod", normalizedDidMethod);
        }
        if (query) {
          search.set("query", query);
        }
        if (sourceType) {
          search.set("sourceType", sourceType);
        }
        if (limit) {
          search.set("limit", String(limit));
        }

        const data = await request(`/api/agents/${agentId}/runtime/search${search.toString() ? `?${search.toString()}` : ""}`);
        renderRuntimeSearch(data);
        if (data.suggestedResumeBoundaryId) {
          const rehydrateInput = document.querySelector('#rehydrate-form [name="resumeFromCompactBoundaryId"]');
          const runnerInput = document.querySelector('#runner-form [name="resumeFromCompactBoundaryId"]');
          if (rehydrateInput && !rehydrateInput.value) {
            rehydrateInput.value = data.suggestedResumeBoundaryId;
          }
          if (runnerInput && !runnerInput.value) {
            runnerInput.value = data.suggestedResumeBoundaryId;
          }
        }
        return data;
      }

      async function loadSandboxAudits(agentId = activeAgentId, { limit = 8, capability = "", status = "" } = {}) {
        if (!agentId) {
          renderSandboxAudits(null);
          return null;
        }

        const search = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          search.set("didMethod", normalizedDidMethod);
        }
        if (limit) {
          search.set("limit", String(limit));
        }
        if (capability) {
          search.set("capability", capability);
        }
        if (status) {
          search.set("status", status);
        }

        const data = await request(`/api/agents/${agentId}/runtime/actions?${search.toString()}`);
        renderSandboxAudits(data);
        return data;
      }

      async function loadRecoveryBundles({ limit = 8 } = {}) {
        const search = new URLSearchParams();
        if (limit) {
          search.set("limit", String(limit));
        }
        const data = await request(`/api/device/runtime/recovery${search.toString() ? `?${search.toString()}` : ""}`);
        renderRecoveryState(data);
        return data;
      }

      async function exportRecoveryBundle(payload = {}) {
        const data = await request("/api/device/runtime/recovery", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderRecoveryState(data);
        return data;
      }

      async function importRecoveryBundle(payload = {}) {
        const data = await request("/api/device/runtime/recovery/import", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderRecoveryState(data);
        await Promise.all([loadRuntime(activeAgentId), loadSecurityStatus(), loadDeviceSetupState(), loadSetupPackageList()]);
        return data;
      }

      async function loadRecoveryRehearsals({ limit = 8 } = {}) {
        const search = new URLSearchParams();
        if (limit) {
          search.set("limit", String(limit));
        }
        const data = await request(`/api/device/runtime/recovery/rehearsals${search.toString() ? `?${search.toString()}` : ""}`);
        renderRecoveryRehearsalState(data);
        return data;
      }

      async function runRecoveryRehearsal(payload = {}) {
        const data = await request("/api/device/runtime/recovery/verify", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderRecoveryRehearsalState(data);
        await Promise.all([loadDeviceSetupState(), loadRecoveryRehearsals(), loadSetupPackageList()]);
        return data;
      }

      async function loadDeviceSetupState() {
        const data = await request("/api/device/setup");
        renderSetupState(data);
        return data;
      }

      async function executeDeviceSetup(payload = {}) {
        const data = await request("/api/device/setup", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderSetupState(data);
        renderBootstrapResult(data.bootstrap || null);
        if (data.bootstrap?.sessionState) {
          renderSessionState(data.bootstrap.sessionState);
        }
        if (data.bootstrap?.rehydrate) {
          renderRehydratePack(data.bootstrap.rehydrate);
        }
        if (data.bootstrap?.contextBuilder) {
          renderContextBuilder(data.bootstrap.contextBuilder);
        }
        if (data.recoveryExport) {
          renderRecoveryState(data.recoveryExport);
        }
        if (data.recoveryRehearsal) {
          renderRecoveryRehearsalState(data.recoveryRehearsal);
        }
        await Promise.all([
          loadRuntime(activeAgentId),
          loadContext(activeAgentId),
          loadSecurityStatus(),
          loadRecoveryBundles(),
          loadRecoveryRehearsals(),
          loadAgentSessionState(activeAgentId),
          loadCompactBoundaries(activeAgentId),
          loadVerificationRuns(activeAgentId),
          loadTranscript(activeAgentId),
          loadDeviceSetupState(),
          loadSetupPackageList(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
          loadLocalReasonerRestoreCandidates(),
        ]);
        return data;
      }

      async function previewSetupPackage() {
        const data = await request("/api/device/setup/package");
        renderSetupPackageState(data);
        return data;
      }

      async function loadSetupPackageList() {
        const data = await request("/api/device/setup/packages?limit=10");
        renderSetupPackageList(data);
        return data;
      }

      async function loadSavedSetupPackage(packageId) {
        if (!packageId) {
          renderSetupPackageState(null);
          return null;
        }
        const data = await request(`/api/device/setup/packages/${encodeURIComponent(packageId)}`);
        renderSetupPackageState(data);
        return data;
      }

      async function exportSetupPackage(payload = {}) {
        const data = await request("/api/device/setup/package", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderSetupPackageState(data);
        await Promise.all([loadDeviceSetupState(), loadSetupPackageList()]);
        return data;
      }

      async function importSetupPackage(payload = {}) {
        const data = await request("/api/device/setup/package/import", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderSetupPackageState(data);
        if (data.runtime?.deviceRuntime?.residentAgentId) {
          activeAgentId = data.runtime.deviceRuntime.residentAgentId;
        }
        await Promise.all([
          loadRuntime(activeAgentId),
          loadContext(activeAgentId),
          loadSecurityStatus(),
          loadDeviceSetupState(),
          loadSetupPackageList(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
          loadLocalReasonerRestoreCandidates(),
        ]);
        return data;
      }

      async function deleteSavedSetupPackage(packageId, payload = {}) {
        if (!packageId) {
          return null;
        }
        const data = await request(`/api/device/setup/packages/${encodeURIComponent(packageId)}/delete`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderSetupPackageState(data);
        await Promise.all([loadDeviceSetupState(), loadSetupPackageList()]);
        return data;
      }

      async function pruneSavedSetupPackages(payload = {}) {
        const data = await request("/api/device/setup/packages", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderSetupPackageMaintenance(data);
        await Promise.all([loadDeviceSetupState(), loadSetupPackageList()]);
        return data;
      }

      async function loadLocalReasonerCatalog() {
        const data = await request("/api/device/runtime/local-reasoner/catalog");
        renderLocalReasonerCatalog(data);
        return data;
      }

      async function loadLocalReasonerProfiles() {
        const data = await request("/api/device/runtime/local-reasoner/profiles?limit=12");
        renderLocalReasonerProfiles(data);
        return data;
      }

      async function loadLocalReasonerRestoreCandidates() {
        const data = await request("/api/device/runtime/local-reasoner/restore-candidates?limit=12");
        renderLocalReasonerRestore(data);
        return data;
      }

      async function loadLocalReasonerProfile(profileId, { includeProfile = true } = {}) {
        if (!profileId) {
          return null;
        }
        const query = new URLSearchParams();
        query.set("includeProfile", includeProfile ? "true" : "false");
        const data = await request(
          `/api/device/runtime/local-reasoner/profiles/${encodeURIComponent(profileId)}?${query.toString()}`
        );
        return data;
      }

      async function probeLocalReasoner(payload = {}) {
        const data = await request("/api/device/runtime/local-reasoner/probe", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderLocalReasonerCatalog({
          checkedAt: data.checkedAt,
          selectedProvider:
            data.deviceRuntime?.localReasoner?.activeProvider ||
            data.deviceRuntime?.localReasoner?.provider ||
            null,
          deviceRuntime: data.deviceRuntime || null,
          providers: [
            {
              provider:
                data.deviceRuntime?.localReasoner?.activeProvider ||
                data.deviceRuntime?.localReasoner?.provider ||
                payload.provider ||
                null,
              selected: true,
              config: data.deviceRuntime?.localReasoner || null,
              diagnostics: data.diagnostics || null,
              rawDiagnostics: data.rawDiagnostics || null,
              availableModels: Array.isArray(data.rawDiagnostics?.models) ? data.rawDiagnostics.models : [],
            },
          ],
        });
        return data;
      }

      async function selectLocalReasoner(payload = {}) {
        const data = await request("/api/device/runtime/local-reasoner/select", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        await Promise.all([
          loadRuntime(activeAgentId),
          loadDeviceSetupState(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
          loadLocalReasonerRestoreCandidates(),
        ]);
        return data;
      }

      async function migrateLocalReasonerToDefault(payload = {}) {
        const data = await request("/api/device/runtime/local-reasoner/migrate-default", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        await Promise.all([
          loadRuntime(activeAgentId),
          loadDeviceSetupState(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
          loadLocalReasonerRestoreCandidates(),
        ]);
        return data;
      }

      async function prewarmLocalReasoner(payload = {}) {
        const data = await request("/api/device/runtime/local-reasoner/prewarm", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderLocalReasonerCatalog({
          checkedAt: data.checkedAt,
          selectedProvider:
            data.deviceRuntime?.localReasoner?.activeProvider ||
            data.deviceRuntime?.localReasoner?.provider ||
            null,
          deviceRuntime: data.deviceRuntime || null,
          providers: [
            {
              provider:
                data.deviceRuntime?.localReasoner?.activeProvider ||
                data.deviceRuntime?.localReasoner?.provider ||
                payload.provider ||
                null,
              selected: true,
              config: data.deviceRuntime?.localReasoner || null,
              selection: data.deviceRuntime?.localReasoner?.selection || null,
              lastProbe: data.deviceRuntime?.localReasoner?.lastProbe || null,
              lastWarm: data.warmState || data.deviceRuntime?.localReasoner?.lastWarm || null,
              diagnostics: data.diagnostics || null,
              rawDiagnostics: data.rawDiagnostics || null,
              availableModels: Array.isArray(data.rawDiagnostics?.models) ? data.rawDiagnostics.models : [],
            },
          ],
        });
        await Promise.all([
          loadRuntime(activeAgentId),
          loadDeviceSetupState(),
          loadLocalReasonerProfiles(),
          loadLocalReasonerRestoreCandidates(),
        ]);
        return data;
      }

      async function restoreLocalReasoner(payload = {}) {
        const data = await request("/api/device/runtime/local-reasoner/restore", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderLocalReasonerRestore({
          restoredAt: data.restoredAt,
          restoreCandidates: data.selectedCandidate ? [data.selectedCandidate] : [],
          counts: {
            total: data.selectedCandidate ? 1 : 0,
            restorable: data.selectedCandidate?.health?.restorable ? 1 : 0,
          },
          latestRestore: {
            restoredProfileId: data.restoredProfileId || null,
            dryRun: Boolean(data.dryRun),
            prewarm: Boolean(data.prewarm),
            warmStatus: data.prewarmResult?.warmState?.status || null,
          },
        });
        await Promise.all([
          loadRuntime(activeAgentId),
          loadDeviceSetupState(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
          loadLocalReasonerRestoreCandidates(),
        ]);
        return data;
      }

      async function saveLocalReasonerProfile(payload = {}) {
        const data = await request("/api/device/runtime/local-reasoner/profiles", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        await Promise.all([
          loadRuntime(activeAgentId),
          loadDeviceSetupState(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
          loadLocalReasonerRestoreCandidates(),
        ]);
        return data;
      }

      function buildRecommendedGemmaProfilePayload() {
        return {
          profileId: RECOMMENDED_GEMMA_PROFILE_ID,
          label: RECOMMENDED_GEMMA_PROFILE_LABEL,
          note: RECOMMENDED_GEMMA_PROFILE_NOTE,
          source: "manual",
          localReasoner: {
            enabled: true,
            provider: "ollama_local",
            model: "gemma4:e4b",
            baseUrl: "http://127.0.0.1:11434",
            path: "/api/chat",
            timeoutMs: 60000,
          },
          sourceWindowId: windowId,
          updatedByWindowId: windowId,
          updatedByAgentId: activeAgentId,
        };
      }

      async function saveRecommendedGemmaProfile() {
        const data = await saveLocalReasonerProfile(buildRecommendedGemmaProfilePayload());
        await loadLocalReasonerProfile(data?.summary?.profileId || RECOMMENDED_GEMMA_PROFILE_ID);
        return data;
      }

      async function activateLocalReasonerProfile(profileId, payload = {}) {
        if (!profileId) {
          return null;
        }
        const data = await request(`/api/device/runtime/local-reasoner/profiles/${encodeURIComponent(profileId)}/activate`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        await Promise.all([
          loadRuntime(activeAgentId),
          loadDeviceSetupState(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
          loadLocalReasonerRestoreCandidates(),
        ]);
        return data;
      }

      async function deleteLocalReasonerProfile(profileId, payload = {}) {
        if (!profileId) {
          return null;
        }
        const data = await request(`/api/device/runtime/local-reasoner/profiles/${encodeURIComponent(profileId)}/delete`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        await Promise.all([
          loadRuntime(activeAgentId),
          loadDeviceSetupState(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
          loadLocalReasonerRestoreCandidates(),
        ]);
        return data;
      }

      async function runKeychainMigration(payload = {}) {
        const data = await request("/api/security/keychain-migration", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderKeychainMigrationResult(data);
        await Promise.all([
          loadSecurityStatus(),
          loadDeviceSetupState(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
          loadLocalReasonerRestoreCandidates(),
        ]);
        return data;
      }

      async function loadReadSessions() {
        try {
          const data = await request("/api/security/read-sessions");
          renderReadSessionState(data);
          return data;
        } catch (error) {
          renderReadSessionState({ error: error.message });
          return null;
        }
      }

      async function createReadSessionEntry(payload = {}) {
        const data = await request("/api/security/read-sessions", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderReadSessionState(data);
        return data;
      }

      async function revokeReadSessionEntry(readSessionId, payload = {}) {
        const data = await request(`/api/security/read-sessions/${encodeURIComponent(readSessionId)}/revoke`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderReadSessionState(data);
        return data;
      }

      async function executeSandboxAction(agentId = activeAgentId, payload = {}) {
        if (!agentId) {
          renderSandboxResult(null);
          return null;
        }

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }

        const data = await request(`/api/agents/${agentId}/runtime/actions${query.toString() ? `?${query.toString()}` : ""}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderSandboxResult(data);
        await Promise.all([
          loadSandboxAudits(agentId),
          loadRuntime(agentId),
          loadConversationMinutes(agentId),
          loadRuntimeSearch(agentId, buildRuntimeSearchOptionsFromForm()),
          loadTranscript(agentId),
          loadContext(agentId),
        ]);
        return data;
      }

      async function loadRehydrate(agentId = activeAgentId, { resumeFromCompactBoundaryId = null } = {}) {
        if (!agentId) {
          renderRehydratePack(null);
          return null;
        }

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }
        const resolvedResumeBoundaryId =
          resumeFromCompactBoundaryId ||
          document.querySelector('#rehydrate-form [name="resumeFromCompactBoundaryId"]')?.value ||
          "";
        if (resolvedResumeBoundaryId) {
          query.set("resumeFromCompactBoundaryId", resolvedResumeBoundaryId);
        }
        const data = await request(`/api/agents/${agentId}/runtime/rehydrate${query.toString() ? `?${query.toString()}` : ""}`);
        renderRehydratePack(data.rehydrate);
        return data.rehydrate;
      }

      async function executeBootstrap(agentId = activeAgentId, payload = {}) {
        if (!agentId) {
          renderBootstrapResult(null);
          return null;
        }

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }
        const data = await request(`/api/agents/${agentId}/runtime/bootstrap${query.toString() ? `?${query.toString()}` : ""}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderBootstrapResult(data);
        renderSessionState(data.sessionState || null);
        renderRehydratePack(data.rehydrate || null);
        renderContextBuilder(data.contextBuilder || null);
        if (!data.bootstrap?.dryRun) {
          await Promise.all([
            loadRuntime(agentId),
            loadContext(agentId),
            loadPassportMemories(agentId),
            loadAgentSessionState(agentId),
            loadCompactBoundaries(agentId),
            loadVerificationRuns(agentId),
            loadTranscript(agentId),
            loadDeviceSetupState(),
          ]);
        }
        return data;
      }

      function parseConversationTurnLines(rawValue) {
        const text = String(rawValue || "").trim();
        if (!text) {
          return [];
        }

        return text
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const match = line.match(/^([^:：]+)[:：]\s*(.+)$/);
            if (!match) {
              return {
                role: "note",
                content: line,
              };
            }
            return {
              role: match[1].trim(),
              content: match[2].trim(),
            };
          });
      }

      function parseToolResultLines(rawValue) {
        const text = String(rawValue || "").trim();
        if (!text) {
          return [];
        }

        return text
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const match = line.match(/^([^:：]+)[:：]\s*(.+)$/);
            if (!match) {
              return {
                tool: "note",
                result: line,
              };
            }
            return {
              tool: match[1].trim(),
              result: match[2].trim(),
            };
          });
      }

      function copyFormFields(sourceForm, targetForm, fieldNames = []) {
        if (!sourceForm || !targetForm || !Array.isArray(fieldNames)) {
          return;
        }

        for (const name of fieldNames) {
          if (!name) {
            continue;
          }
          const sourceInput = sourceForm.querySelector(`[name="${name}"]`);
          const targetInput = targetForm.querySelector(`[name="${name}"]`);
          if (!sourceInput || !targetInput) {
            continue;
          }
          targetInput.value = sourceInput.value;
        }
      }

      function buildBootstrapPayloadFromForm() {
        const form = document.getElementById("bootstrap-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        body.sourceWindowId = windowId;
        body.updatedByWindowId = windowId;
        body.recordedByWindowId = windowId;
        body.updatedByAgentId = activeAgentId;
        body.recordedByAgentId = activeAgentId;
        body.claimResidentAgent = body.claimResidentAgent;
        applyOptionalListField(body, "stablePreferences");
        applyOptionalListField(body, "currentPlan");
        applyOptionalListField(body, "constraints");
        applyOptionalListField(body, "successCriteria");
        body.maxConversationTurns = Number(body.maxConversationTurns || 12);
        body.maxContextChars = Number(body.maxContextChars || 16000);
        body.maxRecentConversationTurns = Number(body.maxRecentConversationTurns || 6);
        body.maxToolResults = Number(body.maxToolResults || 6);
        body.maxQueryIterations = Number(body.maxQueryIterations || 4);
        return body;
      }

      function buildDeviceRuntimePayloadFromForm() {
        const form = document.getElementById("device-runtime-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        body.residentAgentId = body.residentAgentId || activeAgentId || "";
        applyOptionalListField(body, "allowedCapabilities");
        applyOptionalListField(body, "localReasonerArgs");
        body.sourceWindowId = windowId;
        body.updatedByWindowId = windowId;
        body.recordedByWindowId = windowId;
        body.updatedByAgentId = activeAgentId || body.residentAgentId || null;
        body.maxReadBytes = Number(body.maxReadBytes || 8192);
        body.maxListEntries = Number(body.maxListEntries || 40);
        body.recoveryRehearsalMaxAgeHours = Number(body.recoveryRehearsalMaxAgeHours || 720);
        body.localReasonerModel = body.localReasonerModel || "";
        body.localReasonerBaseUrl = body.localReasonerBaseUrl || "";
        return body;
      }

      function buildDeviceSetupPayloadFromForm() {
        const form = document.getElementById("device-setup-form");
        const runtimePayload = buildDeviceRuntimePayloadFromForm();
        if (!form) {
          return runtimePayload;
        }

        const body = formDataToObject(form);
        return {
          ...runtimePayload,
          residentAgentId: body.residentAgentId || runtimePayload.residentAgentId || activeAgentId || "",
          residentDidMethod: body.residentDidMethod || runtimePayload.residentDidMethod || activeDashboardDidMethod || "agentpassport",
          recoveryPassphrase: body.recoveryPassphrase || "",
          dryRun: body.dryRun,
          claimResidentAgent: true,
          sourceWindowId: windowId,
          updatedByWindowId: windowId,
          recordedByWindowId: windowId,
          updatedByAgentId: activeAgentId || runtimePayload.residentAgentId || null,
        };
      }

      function buildConversationMinutePayloadFromForm() {
        const form = document.getElementById("conversation-minute-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        body.sourceWindowId = windowId;
        body.recordedByWindowId = windowId;
        body.recordedByAgentId = activeAgentId;
        body.linkedTaskSnapshotId = activeRuntime?.taskSnapshot?.snapshotId || null;
        applyOptionalListField(body, "highlights");
        applyOptionalListField(body, "actionItems");
        applyOptionalListField(body, "tags");
        return body;
      }

      function buildRuntimeSearchOptionsFromForm() {
        const form = document.getElementById("runtime-search-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        return {
          query: body.query || "",
          sourceType: body.sourceType || "",
          limit: body.limit ? Number(body.limit || 8) : 8,
        };
      }

      function buildRecoveryExportPayloadFromForm() {
        const form = document.getElementById("recovery-export-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        return {
          passphrase: body.passphrase || "",
          note: body.note || "",
          saveToFile: body.saveToFile,
          dryRun: body.dryRun,
        };
      }

      function buildRecoveryImportPayloadFromForm() {
        const form = document.getElementById("recovery-import-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        return {
          bundlePath: body.bundlePath || "",
          passphrase: body.passphrase || "",
          overwrite: body.overwrite,
          restoreLedger: body.restoreLedger,
          dryRun: body.dryRun,
        };
      }

      function buildRecoveryVerifyPayloadFromForm() {
        const form = document.getElementById("recovery-verify-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        return {
          bundlePath: body.bundlePath || "",
          passphrase: body.passphrase || "",
          dryRun: body.dryRun,
          persist: body.persist,
        };
      }

      function buildSetupPackageExportPayloadFromForm() {
        const form = document.getElementById("setup-package-export-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        return {
          note: body.note || "",
          saveToFile: body.saveToFile,
          includeLocalReasonerProfiles: body.includeLocalReasonerProfiles,
          dryRun: body.dryRun,
        };
      }

      function buildSetupPackageImportPayloadFromForm() {
        const form = document.getElementById("setup-package-import-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        return {
          packagePath: body.packagePath || "",
          allowResidentRebind: body.allowResidentRebind,
          importLocalReasonerProfiles: body.importLocalReasonerProfiles,
          dryRun: body.dryRun,
          sourceWindowId: windowId,
          updatedByWindowId: windowId,
          updatedByAgentId: activeAgentId,
        };
      }

      function buildSetupPackageLoadPayloadFromForm() {
        const form = document.getElementById("setup-package-load-form");
        if (!form) {
          return {};
        }
        const body = formDataToObject(form);
        return {
          packageId: body.packageId || "",
        };
      }

      function buildSetupPackageDeletePayloadFromForm() {
        const form = document.getElementById("setup-package-delete-form");
        if (!form) {
          return {};
        }
        const body = formDataToObject(form);
        return {
          packageId: body.packageId || "",
          dryRun: body.dryRun,
        };
      }

      function buildLocalReasonerProbePayloadFromForm() {
        const form = document.getElementById("local-reasoner-probe-form");
        if (!form) {
          return {};
        }
        const body = formDataToObject(form);
        return {
          provider: body.provider || "",
          command: body.command || "",
          args: body.args ? String(body.args).split(",").map((item) => item.trim()).filter(Boolean) : [],
          cwd: body.cwd || "",
          baseUrl: body.baseUrl || "",
          model: body.model || "",
        };
      }

      function buildLocalReasonerSelectPayloadFromForm() {
        const form = document.getElementById("local-reasoner-select-form");
        if (!form) {
          return {};
        }
        const body = formDataToObject(form);
        return {
          provider: body.provider || "",
          enabled: body.enabled,
          command: body.command || "",
          args: body.args ? String(body.args).split(",").map((item) => item.trim()).filter(Boolean) : [],
          cwd: body.cwd || "",
          baseUrl: body.baseUrl || "",
          model: body.model || "",
          dryRun: body.dryRun,
          sourceWindowId: windowId,
          updatedByWindowId: windowId,
          updatedByAgentId: activeAgentId,
        };
      }

      function buildLocalReasonerPrewarmPayloadFromForm() {
        const form = document.getElementById("local-reasoner-prewarm-form");
        if (!form) {
          return {};
        }
        const body = formDataToObject(form);
        return {
          provider: body.provider || "",
          model: body.model || "",
          baseUrl: body.baseUrl || "",
          dryRun: body.dryRun,
          sourceWindowId: windowId,
          updatedByWindowId: windowId,
          updatedByAgentId: activeAgentId,
        };
      }

      function buildLocalReasonerMigrationPayloadFromForm() {
        const form = document.getElementById("local-reasoner-migrate-form");
        if (!form) {
          return {};
        }
        const body = formDataToObject(form);
        return {
          dryRun: body.dryRun,
          prewarm: body.prewarm,
          includeProfiles: body.includeProfiles,
          sourceWindowId: windowId,
          updatedByWindowId: windowId,
          updatedByAgentId: activeAgentId,
        };
      }

      function buildLocalReasonerProfileSavePayloadFromForm() {
        const form = document.getElementById("local-reasoner-profile-save-form");
        if (!form) {
          return {};
        }
        const body = formDataToObject(form);
        return {
          profileId: body.profileId || "",
          label: body.label || "",
          note: body.note || "",
          source: body.source || "current",
          dryRun: body.dryRun,
          sourceWindowId: windowId,
          updatedByWindowId: windowId,
          updatedByAgentId: activeAgentId,
        };
      }

      function buildLocalReasonerProfileActivatePayloadFromForm() {
        const form = document.getElementById("local-reasoner-profile-activate-form");
        if (!form) {
          return {};
        }
        const body = formDataToObject(form);
        return {
          profileId: body.profileId || "",
          dryRun: body.dryRun,
          sourceWindowId: windowId,
          updatedByWindowId: windowId,
          updatedByAgentId: activeAgentId,
        };
      }

      function buildLocalReasonerProfileDeletePayloadFromForm() {
        const form = document.getElementById("local-reasoner-profile-delete-form");
        if (!form) {
          return {};
        }
        const body = formDataToObject(form);
        return {
          profileId: body.profileId || "",
          dryRun: body.dryRun,
        };
      }

      function buildLocalReasonerRestorePayloadFromForm() {
        const form = document.getElementById("local-reasoner-restore-form");
        if (!form) {
          return {};
        }
        const body = formDataToObject(form);
        return {
          profileId: body.profileId || "",
          prewarm: body.prewarm,
          dryRun: body.dryRun,
          sourceWindowId: windowId,
          updatedByWindowId: windowId,
          updatedByAgentId: activeAgentId,
        };
      }

      function buildSetupPackagePrunePayloadFromForm() {
        const form = document.getElementById("setup-package-prune-form");
        if (!form) {
          return {};
        }
        const body = formDataToObject(form);
        return {
          keepLatest: body.keepLatest || 3,
          residentAgentId: body.residentAgentId || "",
          noteIncludes: body.noteIncludes || "",
          dryRun: body.dryRun,
        };
      }

      function buildTranscriptOptionsFromForm() {
        const form = document.getElementById("transcript-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        return {
          family: body.family || null,
          limit: body.limit ? Number(body.limit || 12) : 12,
        };
      }

      function buildSandboxActionPayloadFromForm() {
        const form = document.getElementById("sandbox-action-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        let parsedArgs = [];
        if ((body.capability || "") === "process_exec" && body.methodOrArgs) {
          try {
            const candidate = JSON.parse(body.methodOrArgs);
            if (Array.isArray(candidate)) {
              parsedArgs = candidate.map((item) => String(item));
            }
          } catch {
            parsedArgs = [];
          }
        }
        return {
          interactionMode: "command",
          executionMode: "execute",
          confirmExecution: true,
          currentGoal: activeRuntime?.taskSnapshot?.objective || activeRuntime?.taskSnapshot?.title || "",
          requestedAction: body.query || body.targetResource || body.title || body.capability,
          requestedActionType: body.actionType || "",
          requestedCapability: body.capability || "",
          targetResource: body.targetResource || "",
          sandboxAction: {
            capability: body.capability || "",
            actionType: body.actionType || "",
            method: (body.capability || "") === "network_external" ? (body.methodOrArgs || "GET") : "",
            command: (body.capability || "") === "process_exec" ? (body.targetResource || "") : "",
            args: parsedArgs,
            cwd: body.cwd || "",
            path: body.targetResource || "",
            targetResource: body.targetResource || "",
            url: (body.capability || "") === "network_external" ? (body.targetResource || "") : "",
            query: body.query || "",
            title: body.title || "",
            transcript: body.transcript || "",
            sourceWindowId: windowId,
            recordedByAgentId: activeAgentId,
            recordedByWindowId: windowId,
          },
          sourceWindowId: windowId,
          recordedByAgentId: activeAgentId,
          recordedByWindowId: windowId,
          persistRun: false,
          autoCompact: false,
        };
      }

      function buildContextBuilderPayloadFromForm(formId = "context-builder-form") {
        const form = document.getElementById(formId);
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        return {
          currentGoal: body.currentGoal || activeRuntime?.taskSnapshot?.objective || activeRuntime?.taskSnapshot?.title || "",
          query: body.query || "",
          recentConversationTurns: parseConversationTurnLines(body.recentConversationTurns),
          toolResults: parseToolResultLines(body.toolResults),
        };
      }

      function buildRunnerPayloadFromForm() {
        const form = document.getElementById("runner-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        return {
          currentGoal: body.currentGoal || activeRuntime?.taskSnapshot?.objective || activeRuntime?.taskSnapshot?.title || "",
          query: body.query || "",
          userTurn: body.userTurn || "",
          interactionMode: body.interactionMode || "conversation",
          requestedAction: body.requestedAction || "",
          executionMode: body.executionMode || "discuss",
          confirmExecution: body.confirmExecution,
          recentConversationTurns: parseConversationTurnLines(body.recentConversationTurns),
          toolResults: parseToolResultLines(body.toolResults),
          reasonerProvider: body.reasonerProvider || null,
          reasonerUrl: body.reasonerUrl || null,
          reasonerModel: body.reasonerModel || null,
          allowOnlineReasoner: body.allowOnlineReasoner,
          resumeFromCompactBoundaryId: body.resumeFromCompactBoundaryId || "",
          candidateResponse: body.candidateResponse || "",
          queryIteration:
            body.queryIteration !== ""
              ? Number(body.queryIteration || 1)
              : null,
          turnCount: Number(body.turnCount || 0),
          estimatedContextChars: Number(body.estimatedContextChars || 0),
          workingCheckpointThreshold:
            body.workingCheckpointThreshold !== ""
              ? Number(body.workingCheckpointThreshold || 12)
              : null,
          workingRetainCount:
            body.workingRetainCount !== ""
              ? Number(body.workingRetainCount || 6)
              : null,
          autoCompact: body.autoCompact,
          storeToolResults: body.storeToolResults,
          persistRun: body.persistRun,
          sourceWindowId: windowId,
          recordedByAgentId: activeAgentId,
          recordedByWindowId: windowId,
          claims: {
            agentId: body.claimAgentId || null,
            parentAgentId: body.claimParentAgentId || null,
            walletAddress: body.claimWalletAddress || null,
            role: body.claimRole || null,
            displayName: body.claimDisplayName || null,
            authorizationThreshold:
              body.claimAuthorizationThreshold !== ""
                ? Number(body.claimAuthorizationThreshold || 0)
                : null,
          },
        };
      }

      function buildVerificationRunPayloadFromForm() {
        const form = document.getElementById("verification-run-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        return {
          currentGoal: body.currentGoal || activeRuntime?.taskSnapshot?.objective || activeRuntime?.taskSnapshot?.title || "",
          query: body.query || "",
          adversarialResponseText: body.adversarialResponseText || "",
          mode: body.mode || "runtime_integrity",
          persistRun: body.persistRun,
          sourceWindowId: windowId,
          recordedByWindowId: windowId,
        };
      }

      function buildOfflineReplayPayloadFromForm() {
        const form = document.getElementById("offline-replay-form");
        if (!form) {
          return {};
        }

        const body = formDataToObject(form);
        return {
          currentGoal: body.currentGoal || activeRuntime?.taskSnapshot?.objective || activeRuntime?.taskSnapshot?.title || "",
          sourceWindowId: windowId,
          recordedByWindowId: windowId,
          recordedByAgentId: activeAgentId,
        };
      }

      async function loadPassportMemories(
        agentId = activeAgentId,
        {
          layer = null,
          kind = null,
          query = null,
          limit = 24,
        } = {}
      ) {
        if (!agentId) {
          renderPassportMemories(null);
          return null;
        }

        const search = new URLSearchParams();
        if (layer) {
          search.set("layer", layer);
        }
        if (kind) {
          search.set("kind", kind);
        }
        if (query) {
          search.set("query", query);
        }
        if (limit) {
          search.set("limit", String(limit));
        }

        const data = await request(`/api/agents/${agentId}/passport-memory${search.toString() ? `?${search.toString()}` : ""}`);
        renderPassportMemories(data);
        return data;
      }

      async function loadArchivedRecords(
        agentId = activeAgentId,
        {
          kind = "passport-memory",
          query = "",
          archivedFrom = "",
          archivedTo = "",
          limit = 12,
          offset = 0,
        } = {}
      ) {
        if (!agentId) {
          renderArchivedRecords(null);
          return null;
        }

        const search = new URLSearchParams();
        if (kind) {
          search.set("kind", kind);
        }
        if (query) {
          search.set("query", query);
        }
        if (archivedFrom) {
          search.set("archivedFrom", archivedFrom);
        }
        if (archivedTo) {
          search.set("archivedTo", archivedTo);
        }
        if (limit != null) {
          search.set("limit", String(limit));
        }
        if (offset != null) {
          search.set("offset", String(offset));
        }

        const data = await request(`/api/agents/${agentId}/archives?${search.toString()}`);
        renderArchivedRecords(data);
        return data;
      }

      async function loadArchiveRestoreHistory(
        agentId = activeAgentId,
        { limit = 12, kind = "all", restoredFrom = "", restoredTo = "" } = {}
      ) {
        if (!agentId) {
          renderArchiveRestoreHistory(null);
          return null;
        }
        const search = new URLSearchParams();
        if (limit) {
          search.set("limit", String(limit));
        }
        if (kind && kind !== "all") {
          search.set("kind", kind);
        }
        if (restoredFrom) {
          search.set("restoredFrom", restoredFrom);
        }
        if (restoredTo) {
          search.set("restoredTo", restoredTo);
        }
        const data = await request(`/api/agents/${agentId}/archive-restores${search.toString() ? `?${search.toString()}` : ""}`);
        renderArchiveRestoreHistory(data);
        return data;
      }

      function buildArchiveRestoreOptionsFromForm() {
        const form = document.getElementById("archive-restores-form");
        if (!form) {
          return { kind: "all", limit: 12, restoredFrom: "", restoredTo: "" };
        }
        const body = formDataToObject(form);
        return {
          kind: body.kind || "all",
          limit: body.limit ? Number(body.limit) : 12,
          restoredFrom: body.restoredFrom ? new Date(body.restoredFrom).toISOString() : "",
          restoredTo: body.restoredTo ? new Date(body.restoredTo).toISOString() : "",
        };
      }

      async function runContextBuilder(agentId = activeAgentId, payload = {}) {
        if (!agentId) {
          renderContextBuilder(null);
          return null;
        }

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }

        const data = await request(`/api/agents/${agentId}/context-builder${query.toString() ? `?${query.toString()}` : ""}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderContextBuilder(data.contextBuilder);
        return data.contextBuilder;
      }

      async function runResponseVerifier(agentId = activeAgentId, payload = {}) {
        if (!agentId) {
          renderResponseVerification(null);
          return null;
        }

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }

        const data = await request(`/api/agents/${agentId}/response-verify${query.toString() ? `?${query.toString()}` : ""}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderResponseVerification(data.runtimeIntegrity || data.verification);
        return data.runtimeIntegrity || data.verification;
      }

      async function loadAgentRuns(agentId = activeAgentId, { limit = 8 } = {}) {
        if (!agentId) {
          renderRunnerHistory(null);
          return null;
        }

        const search = new URLSearchParams();
        if (limit) {
          search.set("limit", String(limit));
        }
        const data = await request(`/api/agents/${agentId}/runner${search.toString() ? `?${search.toString()}` : ""}`);
        renderRunnerHistory(data);
        return data;
      }

      async function loadAgentSessionState(agentId = activeAgentId) {
        if (!agentId) {
          renderSessionState(null);
          return null;
        }

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }
        const data = await request(`/api/agents/${agentId}/session-state${query.toString() ? `?${query.toString()}` : ""}`);
        renderSessionState(data.sessionState || null);
        return data.sessionState || null;
      }

      async function loadAgentCognitiveTransitions(agentId = activeAgentId, { limit = 8 } = {}) {
        if (!agentId) {
          activeCognitiveTransitions = null;
          renderCognitiveDynamicsPanel(activeRuntime);
          return null;
        }

        const search = new URLSearchParams();
        if (limit) {
          search.set("limit", String(limit));
        }
        const data = await request(`/api/agents/${agentId}/cognitive-transitions${search.toString() ? `?${search.toString()}` : ""}`);
        activeCognitiveTransitions = data || null;
        renderCognitiveDynamicsPanel(activeRuntime);
        return data;
      }

      async function loadCompactBoundaries(agentId = activeAgentId, { limit = 8 } = {}) {
        if (!agentId) {
          renderCompactBoundaries(null);
          return null;
        }

        const search = new URLSearchParams();
        if (limit) {
          search.set("limit", String(limit));
        }
        const data = await request(`/api/agents/${agentId}/compact-boundaries${search.toString() ? `?${search.toString()}` : ""}`);
        renderCompactBoundaries(data);
        return data;
      }

      async function loadTranscript(agentId = activeAgentId, { family = null, limit = 12 } = {}) {
        if (!agentId) {
          renderTranscriptState(null);
          return null;
        }

        const search = new URLSearchParams();
        if (family) {
          search.set("family", family);
        }
        if (limit) {
          search.set("limit", String(limit));
        }
        const data = await request(`/api/agents/${agentId}/transcript${search.toString() ? `?${search.toString()}` : ""}`);
        renderTranscriptState(data);
        return data;
      }

      function buildArchivesOptionsFromForm() {
        const form = document.getElementById("archives-form");
        if (!form) {
          return { kind: "passport-memory", limit: 12, offset: 0 };
        }
        const body = formDataToObject(form);
        return {
          kind: body.kind || "passport-memory",
          query: body.query || "",
          archivedFrom: body.archivedFrom ? new Date(body.archivedFrom).toISOString() : "",
          archivedTo: body.archivedTo ? new Date(body.archivedTo).toISOString() : "",
          limit: body.limit ? Number(body.limit) : 12,
          offset: body.offset ? Number(body.offset) : 0,
        };
      }

      async function loadVerificationRuns(agentId = activeAgentId, { limit = 8 } = {}) {
        if (!agentId) {
          renderVerificationRunHistory(null);
          return null;
        }

        const search = new URLSearchParams();
        if (limit) {
          search.set("limit", String(limit));
        }
        const data = await request(`/api/agents/${agentId}/verification-runs${search.toString() ? `?${search.toString()}` : ""}`);
        renderVerificationRunHistory(data);
        return data;
      }

      async function executeRunner(agentId = activeAgentId, payload = {}) {
        if (!agentId) {
          renderRunnerResult(null);
          return null;
        }

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }

        const data = await request(`/api/agents/${agentId}/runner${query.toString() ? `?${query.toString()}` : ""}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderRunnerResult(data.runner);
        renderContextBuilder(data.runner?.contextBuilder || null);
        renderDriftCheckResult(data.runner?.driftCheck || null);
        renderResponseVerification(data.runner?.runtimeIntegrity || data.runner?.verification || null);
        await Promise.all([
          loadAgentRuns(agentId),
          loadAgentSessionState(agentId),
          loadCompactBoundaries(agentId),
          loadVerificationRuns(agentId),
          loadTranscript(agentId),
          loadPassportMemories(agentId),
          loadContext(agentId),
          loadRuntime(agentId),
          loadRehydrate(agentId),
        ]);
        return data.runner;
      }

      async function executeVerification(agentId = activeAgentId, payload = {}) {
        if (!agentId) {
          renderVerificationRunResult(null);
          return null;
        }

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }

        const data = await request(`/api/agents/${agentId}/verification-runs${query.toString() ? `?${query.toString()}` : ""}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderVerificationRunResult(data);
        renderSessionState(data.sessionState || null);
        await Promise.all([
          loadVerificationRuns(agentId),
          loadCompactBoundaries(agentId),
          loadTranscript(agentId),
        ]);
        return data;
      }

      async function executeOfflineReplay(agentId = activeAgentId, payload = {}) {
        if (!agentId) {
          activeOfflineReplayResult = null;
          renderCognitiveDynamicsPanel(activeRuntime);
          return null;
        }

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }

        const data = await request(`/api/agents/${agentId}/offline-replay${query.toString() ? `?${query.toString()}` : ""}`, {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            sourceWindowId: payload.sourceWindowId || windowId,
            recordedByWindowId: payload.recordedByWindowId || windowId,
            recordedByAgentId: payload.recordedByAgentId || activeAgentId,
          }),
        });
        activeOfflineReplayResult = data.offlineReplay || null;
        renderCognitiveDynamicsPanel(activeRuntime);
        await Promise.all([
          loadRuntime(agentId),
          loadContext(agentId),
          loadPassportMemories(agentId),
        ]);
        return activeOfflineReplayResult;
      }

      async function runDriftCheck(agentId = activeAgentId, payload = {}) {
        if (!agentId) {
          renderDriftCheckResult(null);
          return null;
        }

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(activeDashboardDidMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }
        const data = await request(`/api/agents/${agentId}/runtime/drift-check${query.toString() ? `?${query.toString()}` : ""}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        renderDriftCheckResult(data.driftCheck);
        return data.driftCheck;
      }

      async function loadReferencedWindowContext(targetWindowId = activeWindowContextId, { sync = true } = {}) {
        const resolvedWindowId = String(targetWindowId || localWindowBinding?.windowId || windowId);
        activeWindowContextId = resolvedWindowId;

        if (localWindowBinding?.windowId === resolvedWindowId) {
          activeWindowContextBinding = localWindowBinding;
          activeWindowContextError = null;
          syncWindowContextSummary();
          renderWindowContextPanel();
          if (sync) {
            syncDashboardUrlState();
          }
          return activeWindowContextBinding;
        }

        try {
          const data = await request(`/api/windows/${encodeURIComponent(resolvedWindowId)}`);
          activeWindowContextBinding = data.window || null;
          activeWindowContextError = null;
        } catch (error) {
          activeWindowContextBinding = null;
          activeWindowContextError = error.message;
        }

        syncWindowContextSummary();
        renderWindowContextPanel();
        if (sync) {
          syncDashboardUrlState();
        }
        return activeWindowContextBinding;
      }

      async function loadContext(agentId = activeAgentId, { didMethod = activeDashboardDidMethod, sync = false } = {}) {
        if (!agentId) {
          renderContext(null);
          return null;
        }

        const query = new URLSearchParams();
        const normalizedDidMethod = normalizeDashboardDidMethod(didMethod);
        if (normalizedDidMethod) {
          query.set("didMethod", normalizedDidMethod);
        }
        const data = await request(`/api/agents/${agentId}/context${query.toString() ? `?${query.toString()}` : ""}`);
        renderContext(data.context);
        renderRuntimeState(data.context?.runtime || null);
        await loadStatusListBrowser(
          data.context?.statusList?.statusListId ||
            data.context?.statusLists?.[0]?.statusListId ||
            activeStatusListId ||
            null,
          data.context?.statusLists || activeStatusLists
        );
        if (sync) {
          syncDashboardUrlState();
        }
        return data.context;
      }

      async function loadAgentCompareDetail(params = activeCompareParams) {
        const leftAgentId = params?.leftAgentId || activeAgentId || null;
        const rightAgentId = params?.rightAgentId || "agent_treasury";
        const issuerAgentId = params?.issuerAgentId || "agent_treasury";
        const issuerDidMethod = params?.issuerDidMethod || "agentpassport";

        if (!leftAgentId || !rightAgentId) {
          renderCompareDetail(null);
          return null;
        }

        activeCompareParams = {
          leftAgentId,
          rightAgentId,
          issuerAgentId,
          issuerDidMethod,
        };
        syncActiveAgentFields();

        const query = new URLSearchParams({
          leftAgentId,
          rightAgentId,
          issuerAgentId,
          issuerDidMethod,
          summaryOnly: "true",
        });
        try {
          const data = await request(`/api/agents/compare/evidence?${query.toString()}`);
          renderCompareDetail(data);
          syncDashboardUrlState();
          return data;
        } catch (error) {
          const summaryRoot = document.getElementById("compare-summary");
          const detailRoot = document.getElementById("compare-detail");
          const root = document.getElementById("compare-detail-json");
          if (summaryRoot) {
            summaryRoot.textContent = `对比加载失败：${error.message}`;
          }
          if (detailRoot) {
            detailRoot.textContent = "请检查左右 Agent ID、issuer 和 did method。";
          }
          if (root) {
            setJsonText(root, activeCompareParams, "提交对比后，这里会显示助手对比详情。");
          }
          return null;
        }
      }

      document.getElementById("window-id").textContent = windowId;
      document.getElementById("active-agent").textContent = "读取本地窗口绑定中...";
      syncActiveAgentFields();
      syncDashboardViewSummary();
      syncWindowContextSummary();
      renderWindowContextPanel();
      syncProposalPayloadExample();

      document.getElementById("agents").addEventListener("click", async (event) => {
        const button = event.target.closest("[data-agent-id][data-agent-action]");
        if (!button) {
          return;
        }

        const agentId = button.dataset.agentId;
        if (button.dataset.agentAction === "context") {
          await loadContext(agentId);
          document.getElementById("credential-agent-id").value = agentId;
          return;
        }

        if (button.dataset.agentAction === "credential") {
          document.getElementById("credential-agent-id").value = agentId;
          await loadAgentCredential(agentId);
        }
      });

      document.getElementById("authorizations").addEventListener("click", async (event) => {
        const button = event.target.closest("[data-proposal-id][data-proposal-action]");
        if (!button) {
          return;
        }

        const proposalId = button.dataset.proposalId;
        document.getElementById("credential-proposal-id").value = proposalId;

        if (button.dataset.proposalAction === "load") {
          document.getElementById("sign-proposal-id").value = proposalId;
          document.getElementById("execute-proposal-id").value = proposalId;
          document.getElementById("revoke-proposal-id").value = proposalId;
          return;
        }

        if (button.dataset.proposalAction === "credential") {
          await loadAuthorizationCredential(proposalId);
        }
      });

      document.getElementById("credentials").addEventListener("click", async (event) => {
        const loadButton = event.target.closest(".credential-load");
        const revokeButton = event.target.closest(".credential-revoke");

        if (loadButton) {
          const credentialId = loadButton.dataset.credentialRecordId || loadButton.dataset.credentialId;
          await loadCredentialDetail(credentialId);
          return;
        }

        if (revokeButton) {
          const credentialId = revokeButton.dataset.credentialRecordId || revokeButton.dataset.credentialId;
          await revokeCredentialById(credentialId);
        }
      });

      document.getElementById("credential-repairs").addEventListener("click", async (event) => {
        const timelineButton = event.target.closest(".credential-repair-timeline");
        const linkedButton = event.target.closest(".credential-repair-linked");
        const hubButton = event.target.closest(".credential-repair-hub");
        if (!timelineButton) {
          if (linkedButton) {
            await loadRepairLinkedCredential(linkedButton.dataset.repairId);
            return;
          }
          if (hubButton) {
            openRepairHub(hubButton.dataset.repairId, hubButton.dataset.repairMethod || "agentpassport");
            return;
          }
          return;
        }

        await loadMigrationRepairTimeline(timelineButton.dataset.repairId);
      });

      document.getElementById("credential-repair-context-timeline").addEventListener("click", async (event) => {
        const repairId = event.currentTarget.dataset.repairId;
        if (!repairId) {
          return;
        }
        await loadMigrationRepairTimeline(repairId);
      });

      document.getElementById("credential-repair-context-hub").addEventListener("click", (event) => {
        const repairId = event.currentTarget.dataset.repairId;
        const repairMethod = event.currentTarget.dataset.repairMethod || "agentpassport";
        if (!repairId) {
          return;
        }
        openRepairHub(repairId, repairMethod);
      });

      document.getElementById("credential-repair-context-clear").addEventListener("click", () => {
        setActiveCredentialRepairContext(null);
      });

      document.getElementById("prev-credential-repairs").addEventListener("click", async () => {
        activeCredentialRepairPage = {
          ...activeCredentialRepairPage,
          offset: Math.max(0, activeCredentialRepairPage.offset - activeCredentialRepairPage.limit),
        };
        await loadCredentialStatuses(activeAgentId);
      });

      document.getElementById("next-credential-repairs").addEventListener("click", async () => {
        if (!activeCredentialRepairPage.hasMore) {
          return;
        }
        activeCredentialRepairPage = {
          ...activeCredentialRepairPage,
          offset: activeCredentialRepairPage.offset + activeCredentialRepairPage.limit,
        };
        await loadCredentialStatuses(activeAgentId);
      });

      document.getElementById("credential-status").addEventListener("click", handleStatusEntryAction);
      document.getElementById("status-list-browser").addEventListener("click", handleStatusEntryAction);
      document.getElementById("status-list-compare").addEventListener("click", handleStatusEntryAction);

      document.getElementById("proposal-action-type").addEventListener("change", syncProposalPayloadExample);

      document.getElementById("register-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        body.initialCredits = Number(body.initialCredits || 0);
        body.multisigThreshold = Number(body.multisigThreshold || 1);
        applyOptionalListField(body, "signers");
        await request("/api/agents", { method: "POST", body: JSON.stringify(body) });
        event.currentTarget.reset();
        await Promise.all([loadAgents(), loadLedger()]);
      });

      document.getElementById("fork-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        const sourceAgentId = body.sourceAgentId;
        delete body.sourceAgentId;
        body.multisigThreshold = Number(body.multisigThreshold || 1);
        applyOptionalListField(body, "signers");
        applyOptionalListField(body, "approvals");
        await request(`/api/agents/${sourceAgentId}/fork`, { method: "POST", body: JSON.stringify(body) });
        event.currentTarget.reset();
        await Promise.all([loadAgents(), loadLedger()]);
      });

      document.getElementById("grant-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        const targetAgentId = body.targetAgentId;
        delete body.targetAgentId;
        body.amount = Number(body.amount || 0);
        applyOptionalListField(body, "approvals");
        await request(`/api/agents/${targetAgentId}/grants`, { method: "POST", body: JSON.stringify(body) });
        event.currentTarget.reset();
        await Promise.all([loadAgents(), loadLedger()]);
      });

      document.getElementById("policy-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        const agentId = body.agentId;
        delete body.agentId;
        body.multisigThreshold = Number(body.multisigThreshold || 1);
        applyOptionalListField(body, "signers");
        await request(`/api/agents/${agentId}/policy`, { method: "PATCH", body: JSON.stringify(body) });
        event.currentTarget.reset();
        await Promise.all([loadAgents(), loadLedger()]);
      });

      document.getElementById("window-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        const agentId = body.agentId;
        await request("/api/windows/link", {
          method: "POST",
          body: JSON.stringify({
            windowId,
            agentId,
            label: body.label,
          }),
        });
        setActiveAgent(agentId);
        event.currentTarget.reset();
        document.getElementById("window-agent-id").value = agentId;
        await Promise.all([
          loadWindowBinding(),
          loadContext(agentId),
          loadLedger(),
          loadAuthorizations(agentId),
          loadCredentialStatuses(agentId),
          loadPassportMemories(agentId),
          loadAgentRuns(agentId),
          loadAgentSessionState(agentId),
          loadCompactBoundaries(agentId),
          loadVerificationRuns(agentId),
          loadTranscript(agentId),
        ]);
        await runContextBuilder(agentId, buildContextBuilderPayloadFromForm());
      });

      document.getElementById("task-snapshot-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        body.sourceWindowId = windowId;
        body.updatedByWindowId = windowId;
        body.updatedByAgentId = activeAgentId;
        applyOptionalListField(body, "currentPlan");
        applyOptionalListField(body, "constraints");
        applyOptionalListField(body, "successCriteria");
        body.driftPolicy = {
          maxConversationTurns: Number(body.maxConversationTurns || 12),
          maxContextChars: Number(body.maxContextChars || 16000),
          maxRecentConversationTurns: Number(body.maxRecentConversationTurns || 6),
          maxToolResults: Number(body.maxToolResults || 6),
          maxQueryIterations: Number(body.maxQueryIterations || 4),
        };
        delete body.maxConversationTurns;
        delete body.maxContextChars;
        delete body.maxRecentConversationTurns;
        delete body.maxToolResults;
        delete body.maxQueryIterations;
        await request(`/api/agents/${activeAgentId}/runtime/snapshot`, { method: "POST", body: JSON.stringify(body) });
        await Promise.all([loadRuntime(activeAgentId), loadRehydrate(activeAgentId), loadContext(activeAgentId)]);
      });

      document.getElementById("bootstrap-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = buildBootstrapPayloadFromForm();
        await executeBootstrap(activeAgentId, body);
      });

      document.getElementById("device-runtime-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await executeDeviceRuntimeConfig(buildDeviceRuntimePayloadFromForm());
      });

      document.getElementById("device-runtime-quick-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const quickForm = event.currentTarget;
        const fullForm = document.getElementById("device-runtime-form");
        copyFormFields(quickForm, fullForm, [
          "residentAgentId",
          "localMode",
          "allowOnlineReasoner",
          "localReasonerEnabled",
          "localReasonerProvider",
          "localReasonerModel",
        ]);
        await executeDeviceRuntimeConfig(buildDeviceRuntimePayloadFromForm());
      });

      document.getElementById("device-setup-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await executeDeviceSetup(buildDeviceSetupPayloadFromForm());
      });

      document.getElementById("setup-package-export-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await exportSetupPackage(buildSetupPackageExportPayloadFromForm());
      });

      document.getElementById("setup-package-import-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await importSetupPackage(buildSetupPackageImportPayloadFromForm());
      });

      document.getElementById("setup-package-load-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = buildSetupPackageLoadPayloadFromForm();
        await loadSavedSetupPackage(body.packageId);
      });

      document.getElementById("setup-package-delete-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = buildSetupPackageDeletePayloadFromForm();
        await deleteSavedSetupPackage(body.packageId, { dryRun: body.dryRun });
      });

      document.getElementById("local-reasoner-probe-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await probeLocalReasoner(buildLocalReasonerProbePayloadFromForm());
      });

      document.getElementById("local-reasoner-select-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await selectLocalReasoner(buildLocalReasonerSelectPayloadFromForm());
      });

      document.getElementById("local-reasoner-prewarm-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await prewarmLocalReasoner(buildLocalReasonerPrewarmPayloadFromForm());
      });

      document.getElementById("local-reasoner-migrate-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await migrateLocalReasonerToDefault(buildLocalReasonerMigrationPayloadFromForm());
      });

      document.getElementById("local-reasoner-profile-save-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = await saveLocalReasonerProfile(buildLocalReasonerProfileSavePayloadFromForm());
        await loadLocalReasonerProfile(data?.summary?.profileId || data?.profile?.profileId || "");
      });

      document.getElementById("save-recommended-gemma-profile").addEventListener("click", async () => {
        await saveRecommendedGemmaProfile();
      });

      document.getElementById("local-reasoner-profile-activate-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = buildLocalReasonerProfileActivatePayloadFromForm();
        await activateLocalReasonerProfile(body.profileId, {
          dryRun: body.dryRun,
          sourceWindowId: body.sourceWindowId,
          updatedByWindowId: body.updatedByWindowId,
          updatedByAgentId: body.updatedByAgentId,
        });
      });

      document.getElementById("local-reasoner-profile-delete-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = buildLocalReasonerProfileDeletePayloadFromForm();
        await deleteLocalReasonerProfile(body.profileId, { dryRun: body.dryRun });
      });

      document.getElementById("local-reasoner-restore-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await restoreLocalReasoner(buildLocalReasonerRestorePayloadFromForm());
      });

      document.getElementById("setup-package-prune-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await pruneSavedSetupPackages(buildSetupPackagePrunePayloadFromForm());
      });

      document.getElementById("decision-log-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        body.sourceWindowId = windowId;
        body.recordedByWindowId = windowId;
        body.recordedByAgentId = activeAgentId;
        applyOptionalListField(body, "tags");
        await request(`/api/agents/${activeAgentId}/runtime/decisions`, { method: "POST", body: JSON.stringify(body) });
        event.currentTarget.reset();
        await Promise.all([loadRuntime(activeAgentId), loadRehydrate(activeAgentId), loadContext(activeAgentId)]);
      });

      document.getElementById("evidence-ref-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        body.sourceWindowId = windowId;
        body.recordedByWindowId = windowId;
        body.recordedByAgentId = activeAgentId;
        applyOptionalListField(body, "tags");
        await request(`/api/agents/${activeAgentId}/runtime/evidence`, { method: "POST", body: JSON.stringify(body) });
        event.currentTarget.reset();
        await Promise.all([loadRuntime(activeAgentId), loadRehydrate(activeAgentId), loadContext(activeAgentId)]);
      });

      document.getElementById("conversation-minute-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = buildConversationMinutePayloadFromForm();
        await recordConversationMinuteEntry(activeAgentId, body);
        event.currentTarget.reset();
      });

      document.getElementById("runtime-search-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await loadRuntimeSearch(activeAgentId, buildRuntimeSearchOptionsFromForm());
      });

      document.getElementById("recovery-export-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await exportRecoveryBundle(buildRecoveryExportPayloadFromForm());
      });

      document.getElementById("recovery-import-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await importRecoveryBundle(buildRecoveryImportPayloadFromForm());
      });

      document.getElementById("recovery-verify-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await runRecoveryRehearsal(buildRecoveryVerifyPayloadFromForm());
      });

      document.getElementById("sandbox-action-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await executeSandboxAction(activeAgentId, buildSandboxActionPayloadFromForm());
      });

      document.getElementById("transcript-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await loadTranscript(activeAgentId, buildTranscriptOptionsFromForm());
      });

      document.getElementById("rehydrate-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        await loadRehydrate(activeAgentId, {
          resumeFromCompactBoundaryId: body.resumeFromCompactBoundaryId || null,
        });
      });

      document.getElementById("drift-check-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        body.turnCount = Number(body.turnCount || 0);
        body.estimatedContextChars = Number(body.estimatedContextChars || 0);
        applyOptionalListField(body, "referencedDecisionIds");
        applyOptionalListField(body, "referencedEvidenceRefIds");
        await runDriftCheck(activeAgentId, body);
      });

      document.getElementById("passport-memory-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!activeAgentId) {
          throw new Error("请先绑定当前窗口到一个 Agent");
        }

        const body = formDataToObject(event.currentTarget);
        const payload = {};
        if (body.field || body.value) {
          payload.field = body.field || null;
          payload.value = body.value || null;
        }

        await request(`/api/agents/${activeAgentId}/passport-memory`, {
          method: "POST",
          body: JSON.stringify({
            layer: body.layer,
            kind: body.kind,
            summary: body.summary,
            content: body.content,
            payload,
            tags: body.tags,
            sourceWindowId: windowId,
            recordedByAgentId: activeAgentId,
            recordedByWindowId: windowId,
          }),
        });

        event.currentTarget.reset();
        await Promise.all([
          loadPassportMemories(activeAgentId),
          loadContext(activeAgentId),
        ]);
        await runContextBuilder(activeAgentId, buildContextBuilderPayloadFromForm());
      });

      document.getElementById("passport-memory-quick-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!activeAgentId) {
          throw new Error("请先绑定当前窗口到一个 Agent");
        }

        const body = formDataToObject(event.currentTarget);
        await request(`/api/agents/${activeAgentId}/passport-memory`, {
          method: "POST",
          body: JSON.stringify({
            layer: "working",
            kind: "quick_note",
            summary: body.summary,
            content: body.content,
            payload: {},
            tags: body.tags,
            sourceWindowId: windowId,
            recordedByAgentId: activeAgentId,
            recordedByWindowId: windowId,
          }),
        });

        event.currentTarget.reset();
        await Promise.all([
          loadPassportMemories(activeAgentId),
          loadContext(activeAgentId),
        ]);
        await runContextBuilder(activeAgentId, buildContextBuilderPayloadFromForm());
      });

      document.getElementById("memory-compactor-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!activeAgentId) {
          throw new Error("请先绑定当前窗口到一个 Agent");
        }

        const body = formDataToObject(event.currentTarget);
        await request(`/api/agents/${activeAgentId}/memory-compactor`, {
          method: "POST",
          body: JSON.stringify({
            turns: parseConversationTurnLines(body.turns),
            writeConversationTurns: body.writeConversationTurns,
            sourceWindowId: windowId,
            recordedByAgentId: activeAgentId,
            recordedByWindowId: windowId,
          }),
        });

        await Promise.all([
          loadPassportMemories(activeAgentId),
          loadContext(activeAgentId),
        ]);
        await runContextBuilder(activeAgentId, buildContextBuilderPayloadFromForm());
      });

      document.getElementById("context-builder-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await runContextBuilder(activeAgentId, buildContextBuilderPayloadFromForm());
      });

      document.getElementById("context-builder-quick-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const quickForm = event.currentTarget;
        const fullForm = document.getElementById("context-builder-form");
        copyFormFields(quickForm, fullForm, [
          "currentGoal",
          "query",
          "recentConversationTurns",
        ]);
        await runContextBuilder(activeAgentId, buildContextBuilderPayloadFromForm("context-builder-quick-form"));
      });

      document.getElementById("response-verify-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        const verificationPayload = {
          responseText: body.responseText || "",
          claims: {
            agentId: body.agentId || null,
            parentAgentId: body.parentAgentId || null,
            walletAddress: body.walletAddress || null,
            role: body.role || null,
            displayName: body.displayName || null,
            authorizationThreshold:
              body.authorizationThreshold !== ""
                ? Number(body.authorizationThreshold || 0)
                : null,
          },
        };
        await runResponseVerifier(activeAgentId, verificationPayload);
      });

      document.getElementById("runner-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await executeRunner(activeAgentId, buildRunnerPayloadFromForm());
      });

      document.getElementById("verification-run-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await executeVerification(activeAgentId, buildVerificationRunPayloadFromForm());
      });

      document.getElementById("offline-replay-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await executeOfflineReplay(activeAgentId, buildOfflineReplayPayloadFromForm());
      });

      document.getElementById("memory-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        if (!activeAgentId) {
          throw new Error("请先绑定当前窗口到一个 Agent");
        }
        body.sourceWindowId = windowId;
        body.importance = Number(body.importance || 0.5);
        applyOptionalListField(body, "tags");
        await request(`/api/agents/${activeAgentId}/memories`, { method: "POST", body: JSON.stringify(body) });
        event.currentTarget.reset();
        await Promise.all([loadContext(activeAgentId), loadLedger()]);
      });

      document.getElementById("message-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        const targetAgentId = body.toAgentId;
        delete body.toAgentId;
        if (!activeAgentId) {
          throw new Error("请先绑定当前窗口到一个 Agent");
        }
        body.fromWindowId = windowId;
        body.fromAgentId = activeAgentId;
        applyOptionalListField(body, "tags");
        await request(`/api/agents/${targetAgentId}/messages`, { method: "POST", body: JSON.stringify(body) });
        event.currentTarget.reset();
        await Promise.all([loadContext(activeAgentId), loadLedger()]);
      });

      document.getElementById("proposal-create-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        body.policyAgentId = body.policyAgentId || activeAgentId;
        body.delaySeconds = Number(body.delaySeconds || 0);
        body.expiresInSeconds = Number(body.expiresInSeconds || 0);
        body.createdBy = activeAgentId;
        body.createdByAgentId = activeAgentId;
        body.createdByWindowId = windowId;
        body.sourceWindowId = windowId;
        applyOptionalListField(body, "approvals");
        applyJsonField(body, "payloadJson", {});
        body.payload = body.payloadJson;
        delete body.payloadJson;
        await request("/api/authorizations", { method: "POST", body: JSON.stringify(body) });
        event.currentTarget.reset();
        syncActiveAgentFields();
        await Promise.all([loadAgents(), loadLedger(), loadAuthorizations(activeAgentId), loadContext(activeAgentId)]);
      });

      document.getElementById("proposal-sign-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        const proposalId = body.proposalId;
        delete body.proposalId;
        body.approvedBy = activeAgentId;
        body.signedBy = activeAgentId;
        body.signedWindowId = windowId;
        body.sourceWindowId = windowId;
        applyOptionalListField(body, "approvals");
        await request(`/api/authorizations/${proposalId}/sign`, { method: "POST", body: JSON.stringify(body) });
        event.currentTarget.reset();
        await Promise.all([loadLedger(), loadAuthorizations(activeAgentId), loadContext(activeAgentId)]);
      });

      document.getElementById("proposal-execute-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        const proposalId = body.proposalId;
        delete body.proposalId;
        body.approvedBy = activeAgentId;
        body.executedBy = activeAgentId;
        body.executedWindowId = windowId;
        body.sourceWindowId = windowId;
        applyOptionalListField(body, "approvals");
        await request(`/api/authorizations/${proposalId}/execute`, { method: "POST", body: JSON.stringify(body) });
        event.currentTarget.reset();
        await Promise.all([loadAgents(), loadLedger(), loadAuthorizations(activeAgentId), loadContext(activeAgentId)]);
      });

      document.getElementById("proposal-revoke-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        const proposalId = body.proposalId;
        delete body.proposalId;
        body.approvedBy = activeAgentId;
        body.revokedBy = activeAgentId;
        body.revokedWindowId = windowId;
        body.sourceWindowId = windowId;
        applyOptionalListField(body, "approvals");
        await request(`/api/authorizations/${proposalId}/revoke`, { method: "POST", body: JSON.stringify(body) });
        event.currentTarget.reset();
        await Promise.all([loadLedger(), loadAuthorizations(activeAgentId), loadContext(activeAgentId)]);
      });

      document.getElementById("refresh-agents").addEventListener("click", loadAgents);
      document.getElementById("refresh-ledger").addEventListener("click", loadLedger);
      document.getElementById("refresh-context").addEventListener("click", async () => {
        await loadWindowBinding();
        await loadContext(activeAgentId);
        await loadAuthorizations(activeAgentId);
        await loadCredentialStatuses(activeAgentId);
        await loadRuntime(activeAgentId);
        await loadRehydrate(activeAgentId);
        await loadConversationMinutes(activeAgentId);
        await loadPassportMemories(activeAgentId);
        await loadArchivedRecords(activeAgentId, buildArchivesOptionsFromForm());
        await loadArchiveRestoreHistory(activeAgentId, buildArchiveRestoreOptionsFromForm());
        await loadAgentRuns(activeAgentId);
        await loadAgentSessionState(activeAgentId);
        await loadCompactBoundaries(activeAgentId);
        await loadVerificationRuns(activeAgentId);
        await loadTranscript(activeAgentId);
        await loadSandboxAudits(activeAgentId);
        await runContextBuilder(activeAgentId, buildContextBuilderPayloadFromForm());
      });
      document.getElementById("refresh-window").addEventListener("click", loadWindowBinding);
      document.getElementById("refresh-runtime").addEventListener("click", async () => {
        await loadAgentRuntimeSummary(activeAgentId).then((data) => {
          renderRuntimeQuickSummary(data?.summary || null);
        });
        await Promise.all([
          loadSecurityStatus(),
          loadRecoveryBundles(),
          loadRecoveryRehearsals(),
          loadDeviceSetupState(),
          previewSetupPackage(),
          loadSetupPackageList(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
          loadRuntime(activeAgentId),
          loadConversationMinutes(activeAgentId),
          loadTranscript(activeAgentId),
          loadSandboxAudits(activeAgentId),
        ]);
      });
      document.getElementById("refresh-cognitive-dynamics").addEventListener("click", async () => {
        await Promise.all([
          loadRuntime(activeAgentId),
          loadPassportMemories(activeAgentId),
        ]);
      });
      document.getElementById("download-cognitive-evidence").addEventListener("click", () => {
        if (!activeRuntime && !activeCognitiveTransitions && !activeOfflineReplayResult) {
          return;
        }
        downloadJsonFile(
          `${activeAgentId || "agent"}-cognitive-dynamics-evidence-pack.json`,
          buildCognitiveDynamicsEvidencePack()
        );
      });
      document.getElementById("refresh-sandbox-audits").addEventListener("click", async () => {
        await loadSandboxAudits(activeAgentId);
      });
      document.getElementById("admin-token-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        setStoredAdminToken(String(body.adminToken || "").trim());
        await Promise.all([
          loadSecurityStatus(),
          loadRecoveryBundles(),
          loadRecoveryRehearsals(),
          loadDeviceSetupState(),
          previewSetupPackage(),
          loadSetupPackageList(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
        ]);
      });
      document.getElementById("clear-admin-token").addEventListener("click", async () => {
        setStoredAdminToken("");
        const tokenInput = document.getElementById("admin-token-input");
        if (tokenInput) {
          tokenInput.value = "";
        }
        await Promise.all([
          loadSecurityStatus(),
          loadRecoveryBundles(),
          loadRecoveryRehearsals(),
          loadDeviceSetupState(),
          previewSetupPackage(),
          loadSetupPackageList(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
        ]);
      });
      document.getElementById("keychain-migration-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await runKeychainMigration(formDataToObject(event.currentTarget));
      });
      document.getElementById("refresh-read-sessions").addEventListener("click", async () => {
        await loadReadSessions();
      });
      document.getElementById("read-session-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        body.role = body.role || null;
        body.scopes = body.scopes || (body.role ? null : "agents");
        body.agentIds = body.agentIds ? String(body.agentIds).split(",").map((item) => item.trim()).filter(Boolean) : undefined;
        body.windowIds = body.windowIds ? String(body.windowIds).split(",").map((item) => item.trim()).filter(Boolean) : undefined;
        body.credentialIds = body.credentialIds ? String(body.credentialIds).split(",").map((item) => item.trim()).filter(Boolean) : undefined;
        body.ttlSeconds = Number(body.ttlSeconds || 28800);
        body.parentReadSessionId = body.parentReadSessionId || null;
        body.canDelegate =
          body.canDelegate === "true" ? true : body.canDelegate === "false" ? false : undefined;
        body.maxDelegationDepth =
          body.maxDelegationDepth === "" || body.maxDelegationDepth == null
            ? undefined
            : Number(body.maxDelegationDepth);
        const viewTemplates = {};
        if (body.deviceRuntimeView) {
          viewTemplates.deviceRuntime = body.deviceRuntimeView;
        }
        if (body.deviceSetupView) {
          viewTemplates.deviceSetup = body.deviceSetupView;
        }
        if (body.recoveryView) {
          viewTemplates.recovery = body.recoveryView;
        }
        if (body.agentRuntimeView) {
          viewTemplates.agentRuntime = body.agentRuntimeView;
        }
        if (body.transcriptView) {
          viewTemplates.transcript = body.transcriptView;
        }
        if (body.sandboxAuditsView) {
          viewTemplates.sandboxAudits = body.sandboxAuditsView;
        }
        body.viewTemplates = Object.keys(viewTemplates).length > 0 ? viewTemplates : undefined;
        delete body.deviceRuntimeView;
        delete body.deviceSetupView;
        delete body.recoveryView;
        delete body.agentRuntimeView;
        delete body.transcriptView;
        delete body.sandboxAuditsView;
        await createReadSessionEntry(body);
        event.currentTarget.reset();
      });
      document.getElementById("revoke-read-session-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        if (!body.readSessionId) {
          throw new Error("请输入要撤销的 readSessionId");
        }
        await revokeReadSessionEntry(body.readSessionId, {
          revokedByAgentId: activeAgentId,
          revokedByWindowId: windowId,
        });
        event.currentTarget.reset();
      });
      document.getElementById("refresh-rehydrate").addEventListener("click", async () => {
        const body = formDataToObject(document.getElementById("rehydrate-form"));
        await loadRehydrate(activeAgentId, {
          resumeFromCompactBoundaryId: body.resumeFromCompactBoundaryId || null,
        });
      });
      document.getElementById("refresh-passport-memories").addEventListener("click", async () => {
        await loadPassportMemories(activeAgentId);
      });
      document.getElementById("refresh-archives").addEventListener("click", async () => {
        await Promise.all([
          loadArchivedRecords(activeAgentId, buildArchivesOptionsFromForm()),
          loadArchiveRestoreHistory(activeAgentId, buildArchiveRestoreOptionsFromForm()),
        ]);
      });
      document.getElementById("archives-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await Promise.all([
          loadArchivedRecords(activeAgentId, buildArchivesOptionsFromForm()),
          loadArchiveRestoreHistory(activeAgentId, buildArchiveRestoreOptionsFromForm()),
        ]);
      });
      document.getElementById("archive-restores-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await loadArchiveRestoreHistory(activeAgentId, buildArchiveRestoreOptionsFromForm());
      });
      document.getElementById("export-archives-json").addEventListener("click", () => {
        if (!activeArchivedState) {
          setArchiveActionStatus("当前没有可导出的归档结果。");
          return;
        }
        downloadJsonFile(`${activeAgentId || "agent"}-archives.json`, activeArchivedState);
        setArchiveActionStatus("已导出归档 JSON。");
      });
      document.getElementById("download-archives-evidence").addEventListener("click", () => {
        if (!activeArchivedState) {
          setArchiveActionStatus("当前没有可下载的归档证据包。");
          return;
        }
        downloadJsonFile(`${activeAgentId || "agent"}-archive-evidence-pack.json`, buildArchiveEvidencePack());
        setArchiveActionStatus("已下载归档证据包。");
      });
      document.getElementById("archives-actions").addEventListener("click", async (event) => {
        const replayButton = event.target.closest(".archive-replay");
        if (replayButton) {
          const index = Number(replayButton.dataset.archiveIndex || 0);
          replayArchivedRecord(index);
          return;
        }
        const restoreButton = event.target.closest(".archive-restore");
        if (!restoreButton) {
          return;
        }
        const index = Number(restoreButton.dataset.archiveIndex || 0);
        restoreButton.disabled = true;
        try {
          await restoreArchivedRecord(index);
        } finally {
          restoreButton.disabled = false;
        }
      });
      document.getElementById("archive-restores-actions").addEventListener("click", async (event) => {
        const button = event.target.closest(".archive-restore-revert");
        if (!button) {
          return;
        }
        const index = Number(button.dataset.restoreIndex || 0);
        button.disabled = true;
        try {
          await revertArchiveRestore(index);
        } finally {
          button.disabled = false;
        }
      });
      document.getElementById("export-archive-restores-json").addEventListener("click", () => {
        if (!activeArchiveRestoreHistory) {
          setArchiveActionStatus("当前没有可导出的恢复历史。");
          return;
        }
        downloadJsonFile(`${activeAgentId || "agent"}-archive-restores.json`, activeArchiveRestoreHistory);
        setArchiveActionStatus("已导出恢复历史 JSON。");
      });
      document.getElementById("download-archive-restores-evidence").addEventListener("click", () => {
        if (!activeArchiveRestoreHistory) {
          setArchiveActionStatus("当前没有可下载的恢复证据包。");
          return;
        }
        downloadJsonFile(`${activeAgentId || "agent"}-archive-restores-evidence-pack.json`, buildArchiveRestoreEvidencePack());
        setArchiveActionStatus("已下载恢复证据包。");
      });
      document.getElementById("run-context-builder").addEventListener("click", async () => {
        await runContextBuilder(activeAgentId, buildContextBuilderPayloadFromForm());
      });
      document.getElementById("refresh-runner-history").addEventListener("click", async () => {
        await loadAgentRuns(activeAgentId);
      });
      document.getElementById("auto-recovery-audit-filter").addEventListener("change", (event) => {
        activeAutoRecoveryAuditFilter = event.target.value || "all";
        renderAutoRecoveryAuditTimeline(activeRunnerHistory);
      });
      document.getElementById("auto-recovery-audit-list").addEventListener("click", (event) => {
        const selectButton = event.target.closest(".auto-recovery-audit-select");
        const downloadButton = event.target.closest(".auto-recovery-audit-download");
        const audits = Array.isArray(activeRunnerHistory?.autoRecoveryAudits) ? activeRunnerHistory.autoRecoveryAudits : [];

        if (selectButton) {
          const audit = findAutoRecoveryAuditById(audits, selectButton.dataset.auditId);
          if (!audit) {
            return;
          }
          renderAutoRecoveryAuditDetail(audit);
          renderAutoRecoveryAuditTimeline(activeRunnerHistory);
          return;
        }

        if (downloadButton) {
          const audit = findAutoRecoveryAuditById(audits, downloadButton.dataset.auditId);
          const summaryRoot = document.getElementById("auto-recovery-audit-summary");
          if (!audit) {
            if (summaryRoot) {
              summaryRoot.textContent = "未找到要导出的自动恢复闭环审计。";
            }
            return;
          }
          activeAutoRecoveryAudit = audit;
          downloadJsonFile(`${activeAgentId || "agent"}-${getAutoRecoveryAuditId(audit) || "auto-recovery-audit"}-evidence-pack.json`, buildAutoRecoveryAuditEvidencePack(audit));
          renderAutoRecoveryAuditDetail(audit);
          if (summaryRoot) {
            summaryRoot.textContent = `已导出闭环审计 ${getAutoRecoveryAuditId(audit) || audit.runId || "unknown"} 的证据包。`;
          }
        }
      });
      document.getElementById("export-auto-recovery-audits-json").addEventListener("click", () => {
        const audits = Array.isArray(activeRunnerHistory?.autoRecoveryAudits) ? activeRunnerHistory.autoRecoveryAudits : [];
        const summaryRoot = document.getElementById("auto-recovery-audit-summary");
        if (!audits.length) {
          if (summaryRoot) {
            summaryRoot.textContent = "当前没有可导出的自动恢复闭环审计。";
          }
          return;
        }
        downloadJsonFile(`${activeAgentId || "agent"}-auto-recovery-audits.json`, {
          counts: activeRunnerHistory?.counts || null,
          autoRecoveryAudits: audits,
        });
        if (summaryRoot) {
          summaryRoot.textContent = `已导出 ${audits.length} 条自动恢复闭环审计。`;
        }
      });
      document.getElementById("download-auto-recovery-audit-evidence").addEventListener("click", () => {
        const summaryRoot = document.getElementById("auto-recovery-audit-summary");
        if (!activeAutoRecoveryAudit) {
          if (summaryRoot) {
            summaryRoot.textContent = "请先从闭环审计列表中选中一条记录。";
          }
          return;
        }
        downloadJsonFile(`${activeAgentId || "agent"}-${getAutoRecoveryAuditId(activeAutoRecoveryAudit) || "auto-recovery-audit"}-evidence-pack.json`, buildAutoRecoveryAuditEvidencePack(activeAutoRecoveryAudit));
        if (summaryRoot) {
          summaryRoot.textContent = `已下载当前闭环审计 ${getAutoRecoveryAuditId(activeAutoRecoveryAudit) || activeAutoRecoveryAudit.runId || "unknown"} 的证据包。`;
        }
      });
      document.getElementById("refresh-session-state").addEventListener("click", async () => {
        await Promise.all([
          loadAgentSessionState(activeAgentId),
          loadCompactBoundaries(activeAgentId),
          loadTranscript(activeAgentId),
        ]);
      });
      document.getElementById("refresh-verification-history").addEventListener("click", async () => {
        await loadVerificationRuns(activeAgentId);
      });
      document.getElementById("refresh-window-context").addEventListener("click", async () => {
        await loadReferencedWindowContext(activeWindowContextId || windowId);
      });
      document.getElementById("focus-local-window-context").addEventListener("click", async (event) => {
        const targetWindowId = event.currentTarget.dataset.windowId || localWindowBinding?.windowId || windowId;
        setActiveWindowContextId(targetWindowId, { sync: false });
        await loadReferencedWindowContext(targetWindowId);
      });
      document.getElementById("follow-window-context-agent").addEventListener("click", async (event) => {
        const targetAgentId = event.currentTarget.dataset.agentId || activeWindowContextBinding?.agentId || null;
        const targetWindowId = event.currentTarget.dataset.windowId || activeWindowContextBinding?.windowId || null;
        if (!targetAgentId) {
          return;
        }

        activeAgentId = targetAgentId;
        try {
          localStorage.setItem(ACTIVE_AGENT_KEY, activeAgentId);
        } catch {}
        syncActiveAgentFields();
        syncDashboardViewSummary();
        if (targetWindowId) {
          setActiveWindowContextId(targetWindowId, { sync: false });
        }
        await Promise.all([
          loadContext(targetAgentId, { didMethod: activeDashboardDidMethod, sync: false }),
          loadAuthorizations(targetAgentId),
          loadCredentialStatuses(targetAgentId, { didMethod: activeDashboardDidMethod, resetRepairOffset: true }),
          loadReferencedWindowContext(targetWindowId || activeWindowContextId || windowId, { sync: false }),
          loadConversationMinutes(targetAgentId),
          loadPassportMemories(targetAgentId),
          loadArchivedRecords(targetAgentId, buildArchivesOptionsFromForm()),
          loadArchiveRestoreHistory(targetAgentId, buildArchiveRestoreOptionsFromForm()),
          loadAgentRuns(targetAgentId),
          loadAgentSessionState(targetAgentId),
          loadCompactBoundaries(targetAgentId),
          loadVerificationRuns(targetAgentId),
          loadTranscript(targetAgentId),
        ]);
        await loadAgentCredential(targetAgentId, { didMethod: activeDashboardDidMethod });
        await runContextBuilder(targetAgentId, buildContextBuilderPayloadFromForm());
        syncDashboardUrlState();
      });
      document.getElementById("refresh-authorizations").addEventListener("click", async () => {
        await loadAuthorizations(activeAgentId);
      });
      document.getElementById("refresh-credentials").addEventListener("click", async () => {
        await loadCredentialStatuses(activeAgentId);
        await loadContext(activeAgentId);
      });
      document.getElementById("refresh-status-list").addEventListener("click", async () => {
        const credentialId = activeCredentialRecord?.credentialRecordId || activeCredentialRecord?.credentialId || activeCredential?.id;
        await loadCredentialStatus(credentialId);
      });
      document.getElementById("dashboard-did-method").addEventListener("change", async (event) => {
        const nextDidMethod = normalizeDashboardDidMethod(event.currentTarget.value);
        setActiveDashboardDidMethod(nextDidMethod, { sync: false });
        await loadContext(activeAgentId, { didMethod: nextDidMethod, sync: false });
        await loadCredentialStatuses(activeAgentId, { didMethod: nextDidMethod, resetRepairOffset: true });
        await loadConversationMinutes(activeAgentId);
        await loadAgentRuns(activeAgentId);
        await loadAgentSessionState(activeAgentId);
        await loadCompactBoundaries(activeAgentId);
        await loadVerificationRuns(activeAgentId);
        await loadTranscript(activeAgentId);
        await loadSandboxAudits(activeAgentId);
        await runContextBuilder(activeAgentId, buildContextBuilderPayloadFromForm());
        if (
          activeCredentialRecord?.kind === "agent_identity" &&
          activeCredentialRecord?.subjectId === activeAgentId
        ) {
          await loadAgentCredential(activeAgentId, { didMethod: nextDidMethod });
          return;
        }
        syncDashboardUrlState();
      });
      document.getElementById("refresh-selected-status-list").addEventListener("click", async () => {
        await loadStatusListBrowser(getSelectedStatusListId(), activeStatusLists);
      });
      document.getElementById("refresh-status-list-compare").addEventListener("click", async () => {
        await loadStatusListComparison(getSelectedStatusListId(), getSelectedStatusListCompareId(), activeStatusLists);
      });
      document.getElementById("focus-active-status-list").addEventListener("click", async () => {
        const credentialStatusListId = currentCredentialStatusListId();
        if (!credentialStatusListId) {
          return;
        }
        await loadStatusListBrowser(credentialStatusListId, activeStatusLists);
      });
      document.getElementById("status-list-selector").addEventListener("change", async (event) => {
        await loadStatusListBrowser(event.currentTarget.value || null, activeStatusLists);
      });
      document.getElementById("status-list-compare-selector").addEventListener("change", async (event) => {
        await loadStatusListComparison(getSelectedStatusListId(), event.currentTarget.value || null, activeStatusLists);
      });

      document.getElementById("agent-compare-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        await loadAgentCompareDetail({
          leftAgentId: body.leftAgentId,
          rightAgentId: body.rightAgentId,
          issuerAgentId: body.issuerAgentId,
          issuerDidMethod: body.issuerDidMethod,
        });
      });

      document.getElementById("refresh-compare-detail").addEventListener("click", async () => {
        await loadAgentCompareDetail(activeCompareParams);
      });

      document.getElementById("credential-agent-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        await loadAgentCredential(body.agentId);
      });

      document.getElementById("credential-proposal-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formDataToObject(event.currentTarget);
        await loadAuthorizationCredential(body.proposalId);
      });

      document.getElementById("verify-credential").addEventListener("click", async () => {
        if (!activeCredential) {
          renderCredentialVerification(null);
          return;
        }

        const data = await request("/api/credentials/verify", {
          method: "POST",
          body: JSON.stringify({ credential: activeCredential }),
        });
        renderCredentialVerification(data.verification);
      });

      document.getElementById("show-recommended-view").addEventListener("click", () => {
        window.location.assign("/");
      });

      document.getElementById("show-full-view").addEventListener("click", () => {
        window.location.assign("/lab.html");
      });

      document.querySelectorAll("[data-scroll-target]").forEach((button) => {
        button.addEventListener("click", () => {
          const panelId = button.getAttribute("data-scroll-target");
          if (panelId) {
            scrollToPanel(panelId);
          }
        });
      });

      (async () => {
        const deepLinkedRepairId = parsedDashboardState.repairId || initialDashboardSearch.get("repairId");
        const deepLinkedCredentialId = parsedDashboardState.credentialId || initialDashboardSearch.get("credentialId");
        applyFriendlySelectLabels();
        setDashboardMode(initialDashboardMode);
        await Promise.all([
          loadCapabilityBoundary(),
          loadSecurityStatus(),
          loadReadSessions(),
          loadRecoveryBundles(),
          loadRecoveryRehearsals(),
          loadDeviceSetupState(),
          previewSetupPackage(),
          loadSetupPackageList(),
          loadLocalReasonerCatalog(),
          loadLocalReasonerProfiles(),
          loadLocalReasonerRestoreCandidates(),
          loadAgents(),
          loadLedger(),
        ]);
        await loadWindowBinding();
        if (!parsedDashboardState.agentId && !parsedDashboardState.windowId && localWindowBinding?.agentId) {
          setActiveAgent(localWindowBinding.agentId);
        }
        if (parsedDashboardState.windowId) {
          await loadReferencedWindowContext(parsedDashboardState.windowId, { sync: false });
        }
        await loadAgentRuntimeSummary(activeAgentId).then((data) => {
          renderRuntimeQuickSummary(data?.summary || null);
        });
        if (deepLinkedCredentialId) {
          await loadCredentialDetail(deepLinkedCredentialId, {
            repairId: deepLinkedRepairId,
            sync: false,
          });
        } else if (deepLinkedRepairId) {
          await loadMigrationRepairTimeline(deepLinkedRepairId, {
            sync: false,
            didMethod: activeDashboardDidMethod,
          });
        } else {
          await loadAgentCredential(activeAgentId);
        }
        await loadContext(activeAgentId);
        await loadRuntime(activeAgentId);
        await loadRehydrate(activeAgentId);
        await loadConversationMinutes(activeAgentId);
        await loadPassportMemories(activeAgentId);
        await loadArchivedRecords(activeAgentId, buildArchivesOptionsFromForm());
        await loadArchiveRestoreHistory(activeAgentId, buildArchiveRestoreOptionsFromForm());
        await loadAgentRuns(activeAgentId);
        await loadAgentSessionState(activeAgentId);
        await loadCompactBoundaries(activeAgentId);
        await loadVerificationRuns(activeAgentId);
        await loadTranscript(activeAgentId);
        await loadSandboxAudits(activeAgentId);
        await runContextBuilder(activeAgentId, buildContextBuilderPayloadFromForm());
        await loadAuthorizations(activeAgentId);
        await loadCredentialStatuses(activeAgentId);
        await loadAgentCompareDetail(activeCompareParams);
        syncDashboardUrlState();
      })();
