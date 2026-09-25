const STORAGE_KEYS = { apiEndpoint: "zero_print_api_endpoint", publicKey: "zero_print_public_key" };

const apiEndpointInput = document.getElementById("apiEndpoint");
const publicKeyInput = document.getElementById("publicKey");
const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");
const statusMsg = document.getElementById("statusMsg");

const showStatus = (text, isError = false) => {
    statusMsg.textContent = text;
    statusMsg.className = "status-msg " + (isError ? "error" : "success");
    setTimeout(() => { statusMsg.className = "status-msg"; }, 3000);
};

const loadConfig = () => {
    chrome.storage.local.get([STORAGE_KEYS.apiEndpoint, STORAGE_KEYS.publicKey], (result) => {
        if (chrome.runtime.lastError) return;
        if (result[STORAGE_KEYS.apiEndpoint]) apiEndpointInput.value = result[STORAGE_KEYS.apiEndpoint];
        if (result[STORAGE_KEYS.publicKey]) publicKeyInput.value = result[STORAGE_KEYS.publicKey];
    });
};

const saveConfig = () => {
    const apiEndpoint = apiEndpointInput.value.trim();
    const publicKey = publicKeyInput.value.trim();

    if (!apiEndpoint) { showStatus("接口地址不能为空", true); return; }
    if (!publicKey) { showStatus("公钥不能为空", true); return; }

    const config = {};
    config[STORAGE_KEYS.apiEndpoint] = apiEndpoint;
    config[STORAGE_KEYS.publicKey] = publicKey;

    chrome.storage.local.set(config, () => {
        if (chrome.runtime.lastError) {
            showStatus("保存失败：" + chrome.runtime.lastError.message, true);
        } else {
            showStatus("配置已保存");
        }
    });
};

saveBtn.addEventListener("click", saveConfig);
resetBtn.addEventListener("click", () => {
    apiEndpointInput.value = "";
    publicKeyInput.value = "";
});

loadConfig();
