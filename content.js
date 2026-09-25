const STORAGE_KEYS = { apiEndpoint: "zero_print_api_endpoint", publicKey: "zero_print_public_key" };

const storageGet = (keys) => new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(result);
    });
});

const storageSet = (items) => new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
    });
});

const postToPage = (message) => window.postMessage(message, "*");

const isPageConfigKey = (key) => typeof key === "string" && key.startsWith("zero_print_config_");

const normalizePageConfig = (config) => {
    if (!config || typeof config !== "object" || Array.isArray(config)) return {};
    const normalized = {};
    for (const key of ["target", "pageSize", "duplex", "orientation"]) {
        if (typeof config[key] === "string") normalized[key] = config[key].trim().slice(0, 500);
    }
    const copies = Number.parseInt(config.copies, 10);
    if (Number.isInteger(copies) && copies > 0 && copies <= 99) normalized.copies = copies;
    return normalized;
};

const handleGetGlobalConfig = async () => {
    try {
        const result = await storageGet([STORAGE_KEYS.apiEndpoint, STORAGE_KEYS.publicKey]);
        postToPage({
            type: "zeroPrint_globalConfig",
            config: {
                apiEndpoint: result[STORAGE_KEYS.apiEndpoint] || "",
                publicKey: result[STORAGE_KEYS.publicKey] || "",
            },
        });
    } catch {
        postToPage({ type: "zeroPrint_globalConfig", config: { apiEndpoint: "", publicKey: "" } });
    }
};

const handleGetPageConfig = async ({ requestId, key }) => {
    try {
        if (!isPageConfigKey(key)) throw new Error("配置键无效");
        const result = key ? await storageGet([key]) : {};
        postToPage({ type: "zeroPrint_pageConfig", requestId, config: normalizePageConfig(result[key]) });
    } catch {
        postToPage({ type: "zeroPrint_pageConfig", requestId, config: {} });
    }
};

const handleSetPageConfig = async ({ requestId, key, config }) => {
    try {
        if (!isPageConfigKey(key)) throw new Error("配置键无效");
        await storageSet({ [key]: normalizePageConfig(config) });
        postToPage({ type: "zeroPrint_pageConfigSaved", requestId, ok: true });
    } catch (err) {
        postToPage({
            type: "zeroPrint_pageConfigSaved",
            requestId,
            ok: false,
            message: err?.message || "保存配置失败",
        });
    }
};

const handleSendPrintRequest = async ({ requestId, target, data }) => {
    try {
        const normalizedTarget = typeof target === "string" ? target.trim() : "";
        if (!normalizedTarget) throw new Error("打印机ID无效");
        if (typeof data !== "string" || !data) throw new Error("打印数据无效");
        const config = await storageGet([STORAGE_KEYS.apiEndpoint]);
        const apiEndpoint = String(config[STORAGE_KEYS.apiEndpoint] || "").replace(/\/+$/, "");
        if (!apiEndpoint) throw new Error("接口地址未配置，请前往插件配置页设置");
        const result = await chrome.runtime.sendMessage({
            type: "sendPrintRequest",
            apiEndpoint,
            target: normalizedTarget,
            data,
        });
        postToPage({ type: "zeroPrint_printResponse", requestId, result });
    } catch (err) {
        postToPage({
            type: "zeroPrint_printResponse",
            requestId,
            result: { ok: false, message: err?.message || "打印请求失败" },
        });
    }
};

// 代理 injected.js 的扩展能力请求
window.addEventListener("message", async (e) => {
    if (e.source !== window) return;

    const data = e.data || {};
    switch (data.type) {
        case "zeroPrint_getGlobalConfig":
            await handleGetGlobalConfig();
            break;
        case "zeroPrint_getPageConfig":
            await handleGetPageConfig(data);
            break;
        case "zeroPrint_setPageConfig":
            await handleSetPageConfig(data);
            break;
        case "zeroPrint_sendPrintRequest":
            await handleSendPrintRequest(data);
            break;
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[STORAGE_KEYS.apiEndpoint] || changes[STORAGE_KEYS.publicKey]) {
        handleGetGlobalConfig();
    }
});

// 注入本地 loader.js
const s = document.createElement("script");
s.src = chrome.runtime.getURL("loader.js");
s.onload = () => s.remove();
document.head.appendChild(s);
