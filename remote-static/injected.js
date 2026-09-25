/*! 
 * Copyright (c) 2026
 * Project: 静默打印助手V2 — 适配简道云
 * Author: web5173
 * Licensed under the MIT License.
 */

const STORAGE_KEY_PREFIX = "zero_print_config_";
const JIADAOYUN_PRIMARY_COLOR = "var(--fd-color-brand-6, #03ABA0)";

/** @type {{apiEndpoint:string,publicKey:string}} */
let globalConfig = { apiEndpoint: "", publicKey: "" };
let pageConfigCache = {};
let isHandlingPrint = false;
let triggerTop = null;

const createRequestId = () => crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const getAppFormIds = () => {
    const route = `${location.pathname}${location.hash}`;
    const match = route.match(/\/app\/([0-9a-f]{24})\/(?:form|flow\/[^/]+\/form)\/([0-9a-f]{24})(?:\/|$)/i);
    return match ? { appId: match[1], formId: match[2] } : null;
};
const isZeroPrintWorkPage = () => Boolean(getAppFormIds());
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// ========== 全局配置获取（通过 content.js 代理） ==========
window.postMessage({ type: "zeroPrint_getGlobalConfig" }, "*");
window.addEventListener("message", (e) => {
    if (e.data?.type !== "zeroPrint_globalConfig") return;
    globalConfig = e.data.config || { apiEndpoint: "", publicKey: "" };
    syncZeroPrintTrigger();
});

// ========== 加密工具（RSA-2048 + AES-256-GCM） ==========
/**
 * @param {string} publicKeyBase64
 * @param {string} plaintext
 * @returns {Promise<string>}
 */
async function encryptData(publicKeyBase64, plaintext) {
    const publicKeyBytes = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0));
    const publicKeyObj = await crypto.subtle.importKey(
        "spki", publicKeyBytes,
        { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"]
    );

    const aesKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, true, ["encrypt"]
    );
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(plaintext);

    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, data)
    );

    const aesKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", aesKey));
    const encryptedAesKey = new Uint8Array(
        await crypto.subtle.encrypt(
            { name: "RSA-OAEP", hash: "SHA-256" }, publicKeyObj, aesKeyBytes
        )
    );

    const combined = new Uint8Array(encryptedAesKey.length + nonce.length + ciphertext.length);
    combined.set(encryptedAesKey, 0);
    combined.set(nonce, encryptedAesKey.length);
    combined.set(ciphertext, encryptedAesKey.length + nonce.length);
    return btoa(String.fromCharCode(...combined));
}

// ========== 打印请求（通过 background.js 代理，避免 CORS） ==========
/**
 * @param {string} target
 * @param {object} printData
 */
async function sendPrintRequest(target, printData) {
    if (!globalConfig.apiEndpoint) throw new Error("接口地址未配置，请前往插件配置页设置");
    if (!globalConfig.publicKey) throw new Error("公钥未配置，请前往插件配置页设置");

    const plaintext = JSON.stringify(printData);
    const data = await encryptData(globalConfig.publicKey, plaintext);
    const response = await requestExtension(
        { type: "zeroPrint_sendPrintRequest", target, data },
        "zeroPrint_printResponse",
        "打印请求超时",
        30000
    );

    if (!response.result?.ok) throw new Error(response.result?.message || "打印请求失败");
    return { status: "success" };
}

// ========== 页面配置读写 ==========
const getStorageKey = () => {
    const ids = getAppFormIds();
    if (ids) return `${STORAGE_KEY_PREFIX}${ids.appId}_${ids.formId}`;
    return `${STORAGE_KEY_PREFIX}${window.location.pathname}`;
};

const requestExtension = (message, responseType, timeoutMessage = "扩展响应超时", timeout = 5000) => {
    const requestId = createRequestId();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            window.removeEventListener("message", handleResponse);
            reject(new Error(timeoutMessage));
        }, timeout);

        const handleResponse = (e) => {
            if (e.data?.type !== responseType || e.data.requestId !== requestId) return;
            clearTimeout(timer);
            window.removeEventListener("message", handleResponse);
            resolve(e.data);
        };

        window.addEventListener("message", handleResponse);
        window.postMessage({ ...message, requestId }, "*");
    });
};

const loadConfig = async () => {
    const response = await requestExtension(
        { type: "zeroPrint_getPageConfig", key: getStorageKey() },
        "zeroPrint_pageConfig",
        "读取页面配置超时"
    );
    return response.config || {};
};

const refreshPageConfig = async () => {
    try {
        pageConfigCache = await loadConfig();
    } catch {
        pageConfigCache = {};
    }
    return pageConfigCache;
};

const saveConfig = async (config) => {
    const response = await requestExtension(
        { type: "zeroPrint_setPageConfig", key: getStorageKey(), config },
        "zeroPrint_pageConfigSaved",
        "保存页面配置超时"
    );
    if (!response.ok) throw new Error(response.message || "保存配置失败");
    pageConfigCache = config;
};

// ========== Toast（复用简道云原生类） ==========
function showToast(message, options = {}, showOverlay, duration) {
    if (typeof options === "boolean") {
        options = { type: options ? "loading" : "info", showOverlay, duration };
    }
    const { type = "info", colorful = true, showOverlay: shouldShowOverlay = type === "loading", duration: toastDuration = 3000 } = options;
    const elements = [];

    if (shouldShowOverlay) {
        const overlay = document.createElement("div");
        overlay.className = "x-window-mask mask-appear";
        document.body.appendChild(overlay);
        elements.push(overlay);
    }

    const toast = document.createElement("div");
    toast.className = "x-msg-toast-container x-toast-css-var top-right cloned";
    toast.innerHTML = `
        <div class="x-msg-toast x-msg-toast-appear">
            <div class="x-msg-toast-content ${colorful ? "colorful" : ""} ${type}">
                <div class="x-msg-toast-icon"><i></i></div>
                <div class="x-msg-toast-text"></div>
            </div>
        </div>`;
    const toastText = toast.querySelector(".x-msg-toast-text");
    if (toastText) toastText.textContent = message;
    document.body.appendChild(toast);
    elements.push(toast);

    if (toastDuration) {
        setTimeout(() => elements.forEach(el => el?.remove()), toastDuration);
    }
    return elements;
}

const showErrorToast = (message) => showToast(`打印失败：${message}`, { type: "error", showOverlay: false, duration: 5000 });

// ========== 配置面板（居中模态弹窗，复用简道云原生类） ==========
let configMask = null;

const showConfigPanel = async () => {
    if (configMask) return;
    const config = await refreshPageConfig();
    const mask = document.createElement("div");
    mask.className = "x-window-mask mask-appear-done mask-enter-done zero-print-config-mask";

    const panel = document.createElement("div");
    panel.className = "x-dialog fade-down zero-print-config-dialog theme-normal dialog-content-appear-done dialog-content-enter-done";
    panel.tabIndex = -1;
    panel.innerHTML = `
        <div class="content-wrapper zero-print-config-content-wrapper">
            <div class="dialog-header has-separator">
                <div class="dialog-title">
                    <span class="main-title">ZeroPrint 配置</span>
                    <span class="zero-print-config-subtitle">仅对当前表单生效</span>
                </div>
                <div class="dialog-header-buttons">
                    <button type="button" class="zero-print-config-close x-button x-button-css-var size-small style-text-normal has-icon is-only-icon close-btn" title="关闭">
                        <span class="x-button-icon-wrapper"><span class="x-button-icon"><i class="x-svgicon x-svgicon-CloseOutlined close-icon"><svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><path d="m568 512 291.2-291.2c16-16 16-41.6 0-56-16-16-41.6-16-56 0L512 456 220.8 163.2c-16-16-41.6-16-56 0-16 16-16 41.6 0 56L456 512 163.2 803.2c-16 16-16 41.6 0 56 8 8 17.6 11.2 28.8 11.2s20.8-3.2 28.8-11.2L512 568l291.2 291.2c8 8 17.6 11.2 28.8 11.2s20.8-3.2 28.8-11.2c16-16 16-41.6 0-56L568 512z"></path></svg></i></span></span>
                    </button>
                </div>
            </div>
            <div class="dialog-content">
                <div class="zero-print-config-body">
                    <div class="zero-print-config-row">
                        <label class="field-name zero-print-config-label"><span class="zero-print-required">*</span>打印机ID</label>
                        <div class="x-input x-input-css-var normal-input input-normal zero-print-config-input-wrap">
                            <div class="x-inner-wrapper">
                                <input class="input-inner zero-print-config-input" type="text" placeholder="从 ZeroPrint 客户端复制；留空使用简道云原生打印" data-key="target" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off">
                            </div>
                        </div>
                    </div>
                    <div class="zero-print-config-row">
                        <label class="field-name zero-print-config-label">打印份数</label>
                        <div class="x-input x-input-css-var normal-input input-normal zero-print-config-input-wrap">
                            <div class="x-inner-wrapper">
                                <input class="input-inner zero-print-config-input" type="number" placeholder="不填写默认为1" min="1" max="99" data-key="copies" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off">
                            </div>
                        </div>
                    </div>
                    <div class="zero-print-config-row">
                        <label class="field-name zero-print-config-label">纸张大小</label>
                        <div class="x-input x-input-css-var normal-input input-normal zero-print-config-input-wrap">
                            <div class="x-inner-wrapper">
                                <input class="input-inner zero-print-config-input" type="text" placeholder="从 ZeroPrint 客户端复制；留空使用打印机默认值" data-key="pageSize" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off">
                            </div>
                        </div>
                    </div>
                    <div class="zero-print-config-row">
                        <label class="field-name zero-print-config-label">双面打印</label>
                        <div class="x-input x-input-css-var normal-input input-normal zero-print-config-input-wrap">
                            <div class="x-inner-wrapper">
                                <input class="input-inner zero-print-config-input" type="text" placeholder="从 ZeroPrint 客户端复制；留空使用打印机默认值" data-key="duplex" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off">
                            </div>
                        </div>
                    </div>
                    <div class="zero-print-config-row">
                        <label class="field-name zero-print-config-label">打印方向</label>
                        <div class="x-input x-input-css-var normal-input input-normal zero-print-config-input-wrap">
                            <div class="x-inner-wrapper">
                                <input class="input-inner zero-print-config-input" type="text" placeholder="从 ZeroPrint 客户端复制；留空使用打印机默认值" data-key="orientation" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="x-grid-row row-space-between row-middle dialog-footer has-separator" style="row-gap:12px;flex-direction:row-reverse;">
                <div class="x-grid-col footer-right">
                    <button class="x-button x-button-css-var size-normal style-negative button op-draft footer-btn" type="button" title="重置"><span>重置</span></button>
                    <button class="x-button x-button-css-var size-normal style-primary button op-forward footer-btn" type="button" title="保存"><span>保存</span></button>
                </div>
                <div class="x-grid-col footer-left"></div>
            </div>
        </div>
    `;

    const closeBtn = panel.querySelector(".zero-print-config-close");
    const saveBtn = panel.querySelector(".x-button.style-primary");
    const resetBtn = panel.querySelector(".x-button.style-negative");
    const inputs = panel.querySelectorAll(".zero-print-config-input");

    inputs.forEach(input => {
        const key = input.dataset.key;
        const value = config[key];
        if (value !== undefined && value !== null) input.value = String(value);
    });

    inputs.forEach(input => {
        const wrapper = input.closest(".x-input");
        input.addEventListener("focus", () => wrapper?.classList.add("input-focus"));
        input.addEventListener("blur", () => wrapper?.classList.remove("input-focus"));
    });

    const closePanel = () => { mask.remove(); configMask = null; };
    closeBtn.addEventListener("click", closePanel);
    mask.addEventListener("click", (e) => {
        if (e.target === mask || e.target.classList?.contains("x-mask")) closePanel();
    });
    resetBtn.addEventListener("click", () => inputs.forEach(input => input.value = ""));
    saveBtn.addEventListener("click", async () => {
        const newConfig = {};
        inputs.forEach(input => {
            const key = input.dataset.key;
            const value = input.value.trim();
            if (value) newConfig[key] = key === "copies" ? parseInt(value, 10) || 1 : value;
        });
        try {
            saveBtn.disabled = true;
            await saveConfig(newConfig);
            saveBtn.lastElementChild.textContent = "已保存";
            showToast("配置已保存", { type: "success", showOverlay: false, duration: 1800 });
            closePanel();
        } catch (error) {
            saveBtn.disabled = false;
            showToast(error.message || "保存配置失败", { type: "error", showOverlay: false, duration: 5000 });
        }
    });

    const nativeMask = document.createElement("div");
    nativeMask.className = "x-mask";
    mask.appendChild(nativeMask);
    mask.appendChild(panel);
    document.body.appendChild(mask);
    configMask = mask;

    const targetInput = panel.querySelector('input[data-key="target"]');
    if (targetInput) targetInput.focus();
};

// ========== 触发按钮 ==========
const createTrigger = () => {
    if (document.querySelector(".zero-print-trigger")) return;
    const trigger = document.createElement("div");
    trigger.className = "zero-print-trigger";
    trigger.title = "ZeroPrint";
    const applyTriggerTop = (top) => {
        const maxTop = Math.max(80, window.innerHeight - trigger.offsetHeight - 40);
        triggerTop = clamp(top, 80, maxTop);
        trigger.style.bottom = "auto";
        trigger.style.top = `${triggerTop}px`;
    };
    const getDefaultTriggerTop = () => window.innerHeight - trigger.offsetHeight - 160;

    const triggerBar = document.createElement("div");
    triggerBar.className = "zero-print-trigger-bar";
    triggerBar.title = "展开 ZeroPrint 配置按钮";

    const configButton = document.createElement("button");
    configButton.type = "button";
    configButton.className = "zero-print-config-icon-button x-button x-button-css-var size-normal style-text-normal has-icon is-only-icon";
    configButton.title = "ZeroPrint 配置";
    configButton.innerHTML = '<span class="x-button-icon-wrapper"><i class="x-icon iconfont-fx-pc icon-set"></i></span>';

    const expandTrigger = () => trigger.classList.add("is-visible");
    const collapseTrigger = () => trigger.classList.remove("is-visible");
    let dragState = null;

    trigger.addEventListener("mouseenter", expandTrigger);
    trigger.addEventListener("pointerenter", expandTrigger);
    trigger.addEventListener("mouseleave", collapseTrigger);
    trigger.addEventListener("pointerleave", collapseTrigger);
    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.target !== configButton && !configButton.contains(e.target)) expandTrigger();
    });
    triggerBar.addEventListener("mouseenter", expandTrigger);
    triggerBar.addEventListener("pointerenter", expandTrigger);
    triggerBar.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        expandTrigger();
        dragState = { pointerId: e.pointerId, startY: e.clientY, startTop: trigger.getBoundingClientRect().top };
        trigger.classList.add("is-dragging");
        triggerBar.setPointerCapture?.(e.pointerId);
    });
    triggerBar.addEventListener("pointermove", (e) => {
        if (!dragState || dragState.pointerId !== e.pointerId) return;
        e.preventDefault();
        applyTriggerTop(dragState.startTop + e.clientY - dragState.startY);
    });
    const stopDrag = (e) => {
        if (!dragState || dragState.pointerId !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        trigger.classList.remove("is-dragging");
        triggerBar.releasePointerCapture?.(e.pointerId);
        dragState = null;
    };
    triggerBar.addEventListener("pointerup", stopDrag);
    triggerBar.addEventListener("pointercancel", stopDrag);
    configButton.addEventListener("click", (e) => { e.stopPropagation(); showConfigPanel(); });

    trigger.appendChild(triggerBar);
    trigger.appendChild(configButton);
    document.body.appendChild(trigger);
    applyTriggerTop(triggerTop ?? getDefaultTriggerTop());
    window.addEventListener("resize", () => applyTriggerTop(triggerTop));
};

const removeTrigger = () => {
    document.querySelector(".zero-print-trigger")?.remove();
    if (configMask) {
        configMask.remove();
        configMask = null;
    }
};

const syncZeroPrintTrigger = () => {
    if (isZeroPrintWorkPage() && globalConfig.apiEndpoint && globalConfig.publicKey) {
        refreshPageConfig();
        createTrigger();
    } else {
        removeTrigger();
    }
};

// ========== 样式注入 ==========
const triggerStyle = document.createElement("style");
triggerStyle.innerHTML = `
  .zero-print-config-mask { z-index: 2147483647; }
  .zero-print-config-dialog { padding-top: 0 !important; display: flex !important; align-items: center; justify-content: center; }
  .zero-print-config-content-wrapper { width: 600px; height: auto !important; min-height: 0 !important; display: block !important; }
  .zero-print-config-dialog .dialog-content { flex: none !important; height: auto !important; min-height: 0 !important; overflow: visible; }
  .zero-print-config-dialog .dialog-header.has-separator { position: relative; z-index: 1; border-bottom: 0; box-shadow: 0 1px 4px 0 rgba(31, 45, 61, 0.12); }
  .zero-print-config-dialog .dialog-footer { flex: none !important; }
  .zero-print-config-dialog .dialog-footer.has-separator { position: relative; border-top: 0.8px dashed var(--fd-color-border-secondary, #E6E8ED); box-shadow: none; }
  .zero-print-config-dialog .footer-btn { min-width: 120px; }
  .zero-print-config-dialog .zero-print-config-subtitle { color: ${JIADAOYUN_PRIMARY_COLOR}; margin-left: var(--fd-padding, 8px); font-size: inherit; line-height: inherit; }
  .zero-print-config-dialog .dialog-title { align-items: center; }
  .zero-print-config-body { padding: var(--fd-padding-layout-lg, 20px); }
  .zero-print-config-row { display: flex; align-items: center; margin-bottom: var(--fd-padding-layout, 16px); }
  .zero-print-config-row:last-child { margin-bottom: 0; }
  .zero-print-config-label { width: 84px; flex: 0 0 84px; margin: 0 var(--fd-padding-lg, 12px) 0 0; text-align: right; }
  .zero-print-config-input-wrap { width: 464px; max-width: 464px; height: 32px; }
  .zero-print-config-input { width: 100%; }
  .zero-print-config-dialog .zero-print-required { color: var(--fd-color-error, #EF5655); margin-right: 2px; }
  .zero-print-trigger {
    position: fixed; right: 0; bottom: 160px;
    width: calc(var(--fd-control-height-lg, 40px) * 2);
    height: calc(var(--fd-control-height-lg, 40px) + var(--fd-control-height-lg, 40px) + var(--fd-control-height-lg, 40px) + var(--fd-padding-layout-xl, 24px));
    z-index: 2147483647; background: transparent; pointer-events: auto;
  }
  .zero-print-trigger-bar {
    position: absolute; right: 0; top: var(--fd-padding-layout-sm, 12px);
    width: var(--fd-padding-sm, 6px);
    height: calc(100% - var(--fd-padding-layout-xl, 24px));
    border-radius: var(--fd-border-radius, 6px) 0 0 var(--fd-border-radius, 6px);
    background: ${JIADAOYUN_PRIMARY_COLOR};
    box-shadow: 0 4px 12px rgba(3, 171, 160, 0.28);
    cursor: grab; opacity: 0.95; touch-action: none; user-select: none;
  }
  .zero-print-trigger.is-dragging .zero-print-trigger-bar {
    cursor: grabbing; opacity: 0.82;
  }
  .zero-print-trigger.is-dragging .zero-print-config-icon-button {
    transition: none;
  }
  .zero-print-config-icon-button {
    position: absolute; right: var(--fd-padding-layout, 16px); top: 50%;
    width: 78px !important; height: 78px !important;
    transform: translateY(-50%) translateX(var(--fd-padding-layout-lg, 20px)) scale(0.92);
    color: ${JIADAOYUN_PRIMARY_COLOR} !important;
    background: transparent !important; border-color: transparent !important;
    box-shadow: none !important; padding: 0 !important;
    display: flex !important; align-items: center; justify-content: center;
    opacity: 0; visibility: hidden; pointer-events: none;
    transition: opacity 0.16s ease, transform 0.16s ease, visibility 0s linear 0.16s;
  }
  .zero-print-config-icon-button .x-button-icon-wrapper {
    position: static; transform: none;
    color: ${JIADAOYUN_PRIMARY_COLOR}; background: transparent !important;
    border: 0 !important; box-shadow: none !important;
  }
  .zero-print-config-icon-button .x-icon { color: ${JIADAOYUN_PRIMARY_COLOR}; font-size: 36px; width: 36px; height: 36px; line-height: 36px; }
  .zero-print-trigger:hover .zero-print-config-icon-button,
  .zero-print-trigger.is-visible .zero-print-config-icon-button,
  .zero-print-trigger:focus-within .zero-print-config-icon-button {
    opacity: 1; visibility: visible; pointer-events: auto;
    transform: translateY(-50%) translateX(0) scale(1);
    transition-delay: 0s;
  }
`;
document.head.appendChild(triggerStyle);
syncZeroPrintTrigger();
window.addEventListener("hashchange", syncZeroPrintTrigger);
window.addEventListener("popstate", syncZeroPrintTrigger);

// ========== 静默打印核心逻辑 ==========
const isPrintRequestUrl = (url) => {
    try {
        const pathname = new URL(url, location.origin).pathname;
        return pathname.endsWith("/print");
    } catch { return false; }
};

const parseBody = (body) => {
    if (!body) return null;
    if (typeof body === "string") {
        try { return JSON.parse(body); } catch { return null; }
    }
    if (body instanceof URLSearchParams) {
        const obj = {};
        for (const [k, v] of body) obj[k] = v;
        return obj;
    }
    if (typeof FormData !== "undefined" && body instanceof FormData) {
        const obj = {};
        for (const [k, v] of body) {
            if (obj[k] === undefined) obj[k] = v;
            else if (Array.isArray(obj[k])) obj[k].push(v);
            else obj[k] = [obj[k], v];
        }
        return obj;
    }
    return null;
};

/** 判断是否为系统模板打印（系统模板走原生，不拦截） */
const isSystemTemplatePrint = (bodyObj) => {
    const printId = bodyObj?.printId || bodyObj?.print_id;
    if (!printId) return true;
    if (printId === "system") return true;
    return false;
};

/** 阻止简道云打开打印预览标签页（isHandlingPrint 期间拦截 window.open） */
const hookWindowOpen = () => {
    const originalWindowOpen = window.open;
    window.open = function (...args) {
        if (isHandlingPrint) return null;
        return originalWindowOpen.apply(this, args);
    };
};
hookWindowOpen();

/** MutationObserver：isHandlingPrint 期间兜底隐藏打印预览弹窗 + 阻止 iframe 加载 */
const printPreviewObserver = new MutationObserver((mutations) => {
    if (!isHandlingPrint) return;
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node?.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.classList?.contains("x-window-mask") || node.classList?.contains("modal-mask")) {
                node.style.setProperty("display", "none", "important");
                node.dataset.__zp_hidden = "true";
            }
            const cls = node.className || "";
            const clsStr = typeof cls === "string" ? cls : "";
            if (clsStr.includes("x-dialog") || clsStr.includes("x-window")) {
                node.style.setProperty("display", "none", "important");
                node.dataset.__zp_hidden = "true";
            }
            const iframes = node.tagName === "IFRAME" ? [node] : Array.from(node.querySelectorAll?.("iframe") || []);
            for (const iframe of iframes) {
                if (iframe.src && (iframe.src.includes("file-export.jiandaoyun.com") || iframe.src.includes("jdy-pdf-print") || iframe.src.includes("jdy-office") || iframe.src.includes("preview_office") || iframe.src.includes("web-office"))) {
                    iframe.src = "about:blank";
                }
            }
        }
    }
});
printPreviewObserver.observe(document.documentElement, { childList: true, subtree: true });

/** 收到可打印文件下载地址后发送给 ZeroPrint */
const sendToZeroPrint = async (downloadUrl) => {
    const config = pageConfigCache;
    if (!config.target) {
        showErrorToast("缺少打印机ID，请先配置");
        showConfigPanel();
        return;
    }
    const printData = { url: downloadUrl };
    if (config.copies && config.copies > 0) printData.copies = config.copies;
    if (config.pageSize) printData.pageSize = config.pageSize;
    if (config.duplex) printData.duplex = config.duplex;
    if (config.orientation) printData.orientation = config.orientation;
    await sendPrintRequest(config.target, printData);
};

/** 收到 downloadUrl 后的静默打印流程 */
const executeSilentPrint = async (downloadUrl) => {
    if (!downloadUrl) { showErrorToast("未获取到打印文件地址"); return; }
    const toastResult = showToast("正在发送打印文件，请等待", { type: "loading", showOverlay: true, duration: 0 });
    try {
        await sendToZeroPrint(downloadUrl);
        for (const node of toastResult) node?.remove();
        showToast("打印请求已发送", { type: "success", showOverlay: false });
    } catch (error) {
        for (const node of toastResult) node?.remove();
        showErrorToast(error.message || "打印请求失败");
    } finally {
        setTimeout(() => {
            isHandlingPrint = false;
        }, 1000);
    }
};

// ========== XMLHttpRequest 拦截：用户模板打印走 ZeroPrint，系统模板走原生 ==========
const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;
const originalXhrAddEventListener = XMLHttpRequest.prototype.addEventListener;

XMLHttpRequest.prototype.open = function (method, reqUrl, ...rest) {
    this.__zp_url = reqUrl;
    return originalXHROpen.call(this, method, reqUrl, ...rest);
};

XMLHttpRequest.prototype.addEventListener = function (type, listener, ...rest) {
    if (type !== "readystatechange") {
        return originalXhrAddEventListener.call(this, type, listener, ...rest);
    }
    const reqUrl = String(this.__zp_url || "");
    const isPrintReq = isPrintRequestUrl(reqUrl);
    const isPrintTaskGet = reqUrl.includes("/print_task/get");
    if (!isPrintReq && !isPrintTaskGet) {
        return originalXhrAddEventListener.call(this, type, listener, ...rest);
    }
    const self = this;
    const wrappedListener = function () {
        if (self.readyState === 4) {
            try {
                const result = JSON.parse(self.responseText);
                const shouldProcess = self.__zp_should_intercept || (isPrintTaskGet && isHandlingPrint);
                if (!shouldProcess) return listener.apply(this, arguments);
                if (isPrintReq && result.taskId && result.secret && !isHandlingPrint) {
                    isHandlingPrint = true;
                }
                if (isHandlingPrint && result.status === "success" && result.downloadUrl) {
                    if (!self.__zp_downloadUrl_sent) {
                        self.__zp_downloadUrl_sent = true;
                        document.querySelectorAll(".x-msg-toast-container.cloned").forEach(el => el.remove());
                        executeSilentPrint(result.downloadUrl);
                    }
                    Object.defineProperty(self, "responseText", { get: () => JSON.stringify({ ...result, downloadUrl: "about:blank", previewUrl: "about:blank" }) });
                }
            } catch { }
        }
        return listener.apply(this, arguments);
    };
    return originalXhrAddEventListener.call(this, type, wrappedListener, ...rest);
};

XMLHttpRequest.prototype.send = function (body) {
    const reqUrl = String(this.__zp_url || "");
    const isPrintReq = isPrintRequestUrl(reqUrl);
    const bodyObj = parseBody(body);
    const shouldIntercept = isPrintReq && globalConfig.apiEndpoint && globalConfig.publicKey && pageConfigCache.target && bodyObj && !isSystemTemplatePrint(bodyObj);
    if (shouldIntercept) {
        this.__zp_should_intercept = true;
    }
    const origOnReady = this.onreadystatechange;
    this.onreadystatechange = function () {
        if (this.readyState === 4) {
            try {
                const result = JSON.parse(this.responseText);
                if (this.__zp_should_intercept && result.taskId && result.secret && !isHandlingPrint) {
                    isHandlingPrint = true;
                }
                if (isHandlingPrint && result.status === "success" && result.downloadUrl && !this.__zp_downloadUrl_sent) {
                    this.__zp_downloadUrl_sent = true;
                    document.querySelectorAll(".x-msg-toast-container.cloned").forEach(el => el.remove());
                    executeSilentPrint(result.downloadUrl);
                }
            } catch { }
        }
        origOnReady?.apply(this, arguments);
    };
    return originalXHRSend.apply(this, arguments);
};
