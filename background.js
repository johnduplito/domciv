chrome.action.onClicked.addListener(async (tab) => {
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
