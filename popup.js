const STORAGE_KEYS = { apiEndpoint: "zero_print_api_endpoint", publicKey: "zero_print_public_key" };

const statusBox = document.getElementById("statusBox");
const statusText = document.getElementById("statusText");
const statusDesc = document.getElementById("statusDesc");
const configLink = document.getElementById("configLink");
const manifest = chrome.runtime.getManifest?.();

chrome.storage.local.get([STORAGE_KEYS.apiEndpoint, STORAGE_KEYS.publicKey], (result) => {
    const hasEndpoint = !!result[STORAGE_KEYS.apiEndpoint];
    const hasKey = !!result[STORAGE_KEYS.publicKey];

    if (hasEndpoint && hasKey) {
        statusBox.className = "status ok";
        statusText.textContent = "全局配置已完成";
        statusDesc.textContent = "可以在简道云表单中使用静默打印";
        configLink.textContent = "查看或修改配置";
    } else {
        statusBox.className = "status warn";
        statusText.textContent = "全局配置未完成";
        statusDesc.textContent = "请先配置接口地址和公钥";
        configLink.textContent = "立即配置";
    }
});

configLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
});
