document.addEventListener('DOMContentLoaded', () => {
  const elements = {
    settingsBtn: document.getElementById('settings-btn'),
    settingsPanel: document.getElementById('settings-panel'),
    providerSelect: document.getElementById('provider-select'),
    modelInput: document.getElementById('model-input'),
    apikeyInput: document.getElementById('apikey-input'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    chatContainer: document.getElementById('chat-container'),
    promptInput: document.getElementById('prompt-input'),
    sendBtn: document.getElementById('send-btn'),
    readPageToggle: document.getElementById('read-page-toggle'),
    quickBtns: document.querySelectorAll('.quick-btn'),
    imagePreviewContainer: document.getElementById('image-preview-container'),
    historyBtn: document.getElementById('history-btn'),
    historyPanel: document.getElementById('history-panel'),
    historyList: document.getElementById('history-list'),
    newChatBtn: document.getElementById('new-chat-btn'),
    systemPromptInput: document.getElementById('system-prompt-input'),
    scrollBottomBtn: document.getElementById('scroll-bottom-btn')
  };

  let currentSessionId = null;
  let chatHistory = [];
  let pendingImages = [];

  const defaultModels = {
    openai: "gpt-4o", gemini: "gemini-1.5-pro-latest",
    claude: "claude-3-haiku-20240307", groq: "llama3-8b-8192",
    nvidia: "meta/llama3-70b-instruct"
  };

  // Load Settings
  chrome.storage.local.get(['provider', 'model', 'apiKey', 'systemPrompt'], (data) => {
    if (data.provider) elements.providerSelect.value = data.provider;
    if (data.model) elements.modelInput.value = data.model;
    if (data.apiKey) elements.apikeyInput.value = data.apiKey;
    if (data.systemPrompt) elements.systemPromptInput.value = data.systemPrompt;
    elements.modelInput.placeholder = `e.g. ${defaultModels[elements.providerSelect.value]}`;
  });

  elements.providerSelect.addEventListener('change', (e) => {
    elements.modelInput.placeholder = `e.g. ${defaultModels[e.target.value]}`;
  });

  elements.settingsBtn.addEventListener('click', () => {
    elements.settingsPanel.classList.toggle('open');
    elements.historyPanel.classList.remove('open');
  });

  elements.historyBtn.addEventListener('click', () => {
    elements.historyPanel.classList.toggle('open');
    elements.settingsPanel.classList.remove('open');
    if (elements.historyPanel.classList.contains('open')) {
      renderHistoryList();
    }
  });

  elements.newChatBtn.addEventListener('click', () => {
    createSession();
    elements.historyPanel.classList.remove('open');
  });

  function createSession() {
    currentSessionId = 'session_' + Date.now();
    chatHistory = [];
    elements.chatContainer.innerHTML = '';
    appendMessage('AI', "Hello! I'm your Omni-Copilot. How can I help you today?", 'ai-message', true);
    saveSession();
  }

  function saveSession() {
    if (!currentSessionId) return;
    chrome.storage.local.get(['sessions'], (data) => {
      const sessions = data.sessions || {};
      const session = sessions[currentSessionId] || {
        id: currentSessionId,
        title: chatHistory[0]?.content?.substring(0, 30) || 'New Chat',
        messages: [],
        timestamp: Date.now()
      };
      session.messages = chatHistory;
      session.timestamp = Date.now();
      if (chatHistory.length > 0 && session.title === 'New Chat') {
        session.title = chatHistory[0].content.substring(0, 30) + (chatHistory[0].content.length > 30 ? '...' : '');
      }
      sessions[currentSessionId] = session;

      // Prune to keep only the last 3 sessions
      const sortedSessions = Object.values(sessions).sort((a, b) => b.timestamp - a.timestamp);
      const keptSessions = sortedSessions.slice(0, 3);
      const prunedSessions = {};
      keptSessions.forEach(s => {
        prunedSessions[s.id] = s;
      });
      chrome.storage.local.set({ sessions: prunedSessions });
    });
  }

  function loadSession(id) {
    chrome.storage.local.get(['sessions'], (data) => {
      const sessions = data.sessions || {};
      const session = sessions[id];
      if (session) {
        currentSessionId = id;
        chatHistory = session.messages;
        elements.chatContainer.innerHTML = '';
        chatHistory.forEach(msg => {
          const sender = msg.role === 'user' ? 'You' : (msg.role === 'assistant' ? 'AI' : 'System');
          const className = msg.role === 'user' ? 'user-message' : (msg.role === 'assistant' ? 'ai-message' : 'system-msg');
          const isHTML = msg.role === 'assistant';
          const contentToRender = isHTML ? parseMarkdown(msg.content) : msg.content;
          appendMessage(sender, contentToRender, className, isHTML);
        });
        elements.historyPanel.classList.remove('open');
      }
    });
  }

  function renderHistoryList() {
    chrome.storage.local.get(['sessions'], (data) => {
      const sessions = data.sessions || {};
      const sessionList = Object.values(sessions).sort((a, b) => b.timestamp - a.timestamp);
      elements.historyList.innerHTML = '';
      sessionList.forEach(session => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
          <span class="title">${session.title}</span>
          <span class="date">${new Date(session.timestamp).toLocaleDateString()}</span>
        `;
        div.onclick = () => loadSession(session.id);
        elements.historyList.appendChild(div);
      });
    });
  }

  elements.saveSettingsBtn.addEventListener('click', () => {
    const provider = elements.providerSelect.value;
    const model = elements.modelInput.value.trim() || defaultModels[provider];
    const apiKey = elements.apikeyInput.value.trim();
    const systemPrompt = elements.systemPromptInput.value.trim();
    chrome.storage.local.set({ provider, model, apiKey, systemPrompt }, () => {
      elements.settingsPanel.classList.remove('open');
      appendMessage('System', 'Settings saved successfully!', 'system-msg', false);
    });
  });

  elements.quickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.promptInput.value = btn.getAttribute('data-prompt');
      sendMessage();
    });
  });

  elements.sendBtn.addEventListener('click', sendMessage);
  elements.promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  elements.promptInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight < 120 ? this.scrollHeight : 120) + 'px';
  });

  elements.chatContainer.addEventListener('scroll', () => {
    const isAtBottom = elements.chatContainer.scrollHeight - elements.chatContainer.scrollTop <= elements.chatContainer.clientHeight + 20;
    if (isAtBottom) {
      elements.scrollBottomBtn.classList.add('hidden');
    } else {
      elements.scrollBottomBtn.classList.remove('hidden');
    }
  });

  elements.scrollBottomBtn.addEventListener('click', () => {
    elements.chatContainer.scrollTo({ top: elements.chatContainer.scrollHeight, behavior: 'smooth' });
  });

  // Start a new session by default on load
  createSession();

  // IMAGE PASTE LOGIC
  elements.promptInput.addEventListener('paste', (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64Data = event.target.result;
          const mimeType = blob.type;
          pendingImages.push({ base64: base64Data, mimeType: mimeType });
          updateImagePreviews();
        };
        reader.readAsDataURL(blob);
      }
    }
  });

  function updateImagePreviews() {
    elements.imagePreviewContainer.innerHTML = '';
    pendingImages.forEach((img, index) => {
      const div = document.createElement('div');
      div.className = 'preview-item';
      div.innerHTML = `
        <img src="${img.base64}" class="preview-image">
        <button class="remove-img-btn" data-index="${index}">×</button>
      `;
      elements.imagePreviewContainer.appendChild(div);
    });

    elements.imagePreviewContainer.querySelectorAll('.remove-img-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.getAttribute('data-index'));
        pendingImages.splice(index, 1);
        updateImagePreviews();
      });
    });
  }

  // COPY BUTTON LOGIC
  elements.chatContainer.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      const code = decodeURIComponent(copyBtn.getAttribute('data-code'));
      navigator.clipboard.writeText(code).then(() => {
        const originalHTML = copyBtn.innerHTML;
        copyBtn.innerHTML = '✅ Copied!';
        setTimeout(() => copyBtn.innerHTML = originalHTML, 2000);
      });
    }
  });

  async function sendMessage() {
    const text = elements.promptInput.value.trim();
    if (!text && pendingImages.length === 0) return;

    const imagesToSend = [...pendingImages];

    appendMessage('You', text, 'user-message', false, imagesToSend);
    elements.promptInput.value = '';
    elements.promptInput.style.height = 'auto';

    pendingImages = [];
    updateImagePreviews();

    const typingIndicatorHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
    const aiMessageDiv = appendMessage('AI', typingIndicatorHTML, 'ai-message', true);

    chrome.storage.local.get(['provider', 'model', 'apiKey', 'systemPrompt'], async (settings) => {
      if (!settings.apiKey) {
        aiMessageDiv.innerHTML = '⚠️ Please set your API key in Settings first.';
        elements.settingsPanel.classList.add('open');
        return;
      }

      let pageContext = "";
      if (elements.readPageToggle.checked) pageContext = await getPageContext();

      const promptWithContext = pageContext
        ? `Context from current webpage:\n\n${pageContext}\n\nUser Question: ${text}`
        : text;

      chatHistory.push({ role: 'user', content: promptWithContext });
      saveSession();

      try {
        const response = await fetchAIResponse(
          settings.provider, settings.model || defaultModels[settings.provider],
          settings.apiKey, chatHistory, imagesToSend, settings.systemPrompt
        );

        aiMessageDiv.innerHTML = parseMarkdown(response);
        chatHistory.push({ role: 'assistant', content: response });
        saveSession();
      } catch (error) {
        aiMessageDiv.innerHTML = `❌ Error: ${error.message}`;
        chatHistory.pop();
      }
      elements.chatContainer.scrollTo({ top: elements.chatContainer.scrollHeight, behavior: 'smooth' });
    });
  }

  function appendMessage(sender, text, className, isHTML, images = []) {
    const div = document.createElement('div');
    div.className = `message ${className}`;

    if (images.length > 0) {
      const imgContainer = document.createElement('div');
      imgContainer.className = 'message-images';
      images.forEach(img => {
        const imgEl = document.createElement('img');
        imgEl.src = img.base64;
        imgEl.className = 'sent-image';
        imgContainer.appendChild(imgEl);
      });
      div.appendChild(imgContainer);
    }

    const textDiv = document.createElement('div');
    if (isHTML) textDiv.innerHTML = text;
    else textDiv.innerText = text;
    div.appendChild(textDiv);

    elements.chatContainer.appendChild(div);
    elements.chatContainer.scrollTo({ top: elements.chatContainer.scrollHeight, behavior: 'smooth' });
    return div;
  }

// --- IMPROVED SYNTAX HIGHLIGHTER (Learn with Sumit Inspired) ---
  function highlightCode(code) {
    let escaped = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let tokens =[];
    let tokenCounter = 0;

    // 1. Tokenize Strings and Comments to protect them from downstream regex replacements
    escaped = escaped.replace(/(\/\/.*$|#.*$|&lt;!--[\s\S]*?--&gt;)|("[^"]*"|'[^']*'|`[^`]*`)/gm, (match, isComment, isString) => {
      const id = `___TOKEN_${tokenCounter++}___`;
      if (isComment) tokens.push({ id, val: `<span class="sh-comment">${match}</span>` });
      else tokens.push({ id, val: `<span class="sh-string">${match}</span>` });
      return id;
    });

    // 2. Highlight HTML Attributes (e.g. class=, id=) -> Cyan
    escaped = escaped.replace(/\b([a-zA-Z0-9_-]+)(?=\s*=)/g, '<span class="sh-builtin">$1</span>');

    // 3. Highlight HTML Tags (e.g. <div, </button) -> Pink
    escaped = escaped.replace(/&lt;(\/?)([a-zA-Z0-9_-]+)/g, '&lt;$1<span class="sh-keyword">$2</span>');

    // 4. Highlight Object/Module dot-notation (e.g. chrome., os.) -> Cyan
    escaped = escaped.replace(/\b([a-zA-Z0-9_]+)\./g, '<span class="sh-builtin">$1</span>.');

    // 5. Highlight Built-in Objects and standard libraries -> Cyan
    const builtins = 'console|window|document|Math|print|os|json|String|Number|Boolean|Array|Object|Promise|Exception|Credentials'.split('|');
    const biRegex = new RegExp(`\\b(${builtins.join('|')})\\b`, 'g');
    escaped = escaped.replace(biRegex, '<span class="sh-builtin">$1</span>');

    // 6. Highlight Keywords & Booleans -> Pink
    const keywords = 'const|let|var|function|return|if|else|for|while|import|from|export|await|async|class|new|try|catch|throw|def|except|as|in|true|false|null|undefined|None|True|False'.split('|');
    const kwRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
    escaped = escaped.replace(kwRegex, '<span class="sh-keyword">$1</span>');

    // 7. Highlight Functions (Matches words before an open parenthesis) -> Yellow
    escaped = escaped.replace(/\b([a-zA-Z0-9_]+)(?=\()/g, '<span class="sh-function">$1</span>');

    // 8. Highlight Numbers -> Orange
    escaped = escaped.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="sh-number">$1</span>');

    // 9. Restore tokens back into the code block
    tokens.forEach(token => {
      escaped = escaped.replace(token.id, token.val);
    });

    return escaped;
  }
  

  // --- MARKDOWN PARSER ---
  function parseMarkdown(text) {
    const codeBlocks =[];

    // 0. Handle Thinking Process (Reasoning)
    text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (match, content) => {
      return `
        <details class="thinking-block">
          <summary class="thinking-summary">🤔 Thinking Process</summary>
          <div class="thinking-content">${content.trim()}</div>
        </details>
      `;
    });

    // 1. Extract Code Blocks safely and capture the language
    text = text.replace(/```([a-z0-9]*)\n([\s\S]*?)```/gi, (match, lang, code) => {

      codeBlocks.push({ lang: lang || 'text', code: code.trim() });
      return `%%%CODE_BLOCK_${codeBlocks.length - 1}%%%`;
    });

    // 2. Format basic elements
    let html = text
      .replace(/^### (.*$)/gim, '<h3>$1</h3>') 
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')  
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')   
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') 
      .replace(/\*([^*]+)\*/g, '<em>$1</em>') 
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>') 
      .replace(/^\d+\.\s+(.*$)/gim, '<ol><li>$1</li></ol>') 
      .replace(/^[-*]\s+(.*$)/gim, '<ul><li>$1</li></ul>')  
      .replace(/\n/g, '<br/>'); 

    // 3. Clean up overlapping list tags
    html = html.replace(/<\/ul><br\/><ul>/g, '').replace(/<\/ol><br\/><ol>/g, '');
    html = html.replace(/<\/ul>\s*<ul>/g, '').replace(/<\/ol>\s*<ol>/g, '');

    // 4. Restore Code Blocks with the Beautiful UI
    html = html.replace(/%%%CODE_BLOCK_(\d+)%%%/g, (match, index) => {
      const block = codeBlocks[index];
      const encodedCode = encodeURIComponent(block.code);
      const highlighted = highlightCode(block.code);
      
      return `
        <div class="code-window">
          <div class="code-header">
            <span class="code-lang">${block.lang}</span>
            <button class="copy-btn" data-code="${encodedCode}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 4 6 4.9 6 6v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H8V6h11v14z"></path>
              </svg> Copy
            </button>
          </div>
          <pre><code>${highlighted}</code></pre>
        </div>
      `;
    });

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return html;
  }

  async function getPageContext() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.url.startsWith('chrome://')) return "";
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = window.getSelection().toString().trim();
        if (selection) return selection;
        
        const clone = document.body.cloneNode(true);
        const noisyTags = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'iframe', 'svg'];
        noisyTags.forEach(tag => {
          clone.querySelectorAll(tag).forEach(el => el.remove());
        });
        return clone.innerText.replace(/\n\s*\n/g, '\n').substring(0, 15000);
      }
    });
    return result || "";
  }

  async function fetchAIResponse(provider, model, apiKey, messages, pendingImages = [], customSystemPrompt = "") {
    let url, headers, body;

    if (['openai', 'groq', 'nvidia'].includes(provider)) {
      const urls = { openai: "https://api.openai.com/v1/chat/completions", groq: "https://api.groq.com/openai/v1/chat/completions", nvidia: "https://integrate.api.nvidia.com/v1/chat/completions" };
      url = urls[provider]; headers = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };

      const formattedMessages = messages.map(m => {
        if (m.role === 'user' && pendingImages.length > 0) {
          return {
            role: m.role,
            content: [
              { type: "text", text: m.content },
              ...pendingImages.map(img => ({ type: "image_url", image_url: { url: img.base64 } }))
            ]
          };
        }
        return m;
      });

      if (customSystemPrompt) {
        formattedMessages.unshift({ role: "system", content: customSystemPrompt });
      }

      body = JSON.stringify({ model, messages: formattedMessages });
    } else if (provider === 'claude') {
      url = "https://api.anthropic.com/v1/messages"; headers = { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerously-allow-browser": "true" };
      let systemMessage = customSystemPrompt || messages.find(m => m.role === 'system')?.content || "";

      const claudeMessages = messages.filter(m => m.role !== 'system').map(m => {
        let content = m.content;
        if (m.role === 'user' && pendingImages.length > 0) {
          content = [
            { type: "text", text: m.content },
            ...pendingImages.map(img => ({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.base64.split(',')[1] } }))
          ];
        }
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: content };
      });
      body = JSON.stringify({ model, max_tokens: 1500, system: systemMessage, messages: claudeMessages });
    } else if (provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`; headers = { "Content-Type": "application/json" };

      const geminiMessages = messages.map(m => {
        const parts = [{ text: m.content }];
        if (m.role === 'user' && pendingImages.length > 0) {
          parts.push(...pendingImages.map(img => ({ inline_data: { mime_type: img.mimeType, data: img.base64.split(',')[1] } })));
        }
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: parts };
      });

      const requestBody = { contents: geminiMessages };
      if (customSystemPrompt) {
        requestBody.systemInstruction = { parts: [{ text: customSystemPrompt }] };
      }
      body = JSON.stringify(requestBody);
    }

    const response = await fetch(url, { method: "POST", headers, body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || data.error || "Failed to fetch response");

    if (['openai', 'groq', 'nvidia'].includes(provider)) return data.choices[0].message.content;
    if (provider === 'claude') return data.content[0].text;
    if (provider === 'gemini') return data.candidates[0].content.parts[0].text;
  }
});