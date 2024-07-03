document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('btnChangeColor').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, {type: "change_color"});
        });
    });
});
