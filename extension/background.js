// Relays between tab content scripts and the Tapdeck server on this Mac.
//
// Tabs -> server: each frame playing media sends its state about once a second.
// Server -> tabs: a long-poll on /ext/wait returns commands for a given tab.
// The heartbeats are what keep this service worker alive while media plays.

const SERVER = 'http://127.0.0.1:8765';
const HEADERS = { 'Content-Type': 'application/json', 'X-Tapdeck': '1' };

async function post(path, body) {
  try {
    await fetch(SERVER + path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  } catch {
    // Server not running; nothing to do.
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab) return;
  const key = `${sender.tab.id}:${sender.frameId}`;
  if (msg.type === 'state') post('/ext/state', { key, state: msg.state });
  else if (msg.type === 'gone') post('/ext/gone', { key });
  pollCommands();
});

chrome.tabs.onRemoved.addListener((tab) => post('/ext/gone', { tab }));

let polling = false;

async function pollCommands() {
  if (polling) return;
  polling = true;
  while (true) {
    let commands = null;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 25000);
    try {
      const res = await fetch(SERVER + '/ext/wait', { headers: HEADERS, signal: abort.signal });
      if (res.ok) commands = (await res.json()).commands;
    } catch {
      // Server down or poll timed out.
    }
    clearTimeout(timer);
    if (!commands) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    commands.forEach(dispatch);
  }
}

function dispatch({ key, cmd, value }) {
  const [tabId, frameId] = key.split(':').map(Number);
  chrome.tabs.sendMessage(tabId, { type: 'cmd', cmd, value }, { frameId }, (res) => {
    // The page couldn't handle it (e.g. no "next" button): server presses the media key.
    if (chrome.runtime.lastError || !res || !res.ok) post('/ext/unhandled', { cmd });
  });
}

pollCommands();
