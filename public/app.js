(() => {
  "use strict";
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));
  const money = paise => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(paise||0)/100);
  const num = n => Number(n||0).toLocaleString("en-IN");
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+"_"+Math.random().toString(36).slice(2));

  function getProfileKey(){
    try{
      let key=localStorage.getItem("foodieagent-profile-v1");
      if(!key){key="fa_demo_"+uuid().replace(/-/g,"");localStorage.setItem("foodieagent-profile-v1",key);}
      if(!/^[a-zA-Z0-9_-]{12,100}$/.test(key))throw new Error("invalid");
      return key;
    }catch{return "fa_demo_"+uuid().replace(/-/g,"");}
  }

  const AGENT_ROLES = [
    { id: "pref", name: "Preference Agent", icon: "🎯", desc: "Extracts hard constraints & resolves memory" },
    { id: "disco", name: "Discovery Agent", icon: "🏬", desc: "Searches open restaurants in service area" },
    { id: "diet", name: "Dietary Agent", icon: "🥬", desc: "Validates vegetarian/dietary metadata" },
    { id: "price", name: "Price & ETA Agent", icon: "⏱️", desc: "Calculates paise totals, tax, and delivery" },
    { id: "coord", name: "Coordinator Agent", icon: "🤖", desc: "Enforces constraints & ranks with 40/35/25 formula" },
    { id: "order", name: "Order Monitor", icon: "🔔", desc: "Tracks database order state & notifications" }
  ];

  const state = {
    profileKey: getProfileKey(),
    tab: "discover",
    data: null,
    preferences: null,
    orders: [],
    notifications: [],
    agentRuns: [],
    requestText: "Order a vegetarian pizza under ₹500 delivered within 30 minutes.",
    budgetRupees: "500",
    deadlineMinutes: "30",
    vegetarian: true,
    cuisine: "",
    spiceLevel: "medium",
    useSavedMemory: false,
    rememberPrefs: false,
    recommendation: null,
    selected: null,
    addonItem: null,
    quantity: 1,
    orderChecked: false,
    idempotencyKey: "",
    loading: false,
    placing: false,
    alert: "",
    toastTimer: null,
    // AI Chat, Dynamic Model Selection & LSTM Working Memory
    geminiApiKey: localStorage.getItem("foodieagent-gemini-key") || "",
    selectedModel: localStorage.getItem("foodieagent-model") || "gemini-2.5-flash",
    sessionId: localStorage.getItem("foodieagent-session-id") || ("sess_" + uuid().replace(/-/g,"").slice(0, 12)),
    memoryData: null,
    backupData: null,
    llmStatus: null,
    activeAgentStep: null,
    chatMessages: [
      {
        role: "model",
        text: "👋 Hi! I'm **FoodieAgent Enterprise**, your AI food concierge with **Dual-Tier Memory (LTM + STM)** and **Crash-Resilient WAL Backup**.\n\nAsk me anything: find budget-safe meals, make multi-turn adjustments ('make it veg', 'under ₹350', 'order the first one'), compare dishes, or inspect what I remember about you!",
        toolCalls: [],
        cards: []
      }
    ],
    chatInput: "",
    chatLoading: false,
    simulatingOrderId: null,
    simTimer: null,
    heroSlideIndex: 0,
    heroSlideTimer: null,
    isChatbotOpen: false,
    unreadBotCount: 0
  };

  async function api(path, options={}){
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (state.geminiApiKey) headers["x-gemini-key"] = state.geminiApiKey;

    const response = await fetch("/api/" + path, {
      method: options.method || "GET",
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || ("Request failed (" + response.status + ")"));
    return data;
  }

  function notify(message, type=""){
    const root = $("#toast-root"); if (!root) return;
    const el = document.createElement("div"); el.className = "toast " + type; el.textContent = message; root.appendChild(el);
    window.setTimeout(() => el.remove(), 4200);
  }

  function imageFallback(img){
    img.onerror = null;
    const fallback = img.dataset.fallback || "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=80";
    img.src = fallback;
  }

  function isNonVegetarianRequest(text){
    const low = String(text || "").toLowerCase();
    return /\bnon[\s-]?(?:vegetarian|veg)\b/i.test(low) ||
      /\b(?:chicken|pepperoni|sausage|bacon|ham|salami|prawn|shrimp|fish)\s+(?:pizza|burger|wrap|roll|pasta|noodles?)\b/i.test(low) ||
      /\b(?:pizza|burger|wrap|roll|pasta|noodles?)\s+(?:with|topped with)\s+(?:chicken|pepperoni|sausage|bacon|ham|salami|prawn|shrimp|fish)\b/i.test(low);
  }

  function restaurantById(id){ return (state.data?.restaurants || []).find(r => r.id === id) || null; }

  // Robust Markdown Formatter for In-Chat Rendering
  function renderMarkdown(raw){
    let s = esc(raw);

    // Markdown Tables: | col1 | col2 |
    s = s.replace(/((?:\|[^\n\r]+\|(?:\r?\n|$))+)/g, (tableText) => {
      const lines = tableText.trim().split(/\r?\n/).filter(l => l.includes('|'));
      if (lines.length < 2) return tableText;

      let html = '<table class="chat-table"><thead><tr>';
      const headers = lines[0].split('|').filter(c => c.trim().length > 0);
      headers.forEach(h => { html += '<th>' + h.trim() + '</th>'; });
      html += '</tr></thead><tbody>';

      const startIdx = lines[1].includes('---') ? 2 : 1;
      for (let i = startIdx; i < lines.length; i++) {
        const cells = lines[i].split('|').filter(c => c.trim().length > 0);
        if (cells.length > 0) {
          html += '<tr>';
          cells.forEach(c => { html += '<td>' + c.trim() + '</td>'; });
          html += '</tr>';
        }
      }
      html += '</tbody></table>';
      return html;
    });

    // Headers
    s = s.replace(/^### (.*$)/gim, '<h4 style="margin:8px 0 4px;font-size:14px;color:#1e6545;font-weight:800">$1</h4>');
    s = s.replace(/^## (.*$)/gim, '<h3 style="margin:10px 0 6px;font-size:15px;color:#1e6545;font-weight:800">$1</h3>');

    // Bold & Italic
    s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Lists
    s = s.replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>');
    s = s.replace(/((?:<li>.*<\/li>(?:\r?\n|$))+)/gims, '<ul style="margin:6px 0 8px;padding-left:18px">$1</ul>');

    // Line breaks
    s = s.replace(/\n/g, '<br>');

    return s;
  }

  function nav(){
    const unread = state.notifications.filter(n => !n.is_read).length;
    return '<nav class="app-nav" aria-label="Main navigation">' +
      '<button class="nav-tab ' + (state.tab === "discover" ? "active" : "") + '" data-action="tab" data-tab="discover">⌕ Discover</button>' +
      '<button class="nav-tab ' + (state.tab === "orders" ? "active" : "") + '" data-action="tab" data-tab="orders">▤ Orders <span class="count">' + state.orders.length + '</span></button>' +
      '<button class="nav-tab ' + (state.tab === "memory" ? "active" : "") + '" data-action="tab" data-tab="memory">◉ Memory & tools</button>' +
      '<button class="nav-tab ' + (state.tab === "activity" ? "active" : "") + '" data-action="tab" data-tab="activity">✳ Agent activity</button>' +
      '<button class="nav-tab ' + (state.tab === "notifications" ? "active" : "") + '" data-action="tab" data-tab="notifications">♧ Alerts ' + (unread ? '<span class="count">' + unread + '</span>' : '') + '</button>' +
      '</nav>';
  }

  function updateAiStatusBadge(){
    const label = $("#ai-mode-label");
    const btn = $("#ai-mode-btn");
    if (!label || !btn) return;

    if (state.geminiApiKey || state.llmStatus?.geminiConfigured) {
      label.textContent = "AI: Gemini 2.5 Live";
      btn.classList.add("live-ai");
    } else {
      label.textContent = "AI: Offline Mode";
      btn.classList.remove("live-ai");
    }
  }

  function agentVisualizer(activeStepId = null){
    return '<div class="agent-visualizer">' +
      '<div class="section-head" style="margin-bottom:8px"><div><div class="section-kicker">MULTI-AGENT COLLABORATION PIPELINE</div><h3 style="font:800 17px Manrope,sans-serif;margin:4px 0">6 Autonomous Agents Collaborating</h3></div><span class="subtle-count">Contract Net-Inspired Workflow</span></div>' +
      '<div class="agent-pipeline-grid">' +
      AGENT_ROLES.map(role => {
        const isActive = activeStepId === role.id;
        const isDone = activeStepId && AGENT_ROLES.findIndex(r => r.id === role.id) < AGENT_ROLES.findIndex(r => r.id === activeStepId);
        const cardClass = isActive ? "agent-step-card active" : isDone ? "agent-step-card complete" : "agent-step-card";
        const tagText = isActive ? "⚡ RUNNING" : isDone ? "✓ DONE" : "STANDBY";
        return '<div class="' + cardClass + '">' +
          '<div class="agent-step-header"><span class="agent-step-icon">' + role.icon + '</span><span class="agent-status-tag">' + tagText + '</span></div>' +
          '<div class="agent-step-title">' + role.name + '</div>' +
          '<div class="agent-step-desc">' + role.desc + '</div>' +
          '</div>';
      }).join("") +
      '</div></div>';
  }

  const HERO_SLIDES = [
    {
      title: "Wood-Fired Neapolitan Margherita",
      restaurant: "Urban Oven & Slice Society",
      price: "₹279 – ₹319",
      badge: "LIVE SHOWCASE · 100% PURE VEG",
      image: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=1400&q=90",
      fallback: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1400&q=85"
    },
    {
      title: "Gourmet Truffle Burrata Artisan Pizza",
      restaurant: "Slice Society Artisan Kitchen",
      price: "₹699.00",
      badge: "PREMIUM SELECTION · CHEF'S SPECIAL",
      image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1400&q=90",
      fallback: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=1400&q=85"
    },
    {
      title: "Quattro Formaggi Grande Cheese Pull",
      restaurant: "Urban Oven & Little Tomato",
      price: "₹429 – ₹749",
      badge: "ULTIMATE CHEESE PULL · 4 CHEESES",
      image: "https://images.unsplash.com/photo-1579751626657-72bc17010498?auto=format&fit=crop&w=1400&q=90",
      fallback: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1400&q=85"
    },
    {
      title: "Diavola & Smokehouse BBQ Slices",
      restaurant: "Fire Crust Social & Metro Pizza",
      price: "₹379 – ₹719",
      badge: "SMOKED BBQ & PEPPERONI CRUST",
      image: "https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?auto=format&fit=crop&w=1400&q=90",
      fallback: "https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=1400&q=85"
    },
    {
      title: "Fresh Hand-Rolled Pasta & Cheesy Bread",
      restaurant: "Green Slice & Pasta Pantry",
      price: "₹149 – ₹299",
      badge: "PERFECT SIDES & COMBO ADDONS",
      image: "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=1400&q=90",
      fallback: "https://images.unsplash.com/photo-1573140247632-f8fd74997d5c?auto=format&fit=crop&w=1400&q=85"
    }
  ];

  function startHeroSlider(){
    if (state.heroSlideTimer) clearInterval(state.heroSlideTimer);
    state.heroSlideTimer = setInterval(() => {
      setHeroSlide((state.heroSlideIndex + 1) % HERO_SLIDES.length);
    }, 3800);
  }

  function setHeroSlide(index){
    state.heroSlideIndex = index;
    const slides = $$(".hero-slide");
    const dots = $$(".hero-dot-btn");
    slides.forEach((s, idx) => {
      if (idx === index) s.classList.add("active");
      else s.classList.remove("active");
    });
    dots.forEach((d, idx) => {
      if (idx === index) d.classList.add("active");
      else d.classList.remove("active");
    });
  }

  function hero(){
    const slidesHtml = HERO_SLIDES.map((s, idx) => {
      const activeClass = idx === state.heroSlideIndex ? " active" : "";
      return '<div class="hero-slide' + activeClass + '" data-slide-index="' + idx + '">' +
        '<div class="hero-slide-badge"><span class="live-dot"></span><span>' + esc(s.badge) + '</span></div>' +
        '<img class="hero-photo" src="' + esc(s.image) + '" alt="' + esc(s.title) + '" data-fallback="' + esc(s.fallback) + '" onerror="FoodieAgent.imageFallback(this)">' +
        '<div class="hero-slide-caption">' +
          '<div><div class="slide-title">' + esc(s.title) + '</div><div class="slide-sub">' + esc(s.restaurant) + '</div></div>' +
          '<div class="slide-price">' + esc(s.price) + '</div>' +
        '</div>' +
      '</div>';
    }).join("");

    const dotsHtml = HERO_SLIDES.map((_, idx) => {
      const activeClass = idx === state.heroSlideIndex ? " active" : "";
      return '<button type="button" class="hero-dot-btn' + activeClass + '" data-action="goto-slide" data-slide="' + idx + '" aria-label="Go to slide ' + (idx + 1) + '"></button>';
    }).join("");

    return '<section class="hero"><div class="hero-copy">'+
      '<div class="eyebrow">GOOD FOOD. SMARTER DECISIONS.</div>'+
      '<h1>Your next meal,<br><span>found in minutes.</span></h1>'+
      '<p>One request. A team of specialist agents. Clear prices, dietary checks, and delivery estimates — before you confirm.</p>'+
      '<div class="hero-chips"><span class="hero-chip">'+num(state.data?.restaurants?.length||20)+' restaurants</span><span class="hero-chip">'+num(state.data?.menuItems?.length||115)+' menu items</span><span class="hero-chip amber">Budget-safe recommendations</span></div>'+
      '</div><div class="hero-visual">' +
        '<div class="hero-slider-wrap">' + slidesHtml + '</div>' +
        '<div class="hero-slider-nav">' + dotsHtml +
          '<button type="button" class="hero-arrow-btn" data-action="prev-slide" aria-label="Previous slide">‹</button>' +
          '<button type="button" class="hero-arrow-btn" data-action="next-slide" aria-label="Next slide">›</button>' +
        '</div>' +
      '</div></section>';
  }

  function discoverView(){
    const saved = state.preferences;
    const prefStatus = saved ? 'Saved memory is available for this browser.' : 'Save preferences to demonstrate long-term memory.';
    return hero() +
      agentVisualizer(state.activeAgentStep) +
      '<section class="section-head"><div><div class="section-kicker">START WITH A REQUEST</div><h2>Tell your food agent what you need</h2><p>The agent extracts hard constraints, queries the simulated restaurant catalogue, then ranks only options that meet the rules.</p></div><div class="subtle-count">' + prefStatus + '</div></section>' +
      '<div class="discover-grid"><section class="panel request-panel">' +
        '<h3 class="panel-title">Your order brief</h3><p class="panel-subtitle">The primary jury scenario is already filled in. Edit it to test the agents with another request.</p>' +
        '<form id="discover-form">' +
          '<div class="field-wrap"><label class="field-label" for="request-text">Natural-language request</label><textarea class="field-textarea" id="request-text" rows="2" maxlength="500">' + esc(state.requestText) + '</textarea>' +
          '<div class="query-suggestions"><button type="button" class="suggestion" data-action="quick-query" data-query="Order a vegetarian pizza under ₹500 delivered within 30 minutes.">Jury scenario</button><button type="button" class="suggestion" data-action="quick-query" data-query="Find a mild vegetarian pizza under ₹350 within 25 minutes.">Mild & budget-friendly</button><button type="button" class="suggestion" data-action="quick-query" data-query="Find a vegetarian paneer pizza under ₹450 in 30 minutes.">Paneer pizza</button><button type="button" class="suggestion" data-action="quick-query" data-query="Order a non-vegetarian pizza under ₹500 delivered within 30 minutes.">Non-veg pizza</button></div></div>' +
          '<div class="field-row">' +
            '<div class="field-wrap"><label class="field-label" for="budget">Max total budget (₹)</label><input class="field" id="budget" type="number" min="1" max="100000" step="1" value="' + esc(state.budgetRupees) + '" required></div>' +
            '<div class="field-wrap"><label class="field-label" for="deadline">Delivery deadline (minutes)</label><input class="field" id="deadline" type="number" min="1" max="180" value="' + esc(state.deadlineMinutes) + '" required></div>' +
          '</div>' +
          '<div class="field-row">' +
            '<div class="field-wrap"><label class="field-label" for="cuisine">Preferred cuisine (optional)</label><select class="field-select" id="cuisine"><option value="">Any cuisine</option><option ' + (state.cuisine === "Italian" ? "selected" : "") + ' value="Italian">Italian</option><option ' + (state.cuisine === "Pizza" ? "selected" : "") + ' value="Pizza">Pizza</option><option ' + (state.cuisine === "Fusion" ? "selected" : "") + ' value="Fusion">Fusion</option></select></div>' +
            '<div class="field-wrap"><label class="field-label" for="spice">Spice level</label><select class="field-select" id="spice"><option value="mild" ' + (state.spiceLevel === "mild" ? "selected" : "") + '>Mild</option><option value="medium" ' + (state.spiceLevel === "medium" ? "selected" : "") + '>Medium</option><option value="hot" ' + (state.spiceLevel === "hot" ? "selected" : "") + '>Hot</option></select></div>' +
          '</div>' +
          '<div class="toggle-row"><span class="toggle-copy"><strong>Vegetarian only</strong><small>A clear non-vegetarian prompt automatically switches this search to non-vegetarian only.</small></span><label class="switch"><input id="vegetarian" type="checkbox" ' + (state.vegetarian ? "checked" : "") + '><span class="switch-ui"></span></label></div>' +
          '<div class="toggle-row"><span class="toggle-copy"><strong>Use saved preferences</strong><small>Use memory only to fill gaps; the current request always takes priority.</small></span><label class="switch"><input id="use-memory" type="checkbox" ' + (state.useSavedMemory ? "checked" : "") + '><span class="switch-ui"></span></label></div>' +
          '<div class="toggle-row"><span class="toggle-copy"><strong>Remember these preferences</strong><small>Only save to long-term memory when you opt in.</small></span><label class="switch"><input id="remember-prefs" type="checkbox" ' + (state.rememberPrefs ? "checked" : "") + '><span class="switch-ui"></span></label></div>' +
          '<button class="btn btn-primary btn-wide" id="find-food" type="submit" ' + (state.loading ? 'disabled' : '') + '>' + (state.loading ? '<span class="loader" style="height:16px;width:16px;border-width:2px"></span> Agents are working…' : 'Find best matches <span aria-hidden="true">↗</span>') + '</button>' +
          '<div class="form-note"><span>ⓘ</span><span>Simulated prices and estimates. Total includes delivery and assumed 5% food tax. No real order is placed until you review and confirm.</span></div>' +
        '</form></section>' +
        '<aside class="panel score-guide"><div class="section-kicker">HOW WE RANK</div><div class="big-number">100<span> pts</span></div><p class="panel-subtitle" style="margin:3px 0 0">Explainable score after every hard constraint passes.</p>' +
          '<div class="score-metrics"><div><div class="metric-line"><span>Price headroom</span><strong>40%</strong></div><div class="mini-bar"><span style="width:40%"></span></div></div><div><div class="metric-line"><span>Delivery time</span><strong>35%</strong></div><div class="mini-bar"><span style="width:35%"></span></div></div><div><div class="metric-line"><span>Restaurant rating</span><strong>25%</strong></div><div class="mini-bar"><span style="width:25%"></span></div></div></div>' +
          '<div class="callout"><strong>Hard rules come first.</strong><br>Items that violate the selected dietary requirement, totals above budget, closed restaurants, and late delivery estimates cannot rank as eligible.</div>' +
          '<div class="callout warning"><strong>Original problem statement</strong><br>“Order a vegetarian pizza under ₹500 delivered within 30 minutes.”</div><p class="footnote" style="margin-bottom:0;margin-top:12px">Formula: price score × 0.40 + delivery score × 0.35 + rating score × 0.25. Tax assumption: 5% on food subtotal; delivery fee is separate.</p></aside></div>' +
      (state.recommendation ? renderResults() : '');
  }

  function renderResults(){
    const rec = state.recommendation;
    const count = rec.ranked?.length || 0;
    const cards = (rec.candidates || []).map(candidateCard).join("");
    const noResults = count === 0 ? '<div class="panel empty-panel"><div class="empty-icon">🍕</div><h3>No option meets every constraint</h3><p>The agents kept your constraints intact. Try a larger budget or a longer deadline yourself — they will not silently relax your limits.</p><div class="query-suggestions" style="justify-content:center"><button class="suggestion" data-action="set-budget" data-budget="550">Try ₹550</button><button class="suggestion" data-action="set-deadline" data-deadline="35">Try 35 minutes</button></div></div>' : '';
    return '<section class="results-section" id="recommendations"><div class="section-head"><div><div class="section-kicker">RECOMMENDATIONS</div><h2>Explore menu options</h2><p>Sorted by transparent score. Eligible means all current dietary, availability, total-price, and delivery constraints passed.</p></div><span class="subtle-count">' + count + ' eligible · ' + (rec.candidates || []).length + ' checked</span></div>' +
      '<div class="constraint-list" style="grid-template-columns:repeat(4,minmax(0,1fr));margin:0 0 16px"><div class="callout"><strong>' + (rec.requirements.nonVegetarianOnly ? 'Non-vegetarian only' : rec.requirements.vegetarian ? 'Vegetarian only' : 'All dietary labels') + '</strong><br>Metadata validated</div><div class="callout"><strong>' + money(rec.requirements.budgetPaise) + '</strong><br>Maximum total budget</div><div class="callout"><strong>' + rec.requirements.deadlineMinutes + ' min</strong><br>Delivery limit</div><div class="callout"><strong>' + count + ' matched</strong><br>Hard constraints passed</div></div>' +
      (count ? '<div class="result-grid">' + cards + '</div>' : noResults) +
      (rec.rejected?.length ? '<details class="panel tool-trace"><summary>Dietary filter · ' + rec.rejected.length + ' items rejected before ranking</summary><div class="trace-list">' + rec.rejected.map(x => '<div class="trace-row"><strong>' + esc(x.itemName) + '</strong><span>' + esc(x.restaurantName) + '</span><small>' + esc(x.reason) + '</small></div>').join("") + '</div></details>' : '') +
      '<div class="panel tool-trace"><div class="section-kicker">EXECUTED TOOLS</div><h3 class="panel-title" style="margin-top:8px">Tool-call trace</h3><p class="panel-subtitle">These are real function calls against the local SQLite catalogue and persistent backend, not decorative pipeline labels.</p><div class="trace-list">' + (rec.toolCalls || []).map(t => '<div class="trace-row"><strong>' + esc(t.name) + '</strong><span>' + t.calls + ' call(s)</span><small>' + t.resultCount + ' result record(s)</small></div>').join("") + '</div><div class="trace-memory"><strong>Memory:</strong> ' + (rec.memory?.retrieved ? 'retrieved saved preferences' : 'not applied for this run') + '; fields used: ' + esc((rec.memory?.usedFields || []).join(", ") || "none") + '. Current explicit request values always win.</div><p class="footnote">After confirmation the order phase uses create_order; tracking calls get_order_status; each status change uses send_notification.</p></div>' +
      '<p class="footnote" style="margin-top:14px">Real dish photography is provided for presentation. Restaurants, menu prices, ratings, stock and delivery estimates are a simulated catalogue and are not live availability.</p></section>';
  }

  function candidateCard(c){
    const eligible = Boolean(c.eligible);
    return '<article class="panel menu-card"><div class="menu-photo-wrap"><img class="menu-photo" loading="lazy" src="' + esc(c.imageUrl) + '" alt="' + esc(c.name) + '" data-fallback="' + esc(c.restaurantImage) + '" onerror="FoodieAgent.imageFallback(this)"><span class="veg-tag">' + (c.isVegetarian ? '<span class="veg-dot"></span>VEGETARIAN' : 'NON-VEGETARIAN') + '</span><span class="eligibility ' + (eligible ? '' : 'rejected') + '">' + (eligible ? '✓ ELIGIBLE' : 'NOT ELIGIBLE') + '</span></div><div class="menu-content"><div class="restaurant-line"><span>' + esc(c.restaurantName) + '</span><span class="rating-chip">★ ' + Number(c.restaurantRating).toFixed(1) + '</span></div><h3>' + esc(c.name) + '</h3><p>' + esc(c.description) + '</p><div class="menu-specs"><span class="info-chip">◷ ' + c.estimatedMinutes + ' min</span><span class="info-chip">' + c.prepMinutes + ' min prep</span><span class="score-badge">✳ ' + c.score + '/100</span></div><div class="price-row"><div><div class="price">' + money(c.totalPaise) + '</div><div class="total-note">Food ' + money(c.pricePaise) + ' · delivery ' + money(c.deliveryFeePaise) + ' · tax ' + money(c.taxPaise) + '</div></div><span class="subtle-count">#' + (c.rank || '—') + '</span></div>' + (eligible ? '<div class="constraint-list"><div class="constraint-row"><span class="check">✓</span><span>Vegetarian, budget, and timing rules passed.</span></div><div class="constraint-row"><span class="check">✓</span><span>Score: price ' + c.scoreFactors.price + ' · delivery ' + c.scoreFactors.delivery + ' · rating ' + c.scoreFactors.rating + '</span></div></div><div class="card-actions"><button class="btn btn-orange" data-action="choose-item" data-item="' + esc(c.id) + '">Review order <span>→</span></button><button class="btn btn-secondary" data-action="view-restaurant" data-restaurant="' + esc(c.restaurantId) + '">Menu details</button></div>' : '<div class="constraint-list">' + c.reasons.map(r => '<div class="constraint-row"><span class="cross">×</span><span>' + esc(r) + '</span></div>').join("") + '</div><div class="card-actions"><button class="btn btn-secondary" data-action="view-restaurant" data-restaurant="' + esc(c.restaurantId) + '">View restaurant menu</button></div>') + '</div></article>';
  }

  // ==========================================================================
  // Conversational AI Chat Messages Renderer
  // ==========================================================================
  function renderChatMessagesList(){
    return state.chatMessages.map(m => {
      const isUser = m.role === "user";
      const formattedText = renderMarkdown(m.text);

      let toolPill = "";
      if (m.toolCalls && m.toolCalls.length > 0) {
        toolPill = '<div class="chat-tools-pill">⚙️ Tools Executed: ' + m.toolCalls.map(t => esc(t.name)).join(", ") + '</div>';
      }

      // 1. In-Chat Checkout Ticket
      let checkoutTicketHtml = "";
      if (m.checkoutTicket) {
        const t = m.checkoutTicket;
        checkoutTicketHtml = `
          <div class="chat-checkout-ticket">
            <div class="chat-ticket-head">
              <strong>STAGE 1 · CONFIRMATION GATE</strong>
              <span class="chat-ticket-badge">Review Before Order</span>
            </div>
            <div class="chat-ticket-body">
              <div class="chat-ticket-dish">
                <img src="${esc(t.imageUrl)}" onerror="FoodieAgent.imageFallback(this)" alt="${esc(t.name)}">
                <div>
                  <h4>${esc(t.name)}</h4>
                  <p>${esc(t.restaurantName)} · ★ ${Number(t.restaurantRating).toFixed(1)} · ${t.estimatedMinutes}m ETA</p>
                </div>
              </div>
              <div class="chat-ticket-bill">
                <div class="chat-ticket-line"><span>Food Price (${t.quantity}×)</span><strong>₹${esc(t.subtotalRupees || t.unitPriceRupees)}</strong></div>
                <div class="chat-ticket-line"><span>Delivery Fee</span><strong>₹${esc(t.deliveryFeeRupees)}</strong></div>
                <div class="chat-ticket-line"><span>Food Tax (5%)</span><strong>₹${esc(t.taxRupees)}</strong></div>
                <div class="chat-ticket-line total"><span>Total Payable</span><strong>₹${esc(t.totalRupees)}</strong></div>
              </div>
              <button type="button" class="chat-ticket-btn" data-action="chat-confirm-order" data-ticket='${JSON.stringify(t).replace(/'/g, "&apos;")}'>Confirm & Place Simulated Order →</button>
            </div>
          </div>
        `;
      }

      // 2. In-Chat Order Status Card
      let orderTrackingHtml = "";
      if (m.orderTrackingData && m.orderTrackingData.length > 0) {
        orderTrackingHtml = m.orderTrackingData.map(o => `
          <div class="chat-order-card">
            <div class="chat-order-header">
              <strong>Order #${esc(o.id)}</strong>
              <span class="order-status ${o.status === 'CANCELLED' ? 'cancelled' : ''}">${esc(statusLabel[o.status] || o.status)}</span>
            </div>
            <div class="chat-order-body">
              <div><strong>${esc(o.itemName)}</strong> at ${esc(o.restaurantName)}</div>
              <div>Total: <strong>₹${esc(o.totalRupees || money(o.total_paise))}</strong> · Estimated Delivery: <strong>${o.estimatedMinutes} mins</strong></div>
              ${orderTimeline(o.status)}
              <div style="margin-top:6px;display:flex;gap:8px">
                ${o.status !== 'DELIVERED' && o.status !== 'CANCELLED' ? `<button class="btn btn-secondary btn-small" data-action="auto-simulate" data-order="${esc(o.id)}">▶ Auto-Simulate (30s)</button>` : ''}
                <button class="btn btn-secondary btn-small" data-action="tab" data-tab="orders">View in Orders Tab →</button>
              </div>
            </div>
          </div>
        `).join("");
      }

      // 3. In-Chat Recommended Dish Cards
      let cardsHtml = "";
      if (m.cards && m.cards.length > 0 && !m.checkoutTicket) {
        cardsHtml = '<div class="chat-cards-carousel">' + m.cards.map(c => `
          <div class="chat-mini-card">
            <img src="${esc(c.imageUrl)}" onerror="FoodieAgent.imageFallback(this)" alt="${esc(c.name)}">
            <div class="chat-mini-card-body">
              <div class="chat-mini-card-title">${esc(c.name)}</div>
              <div class="chat-mini-card-rest">${esc(c.restaurantName)} · ★ ${Number(c.restaurantRating).toFixed(1)}</div>
              <div class="chat-mini-card-price">₹${esc(c.totalRupees || c.priceRupees)} <small style="font-weight:normal;color:#666">(${c.estimatedMinutes || c.estimatedDeliveryMinutes}m)</small></div>
              <button class="btn btn-orange btn-small" style="margin-top:6px" data-action="choose-item" data-item="${esc(c.id)}">Review Order →</button>
            </div>
          </div>
        `).join("") + '</div>';
      }

      // 4. Smart Follow-Up Contextual Chips
      let followupChips = "";
      if (!isUser && !m.checkoutTicket && !m.orderTrackingData) {
        followupChips = `
          <div class="chat-followup-chips">
            <button class="chat-followup-chip" data-action="send-chat-chip" data-query="Order this top recommendation for me">🍕 Order Top Match</button>
            <button class="chat-followup-chip" data-action="send-chat-chip" data-query="Suggest a side or drink combo">🥤 Suggest a Combo</button>
            <button class="chat-followup-chip" data-action="send-chat-chip" data-query="Compare Farmhouse Veg Pizza and Classic Margherita">📊 Compare Pizzas</button>
            <button class="chat-followup-chip" data-action="send-chat-chip" data-query="Where is my order?">🧾 Where is my order?</button>
          </div>
        `;
      }

      return '<div class="chat-msg ' + (isUser ? 'user' : 'model') + '">' +
        '<div class="chat-bubble">' + formattedText + checkoutTicketHtml + orderTrackingHtml + '</div>' +
        toolPill + cardsHtml + followupChips +
        '</div>';
    }).join("");
  }

  // Conversational AI Chat View (Tab View)
  function chatView(){
    const isLive = Boolean(state.geminiApiKey || state.llmStatus?.geminiConfigured);
    const msgs = renderChatMessagesList();

    return '<div class="view-header"><div><div class="section-kicker">CONVERSATIONAL AI AGENT</div><h1>Chat with FoodieAgent</h1><p>Full end-to-end food ordering concierge with Dual-Tier Memory (LTM + STM) and SQLite WAL crash durability.</p></div><button class="topbar-badge-btn" data-action="open-ai-settings"><span class="ai-dot-pulse"></span> ' + (isLive ? "Gemini Live Active" : "Offline Deterministic Mode") + '</button></div>' +
      '<div class="chat-container">' +
        '<section class="chat-window">' +
          '<div class="chat-header">' +
            '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
              '<strong>🤖 FoodieAgent Concierge</strong>' +
              '<div class="chat-model-selector-wrap">' +
                '<select class="chat-model-select" id="chat-model-select" title="Switch AI Model">' +
                  '<option value="gemini-2.5-flash" ' + (state.selectedModel === 'gemini-2.5-flash' ? 'selected' : '') + '>⚡ Gemini 2.5 Flash (Recommended)</option>' +
                  '<option value="gemini-2.0-flash" ' + (state.selectedModel === 'gemini-2.0-flash' ? 'selected' : '') + '>⚡ Gemini 2.0 Flash (Fast)</option>' +
                  '<option value="gemini-1.5-flash" ' + (state.selectedModel === 'gemini-1.5-flash' ? 'selected' : '') + '>⚡ Gemini 1.5 Flash</option>' +
                  '<option value="gemini-1.5-pro" ' + (state.selectedModel === 'gemini-1.5-pro' ? 'selected' : '') + '>🧠 Gemini 1.5 Pro (Deep)</option>' +
                  '<option value="offline-rule-engine" ' + (state.selectedModel === 'offline-rule-engine' ? 'selected' : '') + '>🛡️ Offline Rule Engine</option>' +
                '</select>' +
                '<span class="memory-pill-badge" data-action="tab" data-tab="memory" title="Inspect Long-Term & Short-Term Memory">🧠 LSTM Memory Active</span>' +
              '</div>' +
            '</div>' +
            '<button class="btn btn-secondary btn-small" data-action="clear-chat">Clear Chat</button>' +
          '</div>' +
          '<div class="chat-chips-tray">' +
            '<button class="chat-chip" data-action="send-chat-chip" data-query="Order a vegetarian pizza under ₹500 delivered within 30 minutes.">🍕 Pizza &lt; ₹500</button>' +
            '<button class="chat-chip" data-action="send-chat-chip" data-query="Order the first one">👉 Order First One (STM)</button>' +
            '<button class="chat-chip" data-action="send-chat-chip" data-query="Make it pure veg and under 350">🔄 Shift Veg &lt; 350 (STM)</button>' +
            '<button class="chat-chip" data-action="send-chat-chip" data-query="Compare Farmhouse Veg Pizza and Classic Margherita">📊 Compare Pizzas</button>' +
            '<button class="chat-chip" data-action="send-chat-chip" data-query="What do you remember about me?">🧠 LTM Recall</button>' +
            '<button class="chat-chip" data-action="send-chat-chip" data-query="Where is my order?">🧾 Track Orders</button>' +
          '</div>' +
          '<div class="chat-messages" id="chat-messages-container">' + msgs +
          (state.chatLoading ? '<div class="chat-msg model"><div class="chat-bubble"><div class="typing-dots"><span></span><span></span><span></span></div> <span style="font-size:12px;color:#5c7062;margin-left:6px">FoodieAgent is evaluating tools and prices…</span></div></div>' : '') +
          '</div>' +
          '<form class="chat-input-bar" id="chat-form">' +
            '<input class="chat-input" id="chat-input-text" placeholder="Ask for food, compare dishes, track orders, or set preferences…" value="' + esc(state.chatInput) + '" ' + (state.chatLoading ? 'disabled' : '') + '>' +
            '<button class="btn btn-primary" type="submit" ' + (state.chatLoading ? 'disabled' : '') + '>Send ↗</button>' +
          '</form>' +
        '</section>' +
        '<aside class="panel">' +
          '<div class="section-kicker">END-TO-END CAPABILITIES</div><h3 style="font:800 16px Manrope,sans-serif;margin:8px 0">10 Specialist Tools</h3>' +
          '<p class="panel-subtitle">The chatbot autonomously invokes these concrete backend tools:</p>' +
          '<div class="constraint-list">' +
            '<div class="constraint-row"><span class="check">1</span><span><strong>find_best_food_options:</strong> 40/35/25 scoring + hard rules</span></div>' +
            '<div class="constraint-row"><span class="check">2</span><span><strong>compare_dishes:</strong> Side-by-side pricing & ETA verdict</span></div>' +
            '<div class="constraint-row"><span class="check">3</span><span><strong>get_dish_details:</strong> Exact subtotal, delivery & 5% tax</span></div>' +
            '<div class="constraint-row"><span class="check">4</span><span><strong>suggest_combos:</strong> Explores remaining budget headroom</span></div>' +
            '<div class="constraint-row"><span class="check">5</span><span><strong>track_user_orders:</strong> Live order progress & history</span></div>' +
            '<div class="constraint-row"><span class="check">6</span><span><strong>prepare_order_checkout:</strong> In-chat 1-click tickets</span></div>' +
            '<div class="constraint-row"><span class="check">7</span><span><strong>save_user_preferences:</strong> Updates SQLite memory</span></div>' +
          '</div>' +
          '<div class="callout" style="margin-top:16px"><strong>Safety Protocol:</strong> Financial operations are simulated. Every order requires explicit confirmation before any record is created.</div>' +
        '</aside>' +
      '</div>';
  }

  // ==========================================================================
  // Real Floating Chatbot Widget (Always-Accessible Intercom-Style Launcher)
  // ==========================================================================
  function renderChatbotWidget(){
    const root = $("#chatbot-root");
    if (!root) return;

    const msgs = renderChatMessagesList();
    const isLive = Boolean(state.geminiApiKey || state.llmStatus?.geminiConfigured);
    const openClass = state.isChatbotOpen ? " open" : "";

    root.innerHTML = `
      <div class="chatbot-widget-container${openClass}">
        <!-- Floating Launcher Button with Live Pulse -->
        <button type="button" class="chatbot-launcher-btn" data-action="toggle-chatbot" aria-label="Toggle FoodieAgent AI Chatbot">
          <span class="chatbot-launcher-icon">💬</span>
          <span class="chatbot-launcher-close">✕</span>
          ${state.unreadBotCount > 0 ? `<span class="chatbot-badge">${state.unreadBotCount}</span>` : ''}
        </button>

        <!-- Floating Chatbot Window -->
        <section class="chatbot-panel" role="region" aria-label="FoodieAgent Concierge Window">
          <!-- Chatbot Header -->
          <div class="chatbot-header">
            <div class="chatbot-header-left">
              <div class="chatbot-avatar">
                🍕
                <span class="online-status"></span>
              </div>
              <div class="chatbot-header-info">
                <strong>FoodieAgent AI</strong>
                <small>${isLive ? "🟢 Gemini Live Active" : "🛡️ Offline Rule Engine"} · Memory Active</small>
              </div>
            </div>
            <div class="chatbot-header-actions">
              <button type="button" class="chatbot-header-btn" data-action="clear-chat" title="Clear conversation">🗑️</button>
              <button type="button" class="chatbot-header-btn" data-action="toggle-chatbot" title="Minimize chat">✕</button>
            </div>
          </div>

          <!-- Quick Action Chips -->
          <div class="chatbot-chips-strip">
            <button type="button" class="chatbot-quick-chip" data-action="send-chat-chip" data-query="Order a vegetarian pizza under ₹500 delivered within 30 minutes.">🍕 Pizza &lt; ₹500</button>
            <button type="button" class="chatbot-quick-chip" data-action="send-chat-chip" data-query="Order the first one">👉 Order First</button>
            <button type="button" class="chatbot-quick-chip" data-action="send-chat-chip" data-query="Make it pure veg and under 350">🔄 Veg &lt; 350</button>
            <button type="button" class="chatbot-quick-chip" data-action="send-chat-chip" data-query="Compare Farmhouse Veg Pizza and Classic Margherita">📊 Compare</button>
            <button type="button" class="chatbot-quick-chip" data-action="send-chat-chip" data-query="Where is my order?">🧾 Track Order</button>
          </div>

          <!-- Chat Messages Body -->
          <div class="chatbot-messages-body" id="chatbot-messages-container">
            ${msgs}
            ${state.chatLoading ? `
              <div class="chat-msg model">
                <div class="chat-bubble">
                  <div class="typing-dots"><span></span><span></span><span></span></div>
                  <span style="font-size:11px;color:#617567;margin-left:6px">FoodieAgent is evaluating catalogue & prices…</span>
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Chat Input Bar -->
          <form class="chatbot-input-bar" id="chatbot-float-form">
            <input type="text" class="chatbot-input-field" id="chatbot-float-input" placeholder="Ask for food, budget, dietary shifts…" autocomplete="off" ${state.chatLoading ? 'disabled' : ''}>
            <button type="submit" class="chatbot-send-btn" ${state.chatLoading ? 'disabled' : ''} aria-label="Send message">↗</button>
          </form>
        </section>
      </div>
    `;

    bindChatbotForm();
    if (state.isChatbotOpen) {
      scrollChatToBottom();
      setTimeout(() => $("#chatbot-float-input")?.focus(), 150);
    }
  }

  function bindChatbotForm(){
    const floatForm = $("#chatbot-float-form");
    if (floatForm) {
      floatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = $("#chatbot-float-input");
        const val = input?.value.trim();
        if (val) {
          state.chatInput = val;
          if (input) input.value = "";
          onSendChat();
        }
      });
    }
  }

  function viewHeader(kicker, title, description, action=""){
    return '<div class="view-header"><div><div class="section-kicker">' + kicker + '</div><h1>' + title + '</h1><p>' + description + '</p></div>' + action + '</div>';
  }

  function memoryView(){
    const p = state.preferences || {};
    const mem = state.memoryData?.longTermMemory || {};
    const facts = mem.memoryFacts || [];
    const habits = mem.orderHabits || {};
    const stm = state.memoryData?.shortTermMemory || {};
    const working = stm.workingContext || {};
    const backups = state.backupData?.backups || [];

    const restOpts = (state.data?.restaurants || []).map(r => '<option value="' + esc(r.id) + '" ' + (p.preferred_restaurant_id === r.id ? 'selected' : '') + '>' + esc(r.name) + '</option>').join("");

    return viewHeader("DUAL-TIER MEMORY (LSTM) & CRASH DURABILITY", "Long Short Term Memory & Backup", "Dual-tier memory architecture (Episodic LTM + Session STM) combined with SQLite Write-Ahead Logging (WAL) for 100% crash and power-loss durability.") +
      '<div class="memory-tier-grid">' +
        // Card 1: Long-Term Memory (LTM)
        '<section class="memory-tier-card">' +
          '<div class="memory-tier-header"><strong>🧠 Long-Term Memory (LTM)</strong><span class="subtle-count">Episodic & Preferences</span></div>' +
          '<form id="memory-form">' +
            '<div class="field-row"><div class="field-wrap"><label class="field-label" for="memory-veg">Dietary preference</label><select class="field-select" id="memory-veg"><option value="" ' + (p.vegetarian == null ? 'selected' : '') + '>Not saved</option><option value="true" ' + (p.vegetarian === true ? 'selected' : '') + '>Vegetarian</option><option value="false" ' + (p.vegetarian === false ? 'selected' : '') + '>No vegetarian-only constraint</option></select></div>' +
            '<div class="field-wrap"><label class="field-label" for="memory-cuisine">Preferred cuisine</label><input class="field" id="memory-cuisine" maxlength="80" placeholder="e.g. Italian" value="' + esc(p.cuisine || '') + '"></div></div>' +
            '<div class="field-row"><div class="field-wrap"><label class="field-label" for="memory-budget">Usual budget (₹)</label><input class="field" id="memory-budget" type="number" min="1" max="100000" value="' + (p.budget_paise != null ? esc(Number(p.budget_paise) / 100) : '') + '" placeholder="e.g. 500"></div>' +
            '<div class="field-wrap"><label class="field-label" for="memory-deadline">Delivery limit (mins)</label><input class="field" id="memory-deadline" type="number" min="1" max="180" value="' + (p.delivery_limit_minutes != null ? esc(p.delivery_limit_minutes) : '') + '" placeholder="e.g. 30"></div></div>' +
            '<div class="field-row"><div class="field-wrap"><label class="field-label" for="memory-restaurant">Preferred restaurant</label><select class="field-select" id="memory-restaurant"><option value="">No preference</option>' + restOpts + '</select></div>' +
            '<div class="field-wrap"><label class="field-label" for="memory-spice">Spice level</label><select class="field-select" id="memory-spice"><option value="">Not saved</option><option value="mild" ' + (p.spice_level === "mild" ? 'selected' : '') + '>Mild</option><option value="medium" ' + (p.spice_level === "medium" ? 'selected' : '') + '>Medium</option><option value="hot" ' + (p.spice_level === "hot" ? 'selected' : '') + '>Hot</option></select></div></div>' +
            '<div class="modal-actions"><button type="submit" class="btn btn-primary">Save preferences</button><button type="button" class="btn btn-secondary" data-action="delete-preferences">Reset</button></div>' +
          '</form>' +

          '<div style="margin-top:20px;border-top:1px solid #ebefe5;padding-top:14px">' +
            '<div class="section-kicker" style="margin-bottom:6px">DISCOVERED MEMORY FACTS</div>' +
            (facts.length ? '<div class="memory-facts-container">' + facts.map(f => `<span class="memory-fact-chip"><strong>${esc(f.category.toUpperCase())}:</strong> ${esc(f.value)} <button type="button" class="memory-fact-delete" data-action="delete-fact" data-fact="${esc(f.id)}" title="Delete fact">×</button></span>`).join("") + '</div>' : '<p style="color:#788579;font-size:12px;margin:6px 0">No discovered facts yet. Chat with the agent (e.g. "I am allergic to mushrooms", "prefer extra cheese") to auto-populate facts!</p>') +
            '<form id="add-fact-form" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
              '<select class="field-select" id="fact-category" style="width:110px"><option value="diet">Diet</option><option value="allergy">Allergy</option><option value="budget">Budget</option><option value="cuisine">Cuisine</option><option value="spice">Spice</option><option value="favorite_dish">Favorite</option></select>' +
              '<input class="field" id="fact-key" placeholder="Key (e.g. allergy_nut)" style="flex:1;min-width:110px">' +
              '<input class="field" id="fact-value" placeholder="Value (e.g. Nut Allergy)" style="flex:1.4;min-width:130px">' +
              '<button type="submit" class="btn btn-secondary btn-small">+ Add Fact</button>' +
            '</form>' +
          '</div>' +
        '</section>' +

        // Card 2: Short-Term Working Memory (STM) & Habit Insights
        '<section class="memory-tier-card">' +
          '<div class="memory-tier-header"><strong>⚡ Short-Term Working Memory (STM)</strong><span class="subtle-count">Active Session</span></div>' +
          '<div style="background:#f7f9f4;border:1px solid #dce4d6;border-radius:12px;padding:12px;font-size:12px;color:#2b4233;margin-bottom:14px">' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Session ID:</span><code style="font-family:monospace;font-size:11px">' + esc(state.sessionId) + '</code></div>' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Active Focus:</span><strong>' + esc(working.activeCategory || "Default (pizza)") + '</strong></div>' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Working Budget:</span><strong>' + (working.activeBudgetRupees ? "₹" + esc(working.activeBudgetRupees) : "Default (₹500)") + '</strong></div>' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Dietary Filter:</span><strong>' + (working.activeDiet === true ? "Pure Veg" : working.activeDiet === false ? "Non-Veg" : "Not set") + '</strong></div>' +
            (working.lastMentionedDishes?.length ? '<div style="margin-top:6px;border-top:1px dashed #c9d8c4;padding-top:6px"><span>Recently Presented Dishes:</span><br>' + working.lastMentionedDishes.map((d, i) => `<span style="display:inline-block;background:#e5f0df;padding:2px 7px;border-radius:6px;margin:3px 3px 0 0;font-size:11px">#${i + 1} ${esc(d.name)}</span>`).join("") + '</div>' : '') +
            '<div style="margin-top:10px;text-align:right"><button type="button" class="btn btn-secondary btn-small" data-action="clear-stm">Reset Active STM Working Memory</button></div>' +
          '</div>' +

          '<div class="section-kicker" style="margin-bottom:6px">HISTORICAL ORDER HABITS (LTM)</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
            '<div style="background:#fffefb;border:1px solid #e1e7dc;border-radius:10px;padding:10px"><span>Total Orders Placed</span><h4 style="font:800 20px Manrope;color:var(--green);margin:4px 0 0">' + (habits.totalOrdersCount || 0) + '</h4></div>' +
            '<div style="background:#fffefb;border:1px solid #e1e7dc;border-radius:10px;padding:10px"><span>Average Spend</span><h4 style="font:800 20px Manrope;color:var(--orange);margin:4px 0 0">' + (habits.averageOrderSpendRupees ? "₹" + habits.averageOrderSpendRupees : "—") + '</h4></div>' +
          '</div>' +
          (habits.frequentDishes?.length ? '<div style="margin-top:10px;font-size:12px"><span>Most Ordered:</span> <strong>' + esc(habits.frequentDishes.join(", ")) + '</strong></div>' : '') +
        '</section>' +
      '</div>' +

      // Section 3: Power-Loss Durability & Database Backup
      '<section class="backup-section-panel">' +
        '<div class="backup-durability-banner">' +
          '<div>' +
            '<span class="backup-durability-badge">⚡ POWER-LOSS DURABLE (WAL MODE)</span>' +
            '<h3 style="font:800 17px Manrope;margin:6px 0 3px">Crash Protection & Hot Snapshots</h3>' +
            '<p style="font-size:12px;color:#355342;margin:0">Committed transactions are protected against sudden power outage by SQLite Write-Ahead Logging (WAL) and fsync. Automated periodic backups run every 15 minutes.</p>' +
          '</div>' +
          '<button type="button" class="btn btn-primary" data-action="create-backup">💾 Create Instant Hot Backup</button>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong style="font-size:13px">Available Database Snapshots (' + backups.length + ')</strong><span class="subtle-count">Snapshots stored in project root /backups</span></div>' +
        (backups.length ? '<div style="overflow-x:auto"><table class="backup-table"><thead><tr><th>Snapshot File</th><th>Created At</th><th>Size</th><th>Reason</th><th>SHA-256 Checksum</th><th>Action</th></tr></thead><tbody>' +
          backups.map(b => `<tr><td><strong>${esc(b.filename)}</strong></td><td>${new Date(b.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" })}</td><td>${(b.fileSizeBytes / 1024).toFixed(1)} KB</td><td><span style="background:#eef4ea;padding:2px 7px;border-radius:5px;font-size:11px">${esc(b.reason)}</span></td><td><span class="checksum-code">${esc(b.checksum?.slice(0, 16))}…</span></td><td><button type="button" class="btn btn-secondary btn-small" data-action="restore-backup" data-filename="${esc(b.filename)}">↺ Restore</button></td></tr>`).join("") +
          '</tbody></table></div>' : '<p style="color:#788579;font-size:12px">No snapshots yet. Click "Create Instant Hot Backup" above to test!</p>') +
      '</section>';
  }

  const statusOrder = ["CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];
  const statusLabel = { CONFIRMED: "Confirmed", PREPARING: "Preparing", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", CANCELLED: "Cancelled" };

  function orderTimeline(status){
    if (status === "CANCELLED") return '<div class="callout error">This demo order was cancelled.</div>';
    const idx = statusOrder.indexOf(status);
    return '<div class="timeline">' + statusOrder.map((s, i) => '<span class="timeline-step ' + (i <= idx ? 'complete' : '') + '"></span>').join("") + '</div><div class="timeline-labels">' + statusOrder.map(s => '<span>' + statusLabel[s] + '</span>').join("") + '</div>';
  }

  function orderCard(o){
    const active = o.status === "CONFIRMED" || o.status === "PREPARING";
    const next = o.status === "CONFIRMED" ? "PREPARING" : o.status === "PREPARING" ? "OUT_FOR_DELIVERY" : o.status === "OUT_FOR_DELIVERY" ? "DELIVERED" : null;
    const isSimulating = state.simulatingOrderId === o.id;

    return '<article class="panel order-card"><div class="order-card-head"><div><h3>' + esc(o.item_name) + ' <span style="font-weight:500;color:#6c7a70">× ' + o.quantity + '</span></h3><p>' + esc(o.restaurant_name) + ' · ' + esc(o.id) + '<br>Placed ' + new Date(o.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) + '</p></div><span class="order-status ' + (o.status === "CANCELLED" ? 'cancelled' : '') + '">' + esc(statusLabel[o.status] || o.status) + '</span></div>' +
      (isSimulating ? '<div class="auto-delivery-banner"><span class="sim-timer-pill">▶ SIMULATION ACTIVE</span><span>Auto-advancing order milestones in real time…</span></div>' : '') +
      '<div class="order-details"><span>Final total<strong>' + money(o.total_paise) + '</strong></span><span>Delivery estimate<strong>' + o.estimated_minutes + ' minutes</strong></span><span>Data source<strong>Simulated (SQLite)</strong></span></div>' + orderTimeline(o.status) +
      '<div class="card-actions">' +
      (next && !isSimulating ? '<button class="btn btn-primary" data-action="advance-order" data-order="' + esc(o.id) + '" data-status="' + next + '">Demo: move to ' + esc(statusLabel[next]) + ' →</button>' : '') +
      (o.status !== "DELIVERED" && o.status !== "CANCELLED" && !isSimulating ? '<button class="btn btn-secondary" data-action="auto-simulate" data-order="' + esc(o.id) + '">▶ Auto-Simulate Live Delivery</button>' : '') +
      (active ? '<button class="btn btn-secondary" data-action="cancel-order" data-order="' + esc(o.id) + '">Cancel demo order</button>' : '<button class="btn btn-secondary" data-action="open-notifications">View notifications</button>') + '</div></article>';
  }

  function ordersView(){
    const content = state.orders.length ? state.orders.map(orderCard).join("") : '<div class="panel empty-panel"><div class="empty-icon">🧾</div><h3>No demo orders yet</h3><p>Find an eligible menu item, review the bill, and explicitly confirm it. The order will appear here with a unique ID and persistent status.</p><button class="btn btn-primary" data-action="tab" data-tab="discover">Find a pizza</button></div>';
    return viewHeader("ORDER MONITORING AGENT", "Your orders", "Simulated order history and status updates are stored in the local SQLite database. Use manual step controls or live auto-simulation to advance through the lifecycle.", '<button class="btn btn-secondary" data-action="refresh">↻ Refresh</button>') +
      content;
  }

  function activityView(){
    const runs = state.agentRuns || [];
    return viewHeader("AGENT EXECUTION HISTORY", "Agent execution history", "Each recommendation run stores the request, preferences, specialist outputs, rejected options, and ranked shortlist.") +
      agentVisualizer() +
      '<div class="content-section"><div class="section-head"><div><div class="section-kicker">AUDIT TRAIL</div><h2>Recent agent runs</h2><p>Database-backed results from the coordinator.</p></div></div>' +
      (runs.length ? runs.map(run => {
        const result = typeof run.result_json === "string" ? safeJson(run.result_json) : run.result_json || {};
        return '<article class="panel order-card"><div class="order-card-head"><div><h3>' + esc(run.request_text) + '</h3><p>Run #' + esc(run.id) + ' · ' + new Date(run.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) + '</p></div><span class="order-status">' + (result.ranked?.length || result.recommendedCards?.length || 0) + ' eligible</span></div>' +
          '<div class="order-details"><span>Budget<strong>' + (result.requirements?.budgetPaise ? money(result.requirements.budgetPaise) : '—') + '</strong></span><span>Deadline<strong>' + (result.requirements?.deadlineMinutes || '—') + ' min</strong></span><span>Model<strong>' + (result.model || 'Deterministic') + '</strong></span></div>' +
          (result.recommendation ? '<div class="callout">Top match: <strong>' + esc(result.recommendation.name) + '</strong> at ' + money(result.recommendation.totalPaise) + ' · ' + result.recommendation.estimatedMinutes + ' min · ' + result.recommendation.score + '/100.</div>' : '<div class="callout warning">No candidate met all hard constraints.</div>') + '</article>';
      }).join("") : '<div class="panel empty-panel"><div class="empty-icon">✳</div><h3>No execution log yet</h3><p>Run a request from Discover or Chat and the coordinator will store its complete audit record here.</p><button class="btn btn-primary" data-action="tab" data-tab="discover">Run the agents</button></div>') + '</div>';
  }

  function safeJson(s){ try { return JSON.parse(s); } catch { return {}; } }

  function notificationsView(){
    return viewHeader("PERSISTENT IN-APP ALERTS", "Notifications", "Every confirmed order and each valid status transition creates a database-backed notification.", '<button class="btn btn-secondary" data-action="mark-all-read">Mark all read</button>') +
      (state.notifications.length ? '<div class="notification-list">' + state.notifications.map(n => '<article class="notification-item ' + (!n.is_read ? 'unread' : '') + '"><span class="notification-icon">' + (n.title?.toLowerCase().includes("cancel") ? '×' : '✓') + '</span><div style="flex:1"><strong>' + esc(n.title) + '</strong><p>' + esc(n.message) + '</p><small>' + new Date(n.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) + '</small></div>' + (!n.is_read ? '<button class="btn btn-secondary btn-small" data-action="mark-read" data-notification="' + esc(n.id) + '">Mark read</button>' : '') + '</article>').join("") + '</div>' : '<div class="panel empty-panel"><div class="empty-icon">♧</div><h3>You’re all caught up</h3><p>Confirm a demo order or advance an order status to create an alert.</p></div>');
  }

  function render(){
    const app = $("#app");
    if (!app) return;
    $("#notification-count").textContent = state.notifications.filter(n => !n.is_read).length;
    updateAiStatusBadge();

    const view = state.tab === "discover" ? discoverView()
      : state.tab === "chat" ? chatView()
      : state.tab === "memory" ? memoryView()
      : state.tab === "orders" ? ordersView()
      : state.tab === "activity" ? activityView()
      : notificationsView();

    app.innerHTML = nav() + view +
      '<div class="content-section" style="display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap"><p class="footnote" style="margin:0">FoodieAgent v2.0 · Local SQLite Storage · Assumed 5% Food Tax. Simulated catalogue.</p><button class="btn btn-secondary btn-small" data-action="reset-demo">Reset this browser demo</button></div>';
    bindCurrentForms();
    renderChatbotWidget();
    if (state.tab === "discover") {
      startHeroSlider();
    } else if (state.heroSlideTimer) {
      clearInterval(state.heroSlideTimer);
      state.heroSlideTimer = null;
    }
  }

  function bindCurrentForms(){
    const discover = $("#discover-form");
    if (discover) discover.addEventListener("submit", onSearch);
    const memory = $("#memory-form");
    if (memory) memory.addEventListener("submit", onSaveMemory);
    const factForm = $("#add-fact-form");
    if (factForm) factForm.addEventListener("submit", onAddFactSubmit);
    const chat = $("#chat-form");
    if (chat) chat.addEventListener("submit", onSendChat);
  }

  async function onAddFactSubmit(event){
    event.preventDefault();
    const cat = $("#fact-category")?.value || "diet";
    const key = $("#fact-key")?.value.trim() || "";
    const val = $("#fact-value")?.value.trim() || "";
    if (!key || !val) { notify("Enter both key and value.", "error"); return; }
    try {
      await api("memory", {
        method: "POST",
        body: { profileKey: state.profileKey, action: "save_fact", category: cat, key, value: val }
      });
      notify("Memory fact saved to Long-Term Memory (LTM).");
      await refreshData(false);
      render();
    } catch (err) {
      notify("Failed to save fact: " + err.message, "error");
    }
  }

  function readDiscoverForm(){
    state.requestText = $("#request-text")?.value.trim() || "";
    state.budgetRupees = $("#budget")?.value ?? "";
    state.deadlineMinutes = $("#deadline")?.value ?? "";
    state.vegetarian = Boolean($("#vegetarian")?.checked);
    if (isNonVegetarianRequest(state.requestText)) state.vegetarian = false;
    state.cuisine = $("#cuisine")?.value || "";
    state.spiceLevel = $("#spice")?.value || "medium";
    state.useSavedMemory = Boolean($("#use-memory")?.checked);
    state.rememberPrefs = Boolean($("#remember-prefs")?.checked);
  }

  async function onSearch(event){
    event.preventDefault(); readDiscoverForm();
    if (!state.requestText) { notify("Enter a food request first.", "error"); return; }
    const budget = Number(state.budgetRupees), deadline = Number(state.deadlineMinutes);
    if (!Number.isFinite(budget) || budget < 1 || budget > 100000) { notify("Budget must be between ₹1 and ₹100,000.", "error"); return; }
    if (!Number.isInteger(deadline) || deadline < 1 || deadline > 180) { notify("Delivery deadline must be 1–180 minutes.", "error"); return; }

    state.loading = true; state.tab = "discover";
    state.activeAgentStep = "pref"; render();
    await new Promise(r => setTimeout(r, 200));
    state.activeAgentStep = "disco"; render();
    await new Promise(r => setTimeout(r, 200));
    state.activeAgentStep = "diet"; render();

    try {
      const result = await api("recommend", {
        method: "POST",
        body: {
          profileKey: state.profileKey,
          requestText: state.requestText,
          budgetRupees: budget,
          deadlineMinutes: deadline,
          vegetarian: state.vegetarian,
          nonVegetarianOnly: isNonVegetarianRequest(state.requestText),
          cuisine: state.cuisine,
          spiceLevel: state.spiceLevel,
          useSavedMemory: state.useSavedMemory
        }
      });
      state.activeAgentStep = "coord"; render();
      state.recommendation = result;
      state.agentRuns = [{ request_text: state.requestText, result_json: result, created_at: new Date().toISOString(), id: "latest" }, ...(state.agentRuns || [])].slice(0, 8);

      if (state.rememberPrefs) {
        await savePreferences({
          vegetarian: state.vegetarian, cuisine: state.cuisine, budgetRupees: budget, deliveryLimitMinutes: deadline,
          preferredRestaurantId: "", spiceLevel: state.spiceLevel
        }, false);
      }
      await refreshData(false);
      state.activeAgentStep = null;
      state.tab = "discover"; render();
      if (result.ranked.length) notify("The agents found " + result.ranked.length + " eligible option(s). Review before confirming.");
      else notify("No option met every constraint. The agents did not relax your limits.", "error");
      if (state.recommendation) setTimeout(() => $("#recommendations")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (e) {
      state.activeAgentStep = null;
      notify(e.message, "error"); render();
    } finally {
      state.loading = false;
      const button = $("#find-food");
      if (button) { button.disabled = false; button.innerHTML = 'Find best matches <span aria-hidden="true">↗</span>'; }
    }
  }

  async function onSendChat(event){
    if (event) event.preventDefault();
    const input = $("#chat-input-text");
    const text = input ? input.value.trim() : state.chatInput.trim();
    if (!text || state.chatLoading) return;

    state.chatMessages.push({ role: "user", text, toolCalls: [], cards: [] });
    state.chatInput = "";
    if (input) input.value = "";
    state.chatLoading = true;
    render();
    scrollChatToBottom();

    try {
      const res = await api("agent-chat", {
        method: "POST",
        body: {
          profileKey: state.profileKey,
          message: text,
          model: state.selectedModel,
          sessionId: state.sessionId,
          history: state.chatMessages.slice(-8).map(m => ({ role: m.role, text: m.text }))
        }
      });

      if (res.sessionId) {
        state.sessionId = res.sessionId;
        localStorage.setItem("foodieagent-session-id", res.sessionId);
      }

      state.chatMessages.push({
        role: "model",
        text: res.reply || "Done!",
        toolCalls: res.toolCalls || [],
        cards: res.recommendedCards || [],
        checkoutTicket: res.checkoutTicket || null,
        orderTrackingData: res.orderTrackingData || null
      });
      await refreshData(false);
    } catch (err) {
      state.chatMessages.push({
        role: "model",
        text: "⚠️ Sorry, I encountered an issue: " + err.message,
        toolCalls: [],
        cards: []
      });
    } finally {
      state.chatLoading = false;
      render();
      scrollChatToBottom();
    }
  }

  function scrollChatToBottom(){
    setTimeout(() => {
      const c = $("#chat-messages-container");
      if (c) c.scrollTop = c.scrollHeight;
      const floatC = $("#chatbot-messages-container");
      if (floatC) floatC.scrollTop = floatC.scrollHeight;
    }, 50);
  }

  async function savePreferences(value, showToast=true){
    const data = await api("preferences", { method: "PUT", body: { profileKey: state.profileKey, ...value } });
    state.preferences = data.preferences;
    if (state.data) state.data.preferences = data.preferences;
    if (showToast) notify("Preferences saved to long-term memory.");
    return data.preferences;
  }

  async function onSaveMemory(event){
    event.preventDefault();
    const veg = $("#memory-veg").value;
    const budget = $("#memory-budget").value;
    const deadline = $("#memory-deadline").value;
    const payload = {
      vegetarian: veg === "" ? null : veg === "true",
      cuisine: $("#memory-cuisine").value.trim(),
      budgetRupees: budget === "" ? null : Number(budget),
      deliveryLimitMinutes: deadline === "" ? null : Number(deadline),
      preferredRestaurantId: $("#memory-restaurant").value,
      spiceLevel: $("#memory-spice").value
    };
    try {
      await savePreferences(payload, false);
      await refreshData(false); state.tab = "memory"; render(); notify("Preferences saved. Use “Use saved preferences” to apply them to unspecified fields.");
    } catch (e) { notify(e.message, "error"); }
  }

  async function refreshData(showToast=true){
    const d = await api("bootstrap?profileKey=" + encodeURIComponent(state.profileKey));
    state.data = d; state.preferences = d.preferences; state.orders = d.orders || []; state.notifications = d.notifications || []; state.agentRuns = d.agentRuns || [];
    try {
      state.llmStatus = await api("llm-status");
      state.memoryData = await api("memory?profileKey=" + encodeURIComponent(state.profileKey) + "&sessionId=" + encodeURIComponent(state.sessionId));
      state.backupData = await api("backup");
    } catch {}
    if (showToast) notify("Workspace refreshed from the database.");
  }

  function orderTotals(){
    const c = state.selected; if (!c) return null;
    const qty = state.quantity;
    let subtotal = (c.pricePaise || Math.round(Number(c.priceRupees) * 100)) * qty;
    if (state.addonItem) {
      subtotal += Math.round(Number(state.addonItem.priceRupees || 0) * 100);
    }
    const delivery = c.deliveryFeePaise != null ? c.deliveryFeePaise : Math.round(Number(c.deliveryFeeRupees || 0) * 100);
    const tax = Math.round(subtotal * 0.05);
    return { subtotal, delivery, tax, total: subtotal + delivery + tax };
  }

  async function openOrderModal(itemId){
    let c = state.recommendation?.candidates?.find(x => x.id === itemId);
    if (!c) {
      for (const msg of state.chatMessages) {
        c = (msg.cards || []).find(x => x.id === itemId);
        if (c) break;
      }
    }
    if (!c && state.data?.menuItems) {
      const m = state.data.menuItems.find(x => x.id === itemId);
      const r = state.data.restaurants.find(x => x.id === m?.restaurant_id);
      if (m && r) {
        c = {
          id: m.id,
          name: m.name,
          description: m.description,
          restaurantId: r.id,
          restaurantName: r.name,
          restaurantRating: r.rating,
          pricePaise: m.price_paise,
          deliveryFeePaise: r.delivery_fee_paise,
          estimatedMinutes: r.estimated_minutes,
          imageUrl: m.image_url,
          isVegetarian: m.is_vegetarian,
          eligible: true
        };
      }
    }
    if (!c) { notify("Selected item not found.", "error"); return; }
    state.selected = c;
    state.addonItem = null;
    state.quantity = 1;
    state.orderChecked = false;
    state.idempotencyKey = "FAORD_" + uuid().replace(/-/g, "");
    state.modal = "review";

    try {
      const budgetRupees = state.recommendation?.requirements?.budgetPaise ? state.recommendation.requirements.budgetPaise / 100 : 500;
      const res = await api("agent-chat", {
        method: "POST",
        body: {
          profileKey: state.profileKey,
          message: "suggest combo for item " + c.id + " with budget " + budgetRupees
        }
      });
      state.modalCombos = res.comboData?.compatibleAddons || [];
    } catch {
      state.modalCombos = [];
    }

    renderModal();
  }

  function renderModal(){
    const root = $("#modal-root");
    if (!state.modal) { root.innerHTML = ""; return; }

    if (state.modal === "review") {
      const c = state.selected;
      const total = orderTotals();
      const maxBudgetPaise = Number(state.recommendation?.requirements?.budgetPaise || 50000);
      const maxDeadline = Number(state.recommendation?.requirements?.deadlineMinutes || 30);
      const fits = total && total.total <= maxBudgetPaise && c.estimatedMinutes <= maxDeadline;

      let comboBoxHtml = "";
      if (state.modalCombos && state.modalCombos.length > 0 && !state.addonItem) {
        comboBoxHtml = `
          <div class="combo-suggester-box">
            <div class="combo-head"><span>💡 Smart Combo Opportunity</span><small>Fits in your ₹${(maxBudgetPaise / 100).toFixed(0)} budget</small></div>
            <div class="combo-items-list">
              ${state.modalCombos.slice(0, 2).map(a => `
                <div class="combo-item-row">
                  <div><strong>+ ${esc(a.name)}</strong> (₹${esc(a.priceRupees)})</div>
                  <button type="button" class="btn btn-secondary btn-small" data-action="add-combo-item" data-id="${esc(a.id)}" data-name="${esc(a.name)}" data-price="${esc(a.priceRupees)}">+ Add to Order</button>
                </div>
              `).join("")}
            </div>
          </div>
        `;
      } else if (state.addonItem) {
        comboBoxHtml = `
          <div class="combo-suggester-box" style="border-style:solid;background:#eef7f2">
            <div class="combo-head"><span>✓ Combo Bundle Added</span><button type="button" class="btn btn-secondary btn-small" data-action="remove-combo-item">Remove</button></div>
            <div style="font-size:12px;color:#1e6545">Bundled with <strong>${esc(state.addonItem.name)}</strong> (+₹${esc(state.addonItem.priceRupees)})</div>
          </div>
        `;
      }

      root.innerHTML = '<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><div class="modal-header"><div><div class="section-kicker">STAGE 1 · REVIEW</div><h2 id="review-title">Review your order</h2><p>Check the complete amount and estimate before you confirm the simulated order.</p></div><button class="modal-close" data-action="close-modal" aria-label="Close">×</button></div><div class="modal-body">' +
        '<div class="checkout-preview"><img src="' + esc(c.imageUrl) + '" alt="' + esc(c.name) + '" data-fallback="' + esc(c.restaurantImage) + '" onerror="FoodieAgent.imageFallback(this)"><div><h3>' + esc(c.name) + '</h3><p>' + esc(c.restaurantName) + ' · ★ ' + Number(c.restaurantRating).toFixed(1) + '<br>Estimated delivery: ' + c.estimatedMinutes + ' minutes</p></div></div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:12px"><div><label class="field-label">Quantity</label><div class="quantity-control"><button data-action="quantity-minus" aria-label="Decrease quantity">−</button><span>' + state.quantity + '</span><button data-action="quantity-plus" aria-label="Increase quantity">+</button></div></div><span class="score-badge">✓ Constraints checked</span></div>' +
        comboBoxHtml +
        '<div class="bill-line"><span>Main dish (' + state.quantity + ' × ' + money(c.pricePaise || c.priceRupees * 100) + ')</span><strong>' + money((c.pricePaise || c.priceRupees * 100) * state.quantity) + '</strong></div>' +
        (state.addonItem ? '<div class="bill-line"><span>Combo Addon (' + esc(state.addonItem.name) + ')</span><strong>' + money(Number(state.addonItem.priceRupees) * 100) + '</strong></div>' : '') +
        '<div class="bill-line"><span>Delivery fee</span><strong>' + money(total.delivery) + '</strong></div><div class="bill-line"><span>Assumed food tax (5%)</span><strong>' + money(total.tax) + '</strong></div><div class="bill-line bill-total"><span>Total payable</span><strong>' + money(total.total) + '</strong></div>' +
        '<div class="callout ' + (!fits ? 'error' : '') + '" style="margin-top:13px">' + (fits ? 'Budget limit: ' + money(maxBudgetPaise) + '. Delivery deadline: ' + maxDeadline + ' minutes.' : 'This total exceeds the current budget (' + money(maxBudgetPaise) + ') or deadline (' + maxDeadline + 'm). Reduce quantity or remove addon.') + '</div>' +
        '<div class="confirm-row"><input id="confirm-order-check" type="checkbox" ' + (state.orderChecked ? 'checked' : '') + '><label for="confirm-order-check"><strong>I confirm this simulated order.</strong> I understand this creates a local demo record only in SQLite; it does not charge money or dispatch a real courier.</label></div>' +
        '<div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">Go back</button><button class="btn btn-orange" data-action="confirm-order" ' + (!state.orderChecked || !fits || state.placing ? 'disabled' : '') + '>' + (state.placing ? 'Placing…' : 'Confirm & place demo order →') + '</button></div><p class="footnote">The order is created only after explicit confirmation. A repeat submission uses the same idempotency key.</p></div></section></div>';

      const check = $("#confirm-order-check"); if (check) check.addEventListener("change", () => { state.orderChecked = check.checked; renderModal(); });
    } else if (state.modal === "success") {
      const o = state.lastOrder;
      root.innerHTML = '<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><div class="modal-body"><div class="success-hero"><div class="success-mark">✓</div><div class="section-kicker">STAGE 2 · CONFIRMED</div><h2>Demo order created</h2><p>Your simulated order is saved in the local SQLite database. No real restaurant or courier has been contacted.</p><div class="callout" style="text-align:left"><strong>Order ID: ' + esc(o?.id || '—') + '</strong><br>' + esc(o?.item_name || state.selected?.name || 'Pizza') + ' · ' + esc(o?.restaurant_name || state.selected?.restaurantName || 'Restaurant') + '<br>Total: <strong>' + money(o?.total_paise || orderTotals()?.total) + '</strong> · ETA: ' + (o?.estimated_minutes || state.selected?.estimatedMinutes) + ' minutes</div><div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">Back to discovery</button><button class="btn btn-primary" data-action="view-orders">Track my order →</button></div></div></div></section></div>';
    } else if (state.modal === "ai-settings") {
      const hasKey = Boolean(state.geminiApiKey);
      root.innerHTML = `
        <div class="modal-backdrop" data-action="backdrop-close">
          <section class="modal" role="dialog" aria-modal="true" style="max-width:540px">
            <div class="modal-header">
              <div><div class="section-kicker">INTELLIGENCE SETTINGS</div><h2>Gemini AI & Agent Mode</h2><p>Configure Google Gemini for live conversational multi-agent reasoning.</p></div>
              <button class="modal-close" data-action="close-modal">×</button>
            </div>
            <div class="modal-body">
              <div class="callout ${hasKey ? '' : 'warning'}" style="margin-bottom:14px">
                <strong>Current Active Mode:</strong> ${hasKey ? "⚡ Google Gemini 2.5 Flash (Live LLM Reasoning)" : "🛡️ Offline Deterministic Agent (Rule-Based Engine)"}<br>
                <small>${hasKey ? "Conversational agent uses live Gemini tool-calling across 10 specialized functions." : "Offline mode uses deterministic rule-based algorithms with full intent parsing. Zero API key needed."}</small>
              </div>
              <form id="gemini-key-form">
                <div class="field-wrap">
                  <label class="field-label" for="gemini-key-input">Gemini API Key (Optional)</label>
                  <input class="field" id="gemini-key-input" type="password" placeholder="AIzaSy..." value="${esc(state.geminiApiKey)}">
                  <small style="color:var(--muted);margin-top:4px;display:block">Keys are stored locally in your browser's localStorage and never committed to Git.</small>
                </div>
                <div class="modal-actions" style="margin-top:18px">
                  <button type="submit" class="btn btn-primary">Save Key</button>
                  ${hasKey ? '<button type="button" class="btn btn-secondary" data-action="remove-gemini-key">Use Offline Mode</button>' : ''}
                  <button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button>
                </div>
              </form>
            </div>
          </section>
        </div>
      `;
      const form = $("#gemini-key-form");
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const val = $("#gemini-key-input")?.value.trim() || "";
          state.geminiApiKey = val;
          if (val) localStorage.setItem("foodieagent-gemini-key", val);
          else localStorage.removeItem("foodieagent-gemini-key");
          state.modal = "";
          renderModal();
          render();
          notify(val ? "Gemini API Key saved! Live AI agent activated." : "Switched to Offline Deterministic Agent Mode.");
        });
      }
    }
  }

  // 1-Click In-Chat Order Confirmation
  async function confirmInChatOrder(ticketRaw){
    try {
      const t = typeof ticketRaw === "string" ? JSON.parse(ticketRaw) : ticketRaw;
      notify("Placing simulated order for " + t.name + "...");
      const res = await api("orders", {
        method: "POST",
        body: {
          profileKey: state.profileKey,
          restaurantId: t.restaurantId,
          menuItemId: t.dishId || t.id,
          quantity: t.quantity || 1,
          confirmed: true,
          idempotencyKey: "FAORD_" + uuid().replace(/-/g, ""),
          budgetPaise: 50000,
          deadlineMinutes: 30,
          vegetarianRequired: t.isVegetarian === true,
          nonVegetarianOnly: t.isVegetarian === false,
          category: "pizza"
        }
      });

      state.lastOrder = res.order;
      await refreshData(false);

      state.chatMessages.push({
        role: "model",
        text: `🎉 **Order #${res.order.id} Placed Successfully!**\n\nYour simulated order for **${res.order.item_name}** from **${res.order.restaurant_name}** has been confirmed and saved to SQLite.\n\n- **Total Bill**: ₹${(res.order.total_paise / 100).toFixed(2)}\n- **Simulated Delivery Window**: **${res.order.estimated_minutes} minutes**\n\nTrack status updates below:`,
        orderTrackingData: [res.order],
        cards: []
      });

      render();
      scrollChatToBottom();
      notify("Simulated order " + res.order.id + " confirmed!");
    } catch (err) {
      notify("Could not place order: " + err.message, "error");
    }
  }

  async function placeOrder(){
    if (!state.selected || !state.orderChecked || state.placing) return;
    const total = orderTotals();
    const maxBudgetPaise = Number(state.recommendation?.requirements?.budgetPaise || 50000);
    const maxDeadline = Number(state.recommendation?.requirements?.deadlineMinutes || 30);
    if (total.total > maxBudgetPaise || state.selected.estimatedMinutes > maxDeadline) {
      notify("Order exceeds a hard constraint; it was not placed.", "error"); return;
    }
    state.placing = true; renderModal();
    try {
      const r = await api("orders", {
        method: "POST",
        body: {
          profileKey: state.profileKey,
          restaurantId: state.selected.restaurantId,
          menuItemId: state.selected.id,
          quantity: state.quantity,
          confirmed: true,
          idempotencyKey: state.idempotencyKey,
          budgetPaise: maxBudgetPaise,
          deadlineMinutes: maxDeadline,
          vegetarianRequired: state.selected.isVegetarian === true,
          nonVegetarianOnly: state.selected.isVegetarian === false,
          category: state.selected.category || "pizza"
        }
      });
      state.lastOrder = r.order; state.modal = "success"; await refreshData(false); renderModal(); notify("Simulated order " + r.order.id + " is saved in SQLite.");
    } catch (e) { notify(e.message, "error"); }
    finally { state.placing = false; if (state.modal === "review") renderModal(); }
  }

  async function advanceOrder(id, status){
    try {
      await api("orders/" + encodeURIComponent(id), { method: "POST", body: { profileKey: state.profileKey, status } });
      await refreshData(false);
      // If we are currently in chat, update in-chat message as well
      for (const m of state.chatMessages) {
        if (m.orderTrackingData) {
          const match = m.orderTrackingData.find(o => o.id === id);
          if (match) match.status = status;
        }
      }
      render();
      notify("Order status updated to " + (statusLabel[status] || status) + ". A notification was saved.");
    } catch (e) { notify(e.message, "error"); }
  }

  async function autoSimulateDelivery(orderId){
    const order = state.orders.find(o => o.id === orderId);
    if (!order || order.status === "DELIVERED" || order.status === "CANCELLED") return;

    state.simulatingOrderId = orderId;
    render();
    notify("Started live delivery simulation for " + orderId + " (Milestones every 4 seconds)...");

    const steps = ["PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];
    for (const step of steps) {
      if (state.simulatingOrderId !== orderId) break;
      await new Promise(r => setTimeout(r, 4000));
      await advanceOrder(orderId, step);
    }
    state.simulatingOrderId = null;
    render();
    notify("🎉 Simulated order " + orderId + " has been successfully Delivered!");
  }

  async function resetDemo(){
    if (!window.confirm("Reset this browser’s FoodieAgent demo? This will delete this profile’s saved preferences, agent logs, demo orders, and notifications in SQLite.")) return;
    try {
      await api("demo-reset", { method: "POST", body: { profileKey: state.profileKey } });
      state.preferences = null; state.orders = []; state.notifications = []; state.agentRuns = []; state.recommendation = null; state.selected = null; state.modal = "";
      state.chatMessages = [
        {
          role: "model",
          text: "👋 Hi! I'm **FoodieAgent**, your end-to-end AI food ordering concierge.\n\nAsk me anything: find budget-safe meals, compare dishes, check restaurant menus, track active orders, or inspect your preferences!",
          toolCalls: [],
          cards: []
        }
      ];
      await refreshData(false); state.tab = "discover"; render(); renderModal(); notify("This browser demo profile was reset.");
    } catch (e) { notify(e.message, "error"); }
  }

  async function clickAction(target){
    const button = target.closest("[data-action]"); if (!button) return;
    const action = button.dataset.action;
    if (action === "tab") { state.tab = button.dataset.tab; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else if (action === "go-home") { state.tab = "discover"; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else if (action === "open-notifications") { state.tab = "notifications"; render(); }
    else if (action === "toggle-chatbot") {
      state.isChatbotOpen = !state.isChatbotOpen;
      if (state.isChatbotOpen) state.unreadBotCount = 0;
      renderChatbotWidget();
    }
    else if (action === "open-ai-settings") { state.modal = "ai-settings"; renderModal(); }
    else if (action === "remove-gemini-key") {
      state.geminiApiKey = ""; localStorage.removeItem("foodieagent-gemini-key"); state.modal = ""; renderModal(); render(); notify("Switched to Offline Mode.");
    }
    else if (action === "quick-query") { state.requestText = button.dataset.query; state.tab = "discover"; render(); $("#request-text")?.focus(); }
    else if (action === "goto-slide") {
      const idx = parseInt(button.dataset.slide, 10);
      setHeroSlide(idx);
      startHeroSlider();
    }
    else if (action === "prev-slide") {
      const idx = (state.heroSlideIndex - 1 + HERO_SLIDES.length) % HERO_SLIDES.length;
      setHeroSlide(idx);
      startHeroSlider();
    }
    else if (action === "next-slide") {
      const idx = (state.heroSlideIndex + 1) % HERO_SLIDES.length;
      setHeroSlide(idx);
      startHeroSlider();
    }
    else if (action === "send-chat-chip") {
      state.chatInput = button.dataset.query;
      const input = $("#chat-input-text");
      if (input) input.value = button.dataset.query;
      onSendChat();
    }
    else if (action === "chat-confirm-order") {
      confirmInChatOrder(button.dataset.ticket);
    }
    else if (action === "clear-chat") {
      state.chatMessages = [{
        role: "model",
        text: "Chat cleared! How can FoodieAgent assist you today?",
        toolCalls: [],
        cards: []
      }];
      render();
    }
    else if (action === "set-budget") { state.budgetRupees = button.dataset.budget; render(); $("#budget")?.focus(); }
    else if (action === "set-deadline") { state.deadlineMinutes = button.dataset.deadline; render(); $("#deadline")?.focus(); }
    else if (action === "choose-item") openOrderModal(button.dataset.item);
    else if (action === "add-combo-item") {
      state.addonItem = { id: button.dataset.id, name: button.dataset.name, priceRupees: button.dataset.price };
      renderModal();
    }
    else if (action === "remove-combo-item") {
      state.addonItem = null;
      renderModal();
    }
    else if (action === "close-modal") { state.modal = ""; renderModal(); }
    else if (action === "quantity-minus") { state.quantity = Math.max(1, state.quantity - 1); renderModal(); }
    else if (action === "quantity-plus") { state.quantity = Math.min(10, state.quantity + 1); renderModal(); }
    else if (action === "confirm-order") placeOrder();
    else if (action === "view-orders") { state.modal = ""; renderModal(); state.tab = "orders"; await refreshData(false); render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else if (action === "advance-order") advanceOrder(button.dataset.order, button.dataset.status);
    else if (action === "auto-simulate") autoSimulateDelivery(button.dataset.order);
    else if (action === "cancel-order") advanceOrder(button.dataset.order, "CANCELLED");
    else if (action === "refresh") { await refreshData(); render(); }
    else if (action === "delete-preferences") {
      if (!window.confirm("Delete saved preferences? Your order history will remain.")) return;
      try { await api("preferences", { method: "DELETE", body: { profileKey: state.profileKey } }); await refreshData(false); state.tab = "memory"; render(); notify("Saved preferences deleted."); } catch (e) { notify(e.message, "error"); }
    }
    else if (action === "create-backup") {
      try {
        notify("Flushing WAL & taking atomic hot snapshot…");
        const res = await api("backup", {
          method: "POST",
          body: { action: "create", profileKey: state.profileKey, reason: "manual_snapshot" }
        });
        notify("✅ Backup created: " + res.manifest.filename);
        await refreshData(false);
        render();
      } catch (e) { notify("Backup failed: " + e.message, "error"); }
    }
    else if (action === "restore-backup") {
      const fn = button.dataset.filename;
      if (!window.confirm("Restore database from snapshot " + fn + "? Current state will be replaced.")) return;
      try {
        notify("Restoring snapshot…");
        const res = await api("backup", {
          method: "POST",
          body: { action: "restore", filename: fn }
        });
        notify("✅ Database restored! Integrity: " + res.result.integrity);
        await refreshData(false);
        render();
      } catch (e) { notify("Restore failed: " + e.message, "error"); }
    }
    else if (action === "delete-fact") {
      const factId = button.dataset.fact;
      try {
        await api("memory?profileKey=" + encodeURIComponent(state.profileKey) + "&factId=" + encodeURIComponent(factId), {
          method: "DELETE"
        });
        notify("Fact deleted from Long-Term Memory.");
        await refreshData(false);
        render();
      } catch (e) { notify(e.message, "error"); }
    }
    else if (action === "clear-stm") {
      state.sessionId = "sess_" + uuid().replace(/-/g,"").slice(0, 12);
      localStorage.setItem("foodieagent-session-id", state.sessionId);
      notify("Short-term working memory session reset.");
      await refreshData(false);
      render();
    }
    else if (action === "mark-read") {
      try { await api("notifications", { method: "POST", body: { profileKey: state.profileKey, notificationId: button.dataset.notification } }); await refreshData(false); render(); } catch (e) { notify(e.message, "error"); }
    }
    else if (action === "mark-all-read") {
      try { await api("notifications", { method: "POST", body: { profileKey: state.profileKey } }); await refreshData(false); render(); notify("All alerts marked as read."); } catch (e) { notify(e.message, "error"); }
    }
    else if (action === "reset-demo") resetDemo();
    else if (action === "view-restaurant") {
      const restaurant = restaurantById(button.dataset.restaurant);
      const items = (state.data?.menuItems || []).filter(m => m.restaurant_id === button.dataset.restaurant);
      const root = $("#modal-root");
      root.innerHTML = '<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><div class="section-kicker">RESTAURANT MENU</div><h2>' + esc(restaurant?.name || 'Restaurant') + '</h2><p>' + esc(restaurant?.description || '') + '</p></div><button class="modal-close" data-action="close-modal">×</button></div><div class="modal-body">' +
        '<div class="checkout-preview"><img src="' + esc(restaurant?.image_url || '') + '" alt="' + esc(restaurant?.name || '') + '" onerror="FoodieAgent.imageFallback(this)"><div><h3>' + esc(restaurant?.cuisine || '') + '</h3><p>★ ' + Number(restaurant?.rating || 0).toFixed(1) + ' · ' + (restaurant?.is_open ? 'Open in demo' : 'Closed in demo') + '<br>Delivery fee ' + money(restaurant?.delivery_fee_paise) + ' · estimated ' + restaurant?.estimated_minutes + ' min</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Dish</th><th>Diet</th><th>Price</th></tr></thead><tbody>' + items.map(m => '<tr><td><strong>' + esc(m.name) + '</strong><br><span style="color:#788579">' + esc(m.category) + '</span></td><td>' + (m.is_vegetarian ? 'Vegetarian' : 'Non-veg') + '</td><td>' + money(m.price_paise) + '</td></tr>').join('') + '</tbody></table></div><div class="callout warning" style="margin-top:14px">This is a simulated menu. Item and delivery information is not live.</div><div class="modal-actions"><button class="btn btn-primary" data-action="close-modal">Done</button></div></div></section></div>';
    }
  }

  async function start(){
    try {
      await refreshData(false);
      render();
    } catch (e) {
      $("#app").innerHTML = '<div class="panel empty-panel"><div class="empty-icon">⚠</div><h3>Could not load the local SQLite database</h3><p>' + esc(e.message) + '</p><button class="btn btn-primary" data-action="refresh">Retry</button></div>';
    }
  }

  document.addEventListener("click", e => clickAction(e.target));
  document.addEventListener("change", e => {
    if (e.target.id === "use-memory") state.useSavedMemory = e.target.checked;
    if (e.target.id === "remember-prefs") state.rememberPrefs = e.target.checked;
    if (e.target.id === "chat-model-select") {
      state.selectedModel = e.target.value;
      localStorage.setItem("foodieagent-model", state.selectedModel);
      notify("Switched model to " + state.selectedModel);
      render();
    }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && state.modal) { state.modal = ""; renderModal(); } });

  window.FoodieAgent = { imageFallback, start, render };
  start();
})();
