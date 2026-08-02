document.addEventListener('DOMContentLoaded', () => {
  // --- MATHJAX RENDERING ---
  function renderMathIn(container) {
    if (window.renderMathInElement) {
      renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false,
        trust: true
      });
    }
  }

  function renderKaTeX(latex, display) {
    if (window.katex) {
      try {
        return katex.renderToString(latex, { displayMode: display, throwOnError: false, trust: true });
      } catch (e) {
        return display ? `$$${latex}$$` : `$${latex}$`;
      }
    }
    return display ? `$$${latex}$$` : `$${latex}$`;
  }

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
    sendIcon: document.getElementById('send-icon'),
    stopIcon: document.getElementById('stop-icon'),
    readPageToggle: document.getElementById('read-page-toggle'),
    quickBtns: document.querySelectorAll('.quick-btn'),
    imagePreviewContainer: document.getElementById('image-preview-container'),
    historyBtn: document.getElementById('history-btn'),
    historyPanel: document.getElementById('history-panel'),
    historyList: document.getElementById('history-list'),
    newChatBtn: document.getElementById('new-chat-btn'),
    systemPromptInput: document.getElementById('system-prompt-input'),
    scrollBottomBtn: document.getElementById('scroll-bottom-btn'),
    modelSelect: document.getElementById('model-select'),
    fetchModelsBtn: document.getElementById('fetch-models-btn'),
    customModelRow: document.getElementById('custom-model-row')
  };

  let currentSessionId = null;
  let chatHistory = [];
  let pendingImages = [];
  let isStreaming = false;
  let currentAbortController = null;

  const defaultModels = {
    openai: "gpt-4o", gemini: "gemini-3.6-flash",
    claude: "claude-haiku-4-5-20251001", groq: "llama-3.1-8b-instant",
    nvidia: "meta/llama-3.3-70b-instruct"
  };

  // --- MODEL FETCHING ---
  const modelEndpoints = {
    openai: { url: "https://api.openai.com/v1/models", auth: (key) => `Bearer ${key}`, parse: (data) => data.data?.map(m => m.id).filter(id => id.includes('gpt') || id.includes('o1') || id.includes('o3') || id.includes('chat')).sort() || [] },
    groq: { url: "https://api.groq.com/openai/v1/models", auth: (key) => `Bearer ${key}`, parse: (data) => data.data?.map(m => m.id).sort() || [] },
    nvidia: { url: "https://integrate.api.nvidia.com/v1/models", auth: (key) => `Bearer ${key}`, parse: (data) => data.data?.map(m => m.id).filter(id => id.includes('chat') || id.includes('instruct')).sort() || [] },
    claude: { url: "https://api.anthropic.com/v1/models", auth: (key) => key, parse: (data) => data.data?.map(m => m.id).sort() || [] },
    gemini: { url: "https://generativelanguage.googleapis.com/v1beta/models", auth: null, parse: (data) => data.models?.map(m => m.name.replace('models/', '')).filter(n => n.includes('gemini') && !n.includes('embedding')).sort() || [] }
  };

  async function fetchModels(provider, apiKey) {
    const endpoint = modelEndpoints[provider];
    if (!endpoint) return [];

    const headers = { "Content-Type": "application/json" };
    let url = endpoint.url;

    if (provider === 'gemini') {
      url += `?key=${apiKey}`;
    } else if (endpoint.auth) {
      headers["Authorization"] = endpoint.auth(apiKey);
    }
    if (provider === 'claude') {
      headers["anthropic-version"] = "2023-06-01";
    }

    const response = await fetch(url, { method: "GET", headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return endpoint.parse(data);
  }

  function populateModelDropdown(models, selectedModel) {
    elements.modelSelect.innerHTML = '';
    models.forEach(model => {
      const opt = document.createElement('option');
      opt.value = model;
      opt.textContent = model;
      elements.modelSelect.appendChild(opt);
    });
    // Add custom option at end
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = '✏️ Custom model name...';
    elements.modelSelect.appendChild(customOpt);

    // Set selected value
    if (selectedModel && models.includes(selectedModel)) {
      elements.modelSelect.value = selectedModel;
    } else if (selectedModel) {
      // User had a custom model saved — set to custom and fill input
      elements.modelSelect.value = '__custom__';
      elements.modelInput.value = selectedModel;
      elements.customModelRow.classList.remove('hidden');
    } else {
      // Default to first model
      elements.modelSelect.value = models[0] || '';
    }
  }

  async function autoFetchModels() {
    const apiKey = elements.apikeyInput.value.trim();
    const provider = elements.providerSelect.value;
    if (!apiKey) return;

    elements.fetchModelsBtn.classList.add('spinning');
    elements.fetchModelsBtn.disabled = true;

    try {
      const models = await fetchModels(provider, apiKey);
      if (models.length > 0) {
        chrome.storage.local.get(['model'], (data) => {
          populateModelDropdown(models, data.model);
        });
      } else {
        // Fallback: show default model only
        populateModelDropdown([defaultModels[provider]], null);
      }
    } catch (e) {
      console.warn('Failed to fetch models:', e);
      // Fallback to default
      populateModelDropdown([defaultModels[provider]], null);
    } finally {
      elements.fetchModelsBtn.classList.remove('spinning');
      elements.fetchModelsBtn.disabled = false;
    }
  }

  // Load Settings
  chrome.storage.local.get(['provider', 'model', 'apiKey', 'systemPrompt', 'apiKeys', 'models'], (data) => {
    if (data.provider) elements.providerSelect.value = data.provider;
    if (data.systemPrompt) elements.systemPromptInput.value = data.systemPrompt;

    // Restore per-provider API key and model
    const currentProvider = elements.providerSelect.value;
    const savedKeys = data.apiKeys || {};
    const savedModels = data.models || {};
    const keyToUse = savedKeys[currentProvider] || data.apiKey || '';
    const modelToUse = savedModels[currentProvider] || data.model || '';
    if (keyToUse) elements.apikeyInput.value = keyToUse;

    // Populate model dropdown with defaults first, then try fetching
    populateModelDropdown([defaultModels[currentProvider]], modelToUse);
    if (keyToUse) {
      autoFetchModels();
    }
  });

  elements.providerSelect.addEventListener('change', (e) => {
    const newProvider = e.target.value;
    // Load saved key/model for this provider
    chrome.storage.local.get(['apiKeys', 'models', 'apiKey', 'model'], (data) => {
      const savedKeys = data.apiKeys || {};
      const savedModels = data.models || {};
      const keyForProvider = savedKeys[newProvider] || '';
      const modelForProvider = savedModels[newProvider] || '';

      elements.apikeyInput.value = keyForProvider;
      elements.customModelRow.classList.add('hidden');
      populateModelDropdown([defaultModels[newProvider]], modelForProvider);

      if (keyForProvider) {
        autoFetchModels();
      }
    });
  });

  // Fetch models button
  elements.fetchModelsBtn.addEventListener('click', () => {
    autoFetchModels();
  });

  // Model select change — show/hide custom input
  elements.modelSelect.addEventListener('change', (e) => {
    if (e.target.value === '__custom__') {
      elements.customModelRow.classList.remove('hidden');
      elements.modelInput.focus();
    } else {
      elements.customModelRow.classList.add('hidden');
    }
  });

  // Auto-fetch models when API key is entered (debounced)
  let fetchDebounce = null;
  elements.apikeyInput.addEventListener('input', () => {
    clearTimeout(fetchDebounce);
    const key = elements.apikeyInput.value.trim();
    if (key && key.length > 10) {
      fetchDebounce = setTimeout(autoFetchModels, 600);
    }
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

  function generateTitle(text) {
    if (!text) return 'New Chat';
    let question = text;
    const ctxMatch = text.match(/User Question:\s*([\s\S]+)$/);
    if (ctxMatch) question = ctxMatch[1].trim();
    question = question.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '').replace(/[#*_~>]/g, '').replace(/\s+/g, ' ').trim();
    if (!question) return 'New Chat';
    const stopWords = new Set(['a','an','the','is','are','was','were','be','been','being','am','i','me','my','mine','we','us','our','ours','you','your','yours','he','him','his','she','her','hers','it','its','they','them','their','theirs','what','which','who','whom','whose','that','this','these','those','do','does','did','doing','done','have','has','having','had','will','would','shall','should','can','could','may','might','must','need','ought','dare','used','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','out','off','over','under','again','further','then','once','here','there','when','where','why','how','all','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','don','now','also','about','up','please','could','would','like','want','need','know','tell','show','make','give','use','get','go','see','come','think','take','help','find','let','try','keep','put','say','said','ask','let']);
    const words = question.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w.toLowerCase().replace(/[^a-z]/g, '')));
    if (words.length === 0) return question.substring(0, 40) + (question.length > 40 ? '...' : '');
    const selected = words.slice(0, 7);
    let title = selected.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    if (title.length > 45) title = title.substring(0, 45).replace(/\s+\S*$/, '');
    return title || 'New Chat';
  }

  function createSession() {
    currentSessionId = 'session_' + Date.now();
    chatHistory = [];
    elements.chatContainer.innerHTML = '';
    const greetingDiv = appendMessage('AI', "Hello! I'm your Omni-Copilot. How can I help you today?", 'ai-message', true);
    renderMathIn(greetingDiv);
    saveSession();
  }

  function saveSession() {
    if (!currentSessionId || chatHistory.length === 0) return;
    chrome.storage.local.get(['sessions'], (data) => {
      const sessions = data.sessions || {};
      const session = sessions[currentSessionId] || {
        id: currentSessionId,
        title: generateTitle(chatHistory[0]?.content),
        messages: [],
        timestamp: Date.now()
      };
      session.messages = chatHistory;
      session.timestamp = Date.now();
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
        chatHistory.forEach((msg, i) => {
          const sender = msg.role === 'user' ? 'You' : (msg.role === 'assistant' ? 'AI' : 'System');
          const className = msg.role === 'user' ? 'user-message' : (msg.role === 'assistant' ? 'ai-message' : 'system-msg');
          const isHTML = msg.role === 'assistant';
          if (isHTML && !msg.responses) {
            msg.responses = [msg.content];
            msg.currentIndex = 0;
          }
          const contentToRender = isHTML ? parseMarkdown(msg.content) : msg.content;
          const msgDiv = appendMessage(sender, contentToRender, className, isHTML);
          if (isHTML && msgDiv) {
            renderMathIn(msgDiv);
            updateResponseNav(msgDiv);
          }
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
    const selectedVal = elements.modelSelect.value;
    let model;
    if (selectedVal === '__custom__') {
      model = elements.modelInput.value.trim() || defaultModels[provider];
    } else if (selectedVal) {
      model = selectedVal;
    } else {
      model = defaultModels[provider];
    }
    const apiKey = elements.apikeyInput.value.trim();
    const systemPrompt = elements.systemPromptInput.value.trim();
    // Save to per-provider storage and current values
    chrome.storage.local.get(['apiKeys', 'models'], (data) => {
      const savedKeys = data.apiKeys || {};
      const savedModels = data.models || {};
      savedKeys[provider] = apiKey;
      savedModels[provider] = model;
      chrome.storage.local.set({ provider, model, apiKey, systemPrompt, apiKeys: savedKeys, models: savedModels }, () => {
        elements.settingsPanel.classList.remove('open');
        appendMessage('System', `Settings saved for ${provider}! Using model: ${model}`, 'system-msg', false);
      });
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

  // Auto-focus input when panel is opened or becomes visible
  elements.promptInput.focus();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      elements.promptInput.focus();
    }
  });

  // Shortcut toast notification
  const shortcutToast = document.getElementById('shortcut-toast');
  const toastClose = document.getElementById('toast-close');
  const toastDontShow = document.getElementById('toast-dont-show');

  chrome.storage.local.get(['hideShortcutToast'], (data) => {
    if (!data.hideShortcutToast) {
      shortcutToast.classList.remove('hidden');
    }
  });

  toastClose.addEventListener('click', () => {
    shortcutToast.classList.add('hidden');
  });

  toastDontShow.addEventListener('click', () => {
    chrome.storage.local.set({ hideShortcutToast: true });
    shortcutToast.classList.add('hidden');
  });

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

  // MESSAGE ACTION BUTTONS
  let currentSpeech = null;

  function getMsgIndex(msgDiv) {
    const msgs = [...elements.chatContainer.querySelectorAll('.ai-message')];
    return msgs.indexOf(msgDiv);
  }

  function getMsgEntry(msgDiv) {
    const idx = getMsgIndex(msgDiv);
    return chatHistory[idx];
  }

  function getPlainText(msgDiv) {
    const content = msgDiv.querySelector('.message-content');
    if (!content) return '';
    const clone = content.cloneNode(true);
    clone.querySelectorAll('.thinking-block').forEach(el => el.remove());
    return clone.innerText;
  }

  function getRawMarkdown(msgDiv) {
    const entry = getMsgEntry(msgDiv);
    if (!entry) return '';
    return entry.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  function updateResponseNav(msgDiv) {
    const entry = getMsgEntry(msgDiv);
    if (!entry || !entry.responses) return;
    const nav = msgDiv.querySelector('.response-nav');
    if (!nav) return;
    const total = entry.responses.length;
    nav.style.display = total > 1 ? 'flex' : 'none';
    nav.querySelector('.resp-counter').textContent = `${entry.currentIndex + 1}/${total}`;
    nav.querySelector('.resp-prev').disabled = entry.currentIndex === 0;
    nav.querySelector('.resp-next').disabled = entry.currentIndex === total - 1;
  }

  elements.chatContainer.addEventListener('click', (e) => {
    const msgDiv = e.target.closest('.message');
    if (!msgDiv || !msgDiv.classList.contains('ai-message')) return;
    const entry = getMsgEntry(msgDiv);

    if (e.target.closest('.copy-msg-btn')) {
      const text = getRawMarkdown(msgDiv);
      navigator.clipboard.writeText(text).then(() => {
        const btn = e.target.closest('.copy-msg-btn');
        const tooltip = btn.querySelector('.tooltip');
        if (tooltip) { tooltip.textContent = 'Copied!'; setTimeout(() => tooltip.textContent = 'Copy', 1500); }
      });
      return;
    }

    if (e.target.closest('.read-aloud-btn')) {
      const btn = e.target.closest('.read-aloud-btn');
      if (currentSpeech) {
        speechSynthesis.cancel();
        currentSpeech = null;
        document.querySelectorAll('.read-aloud-btn.active').forEach(b => b.classList.remove('active'));
        return;
      }
      const text = getPlainText(msgDiv);
      if (!text) return;
      const utter = new SpeechSynthesisUtterance(text);
      utter.onend = () => { currentSpeech = null; document.querySelectorAll('.read-aloud-btn.active').forEach(b => b.classList.remove('active')); };
      currentSpeech = utter;
      btn.classList.add('active');
      speechSynthesis.speak(utter);
      return;
    }

    if (e.target.closest('.regenerate-btn')) {
      if (isStreaming) return;
      if (!entry || !entry.responses) return;
      const aiMsgIdx = getMsgIndex(msgDiv);
      const allMsgs = [...elements.chatContainer.querySelectorAll('.message')];
      const msgDivIndex = allMsgs.indexOf(msgDiv);
      let lastUserMsg = null;
      for (let i = msgDivIndex - 1; i >= 0; i--) {
        if (allMsgs[i].classList.contains('user-message')) {
          lastUserMsg = allMsgs[i];
          break;
        }
      }
      if (!lastUserMsg) return;
      const userText = lastUserMsg.querySelector('.message-content')?.innerText || '';
      const textDiv = msgDiv.querySelector('.message-content');
      textDiv.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;

      currentAbortController = new AbortController();
      updateSendButton(true);

      chrome.storage.local.get(['provider', 'model', 'apiKey', 'systemPrompt'], async (settings) => {
        if (!settings.apiKey) { textDiv.innerHTML = '⚠️ Please set your API key in Settings first.'; updateSendButton(false); return; }
        let pageContext = "";
        if (elements.readPageToggle.checked) pageContext = await getPageContext();
        const promptWithContext = pageContext ? `Context from current webpage:\n\n${pageContext}\n\nUser Question: ${userText}` : userText;
        const tempHistory = chatHistory.slice(0, aiMsgIdx).concat([{ role: 'user', content: promptWithContext }]);
        try {
          let thinkingGlow = null;
          const startGlow = () => {
            if (thinkingGlow) return;
            let phase = 0;
            thinkingGlow = setInterval(() => {
              phase += 0.08;
              const el = textDiv.querySelector('.thinking-block.streaming');
              if (el) {
                const s = Math.abs(Math.sin(phase));
                el.style.boxShadow = `0 0 ${6 + 14 * s}px rgba(56, 189, 248, ${0.3 + 0.2 * s})`;
              }
            }, 50);
          };
          const stopGlow = () => {
            if (thinkingGlow) { clearInterval(thinkingGlow); thinkingGlow = null; }
            const el = textDiv.querySelector('.thinking-block');
            if (el) el.style.boxShadow = '';
          };
          const onToken = (partialText) => {
            textDiv.innerHTML = parseMarkdown(partialText, true);
            renderMathIn(textDiv);
            startGlow();
          };

          const response = await fetchAIResponse(settings.provider, settings.model || defaultModels[settings.provider], settings.apiKey, tempHistory, [], settings.systemPrompt, onToken, currentAbortController.signal);
          stopGlow();
          entry.responses.push(response);
          entry.currentIndex = entry.responses.length - 1;
          entry.content = response;
          textDiv.innerHTML = parseMarkdown(response);
          renderMathIn(textDiv);
          saveSession();
          updateResponseNav(msgDiv);
        } catch (error) {
          if (thinkingGlow) { clearInterval(thinkingGlow); thinkingGlow = null; }
          if (error.name === 'AbortError') {
            const partialText = textDiv.innerText || '';
            if (partialText) {
              textDiv.innerHTML = parseMarkdown(partialText);
              renderMathIn(textDiv);
              entry.responses.push(partialText);
              entry.currentIndex = entry.responses.length - 1;
              entry.content = partialText;
              saveSession();
              updateResponseNav(msgDiv);
            } else {
              textDiv.innerHTML = '⚠️ Response stopped.';
            }
          } else {
            textDiv.innerHTML = `❌ Error: ${error.message}`;
          }
        } finally {
          currentAbortController = null;
          updateSendButton(false);
        }
      });
      return;
    }

    if (e.target.closest('.resp-prev') || e.target.closest('.resp-next')) {
      if (!entry || !entry.responses) return;
      const dir = e.target.closest('.resp-prev') ? -1 : 1;
      entry.currentIndex = Math.max(0, Math.min(entry.responses.length - 1, entry.currentIndex + dir));
      entry.content = entry.responses[entry.currentIndex];
      const textDiv = msgDiv.querySelector('.message-content');
      textDiv.innerHTML = parseMarkdown(entry.content);
      renderMathIn(textDiv);
      saveSession();
      updateResponseNav(msgDiv);
      return;
    }
  });

  elements.chatContainer.addEventListener('click', (e) => {
    const userMsgDiv = e.target.closest('.user-message');
    if (!userMsgDiv) return;

    if (e.target.closest('.user-copy-btn')) {
      const text = userMsgDiv.querySelector('.message-content')?.innerText || '';
      navigator.clipboard.writeText(text).then(() => {
        const tooltip = e.target.closest('.user-copy-btn')?.querySelector('.tooltip');
        if (tooltip) { tooltip.textContent = 'Copied!'; setTimeout(() => tooltip.textContent = 'Copy', 1500); }
      });
      return;
    }

    if (e.target.closest('.user-speak-btn')) {
      const btn = e.target.closest('.user-speak-btn');
      if (currentSpeech) {
        speechSynthesis.cancel();
        currentSpeech = null;
        document.querySelectorAll('.read-aloud-btn.active, .user-speak-btn.active').forEach(b => b.classList.remove('active'));
        if (btn.classList.contains('active')) return;
      }
      const text = userMsgDiv.querySelector('.message-content')?.innerText || '';
      if (!text) return;
      const utter = new SpeechSynthesisUtterance(text);
      utter.onend = () => { currentSpeech = null; document.querySelectorAll('.read-aloud-btn.active, .user-speak-btn.active').forEach(b => b.classList.remove('active')); };
      currentSpeech = utter;
      btn.classList.add('active');
      speechSynthesis.speak(utter);
      return;
    }

    if (e.target.closest('.user-edit-btn')) {
      if (isStreaming) return;
      const msgIndex = parseInt(userMsgDiv.getAttribute('data-index'));
      if (isNaN(msgIndex)) return;
      const entry = chatHistory[msgIndex];
      if (!entry) return;
      const rawText = entry.content.replace(/^Context from current webpage:\n\n[\s\S]+?\n\nUser Question:\s*/, '');
      elements.promptInput.value = rawText;
      elements.promptInput.style.height = 'auto';
      elements.promptInput.style.height = (elements.promptInput.scrollHeight < 120 ? elements.promptInput.scrollHeight : 120) + 'px';
      elements.promptInput.focus();
      chatHistory.splice(msgIndex);
      const msgs = [...elements.chatContainer.querySelectorAll('.message')];
      for (let i = msgs.indexOf(userMsgDiv); i < msgs.length; i++) {
        msgs[i].remove();
      }
      return;
    }
  });

  function updateSendButton(streaming) {
    isStreaming = streaming;
    if (streaming) {
      elements.sendBtn.classList.add('streaming');
      elements.sendIcon.style.display = 'none';
      elements.stopIcon.style.display = 'block';
    } else {
      elements.sendBtn.classList.remove('streaming');
      elements.sendIcon.style.display = 'block';
      elements.stopIcon.style.display = 'none';
    }
  }

  async function sendMessage() {
    if (isStreaming) {
      if (currentAbortController) currentAbortController.abort();
      return;
    }

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
        aiMessageDiv.querySelector('.message-content').innerHTML = '⚠️ Please set your API key in Settings first.';
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

      currentAbortController = new AbortController();
      updateSendButton(true);

      try {
        const contentDiv = aiMessageDiv.querySelector('.message-content');
        let thinkingGlow = null;
        const startGlow = () => {
          if (thinkingGlow) return;
          let phase = 0;
          thinkingGlow = setInterval(() => {
            phase += 0.08;
            const el = contentDiv.querySelector('.thinking-block.streaming');
            if (el) {
              const s = Math.abs(Math.sin(phase));
              el.style.boxShadow = `0 0 ${6 + 14 * s}px rgba(56, 189, 248, ${0.3 + 0.2 * s})`;
            }
          }, 50);
        };
        const stopGlow = () => {
          if (thinkingGlow) { clearInterval(thinkingGlow); thinkingGlow = null; }
          const el = contentDiv.querySelector('.thinking-block');
          if (el) el.style.boxShadow = '';
        };
        const onToken = (partialText) => {
          contentDiv.innerHTML = parseMarkdown(partialText, true);
          renderMathIn(contentDiv);
          startGlow();
        };

        const response = await fetchAIResponse(
          settings.provider, settings.model || defaultModels[settings.provider],
          settings.apiKey, chatHistory, imagesToSend, settings.systemPrompt,
          onToken, currentAbortController.signal
        );

        stopGlow();
        contentDiv.innerHTML = parseMarkdown(response);
        renderMathIn(contentDiv);
        chatHistory.push({ role: 'assistant', content: response, responses: [response], currentIndex: 0 });
        saveSession();

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';
        actionsDiv.innerHTML = `
          <button class="action-btn copy-msg-btn" title="Copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span class="tooltip">Copy</span>
          </button>
          <button class="action-btn read-aloud-btn" title="Read aloud">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
            <span class="tooltip">Read aloud</span>
          </button>
          <button class="action-btn regenerate-btn" title="Regenerate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            <span class="tooltip">Regenerate</span>
          </button>
          <div class="response-nav" style="display:none;">
            <button class="resp-prev" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="resp-counter">1/1</span>
            <button class="resp-next" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        `;
        aiMessageDiv.appendChild(actionsDiv);
      } catch (error) {
        if (thinkingGlow) { clearInterval(thinkingGlow); thinkingGlow = null; }
        if (error.name === 'AbortError') {
          const contentDiv = aiMessageDiv.querySelector('.message-content');
          const partialText = contentDiv.innerText || '';
          if (partialText) {
            contentDiv.innerHTML = parseMarkdown(partialText);
            renderMathIn(contentDiv);
            chatHistory.push({ role: 'assistant', content: partialText, responses: [partialText], currentIndex: 0 });
            saveSession();
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'message-actions';
            actionsDiv.innerHTML = `
              <button class="action-btn copy-msg-btn" title="Copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span class="tooltip">Copy</span></button>
              <button class="action-btn read-aloud-btn" title="Read aloud"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg><span class="tooltip">Read aloud</span></button>
              <button class="action-btn regenerate-btn" title="Regenerate"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg><span class="tooltip">Regenerate</span></button>
              <div class="response-nav" style="display:none;"><button class="resp-prev" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button><span class="resp-counter">1/1</span><button class="resp-next" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button></div>
            `;
            aiMessageDiv.appendChild(actionsDiv);
          } else {
            contentDiv.innerHTML = '⚠️ Response stopped.';
            chatHistory.pop();
          }
        } else {
          aiMessageDiv.querySelector('.message-content').innerHTML = `❌ Error: ${error.message}`;
          chatHistory.pop();
        }
      } finally {
        currentAbortController = null;
        updateSendButton(false);
      }
    });
  }

  function appendMessage(sender, text, className, isHTML, images = []) {
    const div = document.createElement('div');
    div.className = `message ${className}`;
    if (className === 'user-message') {
      div.setAttribute('data-index', chatHistory.length);
    }

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
    textDiv.className = 'message-content';
    if (isHTML) textDiv.innerHTML = text;
    else textDiv.innerText = text;
    div.appendChild(textDiv);

    if (className === 'ai-message' && !text.includes('typing-indicator')) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'message-actions';
      actionsDiv.innerHTML = `
        <button class="action-btn copy-msg-btn" title="Copy">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span class="tooltip">Copy</span>
        </button>
        <button class="action-btn read-aloud-btn" title="Read aloud">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          <span class="tooltip">Read aloud</span>
        </button>
        <button class="action-btn regenerate-btn" title="Regenerate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span class="tooltip">Regenerate</span>
        </button>
        <div class="response-nav" style="display:none;">
          <button class="resp-prev" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="resp-counter">1/1</span>
          <button class="resp-next" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      `;
      div.appendChild(actionsDiv);
    }

    if (className === 'user-message' && !isHTML) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'message-actions';
      actionsDiv.innerHTML = `
        <button class="action-btn user-copy-btn" title="Copy">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span class="tooltip">Copy</span>
        </button>
        <button class="action-btn user-speak-btn" title="Read aloud">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          <span class="tooltip">Read aloud</span>
        </button>
        <button class="action-btn user-edit-btn" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span class="tooltip">Edit</span>
        </button>
      `;
      div.appendChild(actionsDiv);
    }

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
  function parseMarkdown(text, streaming = false) {
    const codeBlocks =[];
    const mathBlocks = [];
    const tableBlocks = [];

    // 0. Handle Thinking Process (Reasoning)
    if (streaming) {
      // During streaming: replace complete blocks WITH streaming class
      text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (match, content) => {
        return `
          <details class="thinking-block streaming">
            <summary class="thinking-summary">🤔 Thinking Process</summary>
            <div class="thinking-content">${content.trim()}</div>
          </details>
        `;
      });
      // Handle incomplete (open) thinking tags
      const openThinkIdx = text.indexOf('<think>');
      if (openThinkIdx !== -1) {
        const beforeThink = text.substring(0, openThinkIdx);
        const thinkContent = text.substring(openThinkIdx + 7);
        text = beforeThink + `
          <details class="thinking-block streaming">
            <summary class="thinking-summary">🤔 Thinking Process</summary>
            <div class="thinking-content">${thinkContent}</div>
          </details>
        `;
      }
    } else {
      // Not streaming: normal thinking blocks without streaming class
      text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (match, content) => {
        return `
          <details class="thinking-block">
            <summary class="thinking-summary">🤔 Thinking Process</summary>
            <div class="thinking-content">${content.trim()}</div>
          </details>
        `;
      });
    }

    // 0.5. Extract Math Blocks (display $$...$$, \[...\], then inline $...$, \(...\))
    // Display math: $$...$$
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, latex) => {
      const id = `%%MATH_BLOCK_${mathBlocks.length}%%`;
      mathBlocks.push({ latex: latex.trim(), display: true });
      return id;
    });
    // Display math: \[...\]
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (match, latex) => {
      const id = `%%MATH_BLOCK_${mathBlocks.length}%%`;
      mathBlocks.push({ latex: latex.trim(), display: true });
      return id;
    });
    // Inline math: $...$  (but not $$ and not escaped \$)
    text = text.replace(/(?<!\$)(?<!\\)\$(?!\$)((?:[^$\\]|\\.)+?)\$(?!\$)/g, (match, latex) => {
      const id = `%%MATH_BLOCK_${mathBlocks.length}%%`;
      mathBlocks.push({ latex: latex.trim(), display: false });
      return id;
    });
    // Inline math: \(...\)
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (match, latex) => {
      const id = `%%MATH_BLOCK_${mathBlocks.length}%%`;
      mathBlocks.push({ latex: latex.trim(), display: false });
      return id;
    });

    // 1. Extract Code Blocks safely and capture the language
    text = text.replace(/```([a-z0-9]*)\n([\s\S]*?)```/gi, (match, lang, code) => {

      codeBlocks.push({ lang: lang || 'text', code: code.trim() });
      return `%%%CODE_BLOCK_${codeBlocks.length - 1}%%%`;
    });

    // 1.5. Extract Tables (before \n -> <br/> breaks them)
    text = text.replace(/(?:^|\n)((?:\|.+\|\n?)+)/g, (match, tableBlock) => {
      const rows = tableBlock.trim().split('\n').filter(r => r.trim());
      if (rows.length < 2) return match;

      const parseRow = (row) => row.split('|').slice(1, -1).map(c => c.trim());
      const headerCells = parseRow(rows[0]);
      if (headerCells.length === 0) return match;

      const isSeparator = (row) => /^\|[\s:-]+\|[\s:-]+\|$/.test(row.trim());
      let bodyRows, hasHeader;

      if (rows.length >= 3 && isSeparator(rows[1])) {
        hasHeader = true;
        bodyRows = rows.slice(2).filter(r => !isSeparator(r));
      } else {
        hasHeader = false;
        bodyRows = rows.slice(1);
      }

      const cellCount = headerCells.length;
      const renderCells = (cells, tag) => {
        const padded = cells.concat(Array(Math.max(0, cellCount - cells.length)).fill(''));
        return padded.slice(0, cellCount).map(c => `<${tag}>${c}</${tag}>`).join('');
      };

      let tableHTML = '<table class="md-table">';
      if (hasHeader) {
        tableHTML += `<thead><tr>${renderCells(headerCells, 'th')}</tr></thead>`;
      }
      if (bodyRows.length > 0) {
        tableHTML += '<tbody>';
        bodyRows.forEach(row => {
          const cells = parseRow(row);
          tableHTML += `<tr>${renderCells(cells, 'td')}</tr>`;
        });
        tableHTML += '</tbody>';
      }
      tableHTML += '</table>';

      const id = `%%TABLE_BLOCK_${tableBlocks.length}%%`;
      tableBlocks.push(tableHTML);
      return '\n' + id + '\n';
    });

    // 2. Format basic elements
    let html = text
      .replace(/^### (.*$)/gim, '<h3>$1</h3>') 
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')  
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')   
      .replace(/^---$/gim, '<hr>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') 
      .replace(/\*([^*]+)\*/g, '<em>$1</em>') 
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>') 
      .replace(/((?:^\d+\.\s+(?!.*\*\*)(.*$)\n?(?:[ \t]+.*\n?|\n)*))+/gim, (match) => {
        const items = match.trim().split('\n').map(line => {
          const m = line.match(/^\d+\.\s+(?!.*\*\*)(.*)$/);
          if (m) return '<li>' + m[1] + '</li>';
          if (line.trim()) return '<ul><li>' + line.trim() + '</li></ul>';
          return '';
        }).filter(Boolean).join('');
        return '<ol>' + items + '</ol>';
      })
      .replace(/^[-*]\s+(.*$)/gim, '<ul><li>$1</li></ul>')  
      .replace(/\n/g, '<br/>'); 

    // 3. Clean up overlapping list tags and extra br after block elements
    html = html.replace(/<\/ul><br\/><ul>/g, '').replace(/<\/ol><br\/><ol>/g, '');
    html = html.replace(/<\/ul>\s*<ul>/g, '').replace(/<\/ol>\s*<ol>/g, '');
    html = html.replace(/<\/details><br\/>/g, '</details>');
    html = html.replace(/<\/div><br\/>/g, '</div>');
    html = html.replace(/<\/h[1-6]><br\/>/g, (m) => m.replace('<br/>', ''));
    html = html.replace(/<hr><br\/>/g, '<hr>');
    html = html.replace(/<br\/><hr>/g, '<hr>');

    // 4. Restore Math Blocks (render KaTeX directly)
    html = html.replace(/%%MATH_BLOCK_(\d+)%%/g, (match, index) => {
      const block = mathBlocks[index];
      return renderKaTeX(block.latex, block.display);
    });

    // 4.5. Restore Table Blocks
    html = html.replace(/%%TABLE_BLOCK_(\d+)%%/g, (match, index) => {
      return tableBlocks[index];
    });

    // 5. Restore Code Blocks with the Beautiful UI
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

  async function fetchAIResponse(provider, model, apiKey, messages, pendingImages = [], customSystemPrompt = "", onToken = null, signal = null) {
    let url, headers, body;
    const streaming = !!onToken;

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
        return { role: m.role, content: m.content };
      });

      if (customSystemPrompt) {
        formattedMessages.unshift({ role: "system", content: customSystemPrompt });
      }

      body = JSON.stringify({ model, messages: formattedMessages, max_tokens: 4096, stream: streaming });
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
      body = JSON.stringify({ model, max_tokens: 4096, stream: streaming, system: systemMessage, messages: claudeMessages });
    } else if (provider === 'gemini') {
      const endpoint = streaming ? 'streamGenerateContent' : 'generateContent';
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${apiKey}${streaming ? '&alt=sse' : ''}`;
      headers = { "Content-Type": "application/json" };

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

    const response = await fetch(url, { method: "POST", headers, body, signal });
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error?.message || errData.error || "Failed to fetch response");
    }

    if (!streaming) {
      const data = await response.json();
      if (['openai', 'groq', 'nvidia'].includes(provider)) return data.choices[0].message.content;
      if (provider === 'claude') return data.content[0].text;
      if (provider === 'gemini') {
        const candidate = data.candidates?.[0];
        if (candidate?.content?.parts?.[0]?.text) return candidate.content.parts[0].text;
        if (candidate?.finishReason === 'SAFETY') throw new Error('Response blocked by Gemini safety filters');
        throw new Error('No text in Gemini response');
      }
    }

    // Streaming response handling
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';
    let rawChunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      rawChunks.push(chunk);
      buffer += chunk;

      if (['openai', 'groq', 'nvidia'].includes(provider)) {
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const token = parsed.choices?.[0]?.delta?.content;
              if (token) { fullText += token; if (onToken) onToken(fullText); }
            } catch (e) {}
          }
        }
      } else if (provider === 'claude') {
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                fullText += parsed.delta.text;
                if (onToken) onToken(fullText);
              }
            } catch (e) {}
          }
        }
      } else if (provider === 'gemini') {
        // Gemini streamGenerateContent returns SSE with data: prefix
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6).trim() : trimmed;
          try {
            const parsed = JSON.parse(jsonStr);
            const token = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (token) { fullText += token; if (onToken) onToken(fullText); }
            if (parsed.candidates?.[0]?.finishReason === 'SAFETY' && !fullText) {
              throw new Error('Response blocked by Gemini safety filters');
            }
          } catch (e) {
            if (e.message.includes('safety')) throw e;
          }
        }
      }
    }

    // Fallback: if streaming yielded nothing, try parsing raw response as JSON array
    if (!fullText && rawChunks.length > 0) {
      try {
        const raw = rawChunks.join('');
        const arr = JSON.parse(raw);
        const items = Array.isArray(arr) ? arr : [arr];
        for (const item of items) {
          const token = item.candidates?.[0]?.content?.parts?.[0]?.text;
          if (token) fullText += token;
        }
      } catch (e) {}
    }

    // Debug: log if Gemini returned nothing
    if (!fullText && provider === 'gemini') {
      console.warn('[Omni-Copilot] Empty Gemini response. Raw chunks:', rawChunks.join('').substring(0, 500));
    }

    return fullText;
  }
});