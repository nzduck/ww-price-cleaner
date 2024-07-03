
chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed.');
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.url) {
        if (tab.url.includes('woolworths.co.nz')) {
            chrome.action.enable(tabId);
        } else {
            chrome.action.disable(tabId);
        }
    }
});

chrome.tabs.onActivated.addListener(activeInfo => {
    chrome.tabs.get(activeInfo.tabId, tab => {
        if (tab.url) {
            console.log('onActivated received.');
            if (tab.url.includes('woolworths.co.nz')) {
                chrome.action.enable(tab.id);
                console.log('Page action enabled.');
            } else {
                chrome.action.disable(tab.id);
                console.log('Page action disabled.');
            }
        }
    });
});

chrome.webRequest.onBeforeRequest.addListener((details) => {
        console.log('Intercepted request for: ' + details.url);
        if (details.method === "GET" && details.url.startsWith('https://www.woolworths.co.nz/api/v1/products?target=search&search=')) {
                chrome.tabs.sendMessage(details.tabId, {type: "xhr_detected", url: details.url});
        }
    },
    {urls: ["https://www.woolworths.co.nz/api/v1/*"]},
    ["requestBody"]
);
