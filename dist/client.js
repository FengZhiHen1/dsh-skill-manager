window.__ModuleLoader__.load({ id: "dsh-skill-manager", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/core/model/contract.js
var ContractError = class extends Error {
  /**
   * @param {string} path 失配字段路径（如 value.lib.skills[2].dir）
   * @param {string} expect 期望形状描述
   * @param {unknown} actual 实际值
   */
  constructor(path, expect, actual) {
    const got = actual === null ? "null" : Array.isArray(actual) ? "array" : typeof actual;
    super(`RPC \u8F7D\u8377\u5951\u7EA6\u8FDD\u4F8B @${path}\uFF1A\u671F\u671B ${expect}\uFF0C\u5B9E\u9645 ${got}`);
    this.name = "ContractError";
    this.path = path;
  }
};
function need(cond, path, expect, actual) {
  if (!cond) throw new ContractError(path, expect, actual);
}
function needObj(v, path) {
  need(v !== null && typeof v === "object" && !Array.isArray(v), path, "object", v);
}
function needStr(v, path) {
  need(typeof v === "string", path, "string", v);
}
function needBool(v, path) {
  need(typeof v === "boolean", path, "boolean", v);
}
function needNum(v, path) {
  need(typeof v === "number" && Number.isFinite(v), path, "number", v);
}
function needStrOrNull(v, path) {
  need(v === null || typeof v === "string", path, "string|null", v);
}
function needBoolOrNull(v, path) {
  need(v === null || typeof v === "boolean", path, "boolean|null", v);
}
function needArr(v, path) {
  need(Array.isArray(v), path, "array", v);
  return v;
}
function needOneOf(v, path, allowed) {
  need(allowed.includes(v), path, allowed.join(" | "), v);
}
function opt(v, path, check) {
  if (v !== void 0) check(v, path);
}
function parseTargetKey(key) {
  const m = /^(dsh|pi):(global|project)\|(.+)$/.exec(String(key));
  return m === null ? null : { host: m[1], scope: m[2], project: m[3] };
}
function checkRecordShape(r, path) {
  needObj(r, path);
  needStr(r.checked_at, `${path}.checked_at`);
  needStr(r.repo, `${path}.repo`);
  needStrOrNull(r.branch, `${path}.branch`);
  needStrOrNull(r.current, `${path}.current`);
  needStrOrNull(r.latest, `${path}.latest`);
  needStr(r.status, `${path}.status`);
  needStrOrNull(r.reason, `${path}.reason`);
  needStrOrNull(r.via, `${path}.via`);
  needBool(r.updatable, `${path}.updatable`);
  needBool(r.reachable, `${path}.reachable`);
  needBoolOrNull(r.locally_modified, `${path}.locally_modified`);
  needBool(r.baseline_missing, `${path}.baseline_missing`);
  needBool(r.missing, `${path}.missing`);
}
function mountRowShape(row, path) {
  needObj(row, path);
  needStr(row.target, `${path}.target`);
  needStr(row.path, `${path}.path`);
  needStr(row.issue, `${path}.issue`);
}
function skillItemShape(it, path) {
  needObj(it, path);
  needStr(it.name, `${path}.name`);
  needStr(it.dir, `${path}.dir`);
  needStr(it.description, `${path}.description`);
  needOneOf(it.origin, `${path}.origin`, ["github", "local", "self"]);
  needBool(it.hasSkillMd, `${path}.hasSkillMd`);
  needStrOrNull(it.commit, `${path}.commit`);
  needBool(it.missing, `${path}.missing`);
  needBool(it.disabled, `${path}.disabled`);
  needStr(it.group, `${path}.group`);
  needBool(it.nameVisible, `${path}.nameVisible`);
  needArr(it.targets, `${path}.targets`).forEach((t, i) => needStr(t, `${path}.targets[${i}]`));
  needArr(it.mount, `${path}.mount`).forEach((row, i) => mountRowShape(row, `${path}.mount[${i}]`));
  if (it.upstream !== null) checkRecordShape(it.upstream, `${path}.upstream`);
}
function workspaceShape(ws, path) {
  needObj(ws, path);
  needStr(ws.workspaceId, `${path}.workspaceId`);
  needStr(ws.title, `${path}.title`);
  needStr(ws.path, `${path}.path`);
  needNum(ws.mountCount, `${path}.mountCount`);
}
function syncResultShape(s, path) {
  needObj(s, path);
  needArr(s.results, `${path}.results`).forEach((r, i) => needObj(r, `${path}.results[${i}]`));
  needArr(s.warnings, `${path}.warnings`).forEach((w, i) => needStr(w, `${path}.warnings[${i}]`));
  needArr(s.errors, `${path}.errors`).forEach((e, i) => needObj(e, `${path}.errors[${i}]`));
}
function checkItemShape(r, path) {
  needObj(r, path);
  needStr(r.name, `${path}.name`);
  needOneOf(r.status, `${path}.status`, ["skipped", "updatable", "up_to_date", "check_failed"]);
  needStrOrNull(r.reason ?? null, `${path}.reason`);
  if (r.status === "skipped") return;
  needStr(r.repo, `${path}.repo`);
  needStrOrNull(r.branch, `${path}.branch`);
  needStrOrNull(r.current, `${path}.current`);
  needStrOrNull(r.latest, `${path}.latest`);
  needStrOrNull(r.via, `${path}.via`);
  needBool(r.updatable, `${path}.updatable`);
  needBool(r.reachable, `${path}.reachable`);
  needBoolOrNull(r.locally_modified, `${path}.locally_modified`);
  needBool(r.baseline_missing, `${path}.baseline_missing`);
  needBool(r.missing, `${path}.missing`);
}
function updateItemShape(r, path) {
  needObj(r, path);
  needStr(r.name, `${path}.name`);
  needOneOf(r.status, `${path}.status`, ["skipped", "updated", "failed"]);
  opt(r.reason, `${path}.reason`, needStr);
  opt(r.commit, `${path}.commit`, needStr);
  opt(r.via, `${path}.via`, needStrOrNull);
  opt(r.upToDate, `${path}.upToDate`, needBool);
  opt(r.registrationFailed, `${path}.registrationFailed`, needBool);
}
var PARSERS = {
  overview(v, path) {
    needObj(v, path);
    needStr(v.root, `${path}.root`);
    needObj(v.lib, `${path}.lib`);
    needArr(v.lib.skills, `${path}.lib.skills`).forEach((it, i) => skillItemShape(it, `${path}.lib.skills[${i}]`));
    needArr(v.lib.warnings, `${path}.lib.warnings`).forEach((w, i) => needStr(w, `${path}.lib.warnings[${i}]`));
    needStrOrNull(v.lib.checkedAt, `${path}.lib.checkedAt`);
    needObj(v.health, `${path}.health`);
    needArr(v.health.issues, `${path}.health.issues`).forEach((issue, i) => {
      needObj(issue, `${path}.health.issues[${i}]`);
      needStr(issue.name, `${path}.health.issues[${i}].name`);
      needStr(issue.target, `${path}.health.issues[${i}].target`);
      needStr(issue.issue, `${path}.health.issues[${i}].issue`);
    });
    needArr(v.workspaces, `${path}.workspaces`).forEach((ws, i) => workspaceShape(ws, `${path}.workspaces[${i}]`));
    needObj(v.agents, `${path}.agents`);
    needObj(v.agents.pi, `${path}.agents.pi`);
    needBool(v.agents.pi.available, `${path}.agents.pi.available`);
    needStrOrNull(v.agents.pi.skillsRoot, `${path}.agents.pi.skillsRoot`);
  },
  warm(v, path) {
    needObj(v, path);
    needBool(v.ok, `${path}.ok`);
  },
  backups(v, path) {
    needArr(v, path).forEach((b, i) => {
      needObj(b, `${path}[${i}]`);
      needStr(b.id, `${path}[${i}].id`);
      needStr(b.name, `${path}[${i}].name`);
      needStr(b.time, `${path}[${i}].time`);
      needBool(b.has_meta, `${path}[${i}].has_meta`);
      needBool(b.meta_corrupt, `${path}[${i}].meta_corrupt`);
    });
  },
  search(v, path) {
    needObj(v, path);
    needStr(v.query, `${path}.query`);
    needNum(v.count, `${path}.count`);
    needArr(v.skills, `${path}.skills`).forEach((s, i) => {
      needObj(s, `${path}.skills[${i}]`);
      needStr(s.key, `${path}.skills[${i}].key`);
      needStr(s.name, `${path}.skills[${i}].name`);
      needStr(s.directory, `${path}.skills[${i}].directory`);
      needStr(s.repo, `${path}.skills[${i}].repo`);
      needNum(s.installs, `${path}.skills[${i}].installs`);
      needStr(s.url, `${path}.skills[${i}].url`);
    });
  },
  "repo-skills"(v, path) {
    needObj(v, path);
    needStr(v.repo, `${path}.repo`);
    needStr(v.branch, `${path}.branch`);
    needStr(v.commit, `${path}.commit`);
    needOneOf(v.via, `${path}.via`, ["api", "zipball"]);
    needArr(v.candidates, `${path}.candidates`).forEach((c, i) => {
      needObj(c, `${path}.candidates[${i}]`);
      needStr(c.path, `${path}.candidates[${i}].path`);
      needStr(c.name, `${path}.candidates[${i}].name`);
    });
  },
  add(v, path) {
    needObj(v, path);
    needStr(v.name, `${path}.name`);
    needStr(v.repo, `${path}.repo`);
    needStr(v.branch, `${path}.branch`);
    needStr(v.commit, `${path}.commit`);
    syncResultShape(v.sync, `${path}.sync`);
  },
  check(v, path) {
    needArr(v, path).forEach((r, i) => checkItemShape(r, `${path}[${i}]`));
  },
  update(v, path) {
    needObj(v, path);
    needArr(v.results, `${path}.results`).forEach((r, i) => updateItemShape(r, `${path}.results[${i}]`));
    if (v.sync !== null) syncResultShape(v.sync, `${path}.sync`);
  },
  remove(v, path) {
    needObj(v, path);
    needStr(v.name, `${path}.name`);
    needStrOrNull(v.backup, `${path}.backup`);
    needArr(v.detached, `${path}.detached`).forEach((d, i) => needStr(d, `${path}.detached[${i}]`));
  },
  restore(v, path) {
    needObj(v, path);
    needStr(v.name, `${path}.name`);
    if (v.sync !== null) syncResultShape(v.sync, `${path}.sync`);
  },
  sync: syncResultShape
};
function parseEndpointPayload(endpoint, value) {
  const parse = PARSERS[endpoint];
  if (!parse) throw new ContractError("value", "\u5DF2\u767B\u8BB0\u7AEF\u70B9", endpoint);
  parse(value, "value");
  return value;
}

// src/client/api.js
var CHANNEL = "/skill-manager";
var API_TIMEOUT_MS = 15e3;
var DOWNLOAD_TIMEOUT_MS = 9e4;
var DOWNLOAD_ENDPOINTS = /* @__PURE__ */ new Set(["add", "update"]);
var RpcError = class extends Error {
  /** @type {string} 稳定错误码，取自 Host 侧错误码表；transport = 通道层失败 */
  code;
  /** @type {boolean} Host details.retryable（transport 一律视为可重试） */
  retryable;
  /** @type {{operation:string,summary:string,facts:Array<{label:string,value:string}>,recommendation:string[]}|null} */
  repair;
  constructor(message, { code = "internal", retryable = false, repair = null } = {}) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.retryable = retryable;
    this.repair = repair;
  }
};
function toTransportError(error, endpoint, budgetMs = API_TIMEOUT_MS) {
  if (error instanceof RpcError) return error;
  const aborted = Boolean(error && (error.name === "AbortError" || error.name === "TimeoutError"));
  const message = aborted ? `\u8C03\u7528 ${endpoint} \u8D85\u65F6\uFF08${budgetMs / 1e3}s\uFF09\uFF1A\u7ED3\u679C\u672A\u77E5\u2014\u2014signal \u4E0D\u900F\u4F20\uFF0CHost \u5199\u64CD\u4F5C\u4E0D\u88AB\u5BA2\u6237\u7AEF\u53D6\u6D88\u6253\u65AD\uFF0C\u8BF7\u5237\u65B0\u6838\u5BF9\u73B0\u573A\u540E\u518D\u51B3\u5B9A\u662F\u5426\u91CD\u8BD5\u3002` : `\u4E0E Host \u7684 RPC \u901A\u9053\u5931\u8D25\uFF08${endpoint}\uFF09\uFF1A${error && error.message ? error.message : String(error)}`;
  const err = new RpcError(message, { code: "transport", retryable: true, repair: null });
  return err;
}
function createCall(ctx) {
  return async (endpoint, payload = {}) => {
    const budget = DOWNLOAD_ENDPOINTS.has(endpoint) ? DOWNLOAD_TIMEOUT_MS : API_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget);
    let result;
    try {
      result = await ctx.connection.rpc.call(CHANNEL, endpoint, payload, controller.signal);
    } catch (error) {
      throw toTransportError(error, endpoint, budget);
    } finally {
      clearTimeout(timer);
    }
    if (result && typeof result === "object" && result.ok === true) {
      try {
        return parseEndpointPayload(endpoint, result.value);
      } catch (error) {
        if (error instanceof ContractError) {
          throw new RpcError(error.message, { code: "contract-violation", retryable: false, repair: null });
        }
        throw error;
      }
    }
    const failure = result && typeof result === "object" && result.error ? result.error : {};
    const details = failure.details && typeof failure.details === "object" ? failure.details : {};
    throw new RpcError(failure.message || "\u8BF7\u6C42\u5931\u8D25", {
      code: failure.code || "internal",
      retryable: details.retryable === true,
      repair: details.repair && typeof details.repair === "object" ? details.repair : null
    });
  };
}

// src/client/section.jsx
var import_react5 = require("react");

// src/client/theme.js
var T = {
  bgBase: "var(--dsw-alias-bg-base)",
  bgLayer2: "var(--dsw-alias-bg-layer-2)",
  bgLayer3: "var(--dsw-alias-bg-layer-3)",
  bgModulePlatform: "var(--dsw-alias-bg-module-platform)",
  borderL1: "var(--dsw-alias-border-l1)",
  borderL2: "var(--dsw-alias-border-l2)",
  brand: "var(--dsw-alias-brand-primary)",
  labelPrimary: "var(--dsw-alias-label-primary)",
  labelSecondary: "var(--dsw-alias-label-secondary)",
  labelTertiary: "var(--dsw-alias-label-tertiary)",
  labelDimmed: "var(--dsw-alias-label-dimmed)",
  success: "var(--dsw-alias-state-success-primary)",
  error: "var(--dsw-alias-state-error-primary)",
  warn: "var(--dsw-alias-state-warn-primary)"
};
var badgeStyle = (color) => ({
  color,
  background: `color-mix(in srgb, ${color} 15%, transparent)`
});
var pillBase = {
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: 999,
  fontSize: 11,
  lineHeight: "17px",
  background: T.bgModulePlatform,
  color: T.labelSecondary,
  whiteSpace: "nowrap"
};
var statusPillStyle = (kind) => {
  if (kind === "updatable") return { ...pillBase, color: T.labelPrimary, fontWeight: 500 };
  if (kind === "warn") return { ...pillBase, ...badgeStyle(T.warn) };
  if (kind === "error") return { ...pillBase, ...badgeStyle(T.error) };
  return pillBase;
};
var S = {
  row: { display: "flex", alignItems: "center", gap: "8px", padding: "9px 12px", border: `1px solid ${T.borderL1}`, borderRadius: 12, marginBottom: 8, fontSize: 13 },
  panel: { padding: "10px 12px" },
  /** 高密度列表行（容器卡 + 分隔线用法）：比 S.row 描边卡轻，行内不再带边框。 */
  listRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 13 },
  /** 筛选器触发钮（宿主 Menu 的 anchor）：浅底小圆角，与工具条输入框同高。 */
  filterTrigger: { display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: T.bgModulePlatform, borderRadius: 8, padding: "5px 10px", font: "inherit", fontSize: 12, color: T.labelPrimary, cursor: "pointer" },
  muted: { color: T.labelSecondary, fontSize: 12 },
  guide: { padding: "24px 16px", textAlign: "center", color: T.labelSecondary, fontSize: 13 },
  toolbar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }
};
var cardStyle = { border: `1px solid ${T.borderL1}`, borderRadius: 12, background: T.bgLayer3 };
var subCardStyle = { borderRadius: 10, background: T.bgModulePlatform };
var dotStyle = (color) => ({ width: 7, height: 7, borderRadius: 4, background: color, flex: "none" });
var sectionHead = { fontSize: 14, fontWeight: 600, color: T.labelPrimary };
var cardTitle = { fontSize: 13, fontWeight: 600, color: T.labelPrimary };
var noteText = { fontSize: 11, color: T.labelSecondary };
var dividerStyle = { height: 1, background: T.borderL1, flex: "none" };
var navItemStyle = { display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 10px", border: "none", borderRadius: 8, background: "transparent", font: "inherit", fontSize: 13, cursor: "pointer", color: T.labelSecondary };
var navItemActiveStyle = { background: T.bgModulePlatform, color: T.labelPrimary, fontWeight: 500 };

// src/client/ui.jsx
var import_react = require("react");
var primitives = __toESM(require("@deepseek-ai/dsh-client-ui-primitives"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime = require("react/jsx-runtime");
var ChevronIcon = typeof primitives.IconChevronDownOutline14 === "function" ? primitives.IconChevronDownOutline14 : null;
var ToastImpl = typeof primitives.Toast === "function" ? primitives.Toast : null;
function useToast() {
  const [toast, setToast] = (0, import_react.useState)(null);
  const show = (text) => setToast((t) => ({ seq: (t?.seq ?? 0) + 1, text }));
  return [toast, show, () => setToast(null)];
}
function ToastHost({ toast, onDone }) {
  if (!toast) return null;
  if (ToastImpl) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToastImpl, { text: toast.text, onDone }, toast.seq);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FallbackToast, { text: toast.text, onDone }, toast.seq);
}
function FallbackToast({ text, onDone }) {
  const [fade, setFade] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    const t1 = setTimeout(() => setFade(true), 3e3);
    const t2 = setTimeout(onDone, 4e3);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "div",
    {
      role: "status",
      style: {
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1200,
        background: T.bgLayer3,
        color: T.labelPrimary,
        border: `1px solid ${T.borderL2}`,
        borderRadius: 10,
        padding: "8px 14px",
        fontSize: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,.18)",
        opacity: fade ? 0 : 1,
        transition: "opacity 1s"
      },
      children: text
    }
  );
}
var GhostBtn = (props) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "ghost", size: "sm", ...props });
var OutlineBtn = (props) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", ...props });
var PrimaryBtn = (props) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", size: "sm", ...props });
function ErrorLine({ error }) {
  if (!error) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...badgeStyle(T.error), borderRadius: 10, padding: "9px 12px", marginBottom: 8, fontSize: 12, display: "flex", alignItems: "flex-start", gap: 8 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...dotStyle(T.error), marginTop: 5, flex: "none" } }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1, minWidth: 0, wordBreak: "break-word", lineHeight: 1.55 }, children: String(error.message || error) })
  ] });
}
function NoticeBar({ notice }) {
  if (!notice) return null;
  if (notice.tone !== "warn") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...S.muted, marginBottom: 6 }, children: notice.text });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...badgeStyle(T.warn), borderRadius: 10, padding: "9px 12px", marginBottom: 8, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: dotStyle(T.warn) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1 }, children: notice.text })
  ] });
}
function useTick() {
  const [tick, setTick] = (0, import_react.useState)(0);
  return [tick, () => setTick((t) => t + 1)];
}
function MenuItem({ label, danger, disabled, onClick, onEnter, trailing, children }) {
  const [hover, setHover] = (0, import_react.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      style: {
        position: "relative",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        padding: "7px 12px",
        borderRadius: 6,
        fontSize: 12,
        whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer",
        color: danger ? T.error : T.labelPrimary,
        background: hover && !disabled ? T.bgModulePlatform : "transparent"
      },
      onClick: disabled ? void 0 : (event) => onClick?.(event.currentTarget.getBoundingClientRect()),
      onMouseEnter: (event) => {
        setHover(true);
        if (onEnter) onEnter(event.currentTarget.getBoundingClientRect());
      },
      onMouseLeave: () => setHover(false),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label }),
        trailing || null,
        children
      ]
    }
  );
}
var menuCardStyle = {
  position: "absolute",
  zIndex: 41,
  minWidth: 150,
  background: T.bgLayer3,
  border: `1px solid ${T.borderL2}`,
  borderRadius: 12,
  boxShadow: "0 8px 24px rgba(0,0,0,.18)",
  padding: 6
};
var menuDivider = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { height: 1, margin: "5px 6px", background: T.borderL2 } });
function RowMenu({ it, groupNames, flags = [], busy, onAction, onMove, onClose, triggerRect }) {
  const menuRef = (0, import_react.useRef)(null);
  const [sub, setSub] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    const onScroll = (event) => {
      if (menuRef.current && menuRef.current.contains(event.target)) setSub(null);
      else onClose();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, []);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceBelow = vh - triggerRect.bottom - 12;
  const spaceAbove = triggerRect.top - 12;
  const dropDown = spaceBelow >= Math.min(260, spaceAbove);
  const menuStyle = {
    ...menuCardStyle,
    position: "fixed",
    right: Math.max(8, vw - triggerRect.right),
    maxHeight: Math.max(160, dropDown ? spaceBelow : spaceAbove),
    overflowY: "auto",
    ...dropDown ? { top: triggerRect.bottom + 6 } : { bottom: vh - triggerRect.top + 6 }
  };
  let subStyle = null;
  if (sub) {
    const openLeft = sub.rect.left > 160;
    const subBelow = vh - sub.rect.top - 12;
    const subAbove = sub.rect.bottom - 12;
    const subDown = subBelow >= Math.min(200, subAbove);
    subStyle = {
      ...menuCardStyle,
      position: "fixed",
      zIndex: 42,
      minWidth: 124,
      maxHeight: Math.max(140, subDown ? subBelow : subAbove),
      overflowY: "auto",
      ...openLeft ? { right: Math.max(8, vw - sub.rect.left + 6) } : { left: sub.rect.right + 6 },
      ...subDown ? { top: sub.rect.top - 7 } : { bottom: Math.max(8, vh - sub.rect.bottom - 7) }
    };
  }
  const current = it.group || "\u9ED8\u8BA4";
  const allGroups = [.../* @__PURE__ */ new Set([...groupNames, "\u9ED8\u8BA4"])];
  const external = it.origin === "github";
  const pick = (group) => {
    if (group !== current) onMove(group);
    onClose();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { position: "fixed", inset: 0, zIndex: 40 }, onClick: onClose }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: menuRef, style: menuStyle, children: [
      flags.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { padding: "5px 12px", fontSize: 11, color: T.labelSecondary, whiteSpace: "nowrap" }, children: flags.join(" \xB7 ") }),
        menuDivider
      ] }),
      it.missing && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { padding: "6px 12px", fontSize: 11, lineHeight: 1.55, color: T.labelSecondary, maxWidth: 240 }, children: "\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF08\u5982\u88AB\u624B\u52A8\u8FC1\u8D70\uFF09\uFF0C\u5165\u5E93\u8BB0\u5F55\u4ECD\u4FDD\u7559\uFF1A\u300C\u6062\u590D\u300D\u6309\u4E0A\u6E38\u91CD\u65B0\u4E0B\u8F7D\u56DE\u5E93\uFF1B\u300C\u5220\u9664\u300D\u6E05\u9664\u8BB0\u5F55\u4E0E\u7F13\u5B58\uFF0C\u4E0D\u5F71\u54CD\u4F60\u5DF2\u8FC1\u51FA\u7684\u526F\u672C\u3002" }),
        menuDivider
      ] }),
      it.missing ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MenuItem, { label: "\u6062\u590D", disabled: busy, onClick: () => {
        onClose();
        onAction("update");
      } }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        external && !it.disabled && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MenuItem, { label: "\u7ACB\u5373\u66F4\u65B0", disabled: busy, onClick: () => {
          onClose();
          onAction("update");
        } }),
        it.disabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MenuItem, { label: "\u542F\u7528", disabled: busy, onClick: () => {
          onClose();
          onAction("enable");
        } }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MenuItem, { label: "\u7981\u7528", disabled: busy, onClick: () => {
          onClose();
          onAction("disable");
        } })
      ] }),
      !it.missing && menuDivider,
      !it.missing && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        MenuItem,
        {
          label: "\u79FB\u52A8\u5230\u5206\u7EC4",
          disabled: busy,
          onEnter: (rect) => setSub({ rect }),
          onClick: (rect) => setSub((v) => v ? null : { rect }),
          trailing: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: T.labelSecondary }, children: "\u25B8" })
        }
      ),
      external && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        menuDivider,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MenuItem, { label: "\u5220\u9664", danger: true, disabled: busy, onClick: () => {
          onClose();
          onAction("remove");
        } })
      ] })
    ] }),
    sub && subStyle && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: subStyle, children: allGroups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 12px",
          borderRadius: 6,
          fontSize: 12,
          whiteSpace: "nowrap",
          cursor: "pointer",
          color: group === current ? T.labelPrimary : T.labelSecondary,
          fontWeight: group === current ? 500 : 400
        },
        onClick: (event) => {
          event.stopPropagation();
          pick(group);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { width: 12, color: T.labelPrimary }, children: group === current ? "\u2713" : "" }),
          group
        ]
      },
      group
    )) })
  ] });
}
function ModalShell({ title, width = 480, onMaskClick, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "div",
    {
      role: "presentation",
      style: { position: "fixed", inset: 0, zIndex: 1e3, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15, 17, 21, .42)", padding: 20 },
      onClick: onMaskClick,
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "div",
        {
          role: "dialog",
          "aria-modal": "true",
          "aria-label": title,
          style: { width: `min(${width}px, 100%)`, borderRadius: 16, border: `1px solid ${T.borderL2}`, background: T.bgLayer3, color: T.labelPrimary, boxShadow: "0 18px 48px rgba(0,0,0,.28)", padding: 20 },
          onClick: (e) => e.stopPropagation(),
          children
        }
      )
    }
  );
}
function UpdateConfirmationDialog({ name, detail, busy, onCancel, onConfirm }) {
  const [acknowledged, setAcknowledged] = (0, import_react.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ModalShell, { title: `\u66F4\u65B0 ${name}\uFF1F`, onMaskClick: onCancel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 16, fontWeight: 600, marginBottom: 8 }, children: `\u66F4\u65B0 ${name}\uFF1F` }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: T.labelSecondary, fontSize: 13, lineHeight: 1.55, marginBottom: 12 }, children: detail || "\u68C0\u6D4B\u5230\u4E0E\u5185\u5BB9\u57FA\u7EBF\u4E0D\u540C\u7684\u672C\u5730\u4FEE\u6539\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { borderRadius: 10, padding: "10px 12px", marginBottom: 14, ...badgeStyle(T.warn), fontSize: 12, lineHeight: 1.55 }, children: "\u66F4\u65B0\u4F1A\u66FF\u6362\u6B64 Skill \u76EE\u5F55\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u5907\u4EFD\u672C\u5730\u4FEE\u6539\u3002\u8BF7\u5148\u81EA\u884C\u5907\u4EFD\u9700\u8981\u4FDD\u7559\u7684\u5185\u5BB9\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.labelSecondary, marginBottom: 16, cursor: "pointer" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: acknowledged, onChange: (event) => setAcknowledged(event.target.checked) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: T.labelPrimary }, children: "\u6211\u5DF2\u786E\u8BA4\u8986\u76D6\u672C\u5730\u4FEE\u6539\uFF1B\u7EE7\u7EED\u540E\u4F1A\u5237\u65B0\u4E0A\u6E38\u57FA\u7EBF\u4E0E DSH \u6302\u8F7D\u3002" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(OutlineBtn, { onClick: onCancel, disabled: busy, children: "\u53D6\u6D88" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PrimaryBtn, { onClick: onConfirm, disabled: busy || !acknowledged, children: busy ? "\u66F4\u65B0\u4E2D\u2026" : "\u7EE7\u7EED\u66F4\u65B0" })
    ] })
  ] });
}
function ConfirmDialog({ title, body, warning, confirmLabel, busy = false, onCancel, onConfirm }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ModalShell, { title, width: 420, onMaskClick: busy ? void 0 : onCancel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 16, fontWeight: 600, marginBottom: 8 }, children: title }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: T.labelSecondary, fontSize: 13, lineHeight: 1.55, marginBottom: 12 }, children: body }),
    warning ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { borderRadius: 10, padding: "10px 12px", marginBottom: 14, ...badgeStyle(T.warn), fontSize: 12, lineHeight: 1.55 }, children: warning }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(OutlineBtn, { onClick: onCancel, disabled: busy, children: "\u53D6\u6D88" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PrimaryBtn, { onClick: onConfirm, disabled: busy, children: busy ? "\u5904\u7406\u4E2D\u2026" : confirmLabel })
    ] })
  ] });
}

// src/client/repair.jsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime2 = require("react/jsx-runtime");
async function copyText(text) {
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy") === true;
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return fallback();
    }
  }
  return fallback();
}
function fallbackRepair({ operation = "unknown", code = "internal", message = "" } = {}) {
  const LOCAL_META = {
    transport: {
      // 措辞诚实化：signal 不透传，Host 写操作不被客户端取消打断——超时后结果未知，不谎称「未送达」
      summary: "\u4E0E Host \u7684 RPC \u901A\u9053\u4E2D\u65AD\uFF1A\u8BF7\u6C42\u662F\u5426\u5230\u8FBE\u5E76\u751F\u6548\u4E0D\u53EF\u77E5\uFF08\u5BA2\u6237\u7AEF\u53D6\u6D88/\u8D85\u65F6\u4E0D\u6253\u65AD Host \u4FA7\u5DF2\u5F00\u59CB\u7684\u5199\u64CD\u4F5C\uFF09\u3002",
      recommendation: [
        "\u5148\u5237\u65B0\u9875\u9762\u6838\u5BF9\u73B0\u573A\uFF08\u6280\u80FD\u5217\u8868\u4E0E\u76EE\u5F55\u662F\u5426\u5DF2\u53D8\u5316\uFF09\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u91CD\u8BD5\u2014\u2014\u975E\u5E42\u7B49\u64CD\u4F5C\u76F4\u63A5\u91CD\u8BD5\u53EF\u80FD\u91CD\u590D\u6267\u884C",
        "\u786E\u8BA4 DSH \u5B9E\u4F8B\u4ECD\u5728\u8FD0\u884C\u4E14\u672C\u63D2\u4EF6\u5DF2\u52A0\u8F7D",
        "\u628A\u672C\u63D0\u793A\u8BCD\u4EA4\u7ED9\u672C\u5730 Agent\uFF1A\u53EA\u8BFB\u68C0\u67E5\u63D2\u4EF6\u52A0\u8F7D\u65E5\u5FD7\u4E0E settings.yaml \u7684 skill-manager \u6BB5"
      ]
    },
    "contract-violation": {
      summary: "Host \u8FD4\u56DE\u7684\u6570\u636E\u5F62\u72B6\u4E0E\u5951\u7EA6\u4E0D\u7B26\uFF08Host \u4E0E Client \u7248\u672C\u4E0D\u5339\u914D\uFF0C\u6216 Host \u7AEF Bug\uFF09\u3002",
      recommendation: ["\u5237\u65B0\u9875\u9762\u91CD\u8F7D\u5BA2\u6237\u7AEF", "\u4ECD\u590D\u73B0\u65F6\u6838\u5BF9 Host \u4E0E\u63D2\u4EF6\u5305\u7248\u672C\u4E00\u81F4", "\u628A\u672C\u63D0\u793A\u8BCD\u4EA4\u7ED9\u672C\u5730 Agent\uFF1A\u53EA\u8BFB\u6838\u5BF9 contract.js \u58F0\u660E\u4E0E\u5B9E\u9645\u8FD4\u56DE"]
    }
  };
  const meta = LOCAL_META[code] ?? {
    summary: `\u64CD\u4F5C\u5931\u8D25\uFF08${code}\uFF09\u3002`,
    recommendation: ["\u5148\u539F\u6837\u91CD\u8BD5\u4E00\u6B21\uFF08\u5076\u53D1\u5931\u8D25\u53EF\u80FD\u81EA\u884C\u6062\u590D\uFF09", "\u4ECD\u5931\u8D25\u65F6\u628A\u672C\u63D0\u793A\u8BCD\u4EA4\u7ED9\u672C\u5730 Agent\uFF1A\u53EA\u8BFB\u6392\u67E5\u4E0A\u4E0B\u6587\u6D89\u53CA\u7684\u8DEF\u5F84\u4E0E\u914D\u7F6E\uFF1B\u4EFB\u4F55\u5199\u64CD\u4F5C\u987B\u5148\u5411\u7528\u6237\u786E\u8BA4"]
  };
  return {
    operation,
    summary: meta.summary,
    facts: message ? [{ label: "\u901A\u9053\u9519\u8BEF", value: message }] : [],
    recommendation: meta.recommendation
  };
}
function buildRepairPrompt({ root, code, message, repair }) {
  const r = repair && typeof repair === "object" ? repair : fallbackRepair({ operation: code, code, message });
  const lines = [
    `\u4EFB\u52A1\uFF1A\u4FEE\u590D DSH \u63D2\u4EF6 dsh-skill-manager \u7684\u64CD\u4F5C\u5931\u8D25\uFF08${r.operation || code || "unknown"}\uFF09\u3002`,
    "",
    `\u9519\u8BEF\u7801\uFF1A${code || r.operation || "unknown"}`,
    `\u9519\u8BEF\u6D88\u606F\uFF1A${message || r.summary || "\uFF08\u65E0\uFF09"}`,
    `\u95EE\u9898\u6982\u8FF0\uFF1A${r.summary || "\uFF08\u65E0\uFF09"}`,
    `\u914D\u7F6E\u76EE\u5F55\uFF08skillsDir\uFF09\uFF1A${root || "\uFF08\u672A\u77E5\uFF0C\u8BF7\u4ECE $DSH_HOME/settings.yaml \u7684 skill-manager \u6BB5\u8BFB\u53D6\uFF09"}`,
    "",
    "\u4E0A\u4E0B\u6587\u6E05\u5355\uFF1A"
  ];
  const facts = Array.isArray(r.facts) ? r.facts : [];
  if (facts.length === 0) lines.push("- \uFF08\u65E0\u9644\u52A0\u4E8B\u5B9E\uFF09");
  for (const f of facts) lines.push(`- ${f.label}\uFF1A${f.value}`);
  const rec = Array.isArray(r.recommendation) ? r.recommendation : [];
  if (rec.length > 0) {
    lines.push("", "\u63A8\u8350\u5904\u7406\u65B9\u6848\uFF1A");
    rec.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  }
  lines.push("", "\u8981\u6C42\uFF1A\u6392\u67E5\u4EC5\u505A\u53EA\u8BFB\u68C0\u67E5\uFF1B\u4EFB\u4F55\u5199/\u5220\u64CD\u4F5C\u524D\u5FC5\u987B\u5148\u5411\u7528\u6237\u786E\u8BA4\u65B9\u6848\u3002");
  return lines.join("\n");
}
function RepairCopy({ text, label = "\u590D\u5236\u4FEE\u590D\u63D0\u793A\u8BCD" }) {
  const [result, setResult] = (0, import_react2.useState)(null);
  (0, import_react2.useEffect)(() => {
    if (!result) return void 0;
    const timer = setTimeout(() => setResult(null), 1600);
    return () => clearTimeout(timer);
  }, [result]);
  const click = () => {
    copyText(text).then((ok) => setResult(ok ? "copied" : "failed"));
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    import_dsh_client_ui_primitives2.Button,
    {
      size: "sm",
      variant: "outline",
      onClick: click,
      style: { fontSize: 11, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0 },
      children: result === "copied" ? "\u5DF2\u590D\u5236" : result === "failed" ? "\u590D\u5236\u5931\u8D25" : label
    }
  );
}
var MOUNT_ISSUE_META = {
  "link-missing": {
    summary: "\u671F\u671B\u7684\u6302\u8F7D\u94FE\u63A5\u7F3A\u5931\uFF1A\u5BF9\u8D26\u672A\u80FD\u5728\u8BE5\u76EE\u6807\u5EFA\u7ACB junction\u3002",
    recommendation: ["\u786E\u8BA4\u76EE\u6807\u6839\u76EE\u5F55\u53EF\u5199\uFF08DSH \u5168\u5C40\u6839\u6216\u5DE5\u4F5C\u533A .dsh/skills\uFF09", "\u70B9\u5DE5\u5177\u6761\u300C\u21BB \u5237\u65B0\u300D\u518D\u89E6\u53D1\u4E00\u6B21\u5BF9\u8D26", "\u6301\u7EED\u5931\u8D25\u65F6\u628A\u672C\u63D0\u793A\u8BCD\u4EA4\u7ED9\u672C\u5730 Agent \u53EA\u8BFB\u6392\u67E5\u76EE\u6807\u5377\u4E0E\u6743\u9650"]
  },
  "target-occupied": {
    summary: "\u6302\u8F7D\u76EE\u6807\u88AB\u771F\u5B9E\u76EE\u5F55\u5360\u7528\uFF08\u542B\u65E7\u7248\u672C\u590D\u5236\u7269\u5316\u7684\u9057\u7559\uFF09\uFF1B\u6309\u53EA\u8BFB\u7EA2\u7EBF\u63D2\u4EF6\u4E0D\u89E6\u78B0\u5B83\u3002",
    recommendation: ["\u6253\u5F00\u5360\u7528\u76EE\u5F55\u786E\u8BA4\u5185\u5BB9\uFF1A\u65E7\u7248\u6B8B\u7559\u6216\u4E00\u6B21\u6027\u76EE\u5F55\uFF0C\u81EA\u884C\u5907\u4EFD\u540E\u5220\u9664", "\u5220\u9664\u540E\u70B9\u300C\u21BB \u5237\u65B0\u300D\u89E6\u53D1\u5BF9\u8D26\uFF0C\u7A7A\u95F2\u76EE\u6807\u81EA\u52A8\u91CD\u5EFA junction", "\u82E5\u662F\u6709\u610F\u4FDD\u7559\u7684\u672C\u5730\u906E\u853D\u7248\u672C\uFF0C\u53EF\u4E0D\u5904\u7406\u2014\u2014DSH \u4EE5\u9879\u76EE\u5185\u672C\u5730\u7248\u4E3A\u51C6"]
  },
  "wrong-target": {
    summary: "\u6302\u8F7D\u76EE\u6807\u662F\u94FE\u63A5\u4F46\u6307\u5411\u5E93\u5916\uFF1B\u89C6\u4E3A\u4ED6\u4EBA\u8D44\u4EA7\uFF0C\u4E0D\u593A\u53D6\u3002",
    recommendation: ["\u786E\u8BA4\u8BE5\u94FE\u63A5\u7528\u9014\uFF1B\u786E\u5C5E\u6B8B\u7559\u518D\u624B\u5DE5\u5220\u9664\uFF0C\u7136\u540E\u70B9\u300C\u21BB \u5237\u65B0\u300D\u5BF9\u8D26\u91CD\u5EFA", "\u6307\u5411\u672C\u5E93\u5185\u4ED6\u5904\u7684\u65E7\u94FE\u63A5\u4F1A\u5728\u5BF9\u8D26\u65F6\u81EA\u52A8\u6458\u9664\u91CD\u5EFA\uFF0C\u65E0\u9700\u4EBA\u5DE5"]
  },
  "orphan-link": {
    summary: "\u5B58\u5728\u6307\u5411\u672C\u914D\u7F6E\u76EE\u5F55\u3001\u4F46\u5DF2\u4E0D\u5728\u6302\u8F7D\u671F\u671B\u96C6\u4E2D\u7684\u94FE\u63A5\uFF08\u5206\u7EC4\u79FB\u9664/\u7981\u7528/\u51FA\u5E93\u540E\u6B8B\u7559\u5BF9\u8D26\u672A\u6536\u655B\uFF0C\u6216\u8DE8\u5E93\u6539\u914D\u7684\u5B64\u513F\uFF09\u3002",
    recommendation: ["\u70B9\u300C\u21BB \u5237\u65B0\u300D\u89E6\u53D1\u5BF9\u8D26\uFF1A\u5F52\u5C5E\u672C\u63D2\u4EF6\u4E14\u4E0D\u5728\u671F\u671B\u96C6\u7684\u94FE\u63A5\u4F1A\u88AB\u81EA\u52A8\u6458\u9664", "\u6539\u914D\u8FC7 skillsDir \u65F6\u65E7\u5E93\u94FE\u63A5\u6309\u7EA6\u5B9A\u4FDD\u7559\u4E3A\u5B64\u513F\uFF0C\u53EF\u624B\u5DE5\u6E05\u7406"]
  }
};
function mountIssueRepair(issue, { name, targetLabel: targetLabel2, path, root }) {
  const meta = MOUNT_ISSUE_META[issue] || { summary: `\u6302\u8F7D\u72B6\u6001\u5F02\u5E38\uFF08${issue}\uFF09\u3002`, recommendation: ["\u70B9\u300C\u21BB \u5237\u65B0\u300D\u91CD\u8BD5\u5BF9\u8D26", "\u628A\u672C\u63D0\u793A\u8BCD\u4EA4\u7ED9\u672C\u5730 Agent \u53EA\u8BFB\u6392\u67E5"] };
  const facts = [
    { label: "Skill", value: String(name ?? "") },
    { label: "\u76EE\u6807", value: String(targetLabel2 ?? issue ?? "") }
  ];
  if (path) facts.push({ label: "\u73B0\u573A\u8DEF\u5F84", value: String(path) });
  if (root) facts.push({ label: "\u914D\u7F6E\u76EE\u5F55", value: String(root) });
  return { operation: "mount-inspect", summary: meta.summary, facts, recommendation: meta.recommendation };
}
function settingsRejectedRepair(field, attempted, current, root) {
  return {
    operation: "settings.set",
    summary: `\u914D\u7F6E\u300C${field}\u300D\u88AB settings \u6821\u9A8C\u62D2\u7EDD\uFF0C\u5DF2\u56DE\u6EDA\u4E3A\u5F53\u524D\u503C\u3002`,
    facts: [
      { label: "\u88AB\u62D2\u7EDD\u7684\u5B57\u6BB5", value: String(field) },
      { label: "\u5C1D\u8BD5\u5199\u5165\u7684\u503C", value: JSON.stringify(attempted ?? null) },
      { label: "\u5F53\u524D\u751F\u6548\u7684\u503C", value: JSON.stringify(current ?? null) },
      { label: "\u914D\u7F6E\u76EE\u5F55", value: String(root || "\uFF08\u672A\u914D\u7F6E\uFF09") }
    ],
    recommendation: [
      '\u7EC4\u540D\uFF1A1\u201330 \u5B57\u7B26\uFF0C\u300C\u9ED8\u8BA4\u300D\u300C\u5168\u90E8\u300D\u4E3A\u4FDD\u7559\u5B57\uFF0C\u4E0D\u542B / \\ : * ? " < > | \u4E0E\u63A7\u5236\u5B57\u7B26',
      "skillsDir\uFF1A\u975E\u7A7A\u65F6\u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84",
      "\u8BF7\u68C0\u67E5 $DSH_HOME/settings.yaml \u7684 skill-manager \u6BB5\u4E0E\u63D2\u4EF6 src/core/model/intent.js \u7684 validate \u89C4\u5219\uFF0C\u4FEE\u6B63\u540E\u91CD\u8BD5"
    ]
  };
}

// src/client/manage.jsx
var import_react3 = require("react");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime3 = require("react/jsx-runtime");
var ORIGIN_LABEL = { github: "GitHub", local: "\u672C\u5730", self: "\u81EA\u7814" };
var ORIGIN_OPTIONS = [
  { id: "", label: "\u5168\u90E8\u6765\u6E90" },
  { id: "github", label: "GitHub" },
  { id: "self", label: "\u81EA\u7814/\u672C\u5730" }
];
function targetLabel(target, workspaces) {
  const p = typeof target === "string" ? parseTargetKey(target) : null;
  if (!p) return String(target ?? "\u2014");
  if (p.scope === "global") return p.host === "pi" ? "pi \u7528\u6237\u7EA7" : "DSH \u5168\u5C40";
  const ws = workspaces.find((w) => w.workspaceId === p.project);
  const base = ws ? ws.title : `\u5DE5\u4F5C\u533A ${p.project.slice(0, 8)}\u2026`;
  return p.host === "pi" ? `${base} \xB7 pi` : base;
}
function primaryStatus(it) {
  const mountIssues = it.mount.filter((row) => row.issue && row.issue !== "ok");
  if (it.missing) return { kind: "error", label: "\u7F3A\u5931", issues: null };
  if (mountIssues.length > 0) return { kind: "error", label: `\u6302\u8F7D\u5931\u8D25 ${mountIssues.length}`, issues: mountIssues };
  if (it.disabled) return { kind: "warn", label: "\u5DF2\u7981\u7528", issues: null };
  if (it.upstream && it.upstream.status === "updatable") return { kind: "updatable", label: "\u53EF\u66F4\u65B0", issues: null };
  if (it.upstream && it.upstream.status === "check_failed") return { kind: "warn", label: "\u68C0\u67E5\u5931\u8D25", issues: null };
  return null;
}
function secondaryFlags(it) {
  const flags = [];
  if (it.upstream && it.upstream.locally_modified) flags.push("\u672C\u5730\u6709\u4FEE\u6539");
  if (!it.hasSkillMd && !it.missing) flags.push("\u65E0 SKILL.md");
  if (it.nameVisible === false) flags.push("\u5B89\u88C5\u540D\u6587\u6CD5\u4E0D\u53EF\u89C1");
  return flags;
}
function ManageView({ call, data, config, reload, showToast }) {
  const [origin, setOrigin] = (0, import_react3.useState)("");
  const [originOpen, setOriginOpen] = (0, import_react3.useState)(false);
  const [groupFilter, setGroupFilter] = (0, import_react3.useState)("\u9ED8\u8BA4");
  const [q, setQ] = (0, import_react3.useState)("");
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [error, setError] = (0, import_react3.useState)(null);
  const [notice, setNotice] = (0, import_react3.useState)(null);
  const [flashDir, setFlashDir] = (0, import_react3.useState)(null);
  const [dialog, setDialog] = (0, import_react3.useState)(null);
  const [menuFor, setMenuFor] = (0, import_react3.useState)(null);
  const [expandedMount, setExpandedMount] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => {
    if (!flashDir) return void 0;
    const t = setTimeout(() => setFlashDir(null), 1600);
    return () => clearTimeout(t);
  }, [flashDir]);
  const { groups, skillsIntent, setSkillDisabled, moveSkill, renameGroup, deleteGroup } = config;
  const displaySkills = (0, import_react3.useMemo)(() => data.lib.skills.map((it) => {
    const intent = skillsIntent[it.dir];
    return intent ? { ...it, disabled: intent.disabled === true, group: intent.group } : it;
  }), [data.lib.skills, skillsIntent]);
  const list = (0, import_react3.useMemo)(() => {
    const query = q.trim().toLowerCase();
    return displaySkills.filter((it) => (origin === "" || it.origin === origin) && (groupFilter === "" || it.group === groupFilter) && (query === "" || it.name.toLowerCase().includes(query) || (it.description || "").toLowerCase().includes(query)));
  }, [displaySkills, origin, groupFilter, q]);
  const groupNames = Object.keys(groups);
  const countForGroup = (group) => displaySkills.filter((item) => item.group === group).length;
  const warningLines = [];
  for (const w of data.lib.warnings) {
    warningLines.push({
      key: `w-${warningLines.length}`,
      text: String(w),
      prompt: buildRepairPrompt({
        root: data.root,
        code: "reconcile-warning",
        message: String(w),
        repair: { operation: "sync", summary: String(w), facts: [{ label: "\u914D\u7F6E\u76EE\u5F55", value: String(data.root || "") }], recommendation: ["\u6838\u5BF9 settings \u4E2D\u5F15\u7528\u7684\u5206\u7EC4\u4E0E\u5DE5\u4F5C\u533A\u662F\u5426\u4ECD\u5B58\u5728", "\u70B9\u300C\u21BB \u5237\u65B0\u300D\u89E6\u53D1\u5BF9\u8D26\uFF0C\u5931\u6548\u5F15\u7528\u4F1A\u88AB\u8DF3\u8FC7\u5E76\u4FDD\u7559\u73B0\u573A"] }
      })
    });
  }
  for (const issue of data.health.filter((i) => i.issue === "orphan-link")) {
    warningLines.push({
      key: `o-${issue.name}-${issue.target}`,
      text: `\u5B64\u513F\u94FE\u63A5\uFF1A${issue.name} @ ${issue.target}`,
      prompt: buildRepairPrompt({ root: data.root, code: "orphan-link", message: `\u6307\u5411\u672C\u914D\u7F6E\u76EE\u5F55\u7684\u94FE\u63A5\u4E0D\u5728\u6302\u8F7D\u671F\u671B\u96C6\u4E2D\uFF1A${issue.name}`, repair: mountIssueRepair("orphan-link", { name: issue.name, targetLabel: issue.target, path: issue.path || issue.target, root: data.root }) })
    });
  }
  const rowAction = async (name, action, payload = {}) => {
    if (action === "disable") {
      setSkillDisabled(name, true);
      return;
    }
    if (action === "enable") {
      setSkillDisabled(name, false);
      return;
    }
    if (action === "remove" && payload.confirmed !== true) {
      setDialog({ kind: "remove", name });
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action === "update") {
        if (payload.confirmLocalChanges !== true) {
          const checks = await call("check", { names: [name] });
          const check = checks.find((item) => item.name === name);
          if (check?.locally_modified || check?.baseline_missing) {
            setDialog({
              kind: "update",
              name,
              detail: `\u5F53\u524D ${check.current ? check.current.slice(0, 7) : "\u672A\u77E5"} \u2192 \u4E0A\u6E38 ${check.latest ? check.latest.slice(0, 7) : "\u5F85\u68C0\u67E5"}\u3002`
            });
            return;
          }
        }
        const r = await call("update", { names: [name], confirmLocalChanges: payload.confirmLocalChanges === true });
        const it = r.results.find((item) => item.name === name);
        if (it?.status === "updated") {
          showToast(`${name} \u5DF2\u66F4\u65B0\u81F3 ${String(it.commit || "").slice(0, 7)}\uFF08${it.via === "ls-remote" ? "git" : "API"} \u901A\u9053\uFF09`);
          setFlashDir(name);
        } else if (it) setNotice({ tone: "warn", text: `${name} \u66F4\u65B0\u672A\u5B8C\u6210\uFF08${it.status}\uFF09\uFF1A${it.reason || it.error || "\u672A\u8FD4\u56DE\u539F\u56E0"}` });
        else setNotice({ tone: "warn", text: `${name}\uFF1A\u66F4\u65B0\u7ED3\u679C\u672A\u542B\u8BE5\u6761\u76EE\uFF0C\u8BF7\u70B9\u300C\u21BB \u5237\u65B0\u300D\u6838\u5BF9\u884C\u72B6\u6001` });
      } else if (action === "remove") {
        const r = await call("remove", { name });
        showToast(r.backup ? `${name} \u5DF2\u51FA\u5E93\uFF0C\u5907\u4EFD\u4E8E ${r.backup}` : `${name} \u5DF2\u51FA\u5E93\uFF08\u76EE\u5F55\u672C\u5DF2\u7F3A\u5931\uFF0C\u65E0\u7269\u53EF\u5907\uFF09`);
      }
      reload();
    } catch (e) {
      if (action === "update" && e?.code === "local-changes-confirmation-required" && payload.confirmLocalChanges !== true) {
        setDialog({ kind: "update", name, detail: e.message || "\u68C0\u6D4B\u5230\u672C\u5730\u4FEE\u6539\u3002" });
      } else {
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  };
  const refreshAll = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const failures = [];
      let checkFailed = -1;
      try {
        const r = await call("check", {});
        checkFailed = r.filter((it) => it.status === "check_failed").length;
      } catch (e) {
        failures.push(`\u4E0A\u6E38\u68C0\u67E5\u5931\u8D25\uFF1A${e?.message ?? String(e)}`);
      }
      let syncProblems = -1;
      try {
        const s = await call("sync", {});
        syncProblems = s.errors.length + s.warnings.length;
      } catch (e) {
        failures.push(`\u73B0\u573A\u5BF9\u8D26\u5931\u8D25\uFF1A${e?.message ?? String(e)}`);
      }
      const parts = [];
      if (checkFailed > 0) parts.push(`${checkFailed} \u4E2A\u4E0A\u6E38\u4E0D\u53EF\u8FBE`);
      if (syncProblems > 0) parts.push(`${syncProblems} \u9879\u73B0\u573A\u9700\u8981\u5173\u6CE8\uFF08\u89C1\u884C\u72B6\u6001/\u8B66\u544A\u6761\uFF09`);
      if (failures.length > 0) {
        setError(new Error(failures.join("\uFF1B")));
        setNotice({ tone: "warn", text: parts.length > 0 ? `\u5237\u65B0\u90E8\u5206\u5B8C\u6210\uFF1A${parts.join("\uFF1B")}` : "\u5237\u65B0\u672A\u5168\u90E8\u5B8C\u6210\uFF0C\u8BE6\u89C1\u9519\u8BEF\u6761" });
      } else {
        if (parts.length > 0) {
          setNotice({ tone: "warn", text: `\u5237\u65B0\u5B8C\u6210\uFF1A${parts.join("\uFF1B")}` });
        } else {
          showToast("\u5237\u65B0\u5B8C\u6210\uFF1A\u73B0\u573A\u4E00\u81F4");
        }
      }
      reload();
    } finally {
      setBusy(false);
    }
  };
  const fmtCheckedAt = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const groupOp = (action, name, newName) => {
    if (action === "delete") {
      setDialog({ kind: "group-delete", name });
    } else if (action === "rename") {
      renameGroup(name, newName);
      if (groupFilter === name && newName) setGroupFilter(newName);
    }
  };
  const confirmDeleteGroup = () => {
    const name = dialog?.kind === "group-delete" ? dialog.name : null;
    setDialog(null);
    if (!name) return;
    deleteGroup(name);
    if (groupFilter === name) setGroupFilter("\u9ED8\u8BA4");
  };
  const doCreateGroup = (name) => {
    setDialog(null);
    if (!config.createGroup(name)) return;
    setGroupFilter(name);
    showToast(`\u5DF2\u521B\u5EFA\u5206\u7EC4\u300C${name}\u300D`);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: S.panel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", gap: 14, alignItems: "flex-start" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        GroupNav,
        {
          groups,
          selected: groupFilter,
          total: displaySkills.length,
          countForGroup,
          onSelect: setGroupFilter,
          onCreate: () => setDialog({ kind: "create" })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [
        groupFilter === "" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...cardStyle, padding: "12px 14px" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: cardTitle, children: "\u5F53\u524D\u67E5\u770B\uFF1A\u5168\u90E8\u6280\u80FD" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...noteText, marginTop: 4 }, children: "\u9009\u62E9\u5DE6\u4FA7\u5206\u7EC4\uFF0C\u53EF\u914D\u7F6E\u5B83\u5728 DSH \u5168\u5C40\u4E0E\u5404\u5DE5\u4F5C\u533A\u7684\u53EF\u7528\u8303\u56F4\u3002" })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GroupScopePanel, { config, group: groupFilter, workspaces: data.workspaces, skills: data.lib.skills, onGroupOp: groupOp, piAvailable: data.agents?.pi?.available === true }),
        warningLines.map((w) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...badgeStyle(T.warn), borderRadius: 10, padding: "9px 12px", margin: "8px 0", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: dotStyle(T.warn) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1, minWidth: 0, wordBreak: "break-all" }, children: w.text }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(RepairCopy, { text: w.prompt })
        ] }, w.key)),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "baseline", gap: 8, margin: "14px 0 10px" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: sectionHead, children: "\u6280\u80FD\u5E93" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: noteText, children: `${groupFilter === "" ? "\u5168\u90E8" : groupFilter} \xB7 ${list.length} \u4E2A` }),
          data.lib.checkedAt ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: noteText, children: `\u4E0A\u6E38\u72B6\u6001\u68C0\u67E5\u4E8E ${fmtCheckedAt(data.lib.checkedAt)}` }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...S.toolbar, marginBottom: 12 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Input, { style: { flex: 1, minWidth: 140 }, placeholder: "\u641C\u7D22\u540D\u79F0 / \u63CF\u8FF0\u2026", value: q, onChange: (e) => setQ(e.target.value) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            import_dsh_client_ui_primitives3.Menu,
            {
              open: originOpen,
              portal: true,
              compact: true,
              anchor: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { type: "button", disabled: busy, onClick: () => setOriginOpen((v) => !v), style: S.filterTrigger, children: [
                ORIGIN_OPTIONS.find((o) => o.id === origin)?.label ?? "\u5168\u90E8\u6765\u6E90",
                ChevronIcon ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ChevronIcon, { style: { color: T.labelSecondary, transition: "transform .16s", transform: originOpen ? "rotate(180deg)" : void 0 } }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { color: T.labelSecondary, fontSize: 10 }, children: originOpen ? "\u25B4" : "\u25BE" })
              ] }),
              items: ORIGIN_OPTIONS,
              selectedId: origin,
              onSelect: (id) => {
                setOrigin(id);
                setOriginOpen(false);
              },
              onClose: () => setOriginOpen(false)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GhostBtn, { onClick: refreshAll, disabled: busy, title: "\u91CD\u65B0\u68C0\u67E5\u5168\u90E8\u4E0A\u6E38\u3001\u6267\u884C\u4E00\u6B21\u5B89\u5168\u5BF9\u8D26\u5E76\u5237\u65B0\u5217\u8868", children: "\u21BB \u5237\u65B0" })
        ] }),
        notice ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(NoticeBar, { notice }) : null,
        error ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ErrorLine, { error }) : null,
        list.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...S.muted, padding: 12 }, children: "\u5E93\u4E3A\u7A7A\uFF08\u65E0\u5339\u914D skill\uFF09" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...cardStyle, padding: 0 }, children: list.map((it, idx) => {
          const status = primaryStatus(it);
          const mountIssues = status?.issues || [];
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { position: "relative" }, children: [
            idx > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: dividerStyle }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...S.listRow, background: flashDir === it.dir ? `color-mix(in srgb, ${T.brand} 10%, transparent)` : "transparent", transition: "background-color 1.4s" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { flex: 1, minWidth: 0 }, title: it.description, children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontWeight: 600, color: T.labelPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: it.name }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...noteText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: [
                  ORIGIN_LABEL[it.origin] || it.origin,
                  // 右栏已按左栏分组收窄；仅「全部」视图补组名与挂载目标，避免逐行重复
                  groupFilter === "" ? it.group : null,
                  groupFilter === "" && it.targets.length > 0 ? it.targets.map((t) => targetLabel(t, data.workspaces)).join(" / ") : null,
                  it.commit ? it.commit.slice(0, 7) : null
                ].filter(Boolean).join(" \xB7 ") })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }, children: [
                status && (mountIssues.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                  "button",
                  {
                    type: "button",
                    title: "\u70B9\u51FB\u5C55\u5F00\u6302\u8F7D\u5931\u8D25\u660E\u7EC6\u4E0E\u4FEE\u590D\u63D0\u793A\u8BCD",
                    onClick: () => setExpandedMount(expandedMount === it.dir ? null : it.dir),
                    style: { ...statusPillStyle("error"), border: "none", font: "inherit", cursor: "pointer" },
                    children: `${status.label} \xB7 ${expandedMount === it.dir ? "\u6536\u8D77" : "\u5C55\u5F00"}`
                  }
                ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: statusPillStyle(status.kind), children: status.label })),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                  "button",
                  {
                    type: "button",
                    title: "\u884C\u64CD\u4F5C",
                    disabled: busy,
                    onClick: (e) => setMenuFor(menuFor?.dir === it.dir ? null : { dir: it.dir, rect: e.currentTarget.getBoundingClientRect() }),
                    style: { border: "none", background: "transparent", cursor: busy ? "default" : "pointer", fontSize: 16, lineHeight: 1, padding: "3px 6px", borderRadius: 6, color: menuFor?.dir === it.dir ? T.labelPrimary : T.labelSecondary },
                    children: "\u22EF"
                  }
                )
              ] }),
              menuFor?.dir === it.dir && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                RowMenu,
                {
                  it,
                  groupNames,
                  flags: secondaryFlags(it),
                  busy,
                  triggerRect: menuFor.rect,
                  onAction: (action) => rowAction(it.dir, action),
                  onMove: (group) => moveSkill(it.dir, group),
                  onClose: () => setMenuFor(null)
                }
              )
            ] }),
            expandedMount === it.dir && mountIssues.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...subRowPanel }, children: mountIssues.map((row, midx) => {
              const repair = mountIssueRepair(row.issue, { name: it.dir, targetLabel: targetLabel(row.target, data.workspaces), path: row.path, root: data.root });
              return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "4px 0" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: dotStyle(T.error) }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { flex: 1, minWidth: 0 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontWeight: 500, color: T.labelPrimary }, children: `${targetLabel(row.target, data.workspaces)} \xB7 ${row.issue}` }),
                  row.path ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { ...noteText, display: "block", wordBreak: "break-all" }, children: row.path }) : null
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(RepairCopy, { text: buildRepairPrompt({ root: data.root, code: row.issue, message: `${it.dir} \u2192 ${row.path || targetLabel(row.target, data.workspaces)}`, repair }) })
              ] }, `${row.target}-${midx}`);
            }) })
          ] }, it.dir);
        }) })
      ] })
    ] }),
    dialog?.kind === "create" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CreateGroupDialog, { onCancel: () => setDialog(null), onCreate: doCreateGroup }),
    dialog?.kind === "update" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      UpdateConfirmationDialog,
      {
        name: dialog.name,
        detail: dialog.detail,
        busy,
        onCancel: () => setDialog(null),
        onConfirm: () => {
          const name = dialog.name;
          setDialog(null);
          rowAction(name, "update", { confirmLocalChanges: true });
        }
      }
    ),
    dialog?.kind === "remove" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      ConfirmDialog,
      {
        title: `\u51FA\u5E93\u300C${dialog.name}\u300D\uFF1F`,
        body: "\u4EC5 GitHub \u6765\u6E90\u7684 Skill \u53EF\u51FA\u5E93\uFF08\u81EA\u7814/\u672C\u5730\u76EE\u5F55\u65E0\u5220\u9664\u5165\u53E3\uFF0C\u5728\u6280\u80FD\u76EE\u5F55\u5185\u81EA\u7BA1\uFF09\u3002",
        warning: "\u6267\u884C\u987A\u5E8F\uFF1A\u5148\u628A\u6574\u76EE\u5F55\u81EA\u52A8\u5907\u4EFD\u5230 DSH HOME \u5907\u4EFD\u533A \u2192 \u6458\u9664\u5168\u90E8\u6302\u8F7D\u94FE\u63A5 \u2192 \u5220\u9664\u5E93\u5185\u76EE\u5F55 \u2192 \u6E05\u7406\u767B\u8BB0\u4E0E\u68C0\u67E5\u7F13\u5B58\u3002settings \u91CC\u7684\u5206\u7EC4\u5F52\u5C5E\u4E0D\u968F\u51FA\u5E93\u6D88\u5931\uFF0C\u91CD\u65B0\u5165\u5E93\u81EA\u7136\u843D\u56DE\u539F\u7EC4\u3002",
        confirmLabel: "\u786E\u8BA4\u51FA\u5E93",
        busy,
        onCancel: () => setDialog(null),
        onConfirm: () => {
          const name = dialog.name;
          setDialog(null);
          rowAction(name, "remove", { confirmed: true });
        }
      }
    ),
    dialog?.kind === "group-delete" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      ConfirmDialog,
      {
        title: `\u5220\u9664\u5206\u7EC4\u300C${dialog.name}\u300D\uFF1F`,
        body: `\u8BE5\u7EC4\u5F53\u524D ${countForGroup(dialog.name)} \u4E2A\u6210\u5458\uFF0C\u5220\u9664\u540E\u6210\u5458\u56DE\u843D\u300C\u9ED8\u8BA4\u300D\u7EC4\u3002`,
        warning: "\u4E0D\u5220\u9664\u4EFB\u4F55 Skill \u6587\u4EF6\uFF1B\u4F46\u8BE5\u7EC4\u7684\u6302\u8F7D\u89C4\u5219\u968F\u4E4B\u79FB\u9664\uFF0C\u6309\u6B64\u89C4\u5219\u6302\u51FA\u53BB\u7684\u94FE\u63A5\u4F1A\u5728\u5BF9\u8D26\u65F6\u88AB\u6458\u9664\uFF08\u56DE\u843D\u300C\u9ED8\u8BA4\u300D\u7EC4\u7684\u89C4\u5219\uFF09\u3002",
        confirmLabel: "\u786E\u8BA4\u5220\u9664\u5206\u7EC4",
        onCancel: () => setDialog(null),
        onConfirm: confirmDeleteGroup
      }
    )
  ] });
}
var subRowPanel = {
  margin: "0 12px 8px",
  padding: "8px 12px",
  borderRadius: 10,
  background: T.bgLayer3,
  border: `1px solid ${T.borderL1}`
};
function GroupNav({ groups, selected, total, countForGroup, onSelect, onCreate }) {
  const renderItem = (key, label, count) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "button",
    {
      type: "button",
      title: label,
      onClick: () => onSelect(key),
      style: { ...navItemStyle, ...selected === key ? navItemActiveStyle : null },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }, children: label }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { ...noteText, flex: "none" }, children: count })
      ]
    },
    key || "<all>"
  );
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { flex: "none", width: 140 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 6, padding: "0 4px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: cardTitle, children: "\u5206\u7EC4" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1 } }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: onCreate, style: { border: "none", background: "none", padding: 0, font: "inherit", fontSize: 11, color: T.labelSecondary, cursor: "pointer" }, children: "\uFF0B \u65B0\u5EFA" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { maxHeight: 320, overflowY: "auto" }, children: [
      renderItem("", "\u5168\u90E8", total),
      renderItem("\u9ED8\u8BA4", "\u9ED8\u8BA4", countForGroup("\u9ED8\u8BA4")),
      Object.keys(groups).filter((group) => group !== "\u9ED8\u8BA4").map((group) => renderItem(group, group, countForGroup(group)))
    ] })
  ] });
}
function ScopeRow({ checked, title, hint, count, onToggle, trailing }) {
  const [hover, setHover] = (0, import_react3.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "label",
    {
      style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: checked ? `color-mix(in srgb, ${T.brand} 8%, transparent)` : hover ? T.bgModulePlatform : "transparent" },
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", checked, onChange: (event) => onToggle(event.target.checked), style: { accentColor: T.brand, width: 13, height: 13, margin: 0, flex: "none" } }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontWeight: 500, color: T.labelPrimary, flex: "none" }, children: title }),
        hint ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { ...noteText, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: hint, children: hint }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1 } }),
        count > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { ...pillBase, flex: "none" }, children: `${count} \u4E2A\u7EC4\u4F7F\u7528` }) : null,
        trailing || null
      ]
    }
  );
}
function HostChip({ label, active, onToggle, title }) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    "button",
    {
      type: "button",
      title,
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(!active);
      },
      style: {
        ...pillBase,
        border: "none",
        font: "inherit",
        fontSize: 10,
        padding: "0 7px",
        cursor: "pointer",
        ...active ? { background: `color-mix(in srgb, ${T.brand} 16%, transparent)`, color: T.labelPrimary, fontWeight: 500 } : { background: T.bgModulePlatform, color: T.labelTertiary }
      },
      children: label
    }
  );
}
function CreateGroupDialog({ onCancel, onCreate }) {
  const [name, setName] = (0, import_react3.useState)("");
  const [error, setError] = (0, import_react3.useState)(null);
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("\u8BF7\u8F93\u5165\u7EC4\u540D");
      return;
    }
    if (trimmed.length > 30) {
      setError("\u7EC4\u540D\u6700\u957F 30 \u5B57\u7B26");
      return;
    }
    if (trimmed === "\u9ED8\u8BA4" || trimmed === "\u5168\u90E8") {
      setError("\u300C\u9ED8\u8BA4\u300D\u300C\u5168\u90E8\u300D\u662F\u4FDD\u7559\u5B57");
      return;
    }
    onCreate(trimmed);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(ModalShell, { title: "\u65B0\u5EFA\u5206\u7EC4", width: 400, onMaskClick: onCancel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 16, fontWeight: 600, marginBottom: 8 }, children: "\u65B0\u5EFA\u5206\u7EC4" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { color: T.labelSecondary, fontSize: 13, lineHeight: 1.55, marginBottom: 12 }, children: "\u521B\u5EFA\u547D\u540D\u5206\u7EC4\uFF0C\u6309\u4E3B\u9898\u7EC4\u7EC7 Skill \u5E76\u914D\u7F6E\u5176\u53EF\u7528\u8303\u56F4\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 12, fontWeight: 500, marginBottom: 6 }, children: "\u7EC4\u540D" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      import_dsh_client_ui_primitives3.Input,
      {
        value: name,
        autoFocus: true,
        placeholder: "\u65B0\u7EC4\u540D",
        onChange: (e) => setName(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }
      }
    ),
    error ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 12, color: T.error, marginTop: 6 }, children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 11, color: T.labelSecondary, marginTop: 8 }, children: "\u65B0\u7EC4\u590D\u5236\u300C\u9ED8\u8BA4\u300D\u7EC4\u7684\u6302\u8F7D\u89C4\u5219\u4F5C\u4E3A\u8D77\u6B65\uFF1B\u7EC4\u540D 1\u201330 \u5B57\u7B26\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(OutlineBtn, { onClick: onCancel, children: "\u53D6\u6D88" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(PrimaryBtn, { onClick: submit, children: "\u65B0\u5EFA" })
    ] })
  ] });
}
function GroupScopePanel({ config, group, workspaces, skills, onGroupOp, piAvailable = false }) {
  const [renaming, setRenaming] = (0, import_react3.useState)(false);
  const [newName, setNewName] = (0, import_react3.useState)("");
  const [opsOpen, setOpsOpen] = (0, import_react3.useState)(false);
  const [showAllWs, setShowAllWs] = (0, import_react3.useState)(false);
  const [wsFilter, setWsFilter] = (0, import_react3.useState)("");
  const [pendingUnmount, setPendingUnmount] = (0, import_react3.useState)(null);
  const { groups, toggleMount, toggleHost } = config;
  const mounts = groups[group] && groups[group].mounts || [];
  const findMount = (scopeKind, workspaceId) => mounts.find((mount) => mount.scope === scopeKind && (scopeKind === "global" || mount.project === workspaceId));
  const enabled = (scopeKind, workspaceId) => Boolean(findMount(scopeKind, workspaceId));
  const hostsOf = (scopeKind, workspaceId) => {
    const m = findMount(scopeKind, workspaceId);
    if (!m) return [];
    return Array.isArray(m.hosts) && m.hosts.length > 0 ? m.hosts : ["dsh"];
  };
  const effectiveGroup = (skill) => {
    const g = skill.group || "\u9ED8\u8BA4";
    return Object.prototype.hasOwnProperty.call(groups, g) ? g : "\u9ED8\u8BA4";
  };
  const linksOnTarget = (scopeKind, workspaceId) => {
    const base = scopeKind === "global" ? "global|global" : `project|${workspaceId}`;
    return skills.filter((s) => effectiveGroup(s) === group && (s.targets.includes(`dsh:${base}`) || s.targets.includes(`pi:${base}`))).length;
  };
  const toggle = (scopeKind, workspaceId, checked) => {
    if (!checked) {
      const count = linksOnTarget(scopeKind, workspaceId);
      if (count > 0) {
        const ws = scopeKind === "project" ? workspaces.find((w) => w.workspaceId === workspaceId) : null;
        setPendingUnmount({ scopeKind, workspaceId, count, targetName: ws ? ws.title : "\u5168\u5C40", hosts: hostsOf(scopeKind, workspaceId) });
        return;
      }
    }
    toggleMount(group, scopeKind, workspaceId, checked);
  };
  const toggleHostChip = (scopeKind, workspaceId, host, on) => {
    if (on) {
      toggleHost(group, scopeKind, workspaceId, host, true);
      return;
    }
    if (hostsOf(scopeKind, workspaceId).length <= 1) {
      toggle(scopeKind, workspaceId, false);
      return;
    }
    toggleHost(group, scopeKind, workspaceId, host, false);
  };
  const hostChipsFor = (scopeKind, workspaceId) => {
    if (!piAvailable || !enabled(scopeKind, workspaceId)) return null;
    const hosts = hostsOf(scopeKind, workspaceId);
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { display: "inline-flex", gap: 4, flex: "none" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(HostChip, { label: "DSH", title: "DSH \u4FA7\u751F\u6548\uFF08\u5168\u5C40\u6839 / \u5DE5\u4F5C\u533A .dsh/skills\uFF09", active: hosts.includes("dsh"), onToggle: (on) => toggleHostChip(scopeKind, workspaceId, "dsh", on) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(HostChip, { label: "pi", title: "pi \u4FA7\u751F\u6548\uFF08pi \u7528\u6237\u7EA7 / \u5DE5\u4F5C\u533A .pi/skills\uFF09", active: hosts.includes("pi"), onToggle: (on) => toggleHostChip(scopeKind, workspaceId, "pi", on) })
    ] });
  };
  const confirmUnmount = () => {
    toggleMount(group, pendingUnmount.scopeKind, pendingUnmount.workspaceId, false);
    setPendingUnmount(null);
  };
  const manageable = group !== "\u9ED8\u8BA4";
  const submitRename = () => {
    const trimmed = newName.trim();
    setRenaming(false);
    if (trimmed && trimmed !== group) onGroupOp("rename", group, trimmed);
  };
  const wsChecked = (w) => enabled("project", w.workspaceId);
  const enabledWs = workspaces.filter(wsChecked);
  const restCount = workspaces.length - enabledWs.length;
  const filtering = wsFilter.trim() !== "";
  const visibleWs = filtering ? workspaces.filter((w) => `${w.title}
${w.path}`.toLowerCase().includes(wsFilter.trim().toLowerCase())) : showAllWs ? workspaces : enabledWs;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...cardStyle, padding: "12px 14px" }, children: [
    renaming ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        import_dsh_client_ui_primitives3.Input,
        {
          style: { width: 160 },
          value: newName,
          autoFocus: true,
          onChange: (e) => setNewName(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter") submitRename();
            if (e.key === "Escape") setRenaming(false);
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(PrimaryBtn, { onClick: submitRename, children: "\u4FDD\u5B58" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GhostBtn, { onClick: () => setRenaming(false), children: "\u53D6\u6D88" })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: cardTitle, children: `\u5F53\u524D\u5206\u7EC4\uFF1A${group}` }),
      manageable && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1 } }),
      manageable && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { position: "relative" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            title: "\u5206\u7EC4\u64CD\u4F5C",
            onClick: () => setOpsOpen((v) => !v),
            style: { border: "none", background: "transparent", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "3px 6px", borderRadius: 6, color: opsOpen ? T.labelPrimary : T.labelSecondary },
            children: "\u22EF"
          }
        ),
        opsOpen && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { position: "fixed", inset: 0, zIndex: 40 }, onClick: () => setOpsOpen(false) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...menuCardStyle, top: "100%", right: 0, marginTop: 4 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(MenuItem, { label: "\u6539\u540D", onClick: () => {
              setOpsOpen(false);
              setNewName(group);
              setRenaming(true);
            } }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(MenuItem, { label: "\u5220\u9664\u5206\u7EC4", danger: true, onClick: () => {
              setOpsOpen(false);
              onGroupOp("delete", group);
            } })
          ] })
        ] })
      ] })
    ] }),
    renaming && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...noteText, marginBottom: 8 }, children: "\u6539\u540D\u7ACB\u5373\u751F\u6548\uFF1A\u5206\u7EC4\u6210\u5458\u4E0E\u6302\u8F7D\u89C4\u5219\u540C\u6B65\u6539\u540D\uFF0CSkill \u672C\u4F53\u4E0D\u53D7\u5F71\u54CD\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: dividerStyle }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { padding: "4px 0" }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      ScopeRow,
      {
        checked: enabled("global"),
        title: piAvailable ? "\u5168\u5C40" : "DSH \u5168\u5C40",
        hint: piAvailable ? "DSH \u5168\u5C40\u4E0E pi \u7528\u6237\u7EA7\uFF0C\u6309\u53F3\u4FA7\u5BBF\u4E3B\u9009\u62E9\u751F\u6548\u9762" : "\u5BF9\u6240\u6709 DSH \u9879\u76EE\u751F\u6548",
        count: 0,
        onToggle: (checked) => toggle("global", null, checked),
        trailing: hostChipsFor("global", null)
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: dividerStyle }),
    workspaces.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...S.muted, padding: "8px 0" }, children: "\u5F53\u524D\u6CA1\u6709 DSH \u5DE5\u4F5C\u533A\uFF1B\u8BF7\u5728 DSH \u539F\u751F\u5DE5\u4F5C\u533A\u754C\u9762\u521B\u5EFA\u6216\u6253\u5F00\u9879\u76EE\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 2px 6px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontSize: 11, fontWeight: 600, color: T.labelSecondary }, children: "\u5DE5\u4F5C\u533A\u9879\u76EE" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1 } }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: pillBase, children: `\u5DF2\u542F\u7528 ${enabledWs.length} \xB7 \u5171 ${workspaces.length}` })
      ] }),
      workspaces.length > 8 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { marginBottom: 8 }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Input, { placeholder: "\u8FC7\u6EE4\u5DE5\u4F5C\u533A\u2026", value: wsFilter, onChange: (e) => setWsFilter(e.target.value) }) }),
      (visibleWs.length > 0 || filtering) && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { border: `1px solid ${T.borderL1}`, borderRadius: 10, padding: 2, maxHeight: 208, overflowY: "auto", scrollbarWidth: "thin" }, children: [
        visibleWs.map((workspace) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          ScopeRow,
          {
            checked: wsChecked(workspace),
            title: workspace.title,
            hint: workspace.path,
            count: workspace.mountCount,
            onToggle: (checked) => toggle("project", workspace.workspaceId, checked),
            trailing: hostChipsFor("project", workspace.workspaceId)
          },
          workspace.workspaceId
        )),
        filtering && visibleWs.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...S.muted, padding: "8px 10px" }, children: "\u65E0\u5339\u914D\u5DE5\u4F5C\u533A" })
      ] }),
      !filtering && restCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "button",
        {
          type: "button",
          onClick: () => setShowAllWs((v) => !v),
          style: { display: "block", width: "100%", border: `1px dashed ${T.borderL2}`, background: "transparent", borderRadius: 8, padding: "6px 10px", marginTop: 6, font: "inherit", fontSize: 11, color: T.labelSecondary, cursor: "pointer", textAlign: "center" },
          children: showAllWs ? "\u25BE \u6536\u8D77\u5176\u4ED6\u5DE5\u4F5C\u533A" : `\u25B8 \u5C55\u5F00\u5176\u4ED6 ${restCount} \u4E2A\u5DE5\u4F5C\u533A\uFF08\u52FE\u9009\u5373\u542F\u7528\uFF09`
        }
      )
    ] }),
    pendingUnmount && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(ModalShell, { title: "\u786E\u8BA4\u53D6\u6D88\u6302\u8F7D", width: 420, onMaskClick: () => setPendingUnmount(null), children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { fontSize: 16, fontWeight: 600, marginBottom: 8 }, children: [
        "\u53D6\u6D88\u300C",
        group,
        "\u300D\u5728\u300C",
        pendingUnmount.targetName,
        "\u300D\u7684\u6302\u8F7D\uFF1F"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { color: T.labelSecondary, fontSize: 13, lineHeight: 1.55, marginBottom: 12 }, children: `\u8BE5\u5206\u7EC4\u6709 ${pendingUnmount.count} \u4E2A Skill \u6302\u8F7D\u5728\u6B64\u76EE\u6807\u4E0B\uFF0C\u53D6\u6D88\u540E\u5BF9\u8D26\u4F1A\u79FB\u9664\u8FD9\u4E9B\u94FE\u63A5\u3002` }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { borderRadius: 10, padding: "10px 12px", marginBottom: 14, ...badgeStyle(T.warn), fontSize: 12, lineHeight: 1.55 }, children: `\u53EA\u79FB\u9664\u94FE\u63A5\u6307\u9488\uFF0C\u4E0D\u5220\u9664\u6280\u80FD\u5E93\u6587\u4EF6${pendingUnmount.hosts.includes("pi") ? "\uFF1B\u672C\u76EE\u6807\u542B pi \u5BBF\u4E3B\uFF0C.pi/skills \u4E0E pi \u7528\u6237\u7EA7\u94FE\u63A5\u4E00\u5E76\u6458\u9664" : ""}\uFF1B\u91CD\u65B0\u52FE\u9009\u5373\u53EF\u6062\u590D\u6302\u8F7D\u3002` }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(OutlineBtn, { onClick: () => setPendingUnmount(null), children: "\u53D6\u6D88" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(PrimaryBtn, { onClick: confirmUnmount, children: `\u786E\u8BA4\u79FB\u9664 ${pendingUnmount.count} \u6761\u94FE\u63A5` })
      ] })
    ] })
  ] });
}

// src/client/search.jsx
var import_react4 = require("react");
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime4 = require("react/jsx-runtime");
function SearchView({ call, reload, showToast }) {
  const [query, setQuery] = (0, import_react4.useState)("");
  const [results, setResults] = (0, import_react4.useState)(null);
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [error, setError] = (0, import_react4.useState)(null);
  const [notice, setNotice] = (0, import_react4.useState)(null);
  const [candidates, setCandidates] = (0, import_react4.useState)(null);
  const [selected, setSelected] = (0, import_react4.useState)(/* @__PURE__ */ new Set());
  const [candFilter, setCandFilter] = (0, import_react4.useState)("");
  const showCandidates = (value, intentDir) => {
    setCandidates(value);
    const intentName = typeof intentDir === "string" && intentDir !== "" ? intentDir.split("/").pop() : null;
    const pre = /* @__PURE__ */ new Set();
    if (intentName) {
      for (const c of value.list) {
        const base = c.path ? c.path.split("/").pop() : "";
        if (base === intentName) pre.add(c.path || "");
      }
    }
    setSelected(pre);
    setCandFilter("");
    setNotice(null);
    setError(null);
  };
  const inFlight = (0, import_react4.useRef)(false);
  const doSearch = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await call("search", { query });
      setResults(r);
      setCandidates(null);
    } catch (e) {
      setError(e);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const addFromResult = async (repo, directory) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await call("add", { repo, dir: directory || void 0, ref: "main" });
      showToast(`\u5DF2\u5165\u5E93 ${r.name}`);
      reload();
    } catch (e) {
      if (e?.code === "needs-selection") {
        try {
          const r = await call("repo-skills", { repo, ref: "main" });
          showCandidates({ repo, branch: r.branch, list: r.candidates }, directory);
          setNotice({ tone: "warn", text: "\u8BE5 skill \u5728\u4ED3\u5E93\u4E2D\u7684\u4F4D\u7F6E\u5DF2\u53D8\u5316\uFF08\u6CE8\u518C\u8868\u76EE\u5F55\u4FE1\u606F\u8FC7\u671F\uFF09\uFF0C\u8BF7\u5728\u4E0B\u65B9\u5019\u9009\u4E2D\u786E\u8BA4\u2014\u2014\u5DF2\u6309\u540D\u79F0\u4E3A\u4F60\u9884\u9009\u3002" });
          return;
        } catch (probeError) {
          setError(probeError);
          return;
        }
      }
      setError(e);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const probeAndAdd = async (repo, ref, dir) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await call("repo-skills", { repo, ref });
      if (r.candidates.length <= 1) {
        await call("add", { repo, dir: r.candidates[0] ? r.candidates[0].path : dir, ref: r.branch });
        showToast(`\u5DF2\u5165\u5E93 ${repo}`);
        reload();
      } else {
        showCandidates({ repo, branch: r.branch, list: r.candidates });
      }
    } catch (e) {
      setError(e);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const suggestName = (c) => c.path ? c.path.split("/").pop() : candidates.repo.split("/")[1] || candidates.repo;
  const addSelected = async () => {
    if (!candidates || selected.size === 0 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const picked = candidates.list.filter((c) => selected.has(c.path || ""));
    const failures = [];
    let done = 0;
    try {
      for (const c of picked) {
        try {
          await call("add", { repo: candidates.repo, dir: c.path || void 0, ref: candidates.branch });
          done += 1;
        } catch (e) {
          failures.push(`${c.path || "\uFF08\u4ED3\u5E93\u6839\uFF09"}\uFF1A${e.message || e}`);
        }
      }
      if (done > 0) reload();
      if (failures.length > 0) {
        setError({ message: failures.join("\uFF1B") });
      } else {
        setCandidates(null);
        setSelected(/* @__PURE__ */ new Set());
      }
      if (failures.length > 0) {
        setNotice({ tone: "warn", text: `\u5DF2\u5165\u5E93 ${done} \u4E2A\uFF0C\u5931\u8D25 ${failures.length} \u4E2A\uFF08\u9010\u6761\u539F\u56E0\u89C1\u4E0B\u65B9\u7EA2\u5B57\uFF09` });
      } else {
        showToast(`\u5DF2\u5165\u5E93 ${done} \u4E2A`);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: S.panel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { ...cardStyle, padding: "12px 14px", marginBottom: 14 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { ...cardTitle, marginBottom: 10 }, children: "\u641C\u7D22 skills.sh" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          import_dsh_client_ui_primitives4.Input,
          {
            style: { flex: 1 },
            placeholder: "skills.sh \u5173\u952E\u8BCD",
            value: query,
            onChange: (e) => setQuery(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter") doSearch();
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PrimaryBtn, { onClick: doSearch, disabled: busy || !query.trim(), children: busy ? "\u641C\u7D22\u4E2D\u2026" : "\u641C\u7D22" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DirectAdd, { busy, onProbeAdd: probeAndAdd }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ErrorLine, { error }) : null,
    notice ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(NoticeBar, { notice }) : null,
    !results && !candidates && !error && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { ...S.muted, padding: "4px 2px" }, children: "\u8F93\u5165\u5173\u952E\u8BCD\u641C\u7D22 skills.sh \u6CE8\u518C\u8868\uFF0C\u6216\u76F4\u63A5\u63A2\u6D4B GitHub \u4ED3\u5E93\u5165\u5E93\u3002" }),
    candidates && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { marginBottom: 10 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(GhostBtn, { onClick: () => {
        setCandidates(null);
        setSelected(/* @__PURE__ */ new Set());
      }, disabled: busy, children: "\u2190 \u8FD4\u56DE\u641C\u7D22" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { ...subCardStyle, padding: "10px 12px", margin: "8px 0 12px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { fontWeight: 500, color: T.labelPrimary, fontSize: 13 }, children: candidates.repo }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { ...noteText, marginTop: 2 }, children: `${candidates.branch} \xB7 GitHub Trees API` }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { ...noteText, marginTop: 2 }, children: `\u53D1\u73B0 ${candidates.list.length} \u4E2A\u542B SKILL.md \u7684\u76EE\u5F55\uFF0C\u53EF\u591A\u9009\u5165\u5E93\u3002` })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { ...cardTitle, marginBottom: 8 }, children: "\u9009\u62E9\u8981\u5165\u5E93\u7684 Skill\uFF08\u53EF\u591A\u9009\uFF09" }),
      candidates.list.length > 8 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { marginBottom: 8 }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Input, { placeholder: "\u8FC7\u6EE4\u5019\u9009\u2026", value: candFilter, onChange: (e) => setCandFilter(e.target.value) }) }),
      (() => {
        const query2 = candFilter.trim().toLowerCase();
        const visible = query2 === "" ? candidates.list : candidates.list.filter((c) => `${c.path}
${suggestName(c)}`.toLowerCase().includes(query2));
        return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { ...cardStyle, padding: 0, marginBottom: 10 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { maxHeight: 296, overflowY: "auto", scrollbarWidth: "thin" }, children: [
            visible.map((c, idx) => {
              const key = c.path || "";
              const checked = selected.has(key);
              return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
                idx > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: dividerStyle }) : null,
                /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { style: { ...S.listRow, cursor: busy ? "default" : "pointer" }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                    "input",
                    {
                      type: "checkbox",
                      checked,
                      disabled: busy,
                      style: { accentColor: T.brand, width: 13, height: 13, margin: 0, flex: "none" },
                      onChange: () => {
                        const next = new Set(selected);
                        if (checked) next.delete(key);
                        else next.add(key);
                        setSelected(next);
                      }
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { style: { flex: 1, minWidth: 0 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { color: T.labelPrimary, fontWeight: 500, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: c.path || "\uFF08\u4ED3\u5E93\u6839\uFF09", children: c.path || "\uFF08\u4ED3\u5E93\u6839\uFF09" }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: noteText, children: `\u5EFA\u8BAE\u540D\u79F0\uFF1A${suggestName(c)}` })
                  ] })
                ] })
              ] }, key || "<root>");
            }),
            visible.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { ...S.muted, padding: "10px 12px" }, children: "\u65E0\u5339\u914D\u5019\u9009" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: dividerStyle }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { ...noteText, flex: 1 }, children: `\u5DF2\u9009 ${selected.size} \u4E2A \xB7 \u5171 ${candidates.list.length} \u4E2A\u5019\u9009` }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(PrimaryBtn, { onClick: addSelected, disabled: busy || selected.size === 0, children: busy ? "\u5165\u5E93\u4E2D\u2026" : "\u5165\u5E93\u6240\u9009" })
          ] })
        ] });
      })(),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { ...badgeStyle(T.warn), borderRadius: 10, padding: "9px 12px", fontSize: 11, lineHeight: 1.6, display: "flex", gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { ...dotStyle(T.warn), marginTop: 5 } }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { children: "\u540C\u540D\u4E14\u540C\u4ED3\u5E93\u65F6\u6539\u7528\u66F4\u65B0\uFF1B\u540C\u540D\u5F02\u6E90\u65F6\u9700\u5148\u51FA\u5E93\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { children: "\u5206\u652F\u6309\u6307\u5B9A\u503C \u2192 main \u2192 master \u56DE\u9000\u3002" })
        ] })
      ] })
    ] }),
    results && results.skills.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: S.muted, children: "\u65E0\u7ED3\u679C" }) : results && results.skills.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { ...cardTitle, margin: "4px 0 8px" }, children: `\u201C${results.query || query}\u201D \u7684\u641C\u7D22\u7ED3\u679C \xB7 ${results.skills.length} \u4E2A` }),
      results.skills.map((s) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: S.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { fontWeight: 600, color: T.labelPrimary }, children: s.name }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: noteText, children: `${s.repo}${s.directory ? " / " + s.directory : ""} \xB7 \u5B89\u88C5 ${s.installs}` })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(OutlineBtn, { onClick: () => addFromResult(s.repo, s.directory), disabled: busy, children: "\u5165\u5E93" })
      ] }, s.key))
    ] }) : null
  ] });
}
function DirectAdd({ busy, onProbeAdd }) {
  const [repo, setRepo] = (0, import_react4.useState)("");
  const [branch, setBranch] = (0, import_react4.useState)("");
  const submit = () => {
    if (!repo.trim()) return;
    onProbeAdd(repo.trim(), branch.trim() || "main", void 0);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { ...cardStyle, padding: "12px 14px", marginBottom: 14 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { ...cardTitle, marginBottom: 10 }, children: "\u4ECE GitHub \u4ED3\u5E93\u6DFB\u52A0" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        import_dsh_client_ui_primitives4.Input,
        {
          style: { flex: 1 },
          placeholder: "owner/repo",
          value: repo,
          onChange: (e) => setRepo(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter") submit();
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        import_dsh_client_ui_primitives4.Input,
        {
          style: { width: 110 },
          placeholder: "\u5206\u652F\uFF08\u53EF\u9009\uFF09",
          value: branch,
          onChange: (e) => setBranch(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter") submit();
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(OutlineBtn, { onClick: submit, disabled: busy || !repo.trim(), children: "\u63A2\u6D4B\u4ED3\u5E93" })
    ] })
  ] });
}

// src/client/section.jsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function SkillsSection({ call, workspaces, scope, subscribeSkillSettings }) {
  const [tab, setTab] = (0, import_react5.useState)("manage");
  const [error, setError] = (0, import_react5.useState)(null);
  const [data, setData] = (0, import_react5.useState)(null);
  const [configOverrideUnconfigured, setConfigOverrideUnconfigured] = (0, import_react5.useState)(false);
  const [reloadTick, reload] = useTick();
  const [toast, showToast, dismissToast] = useToast();
  const [snap, setSnap] = (0, import_react5.useState)(() => scope.getSnapshot());
  const [editError, setEditError] = (0, import_react5.useState)(null);
  (0, import_react5.useEffect)(() => {
    let alive = true;
    const apply2 = () => {
      if (alive) setSnap(scope.getSnapshot());
    };
    const off = scope.subscribe(apply2);
    apply2();
    return () => {
      alive = false;
      off();
    };
  }, [scope]);
  const configReady = snap.status === "ready" && snap.value && typeof snap.value === "object";
  const groups = configReady && snap.value.groups && typeof snap.value.groups === "object" ? snap.value.groups : {};
  const skillsIntent = configReady && snap.value.skills && typeof snap.value.skills === "object" ? snap.value.skills : {};
  const skillsDir = configReady && typeof snap.value.skillsDir === "string" ? snap.value.skillsDir : "";
  const editConfig = (field, next) => {
    setEditError(null);
    void (async () => {
      try {
        await scope.set(field, next);
      } catch (error2) {
        setEditError({
          message: `\u914D\u7F6E\u300C${field}\u300D\u5199\u5165\u5931\u8D25\uFF08\u8BF7\u6C42\u672A\u8FBE Host\uFF09\uFF1A${error2?.message ?? String(error2)}`,
          prompt: null
        });
        return;
      }
      const after = scope.getSnapshot();
      const value = after && after.value && typeof after.value === "object" ? after.value : {};
      if (JSON.stringify(value[field]) !== JSON.stringify(next)) {
        setEditError({
          message: `\u914D\u7F6E\u300C${field}\u300D\u88AB\u62D2\u7EDD\uFF0C\u5DF2\u6062\u590D\u539F\u503C\uFF08\u7EC4\u540D\u4FDD\u7559\u5B57/\u975E\u6CD5\u5B57\u7B26\u6216\u683C\u5F0F\u4E0D\u5408\u6CD5\uFF09\u3002`,
          prompt: buildRepairPrompt({
            root: data && data.root,
            code: "settings-validation-rejected",
            message: `\u5B57\u6BB5 ${field} \u5199\u5165\u88AB Host validate \u62D2\u7EDD`,
            repair: settingsRejectedRepair(field, next, value[field], data && data.root)
          })
        });
      }
    })();
  };
  const intentOf = (dir) => skillsIntent[dir] || { disabled: false, group: "\u9ED8\u8BA4" };
  const setSkillDisabled = (dir, disabled) => {
    editConfig("skills", { ...skillsIntent, [dir]: { ...intentOf(dir), disabled } });
  };
  const moveSkill = (dir, group) => {
    editConfig("skills", { ...skillsIntent, [dir]: { ...intentOf(dir), group } });
  };
  const toggleMount = (group, scopeKind, workspaceId, checked) => {
    const mounts = groups[group] && groups[group].mounts || [];
    const key = `${scopeKind}|${workspaceId ?? ""}`;
    const exists = mounts.some((m) => `${m.scope}|${m.project ?? ""}` === key);
    if (exists === checked) return;
    const next = checked ? [...mounts.filter((m) => `${m.scope}|${m.project ?? ""}` !== key), { scope: scopeKind, project: scopeKind === "project" ? workspaceId : null, hosts: ["dsh"] }] : mounts.filter((m) => `${m.scope}|${m.project ?? ""}` !== key);
    editConfig("groups", { ...groups, [group]: { ...groups[group], mounts: next } });
  };
  const toggleHost = (group, scopeKind, workspaceId, host, on) => {
    const mounts = groups[group] && groups[group].mounts || [];
    const key = `${scopeKind}|${workspaceId ?? ""}`;
    const next = mounts.map((m) => {
      if (`${m.scope}|${m.project ?? ""}` !== key) return m;
      const hosts = Array.isArray(m.hosts) && m.hosts.length > 0 ? m.hosts : ["dsh"];
      const nextHosts = on ? [.../* @__PURE__ */ new Set([...hosts, host])] : hosts.filter((h) => h !== host);
      return nextHosts.length === 0 ? m : { ...m, hosts: nextHosts };
    });
    editConfig("groups", { ...groups, [group]: { ...groups[group], mounts: next } });
  };
  const createGroup = (name) => {
    if (Object.prototype.hasOwnProperty.call(groups, name)) {
      setEditError({ message: `\u5206\u7EC4\u300C${name}\u300D\u5DF2\u5B58\u5728\uFF0C\u5DF2\u62D2\u7EDD\u521B\u5EFA\uFF08\u907F\u514D\u8986\u76D6\u65E2\u6709\u7EC4\u7684\u6302\u8F7D\u89C4\u5219\uFF09`, prompt: null });
      return false;
    }
    const baseMounts = (groups["\u9ED8\u8BA4"] && groups["\u9ED8\u8BA4"].mounts || []).map((m) => ({ ...m }));
    editConfig("groups", { ...groups, [name]: { mounts: baseMounts } });
    return true;
  };
  const renameGroup = (oldName, newName) => {
    if (Object.prototype.hasOwnProperty.call(groups, newName)) {
      setEditError({ message: `\u5206\u7EC4\u300C${newName}\u300D\u5DF2\u5B58\u5728\uFF0C\u5DF2\u62D2\u7EDD\u6539\u540D\uFF08\u6539\u540D\u4F1A\u8986\u76D6\u76EE\u6807\u7EC4\u7684\u89C4\u5219\u4E0E\u6210\u5458\uFF09`, prompt: null });
      return false;
    }
    const nextGroups = {};
    for (const [name, g] of Object.entries(groups)) nextGroups[name === oldName ? newName : name] = g;
    const nextSkills = {};
    for (const [dir, intent] of Object.entries(skillsIntent)) {
      nextSkills[dir] = intent.group === oldName ? { ...intent, group: newName } : intent;
    }
    editConfig("groups", nextGroups);
    editConfig("skills", nextSkills);
    return true;
  };
  const deleteGroup = (name) => {
    const nextGroups = {};
    for (const [n, g] of Object.entries(groups)) if (n !== name) nextGroups[n] = g;
    const nextSkills = {};
    for (const [dir, intent] of Object.entries(skillsIntent)) {
      nextSkills[dir] = intent.group === name ? { ...intent, group: "\u9ED8\u8BA4" } : intent;
    }
    editConfig("groups", nextGroups);
    editConfig("skills", nextSkills);
  };
  const config = { groups, skillsIntent, intentOf, editConfig, setSkillDisabled, moveSkill, toggleMount, toggleHost, createGroup, renameGroup, deleteGroup };
  const loadSeq = (0, import_react5.useRef)(0);
  const load = () => {
    setError(null);
    const seq = ++loadSeq.current;
    return call("overview").then((r) => {
      if (seq !== loadSeq.current) return;
      setConfigOverrideUnconfigured(false);
      setData({
        root: r.root,
        lib: r.lib,
        health: r.health.issues,
        workspaces: r.workspaces
      });
    }).catch((e) => {
      if (seq !== loadSeq.current) return;
      if (e && e.code === "skilldir-unconfigured") setConfigOverrideUnconfigured(true);
      else setError(e);
    });
  };
  (0, import_react5.useEffect)(() => {
    const off = subscribeSkillSettings(load);
    load();
    return off;
  }, [reloadTick, subscribeSkillSettings]);
  if (!configReady) {
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.panel, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.muted, children: "\u52A0\u8F7D\u4E2D\u2026" }) });
  }
  if (!skillsDir || configOverrideUnconfigured) {
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: S.guide, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { fontSize: 14, marginBottom: 8, color: T.labelPrimary }, children: "\u5C1A\u672A\u914D\u7F6E\u672C\u5730 skill \u76EE\u5F55" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { children: "\u8BF7\u5230 \u8BBE\u7F6E \u2192 \u63D2\u4EF6 \u2192 skill-manager \u5361\u7247 \u914D\u7F6E\u672C\u5730 skills \u76EE\u5F55\uFF08\u9ED8\u8BA4\u4E3A\u7A7A\u5373\u672A\u914D\u7F6E\uFF09\uFF0C\u914D\u7F6E\u540E\u672C\u9875\u81EA\u52A8\u53EF\u7528\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(OutlineBtn, { style: { marginTop: 12 }, onClick: reload, children: "\u5237\u65B0" })
    ] });
  }
  if (!data) {
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.panel, children: error ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ErrorLineWrap, { error, root: skillsDir }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: S.muted, children: "\u52A0\u8F7D\u4E2D\u2026" }) });
  }
  const TABS = [
    { key: "manage", label: "\u7BA1\u7406", sub: "\u5148\u4E3A\u5206\u7EC4\u914D\u7F6E\u53EF\u7528\u8303\u56F4\uFF0C\u518D\u7BA1\u7406\u5176\u4E2D\u7684 Skill\u3002" },
    { key: "search", label: "\u641C\u7D22", sub: "\u4ECE skills.sh \u641C\u7D22\uFF0C\u6216\u76F4\u63A5\u4ECE GitHub \u4ED3\u5E93\u5165\u5E93\u3002" }
  ];
  const activeTab = TABS.find((t) => t.key === tab);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { padding: "4px 12px 0", marginBottom: 12 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { fontSize: 20, fontWeight: 600, color: T.labelPrimary }, children: "\u6280\u80FD" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { fontSize: 13, color: T.labelTertiary, marginTop: 4 }, children: activeTab ? activeTab.sub : "" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { display: "flex", gap: 20, padding: "0 12px", borderBottom: `1px solid ${T.borderL1}` }, children: TABS.map((t) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      "button",
      {
        type: "button",
        onClick: () => setTab(t.key),
        style: { border: "none", background: "none", padding: "6px 2px 8px", font: "inherit", fontSize: 13, cursor: "pointer", marginBottom: -1, color: tab === t.key ? T.labelPrimary : T.labelSecondary, fontWeight: tab === t.key ? 500 : 400, borderBottom: tab === t.key ? `2px solid ${T.labelPrimary}` : "2px solid transparent" },
        children: t.label
      },
      t.key
    )) }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ErrorLineWrap, { error, root: data && data.root }) : null,
    editError ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { ...badgeStyle(T.error), borderRadius: 10, padding: "8px 12px", margin: "8px 12px 0", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { flex: 1, minWidth: 0, wordBreak: "break-all" }, children: editError.message }),
      editError.prompt ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(RepairCopy, { text: editError.prompt }) : null
    ] }) : null,
    tab === "manage" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ManageView, { call, data, config, reload, showToast }),
    tab === "search" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(SearchView, { call, reload, showToast }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ToastHost, { toast, onDone: dismissToast })
  ] });
}
function ErrorLineWrap({ error, root }) {
  if (!error) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { ...badgeStyle(T.error), borderRadius: 10, padding: "8px 12px", margin: "4px 12px 0", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { flex: 1, minWidth: 0, wordBreak: "break-all" }, children: error.message || String(error) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(RepairCopy, { text: buildRepairPrompt({ root, code: error.code, message: error.message, repair: error.repair }) })
  ] });
}

// src/client/card.jsx
var import_react6 = require("react");
var import_jsx_runtime6 = require("react/jsx-runtime");
function SkillManagerCard({ scope, uiWorkspace }) {
  const [open, setOpen] = (0, import_react6.useState)(false);
  const [draft, setDraft] = (0, import_react6.useState)("");
  const [touched, setTouched] = (0, import_react6.useState)(false);
  const [busy, setBusy] = (0, import_react6.useState)(false);
  const [failed, setFailed] = (0, import_react6.useState)(null);
  const [focused, setFocused] = (0, import_react6.useState)(false);
  const [hoverDiscard, setHoverDiscard] = (0, import_react6.useState)(false);
  const [focusEl, setFocusEl] = (0, import_react6.useState)(null);
  const [snap, setSnap] = (0, import_react6.useState)(() => scope.getSnapshot());
  (0, import_react6.useEffect)(() => {
    let alive = true;
    const apply2 = () => {
      if (alive) setSnap(scope.getSnapshot());
    };
    const off = scope.subscribe(apply2);
    apply2();
    return () => {
      alive = false;
      off();
    };
  }, [scope]);
  const ready = snap.status === "ready";
  const section = snap.value && typeof snap.value === "object" ? snap.value : {};
  const current = typeof section.skillsDir === "string" ? section.skillsDir : "";
  const overridden = Boolean(snap && snap.user && typeof snap.user === "object" && "skillsDir" in snap.user);
  const piOn = section.pi === true;
  (0, import_react6.useEffect)(() => {
    if (!touched) setDraft(current);
  }, [current, touched]);
  const [piDraft, setPiDraft] = (0, import_react6.useState)(null);
  const dirty = touched && draft !== current || piDraft !== null && piDraft !== piOn;
  const reject = (message, code) => ({
    message,
    prompt: buildRepairPrompt({
      root: current,
      code,
      message,
      repair: settingsRejectedRepair("skillsDir", draft.trim(), current, current)
    })
  });
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setFailed(null);
    const attempted = draft.trim();
    try {
      if (touched && attempted !== current) {
        await scope.set("skillsDir", attempted);
        const fresh = scope.getSnapshot();
        const v = fresh.value && typeof fresh.value === "object" ? fresh.value : {};
        const committed = typeof v.skillsDir === "string" ? v.skillsDir : "";
        if (committed !== attempted) {
          setFailed(reject(`\u4FDD\u5B58\u88AB Host \u6821\u9A8C\u62D2\u7EDD\uFF0C\u5DF2\u56DE\u6EDA\u4E3A\u300C${committed || "\u672A\u914D\u7F6E"}\u300D\uFF08\u975E\u7A7A\u76EE\u5F55\u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84\uFF09\u3002`, "settings-validation-rejected"));
          return;
        }
        setDraft(committed);
        setTouched(false);
      }
      if (piDraft !== null && piDraft !== piOn) {
        await scope.set("pi", piDraft);
        const fresh = scope.getSnapshot();
        const v = fresh.value && typeof fresh.value === "object" ? fresh.value : {};
        if (v.pi === true !== piDraft) {
          setFailed({
            message: "\u63A5\u7BA1\u5F00\u5173\u4FDD\u5B58\u88AB\u62D2\u7EDD\uFF0C\u5DF2\u6062\u590D\u539F\u503C\u3002",
            prompt: buildRepairPrompt({ root: current, code: "settings-validation-rejected", message: "\u5B57\u6BB5 pi \u5199\u5165\u88AB Host validate \u62D2\u7EDD", repair: settingsRejectedRepair("pi", piDraft, v.pi, current) })
          });
          return;
        }
        setPiDraft(null);
      }
    } catch (e) {
      setFailed(reject(`\u5199\u5165\u5931\u8D25\uFF08\u8BF7\u6C42\u672A\u8FBE Host\uFF09\uFF1A${e?.message ?? String(e)}`, "settings-write-failed"));
    } finally {
      setBusy(false);
    }
  };
  const discard = () => {
    setFailed(null);
    setDraft(current);
    setTouched(false);
    setPiDraft(null);
  };
  const reset = async () => {
    if (!ready) return;
    setBusy(true);
    setFailed(null);
    try {
      await scope.unset("skillsDir");
      const fresh = scope.getSnapshot();
      const v = fresh.value && typeof fresh.value === "object" ? fresh.value : {};
      setDraft(typeof v.skillsDir === "string" ? v.skillsDir : "");
      setTouched(false);
    } catch (e) {
      setFailed(reject(`\u91CD\u7F6E\u5931\u8D25\uFF08\u8BF7\u6C42\u672A\u8FBE Host\uFF09\uFF1A${e?.message ?? String(e)}`, "settings-write-failed"));
    } finally {
      setBusy(false);
    }
  };
  const pickDirectory = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const path = await uiWorkspace.pickDirectory();
      if (path) {
        setDraft(path);
        setTouched(true);
      }
    } catch (e) {
      setFailed({
        message: e && e.message ? `\u9009\u62E9\u76EE\u5F55\u5931\u8D25\uFF1A${e.message}` : "\u9009\u62E9\u76EE\u5F55\u5931\u8D25",
        prompt: buildRepairPrompt({
          root: current,
          code: "directory-picker-failed",
          message: e && e.message ? e.message : "",
          repair: null
        })
      });
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("li", { style: { listStyle: "none", border: `1px solid ${T.borderL2}`, borderRadius: 12, background: open ? T.bgLayer2 : T.bgLayer3, transition: "border-color .16s, background .16s" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      "button",
      {
        type: "button",
        "aria-expanded": open,
        "aria-label": `${open ? "\u6536\u8D77" : "\u5C55\u5F00"}: \u6280\u80FD\u7BA1\u7406`,
        onClick: () => setOpen(!open),
        onFocus: () => setFocusEl("header"),
        onBlur: () => setFocusEl(null),
        style: { width: "100%", appearance: "none", border: 0, background: "none", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12, ...focusEl === "header" ? { outline: `2px solid ${T.brand}`, outlineOffset: -2 } : {} },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: T.labelPrimary }, children: "\u6280\u80FD\u7BA1\u7406" }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 13, lineHeight: 1.5, color: T.labelTertiary }, children: "\u914D\u7F6E\u672C\u5730 skills \u76EE\u5F55\u4E0E pi agent \u63A5\u7BA1\uFF08\u9ED8\u8BA4\u4E3A\u7A7A\u5373\u672A\u914D\u7F6E\uFF09" })
          ] }),
          dirty ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { flex: "none", borderRadius: 999, padding: "1px 8px", fontSize: 11, lineHeight: "17px", fontWeight: 500, whiteSpace: "nowrap", background: T.bgModulePlatform, color: T.labelSecondary }, children: "\u672A\u4FDD\u5B58" }) : null,
          ChevronIcon ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ChevronIcon, { style: { flex: "none", color: T.labelTertiary, transition: "transform .16s", transform: open ? "rotate(180deg)" : void 0 } }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { flex: "none", color: T.labelTertiary, fontSize: 12 }, children: open ? "\u25BE" : "\u25B8" })
        ]
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { borderTop: `1px solid ${T.borderL2}`, margin: "0 16px", paddingBottom: 8 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, padding: "12px 0" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("label", { htmlFor: "skill-manager-skills-dir", style: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: T.labelPrimary }, children: "\u672C\u5730 skills \u76EE\u5F55" }),
          overridden ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 8 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { borderRadius: 999, padding: "1px 8px", fontSize: 11, lineHeight: "17px", whiteSpace: "nowrap", fontWeight: 500, background: T.bgModulePlatform, color: T.labelSecondary }, children: "\u5DF2\u8986\u76D6" }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", disabled: busy || !ready, onClick: reset, style: { border: "none", background: "none", padding: 0, font: "inherit", fontSize: 12, lineHeight: 1.5, color: T.labelSecondary, cursor: "pointer" }, children: "\u91CD\u7F6E" })
          ] }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "input",
            {
              id: "skill-manager-skills-dir",
              type: "text",
              value: draft,
              placeholder: "\u4F8B\u5982 E:\\Project\\Skills\uFF08\u9ED8\u8BA4\u4E3A\u7A7A = \u672A\u914D\u7F6E\uFF09",
              onChange: (e) => {
                setDraft(e.target.value);
                setTouched(true);
                setFailed(null);
              },
              onFocus: () => setFocused(true),
              onBlur: () => setFocused(false),
              style: { flex: 1, minWidth: 0, height: 34, padding: "0 12px", border: `1px solid ${focused ? T.brand : T.borderL2}`, borderRadius: 8, background: T.bgLayer3, font: "inherit", fontSize: 13, lineHeight: 1.5, color: T.labelPrimary, outline: "none", boxSizing: "border-box" }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(GhostBtn, { disabled: busy || !ready, onClick: pickDirectory, children: "\u9009\u62E9\u2026" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { style: { margin: 0, fontSize: 12, lineHeight: 1.5, color: T.labelTertiary }, children: "\u81EA\u7814/\u672C\u5730 skill \u7684\u5E73\u94FA\u76EE\u5F55\uFF0C\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u4FDD\u5B58\u540E\u7ACB\u5373\u751F\u6548\u3002GitHub \u5165\u5E93\u5B89\u88C5\u5230\u63D2\u4EF6\u4E13\u5C5E\u76EE\u5F55\uFF0C\u4E0D\u53D7\u672C\u5730\u7F16\u8F91\u5F71\u54CD\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 14, padding: "2px 0 12px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 13, fontWeight: 500, color: T.labelPrimary }, children: "\u63A5\u7BA1\u5BBF\u4E3B" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: T.labelTertiary, cursor: "default" }, title: "DSH \u662F\u672C\u63D2\u4EF6\u7684\u57FA\u672C\u76D8\uFF0C\u6052\u4E3A\u63A5\u7BA1\u5BBF\u4E3B", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("input", { type: "checkbox", checked: true, disabled: true, style: { accentColor: T.brand, width: 13, height: 13, margin: 0 } }),
          "DSH"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: T.labelPrimary, cursor: ready && !busy ? "pointer" : "default" }, title: "\u52FE\u9009\u540E\u4FDD\u5B58\u751F\u6548\uFF1Api \u6309\u9ED8\u8BA4\u8DEF\u5F84\u88AB\u63A5\u7BA1\uFF08~/.pi/agent/skills \u4E0E\u5404\u9879\u76EE .pi/skills\uFF09", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("input", { type: "checkbox", checked: piDraft ?? piOn, disabled: busy || !ready, onChange: (e) => {
            setPiDraft(e.target.checked);
            setFailed(null);
          }, style: { accentColor: T.brand, width: 13, height: 13, margin: 0 } }),
          "pi agent"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 12, lineHeight: 1.5, color: T.labelTertiary }, children: "pi \u56FA\u5B9A\u8D70\u9ED8\u8BA4\u8DEF\u5F84\uFF08~/.pi/agent\uFF09\uFF0C\u4FDD\u5B58\u540E\u751F\u6548" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 0 4px", borderTop: `1px solid ${T.borderL2}` }, children: [
        failed ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { style: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: T.error }, children: failed.message }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RepairCopy, { text: failed.prompt })
        ] }) : null,
        (() => {
          const blocked = !dirty || busy || !ready;
          const focusStyle = (el) => focusEl === el ? { outline: `2px solid ${T.brand}`, outlineOffset: 1 } : {};
          return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              "button",
              {
                type: "button",
                disabled: blocked,
                onClick: discard,
                onMouseEnter: () => setHoverDiscard(true),
                onMouseLeave: () => setHoverDiscard(false),
                onFocus: () => setFocusEl("discard"),
                onBlur: () => setFocusEl(null),
                style: { appearance: "none", border: `1px solid ${!blocked && hoverDiscard ? T.labelDimmed : T.borderL2}`, borderRadius: 8, padding: "5px 14px", font: "inherit", fontSize: 13, lineHeight: 1.5, cursor: blocked ? "default" : "pointer", background: "none", color: !blocked && hoverDiscard ? T.labelPrimary : T.labelSecondary, opacity: blocked ? 0.4 : 1, ...focusStyle("discard") },
                children: "\u653E\u5F03"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              "button",
              {
                type: "button",
                disabled: blocked,
                onClick: save,
                onFocus: () => setFocusEl("save"),
                onBlur: () => setFocusEl(null),
                style: { appearance: "none", border: "1px solid transparent", borderRadius: 8, padding: "5px 14px", font: "inherit", fontSize: 13, lineHeight: 1.5, cursor: blocked ? "default" : "pointer", background: T.labelPrimary, color: T.bgLayer3, opacity: blocked ? 0.4 : 1, ...focusStyle("save") },
                children: busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"
              }
            )
          ] });
        })()
      ] })
    ] }) : null
  ] });
}

// src/client/nav-icon.js
var SKILL_ICON_PATHS = [
  "M12.5113 15.4067C12.4395 15.6249 12.1308 15.6249 12.059 15.4067L11.643 14.1416C11.454 13.567 11.0033 13.1164 10.4288 12.9274L9.16369 12.5113C8.94544 12.4395 8.94544 12.1308 9.16369 12.059L10.4288 11.643C11.0033 11.454 11.454 11.0033 11.643 10.4288L12.059 9.16369C12.1308 8.94544 12.4395 8.94544 12.5113 9.16369L12.9274 10.4288C13.1164 11.0033 13.567 11.454 14.1416 11.643L15.4067 12.059C15.6249 12.1308 15.6249 12.4395 15.4067 12.5113L14.1416 12.9274C13.567 13.1164 13.1164 13.567 12.9274 14.1416L12.5113 15.4067Z",
  "M9.02246 0.546878C9.9822 0.546878 10.7564 0.545403 11.374 0.612307C12.0042 0.680586 12.5515 0.826244 13.0273 1.17188C13.3052 1.37376 13.5501 1.61868 13.752 1.89649C14.0975 2.37225 14.2432 2.91984 14.3115 3.54981C14.3784 4.16727 14.377 4.94206 14.377 5.90137V8.51367C13.9611 8.29533 13.5071 8.13985 13.0273 8.06055V5.90137C13.0273 4.9121 13.0259 4.22322 12.9688 3.69532C12.9129 3.18044 12.8098 2.89782 12.6592 2.69043C12.5406 2.52724 12.3966 2.38326 12.2334 2.26465C12.026 2.11404 11.7437 2.0109 11.2285 1.95508C10.7005 1.89789 10.0122 1.89649 9.02246 1.89649H6.55371C5.56395 1.89649 4.87569 1.89787 4.34766 1.95508C3.83242 2.01092 3.55022 2.11398 3.34278 2.26465C3.17953 2.38329 3.03564 2.52719 2.91699 2.69043C2.76642 2.89782 2.66325 3.18042 2.60742 3.69532C2.55027 4.22322 2.54883 4.9121 2.54883 5.90137V10.0986C2.54883 11.0878 2.55031 11.7768 2.60742 12.3047C2.66326 12.8196 2.76642 13.1032 2.91699 13.3105C3.03558 13.4736 3.17966 13.6178 3.34278 13.7363C3.5502 13.8869 3.83265 13.9901 4.34766 14.0459C4.87568 14.1031 5.56398 14.1035 6.55371 14.1035H8.08399C8.27443 14.6025 8.55077 15.0585 8.89551 15.4541H6.55371C5.59402 15.4541 4.81976 15.4546 4.20215 15.3877C3.57204 15.3194 3.02468 15.1738 2.54883 14.8281C2.27111 14.6263 2.02606 14.3813 1.82422 14.1035C1.47883 13.6278 1.33293 13.08 1.26465 12.4502C1.19783 11.8327 1.19922 11.0579 1.19922 10.0986V5.90137C1.19922 4.94206 1.1978 4.16727 1.26465 3.54981C1.33295 2.91984 1.47867 2.37225 1.82422 1.89649C2.02613 1.61864 2.27098 1.37379 2.54883 1.17188C3.02472 0.826181 3.57197 0.6806 4.20215 0.612307C4.81976 0.545393 5.594 0.546877 6.55371 0.546878H9.02246ZM9.19629 9.14649H4.5459V7.84571H9.19629V9.14649ZM11.0303 6.10645H4.5459V4.80567H11.0303V6.10645Z"
];
function patchSkillsNavIcon() {
  for (const label of document.querySelectorAll('span[class*="navLabel"]')) {
    if (label.textContent !== "\u6280\u80FD") continue;
    const cell = label.closest("button");
    const svg = cell ? cell.querySelector("svg") : null;
    if (!svg) continue;
    const first = svg.firstElementChild;
    if (first && first.tagName === "path" && first.getAttribute("d") === SKILL_ICON_PATHS[0]) continue;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    for (const d of SKILL_ICON_PATHS) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "currentColor");
      svg.appendChild(path);
    }
  }
}
function observeSkillsNavIcon() {
  patchSkillsNavIcon();
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.addedNodes.length > 0)) patchSkillsNavIcon();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

// src/client/index.jsx
var inject = ["slots", "workspaces", "uiWorkspace", "settingsScope", "remote", "connection"];
function apply(ctx) {
  const call = createCall(ctx);
  const workspaces = ctx.workspaces;
  const uiWorkspace = ctx.uiWorkspace;
  const scope = ctx.settingsScope.bind({ namespace: "skill-manager" });
  const settingsListeners = /* @__PURE__ */ new Set();
  const subscribeSkillSettings = (fn) => {
    settingsListeners.add(fn);
    return () => settingsListeners.delete(fn);
  };
  const bumpSkillSettings = () => {
    for (const fn of [...settingsListeners]) fn();
  };
  ctx.effect(() => {
    const offSection = ctx.slots.inject(
      "settings.section",
      () => ctx.slots.register(
        { name: "settings.section", id: "skills", order: 16, label: "\u6280\u80FD", inject: () => ({ call, workspaces, scope, subscribeSkillSettings }) },
        SkillsSection
      )
    );
    const offCard = ctx.slots.inject(
      "settings.plugin.item",
      () => ctx.slots.register(
        // rc.7 起该槽为 keyed：key = 本卡片编辑的 settings 命名空间
        // 卡片只需要 scope + uiWorkspace（目录选择器在 uiWorkspace 面上，不在 workspaces 面上）
        { name: "settings.plugin.item", key: "skill-manager", inject: () => ({ scope, uiWorkspace }) },
        SkillManagerCard
      )
    );
    const offSettings = ctx.remote.$on("settings/document-updated", (ns) => {
      if (ns === "skill-manager") bumpSkillSettings();
    });
    const offNavIcon = observeSkillsNavIcon();
    return () => {
      offSection();
      offCard();
      offSettings();
      offNavIcon();
    };
  }, "dsh-skill-manager: settings slots");
}
return module.exports; } });
