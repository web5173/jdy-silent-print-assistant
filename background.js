chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "sendPrintRequest") {
        (async () => {
            try {
                const apiEndpoint = String(request.apiEndpoint || "").replace(/\/+$/, "");
                if (!apiEndpoint) throw new Error("接口地址未配置");

                const response = await fetch(`${apiEndpoint}/api/print`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        target: request.target,
                        data: request.data,
                    }),
                });

                if (!response.ok) {
                    const { code } = await response.json().catch(() => ({}));
                    throw new Error(code === "INVALID_TARGET"
                        ? "打印机ID无效，请检查当前页面配置中的打印机ID是否正确"
                        : "打印失败，请联系开发人员处理");
                }

                sendResponse({ ok: true });
            } catch (error) {
                sendResponse({ ok: false, message: error?.message || "打印请求失败" });
            }
        })();
        return true;
    }
    sendResponse({});
});
