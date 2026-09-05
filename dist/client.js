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

// src/client/api.js
var CHANNEL = "/skill-manager";
var API_TIMEOUT_MS = 15e3;
var DOWNLOAD_TIMEOUT_MS = 9e4;
var DOWNLOAD_ENDPOINTS = /* @__PURE__ */ new Set(["add", "update"]);
var RpcError = class extends Error {
  /** @type {string} 稳定错误码（Host errors.js 码表；transport = 通道层失败） */
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
  const aborted = error instanceof DOMException ? error.name === "AbortError" : Boolean(error && error.name === "AbortError");
  const message = aborted ? `\u8C03\u7528 ${endpoint} \u8D85\u65F6\uFF08${budgetMs / 1e3}s\uFF09\uFF1AHost \u53EF\u80FD\u6B63\u5FD9\u6216\u5DF2\u5931\u8054\u3002` : `\u4E0E Host \u7684 RPC \u901A\u9053\u5931\u8D25\uFF08${endpoint}\uFF09\uFF1A${error && error.message ? error.message : String(error)}`;
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
    if (result && typeof result === "object" && result.ok === true) return result.value;
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
  select: { padding: "4px 8px", borderRadius: 6, border: `1px solid ${T.borderL1}`, background: T.bgBase, color: T.labelPrimary, fontSize: 12 },
  panel: { padding: "10px 12px" },
  error: { color: T.error, fontSize: 12, padding: "6px 8px" },
  muted: { color: T.labelSecondary, fontSize: 12 },
  guide: { padding: "24px 16px", textAlign: "center", color: T.labelSecondary, fontSize: 13 },
  dangerText: { color: T.error },
  toolbar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }
};
var cardStyle = { border: `1px solid ${T.borderL1}`, borderRadius: 12, background: T.bgLayer3 };
var subCardStyle = { borderRadius: 10, background: T.bgModulePlatform };
var dotStyle = (color) => ({ width: 7, height: 7, borderRadius: 4, background: color, flex: "none" });
var sectionHead = { fontSize: 14, fontWeight: 600, color: T.labelPrimary };
var cardTitle = { fontSize: 13, fontWeight: 600, color: T.labelPrimary };
var noteText = { fontSize: 11, color: T.labelSecondary };
var dividerStyle = { height: 1, background: T.borderL1, flex: "none" };

// src/client/ui.jsx
var import_react = require("react");
var primitives = __toESM(require("@deepseek-ai/dsh-client-ui-primitives"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime = require("react/jsx-runtime");
var ChevronIcon = typeof primitives.IconChevronDownOutline14 === "function" ? primitives.IconChevronDownOutline14 : null;
var GhostBtn = (props) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "ghost", size: "sm", ...props });
var OutlineBtn = (props) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", ...props });
function ErrorLine({ error }) {
  if (!error) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: T.error, fontSize: 12, padding: "6px 8px" }, children: String(error.message || error) });
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
      onClick: disabled ? void 0 : onClick,
      onMouseEnter: () => {
        setHover(true);
        if (onEnter) onEnter();
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
function RowMenu({ it, groupNames, busy, onAction, onMove, onClose }) {
  const [subOpen, setSubOpen] = (0, import_react.useState)(false);
  const current = it.group || "\u9ED8\u8BA4";
  const allGroups = [.../* @__PURE__ */ new Set([...groupNames, "\u9ED8\u8BA4"])];
  const external = it.origin === "github";
  const pick = (group) => {
    if (group !== current) onMove(group);
    onClose();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { position: "fixed", inset: 0, zIndex: 40 }, onClick: onClose }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...menuCardStyle, right: 4, top: "calc(100% - 6px)" }, children: [
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
          onEnter: () => setSubOpen(true),
          onClick: () => setSubOpen((v) => !v),
          trailing: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: T.labelSecondary }, children: "\u25B8" }),
          children: subOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...menuCardStyle, right: "100%", top: -7, marginRight: 6, minWidth: 124, zIndex: 42 }, children: allGroups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
        }
      ),
      external && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        menuDivider,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MenuItem, { label: "\u5220\u9664", danger: true, disabled: busy, onClick: () => {
          onClose();
          onAction("remove");
        } })
      ] })
    ] })
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
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", onClick: onConfirm, disabled: busy || !acknowledged, children: busy ? "\u66F4\u65B0\u4E2D\u2026" : "\u7EE7\u7EED\u66F4\u65B0" })
    ] })
  ] });
}

// src/client/repair.jsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime2 = require("react/jsx-runtime");
function copyText(text) {
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
    }
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(fallback);
  } else {
    fallback();
  }
}
function fallbackRepair({ operation = "unknown", code = "internal", message = "" } = {}) {
  const transport = code === "transport";
  return {
    operation,
    summary: transport ? "\u4E0E Host \u7684 RPC \u901A\u9053\u5931\u8D25\uFF1A\u8BF7\u6C42\u672A\u80FD\u9001\u8FBE\u6216\u5E94\u7B54\u65E0\u6CD5\u89E3\u6790\uFF08\u53EF\u80FD\u672A\u8BA4\u8BC1\u3001\u88AB\u56F4\u680F\u62D2\u7EDD\u6216\u5B9E\u4F8B\u5931\u8054\uFF09\u3002" : `\u64CD\u4F5C\u5931\u8D25\uFF08${code}\uFF09\u3002`,
    facts: message ? [{ label: "\u901A\u9053\u9519\u8BEF", value: message }] : [],
    recommendation: transport ? ["\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5\u4E00\u6B21\uFF08\u5BA2\u6237\u7AEF\u4E0E Host \u7248\u672C\u53EF\u80FD\u4E0D\u4E00\u81F4\uFF09", "\u786E\u8BA4 DSH \u5B9E\u4F8B\u4ECD\u5728\u8FD0\u884C\u4E14\u672C\u63D2\u4EF6\u5DF2\u52A0\u8F7D", "\u628A\u672C\u63D0\u793A\u8BCD\u4EA4\u7ED9\u672C\u5730 Agent\uFF1A\u53EA\u8BFB\u68C0\u67E5\u63D2\u4EF6\u52A0\u8F7D\u65E5\u5FD7\u4E0E settings.yaml \u7684 skill-manager \u6BB5"] : ["\u5148\u539F\u6837\u91CD\u8BD5\u4E00\u6B21\uFF08\u5076\u53D1\u5931\u8D25\u53EF\u80FD\u81EA\u884C\u6062\u590D\uFF09", "\u4ECD\u5931\u8D25\u65F6\u628A\u672C\u63D0\u793A\u8BCD\u4EA4\u7ED9\u672C\u5730 Agent\uFF1A\u53EA\u8BFB\u6392\u67E5\u4E0A\u4E0B\u6587\u6D89\u53CA\u7684\u8DEF\u5F84\u4E0E\u914D\u7F6E\uFF1B\u4EFB\u4F55\u5199\u64CD\u4F5C\u987B\u5148\u5411\u7528\u6237\u786E\u8BA4"]
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
  const [copied, setCopied] = (0, import_react2.useState)(false);
  (0, import_react2.useEffect)(() => {
    if (!copied) return void 0;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    import_dsh_client_ui_primitives2.Button,
    {
      size: "sm",
      variant: "outline",
      onClick: () => {
        copyText(text);
        setCopied(true);
      },
      style: { fontSize: 11, padding: "2px 8px", whiteSpace: "nowrap" },
      children: copied ? "\u5DF2\u590D\u5236" : label
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
function targetLabel(target, workspaces) {
  if (typeof target !== "string") return String(target ?? "\u2014");
  if (target.startsWith("global|")) return "DSH \u5168\u5C40";
  const id = target.slice("project|".length);
  const ws = workspaces.find((w) => w.workspaceId === id);
  return ws ? ws.title : `\u5DE5\u4F5C\u533A ${id.slice(0, 8)}\u2026`;
}
function ManageView({ call, data, config, reload }) {
  const [origin, setOrigin] = (0, import_react3.useState)("");
  const [groupFilter, setGroupFilter] = (0, import_react3.useState)("\u9ED8\u8BA4");
  const [q, setQ] = (0, import_react3.useState)("");
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [error, setError] = (0, import_react3.useState)(null);
  const [notice, setNotice] = (0, import_react3.useState)(null);
  const [pendingUpdate, setPendingUpdate] = (0, import_react3.useState)(null);
  const [menuFor, setMenuFor] = (0, import_react3.useState)(null);
  const [createOpen, setCreateOpen] = (0, import_react3.useState)(false);
  const [expandedMount, setExpandedMount] = (0, import_react3.useState)(null);
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
  for (const w of data.lib.warnings || []) {
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
  for (const issue of (data.health || []).filter((i) => i.issue === "orphan-link")) {
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
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action === "update") {
        if (payload.confirmLocalChanges !== true) {
          const checks = await call("check", { names: [name] });
          const check = (checks || []).find((item) => item.name === name);
          if (check?.locally_modified || check?.baseline_missing) {
            setPendingUpdate({
              name,
              detail: `\u5F53\u524D ${check.current ? check.current.slice(0, 7) : "\u672A\u77E5"} \u2192 \u4E0A\u6E38 ${check.latest ? check.latest.slice(0, 7) : "\u5F85\u68C0\u67E5"}\u3002`
            });
            return;
          }
        }
        const r = await call("update", { names: [name], confirmLocalChanges: payload.confirmLocalChanges === true });
        const it = (r.results || []).find((item) => item.name === name);
        setNotice(it ? `${name}\uFF1A${it.status}${it.reason ? "\uFF08" + it.reason + "\uFF09" : ""}` : `${name}\uFF1A\u66F4\u65B0\u5B8C\u6210`);
      } else if (action === "remove") {
        if (!window.confirm(`\u786E\u8BA4\u51FA\u5E93 ${name}\uFF1F\u5220\u9664\u524D\u81EA\u52A8\u5907\u4EFD\u5230 DSH HOME \u5907\u4EFD\u533A\uFF08\u81EA\u6709\u76EE\u5F55\u65E0\u5220\u9664\u5165\u53E3\uFF09\u3002`)) return;
        const r = await call("remove", { name });
        setNotice(r.backup ? `${name} \u5DF2\u51FA\u5E93\uFF0C\u5907\u4EFD\u4E8E ${r.backup}` : `${name} \u5DF2\u51FA\u5E93\uFF08\u76EE\u5F55\u672C\u5DF2\u7F3A\u5931\uFF0C\u65E0\u7269\u53EF\u5907\uFF09`);
      }
      reload();
    } catch (e) {
      if (action === "update" && e?.code === "local-changes-confirmation-required" && payload.confirmLocalChanges !== true) {
        setPendingUpdate({ name, detail: e.message || "\u68C0\u6D4B\u5230\u672C\u5730\u4FEE\u6539\u3002" });
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
      try {
        const r = await call("check", {});
        const failed = (r || []).filter((it) => it.status === "check_failed").length;
        setNotice(failed > 0 ? `\u68C0\u67E5\u5B8C\u6210\uFF1B${failed} \u4E2A\u4E0A\u6E38\u4E0D\u53EF\u8FBE` : "\u68C0\u67E5\u5B8C\u6210");
      } catch (e) {
        setError(e);
      }
      try {
        const s = await call("sync", {});
        const problems = (s?.errors || []).length + (s?.warnings || []).length;
        if (problems > 0) setNotice(`\u5BF9\u8D26\u5B8C\u6210\uFF1B${problems} \u9879\u73B0\u573A\u9700\u8981\u5173\u6CE8\uFF08\u89C1\u884C\u72B6\u6001/\u8B66\u544A\u6761\uFF09`);
      } catch (e) {
        setError(e);
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
      if (!window.confirm(`\u5220\u9664\u7EC4 ${name}\uFF1F\u6210\u5458\u5C06\u56DE\u843D\u300C\u9ED8\u8BA4\u300D\u7EC4`)) return;
      deleteGroup(name);
      if (groupFilter === name) setGroupFilter("\u9ED8\u8BA4");
    } else if (action === "rename") {
      renameGroup(name, newName);
      if (groupFilter === name && newName) setGroupFilter(newName);
    }
  };
  const doCreateGroup = (name) => {
    config.createGroup(name);
    setCreateOpen(false);
    setGroupFilter(name);
    setNotice(`\u5DF2\u521B\u5EFA\u5206\u7EC4\u300C${name}\u300D`);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: S.panel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { marginBottom: 14 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: sectionHead, children: "\u5206\u7EC4" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: noteText, children: `${data.lib.skills.length} \u4E2A Skill` })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Pill, { active: groupFilter === "", onClick: () => setGroupFilter(""), children: `\u5168\u90E8 \xB7 ${data.lib.skills.length}` }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Pill, { active: groupFilter === "\u9ED8\u8BA4", onClick: () => setGroupFilter("\u9ED8\u8BA4"), children: `\u9ED8\u8BA4 \xB7 ${countForGroup("\u9ED8\u8BA4")}` }),
        groupNames.filter((group) => group !== "\u9ED8\u8BA4").map((group) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Pill, { active: groupFilter === group, onClick: () => setGroupFilter(group), children: `${group} \xB7 ${countForGroup(group)}` }, group)),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Pill, { active: false, onClick: () => setCreateOpen(true), children: "\uFF0B \u65B0\u5EFA\u5206\u7EC4" })
      ] }),
      groupFilter === "" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...cardStyle, padding: "12px 14px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: cardTitle, children: "\u5F53\u524D\u67E5\u770B\uFF1A\u5168\u90E8\u6280\u80FD" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...noteText, marginTop: 4 }, children: "\u9009\u62E9\u4E00\u4E2A\u5206\u7EC4\u540E\uFF0C\u53EF\u914D\u7F6E\u5B83\u5728 DSH \u5168\u5C40\u4E0E\u5404\u5DE5\u4F5C\u533A\u7684\u53EF\u7528\u8303\u56F4\u3002" })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GroupScopePanel, { config, group: groupFilter, workspaces: data.workspaces, onGroupOp: groupOp })
    ] }),
    warningLines.map((w) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...badgeStyle(T.warn), borderRadius: 10, padding: "9px 12px", marginBottom: 8, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: dotStyle(T.warn) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1 }, children: w.text }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(RepairCopy, { text: w.prompt })
    ] }, w.key)),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: sectionHead, children: "\u6280\u80FD\u5E93" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: noteText, children: `${groupFilter === "" ? "\u5168\u90E8" : groupFilter} \xB7 ${list.length} \u4E2A` }),
      data.lib.checkedAt ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: noteText, children: `\u4E0A\u6E38\u72B6\u6001\u68C0\u67E5\u4E8E ${fmtCheckedAt(data.lib.checkedAt)}` }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...S.toolbar, marginBottom: 12 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Input, { style: { flex: 1, minWidth: 140 }, placeholder: "\u641C\u7D22\u540D\u79F0 / \u63CF\u8FF0\u2026", value: q, onChange: (e) => setQ(e.target.value) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { style: { ...S.select, border: "none", background: T.bgModulePlatform, borderRadius: 8, padding: "5px 10px" }, value: origin, onChange: (e) => setOrigin(e.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "", children: "\u5168\u90E8\u6765\u6E90" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "github", children: "GitHub" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "self", children: "\u81EA\u7814/\u672C\u5730" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GhostBtn, { onClick: refreshAll, disabled: busy, title: "\u91CD\u65B0\u68C0\u67E5\u5168\u90E8\u4E0A\u6E38\u3001\u6267\u884C\u4E00\u6B21\u5B89\u5168\u5BF9\u8D26\u5E76\u5237\u65B0\u5217\u8868", children: "\u21BB \u5237\u65B0" })
    ] }),
    notice ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...S.muted, marginBottom: 6 }, children: notice }) : null,
    error ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ErrorLine, { error }) : null,
    list.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...S.muted, padding: 12 }, children: "\u5E93\u4E3A\u7A7A\uFF08\u65E0\u5339\u914D skill\uFF09" }) : list.map((it) => {
      const mountIssues = (it.mount || []).filter((row) => row.issue && row.issue !== "ok");
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { position: "relative" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: S.row, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { flex: 1, minWidth: 0 }, title: it.description || "", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontWeight: 600, color: T.labelPrimary }, children: it.name }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: noteText, children: [
              ORIGIN_LABEL[it.origin] || it.origin,
              it.group,
              (it.targets || []).length > 0 ? (it.targets || []).map((t) => targetLabel(t, data.workspaces)).join(" / ") : null,
              it.commit ? it.commit.slice(0, 7) : null
            ].filter(Boolean).join(" \xB7 ") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }, children: [
            it.missing && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: statusPillStyle("error"), children: "\u7F3A\u5931" }),
            it.disabled && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: statusPillStyle("warn"), children: "\u5DF2\u7981\u7528" }),
            !it.hasSkillMd && !it.missing && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: statusPillStyle("warn"), children: "\u65E0 SKILL.md" }),
            it.nameVisible === false && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: statusPillStyle("warn"), title: "\u5B89\u88C5\u540D\u4E0D\u7B26\u5408\u5C0F\u5199\u8FDE\u5B57\u7B26\u6587\u6CD5\uFF0CDSH \u4E0D\u53EF\u89C1", children: "\u540D\u6587\u6CD5" }),
            mountIssues.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                title: "\u70B9\u51FB\u5C55\u5F00\u6302\u8F7D\u5931\u8D25\u660E\u7EC6\u4E0E\u4FEE\u590D\u63D0\u793A\u8BCD",
                onClick: () => setExpandedMount(expandedMount === it.dir ? null : it.dir),
                style: { ...statusPillStyle("error"), border: "none", font: "inherit", cursor: "pointer" },
                children: `\u6302\u8F7D\u5931\u8D25 ${mountIssues.length} \xB7 ${expandedMount === it.dir ? "\u6536\u8D77" : "\u5C55\u5F00"}`
              }
            ),
            it.upstream && it.upstream.status === "updatable" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: statusPillStyle("updatable"), children: "\u53EF\u66F4\u65B0" }),
            it.upstream && it.upstream.status === "up_to_date" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: statusPillStyle("normal"), children: "\u5DF2\u662F\u6700\u65B0" }),
            it.upstream && it.upstream.status === "check_failed" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: statusPillStyle("warn"), children: "\u68C0\u67E5\u5931\u8D25" }),
            it.upstream && it.upstream.locally_modified && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: statusPillStyle("warn"), children: "\u672C\u5730\u6709\u4FEE\u6539" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                title: "\u884C\u64CD\u4F5C",
                disabled: busy,
                onClick: () => setMenuFor(menuFor === it.dir ? null : it.dir),
                style: { border: "none", background: "transparent", cursor: busy ? "default" : "pointer", fontSize: 16, lineHeight: 1, padding: "3px 6px", borderRadius: 6, color: menuFor === it.dir ? T.labelPrimary : T.labelSecondary },
                children: "\u22EF"
              }
            )
          ] }),
          menuFor === it.dir && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            RowMenu,
            {
              it,
              groupNames,
              busy,
              onAction: (action) => rowAction(it.dir, action),
              onMove: (group) => moveSkill(it.dir, group),
              onClose: () => setMenuFor(null)
            }
          )
        ] }),
        expandedMount === it.dir && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...subRowPanel }, children: mountIssues.map((row, idx) => {
          const repair = mountIssueRepair(row.issue, { name: it.dir, targetLabel: targetLabel(row.target, data.workspaces), path: row.path, root: data.root });
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "4px 0" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: dotStyle(T.error) }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { flex: 1, minWidth: 0 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontWeight: 500, color: T.labelPrimary }, children: `${targetLabel(row.target, data.workspaces)} \xB7 ${row.issue}` }),
              row.path ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { ...noteText, display: "block", wordBreak: "break-all" }, children: row.path }) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(RepairCopy, { text: buildRepairPrompt({ root: data.root, code: row.issue, message: `${it.dir} \u2192 ${row.path || targetLabel(row.target, data.workspaces)}`, repair }) })
          ] }, `${row.target}-${idx}`);
        }) })
      ] }, it.dir);
    }),
    createOpen && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CreateGroupDialog, { onCancel: () => setCreateOpen(false), onCreate: doCreateGroup }),
    pendingUpdate && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      UpdateConfirmationDialog,
      {
        name: pendingUpdate.name,
        detail: pendingUpdate.detail,
        busy,
        onCancel: () => setPendingUpdate(null),
        onConfirm: () => {
          const name = pendingUpdate.name;
          setPendingUpdate(null);
          rowAction(name, "update", { confirmLocalChanges: true });
        }
      }
    )
  ] });
}
var subRowPanel = {
  margin: "-4px 0 10px",
  padding: "8px 12px",
  borderRadius: 10,
  background: T.bgLayer3,
  border: `1px solid ${T.borderL1}`
};
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
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", onClick: submit, children: "\u65B0\u5EFA" })
    ] })
  ] });
}
function GroupScopePanel({ config, group, workspaces, onGroupOp }) {
  const [renaming, setRenaming] = (0, import_react3.useState)(false);
  const [newName, setNewName] = (0, import_react3.useState)("");
  const { groups, toggleMount } = config;
  const mounts = groups[group] && groups[group].mounts || [];
  const enabled = (scopeKind, workspaceId) => mounts.some((mount) => mount.scope === scopeKind && (scopeKind === "global" || mount.project === workspaceId));
  const toggle = (scopeKind, workspaceId, checked) => toggleMount(group, scopeKind, workspaceId, checked);
  const manageable = group !== "\u9ED8\u8BA4";
  const submitRename = () => {
    const trimmed = newName.trim();
    setRenaming(false);
    if (trimmed && trimmed !== group) onGroupOp("rename", group, trimmed);
  };
  const entryStyle = (danger) => ({ border: "none", background: "none", padding: 0, font: "inherit", fontSize: 11, color: danger ? T.error : T.labelSecondary, cursor: "pointer" });
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
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", onClick: submitRename, children: "\u4FDD\u5B58" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GhostBtn, { onClick: () => setRenaming(false), children: "\u53D6\u6D88" })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: cardTitle, children: `\u5F53\u524D\u5206\u7EC4\uFF1A${group}` }),
      manageable && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1 } }),
      manageable && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", style: entryStyle(false), onClick: () => {
        setNewName(group);
        setRenaming(true);
      }, children: "\u6539\u540D" }),
      manageable && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", style: entryStyle(true), onClick: () => onGroupOp("delete", group), children: "\u5220\u9664" })
    ] }),
    renaming && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...noteText, marginBottom: 8 }, children: "\u6539\u540D\u7ACB\u5373\u751F\u6548\uFF1A\u5206\u7EC4\u6210\u5458\u4E0E\u6302\u8F7D\u89C4\u5219\u540C\u6B65\u6539\u540D\uFF0CSkill \u672C\u4F53\u4E0D\u53D7\u5F71\u54CD\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { height: 1, background: T.borderL1, flex: "none" } }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, padding: "9px 0", fontSize: 12, cursor: "pointer" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", checked: enabled("global"), onChange: (event) => toggle("global", null, event.target.checked) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontWeight: 500, color: T.labelPrimary }, children: "DSH \u5168\u5C40" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: noteText, children: "\u5BF9\u6240\u6709 DSH \u9879\u76EE\u751F\u6548" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { height: 1, background: T.borderL1, flex: "none" } }),
    workspaces.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...S.muted, padding: "8px 0" }, children: "\u5F53\u524D\u6CA1\u6709 DSH \u5DE5\u4F5C\u533A\uFF1B\u8BF7\u5728 DSH \u539F\u751F\u5DE5\u4F5C\u533A\u754C\u9762\u521B\u5EFA\u6216\u6253\u5F00\u9879\u76EE\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 10, color: T.labelTertiary, padding: "7px 0 1px" }, children: "\u5DE5\u4F5C\u533A\u9879\u76EE" }),
      workspaces.map((workspace) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, padding: "7px 0", fontSize: 12, cursor: "pointer" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", checked: enabled("project", workspace.workspaceId), onChange: (event) => toggle("project", workspace.workspaceId, event.target.checked) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontWeight: 500, color: T.labelPrimary }, children: workspace.title }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: noteText, children: `${workspace.path} \xB7 ${workspace.mountCount} \u4E2A\u7EC4\u4F7F\u7528` })
      ] }, workspace.workspaceId))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { height: 1, background: T.borderL1, flex: "none" } }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...noteText, paddingTop: 8 }, children: "\u53D6\u6D88\u52FE\u9009\u4F1A\u79FB\u9664\u8BE5\u5206\u7EC4\u5728\u8BE5\u76EE\u6807\u4E0B\u7684\u5168\u90E8 Skill \u94FE\u63A5\u3002" }),
    manageable && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...noteText, paddingTop: 4 }, children: "\u5220\u9664\u7EC4\uFF1A\u6210\u5458\u56DE\u843D\u300C\u9ED8\u8BA4\u300D\u7EC4\uFF0C\u6267\u884C\u524D\u9700\u786E\u8BA4\u3002" })
  ] });
}

// src/client/search.jsx
var import_react4 = require("react");
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime4 = require("react/jsx-runtime");
function SearchView({ call, reload }) {
  const [query, setQuery] = (0, import_react4.useState)("");
  const [results, setResults] = (0, import_react4.useState)(null);
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [error, setError] = (0, import_react4.useState)(null);
  const [notice, setNotice] = (0, import_react4.useState)(null);
  const [candidates, setCandidates] = (0, import_react4.useState)(null);
  const [selected, setSelected] = (0, import_react4.useState)(/* @__PURE__ */ new Set());
  const showCandidates = (value) => {
    setCandidates(value);
    setSelected(/* @__PURE__ */ new Set());
    setNotice(null);
    setError(null);
  };
  const doSearch = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call("search", { query });
      setResults(r);
      setCandidates(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const addFrom = async (repo, dir) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call("repo-skills", { repo, ref: "main" });
      if (r.candidates.length <= 1) {
        await call("add", { repo, dir: r.candidates[0] && r.candidates[0].path ? r.candidates[0].path : dir, ref: r.branch });
        setNotice(`\u5DF2\u5165\u5E93 ${repo}`);
        reload();
      } else {
        showCandidates({ repo, branch: r.branch, list: r.candidates });
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const suggestName = (c) => c.path ? c.path.split("/").pop() : candidates.repo.split("/")[1] || candidates.repo;
  const addSelected = async () => {
    if (!candidates || selected.size === 0) return;
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
      setNotice(`\u5DF2\u5165\u5E93 ${done} \u4E2A${failures.length > 0 ? `\uFF1B\u5931\u8D25 ${failures.length} \u4E2A` : ""}`);
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: S.panel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { ...cardTitle, marginBottom: 8 }, children: "\u641C\u7D22 skills.sh" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }, children: [
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
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { size: "sm", onClick: doSearch, disabled: busy || !query.trim(), children: busy ? "\u641C\u7D22\u4E2D\u2026" : "\u641C\u7D22" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DirectAdd, { call, reload, busy, setBusy, setError, onCandidates: showCandidates, onAdded: () => setNotice("\u5DF2\u5165\u5E93") }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ErrorLine, { error }) : null,
    notice ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { ...S.muted, marginBottom: 6 }, children: notice }) : null,
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
      candidates.list.map((c) => {
        const key = c.path || "";
        const checked = selected.has(key);
        return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { style: { ...S.row, cursor: busy ? "default" : "pointer" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "input",
            {
              type: "checkbox",
              checked,
              disabled: busy,
              onChange: () => {
                const next = new Set(selected);
                if (checked) next.delete(key);
                else next.add(key);
                setSelected(next);
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { style: { flex: 1, minWidth: 0 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { color: T.labelPrimary, fontWeight: 500, fontSize: 12 }, children: c.path || "\uFF08\u4ED3\u5E93\u6839\uFF09" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: noteText, children: `\u5EFA\u8BAE\u540D\u79F0\uFF1A${suggestName(c)}` })
          ] })
        ] }, key || "<root>");
      }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, margin: "10px 0" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { ...noteText, flex: 1 }, children: `\u5DF2\u9009 ${selected.size} \u4E2A \xB7 \u5171 ${candidates.list.length} \u4E2A\u5019\u9009` }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { size: "sm", onClick: addSelected, disabled: busy || selected.size === 0, children: busy ? "\u5165\u5E93\u4E2D\u2026" : "\u5165\u5E93\u6240\u9009" })
      ] }),
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
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(OutlineBtn, { onClick: () => addFrom(s.repo, s.directory), disabled: busy, children: "\u5165\u5E93" })
      ] }, s.key))
    ] }) : null
  ] });
}
function DirectAdd({ call, reload, busy, setBusy, setError, onCandidates, onAdded }) {
  const [repo, setRepo] = (0, import_react4.useState)("");
  const [branch, setBranch] = (0, import_react4.useState)("");
  const add = async () => {
    if (!repo.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call("repo-skills", { repo: repo.trim(), ref: branch.trim() || "main" });
      if (r.candidates.length <= 1) {
        await call("add", { repo: repo.trim(), dir: r.candidates[0] && r.candidates[0].path ? r.candidates[0].path : void 0, ref: r.branch });
        if (onAdded) onAdded();
        reload();
      } else {
        onCandidates({ repo: repo.trim(), branch: r.branch, list: r.candidates });
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { ...cardStyle, padding: "12px 14px", marginBottom: 14 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { ...cardTitle, marginBottom: 10 }, children: "\u4ECE GitHub \u4ED3\u5E93\u6DFB\u52A0" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Input, { style: { flex: 1 }, placeholder: "owner/repo", value: repo, onChange: (e) => setRepo(e.target.value) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Input, { style: { width: 110 }, placeholder: "\u5206\u652F\uFF08\u53EF\u9009\uFF09", value: branch, onChange: (e) => setBranch(e.target.value) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(OutlineBtn, { onClick: add, disabled: busy || !repo.trim(), children: "\u63A2\u6D4B\u4ED3\u5E93" })
    ] })
  ] });
}

// src/client/section.jsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var settingsListeners = /* @__PURE__ */ new Set();
function subscribeSkillSettings(fn) {
  settingsListeners.add(fn);
  return () => settingsListeners.delete(fn);
}
function bumpSkillSettings() {
  for (const fn of [...settingsListeners]) fn();
}
function SkillsSection({ call, workspaces, scope }) {
  const [tab, setTab] = (0, import_react5.useState)("manage");
  const [error, setError] = (0, import_react5.useState)(null);
  const [data, setData] = (0, import_react5.useState)(null);
  const [configOverrideUnconfigured, setConfigOverrideUnconfigured] = (0, import_react5.useState)(false);
  const [reloadTick, reload] = useTick();
  const [snap, setSnap] = (0, import_react5.useState)(() => scope.getSnapshot());
  const [editError, setEditError] = (0, import_react5.useState)(null);
  const [pendingEdit, setPendingEdit] = (0, import_react5.useState)(null);
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
  (0, import_react5.useEffect)(() => {
    if (!pendingEdit) return;
    const current = configReady ? snap.value[pendingEdit.field] : void 0;
    const equal = JSON.stringify(current) === JSON.stringify(pendingEdit.value);
    if (!equal) {
      setEditError({
        message: `\u914D\u7F6E\u300C${pendingEdit.field}\u300D\u88AB\u62D2\u7EDD\uFF0C\u5DF2\u6062\u590D\u539F\u503C\uFF08\u7EC4\u540D\u4FDD\u7559\u5B57/\u975E\u6CD5\u5B57\u7B26\u6216\u683C\u5F0F\u4E0D\u5408\u6CD5\uFF09\u3002`,
        prompt: buildRepairPrompt({
          root: data && data.root,
          code: "settings-validation-rejected",
          message: `\u5B57\u6BB5 ${pendingEdit.field} \u5199\u5165\u88AB Host validate \u62D2\u7EDD`,
          repair: settingsRejectedRepair(pendingEdit.field, pendingEdit.value, current, data && data.root)
        })
      });
    }
    setPendingEdit(null);
  }, [snap]);
  const editConfig = (field, next) => {
    setEditError(null);
    setPendingEdit({ field, value: next });
    scope.set(field, next).catch(() => {
    });
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
    const next = checked ? [...mounts.filter((m) => `${m.scope}|${m.project ?? ""}` !== key), { scope: scopeKind, project: scopeKind === "project" ? workspaceId : null }] : mounts.filter((m) => `${m.scope}|${m.project ?? ""}` !== key);
    editConfig("groups", { ...groups, [group]: { ...groups[group], mounts: next } });
  };
  const createGroup = (name) => {
    const baseMounts = (groups["\u9ED8\u8BA4"] && groups["\u9ED8\u8BA4"].mounts || []).map((m) => ({ ...m }));
    editConfig("groups", { ...groups, [name]: { mounts: baseMounts } });
  };
  const renameGroup = (oldName, newName) => {
    const nextGroups = {};
    for (const [name, g] of Object.entries(groups)) nextGroups[name === oldName ? newName : name] = g;
    const nextSkills = {};
    for (const [dir, intent] of Object.entries(skillsIntent)) {
      nextSkills[dir] = intent.group === oldName ? { ...intent, group: newName } : intent;
    }
    editConfig("groups", nextGroups);
    editConfig("skills", nextSkills);
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
  const config = { groups, skillsIntent, intentOf, editConfig, setSkillDisabled, moveSkill, toggleMount, createGroup, renameGroup, deleteGroup };
  const load = () => {
    setError(null);
    return call("overview").then((r) => {
      setConfigOverrideUnconfigured(false);
      setData({
        root: r.root,
        lib: r.lib,
        health: r.health && r.health.issues || [],
        workspaces: r.workspaces || []
      });
    }).catch((e) => {
      if (e && e.code === "skilldir-unconfigured") setConfigOverrideUnconfigured(true);
      else setError(e);
    });
  };
  (0, import_react5.useEffect)(() => {
    const off = subscribeSkillSettings(load);
    load();
    return off;
  }, [reloadTick]);
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
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { flex: 1 }, children: editError.message }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(RepairCopy, { text: editError.prompt })
    ] }) : null,
    tab === "manage" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ManageView, { call, data, config, reload }),
    tab === "search" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(SearchView, { call, reload })
  ] });
}
function ErrorLineWrap({ error, root }) {
  if (!error) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { ...badgeStyle(T.error), borderRadius: 10, padding: "8px 12px", margin: "4px 12px 0", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { flex: 1 }, children: error.message || String(error) }),
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
  const ready = Boolean(snap) && snap.status !== "loading";
  const section = snap.value && typeof snap.value === "object" ? snap.value : {};
  const current = typeof section.skillsDir === "string" ? section.skillsDir : "";
  const overridden = Boolean(snap && snap.user && typeof snap.user === "object" && "skillsDir" in snap.user);
  (0, import_react6.useEffect)(() => {
    if (!touched) setDraft(current);
  }, [current, touched]);
  const dirty = touched && draft !== current;
  const reject = (e) => ({
    message: e && e.message ? e.message : "\u4FDD\u5B58\u5931\u8D25",
    prompt: buildRepairPrompt({
      root: current,
      code: "settings-validation-rejected",
      message: e && e.message ? e.message : "",
      repair: settingsRejectedRepair("skillsDir", draft.trim(), current, current)
    })
  });
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setFailed(null);
    try {
      await scope.set("skillsDir", draft.trim());
      const fresh = scope.getSnapshot();
      const v = fresh.value && typeof fresh.value === "object" ? fresh.value : {};
      setDraft(typeof v.skillsDir === "string" ? v.skillsDir : "");
      setTouched(false);
    } catch (e) {
      setFailed(reject(e));
    } finally {
      setBusy(false);
    }
  };
  const discard = () => {
    setFailed(null);
    setDraft(current);
    setTouched(false);
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
      setFailed(reject(e));
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
        style: { width: "100%", appearance: "none", border: 0, background: "none", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12 },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: T.labelPrimary }, children: "\u6280\u80FD\u7BA1\u7406" }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 13, lineHeight: 1.5, color: T.labelTertiary }, children: "\u914D\u7F6E\u672C\u5730 skills \u76EE\u5F55\uFF08\u7EAF skill \u4FDD\u5B58\u76EE\u5F55\uFF0C\u9ED8\u8BA4\u4E3A\u7A7A\u5373\u672A\u914D\u7F6E\uFF09" })
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
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { style: { margin: 0, fontSize: 12, lineHeight: 1.5, color: T.labelTertiary }, children: "\u7EDD\u5BF9\u8DEF\u5F84\uFF1B\u4FDD\u5B58\u540E\u7ACB\u5373\u751F\u6548\uFF0C\u65E0\u9700\u91CD\u542F\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 0 4px", borderTop: `1px solid ${T.borderL2}` }, children: [
        failed ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { style: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: T.error }, children: failed.message }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RepairCopy, { text: failed.prompt })
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", disabled: !dirty || busy || !ready, onClick: discard, style: { appearance: "none", border: `1px solid ${T.borderL2}`, borderRadius: 8, padding: "5px 14px", font: "inherit", fontSize: 13, lineHeight: 1.5, cursor: "pointer", background: "none", color: T.labelSecondary }, children: "\u653E\u5F03" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", disabled: !dirty || busy || !ready, onClick: save, style: { appearance: "none", border: "1px solid transparent", borderRadius: 8, padding: "5px 14px", font: "inherit", fontSize: 13, lineHeight: 1.5, cursor: "pointer", background: T.labelPrimary, color: T.bgLayer3 }, children: busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58" })
      ] })
    ] }) : null
  ] });
}

// src/client/nav-icon.js
var NAV_STAR_PATH = "M8 1.6 L9.85 6.15 L14.4 8 L9.85 9.85 L8 14.4 L6.15 9.85 L1.6 8 L6.15 6.15 Z";
function patchSkillsNavIcon() {
  for (const label of document.querySelectorAll('span[class*="navLabel"]')) {
    if (label.textContent !== "\u6280\u80FD") continue;
    const cell = label.closest("button");
    const svg = cell ? cell.querySelector("svg") : null;
    if (!svg) continue;
    const first = svg.firstElementChild;
    if (first && first.tagName === "path" && first.getAttribute("d") === NAV_STAR_PATH) continue;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", NAV_STAR_PATH);
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
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
  ctx.effect(() => {
    const offSection = ctx.slots.inject(
      "settings.section",
      () => ctx.slots.register(
        { name: "settings.section", id: "skills", order: 16, label: "\u6280\u80FD", inject: () => ({ call, workspaces, scope }) },
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
