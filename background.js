chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || /^(chrome|edge|about|data):/.test(tab.url) || tab.url.startsWith('https://chromewebstore.google.com')) {
    return;
  }
  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ['civ.css'],
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['config.js'],
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['civ.js'],
  });
});
