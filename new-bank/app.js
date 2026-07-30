const OBJECTIVE_TYPES = new Set(["单选", "多选", "判断"]);
const LS_KEY = window.QUIZ_APP_STORAGE_KEY || "quiz_trainer_state_v1";

const state = {
  bank: [],
  bankById: new Map(),
  searchIndex: [],
  searchResults: [],
  searchExpandedAnswers: new Set(),
  session: [],
  index: 0,
  answers: new Map(),
  checked: new Map(),
  wrongSet: new Set(),
  wrongBook: new Map(),
  performance: new Map(),
  seenSet: new Set(),
};

const dom = {
  searchInput: document.getElementById("search-input"),
  searchLimit: document.getElementById("search-limit"),
  searchScope: document.getElementById("search-scope"),
  searchTypeFilter: document.getElementById("search-type-filter"),
  searchBtn: document.getElementById("search-btn"),
  clearSearchBtn: document.getElementById("clear-search-btn"),
  searchSummary: document.getElementById("search-summary"),
  searchResults: document.getElementById("search-results"),
  typeFilters: document.getElementById("type-filters"),
  questionCount: document.getElementById("question-count"),
  orderMode: document.getElementById("order-mode"),
  practiceMode: document.getElementById("practice-mode"),
  startBtn: document.getElementById("start-btn"),
  startWrongBtn: document.getElementById("start-wrong-btn"),
  resetBtn: document.getElementById("reset-btn"),
  panel: document.getElementById("question-panel"),
  metaType: document.getElementById("meta-type"),
  metaCategory: document.getElementById("meta-category"),
  metaLevel: document.getElementById("meta-level"),
  questionTitle: document.getElementById("question-title"),
  questionStem: document.getElementById("question-stem"),
  optionsWrap: document.getElementById("options-wrap"),
  subjectiveWrap: document.getElementById("subjective-wrap"),
  subjectiveNote: document.getElementById("subjective-note"),
  resultBox: document.getElementById("result-box"),
  checkBtn: document.getElementById("check-btn"),
  showAnswerBtn: document.getElementById("show-answer-btn"),
  prevBtn: document.getElementById("prev-btn"),
  nextBtn: document.getElementById("next-btn"),
  jumpInput: document.getElementById("jump-input"),
  jumpBtn: document.getElementById("jump-btn"),
  statProgress: document.getElementById("stat-progress"),
  statAccuracy: document.getElementById("stat-accuracy"),
  statDone: document.getElementById("stat-done"),
  statWrong: document.getElementById("stat-wrong"),
  statWrongBank: document.getElementById("stat-wrong-bank"),
  statSeen: document.getElementById("stat-seen"),
  statUnseen: document.getElementById("stat-unseen"),
  unseenSummary: document.getElementById("unseen-summary"),
  unseenBreakdown: document.getElementById("unseen-breakdown"),
  unseenList: document.getElementById("unseen-list"),
  wrongbookSummary: document.getElementById("wrongbook-summary"),
  wrongbookList: document.getElementById("wrongbook-list"),
  exportWrongBtn: document.getElementById("export-wrong-btn"),
  clearWrongBtn: document.getElementById("clear-wrong-btn"),
};

function normalizeAnswer(raw, qType) {
  const value = (raw ?? "").toString().trim();
  if (!value) return "";

  if (qType === "判断") {
    if (value === "A" || value === "正确" || value === "对") return "正确";
    if (value === "B" || value === "错误" || value === "错") return "错误";
  }

  const compact = value.toUpperCase().replace(/\s+/g, "");
  if (qType === "多选") {
    return [...new Set(compact.split(""))].sort().join("");
  }
  return compact;
}

function escapeHtml(text) {
  return (text ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getTypeCounts(list) {
  const map = new Map();
  for (const row of list) {
    const k = row.question_type || "未分类";
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function buildSearchTypeFilter() {
  const typeRows = getTypeCounts(state.bank);
  dom.searchTypeFilter.innerHTML = [
    '<option value="all">全部题型</option>',
    ...typeRows.map(
      ([type, count]) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}（${count}）</option>`,
    ),
  ].join("");
}

function toHalfWidth(text) {
  return (text ?? "")
    .toString()
    .replace(/\u3000/g, " ")
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248));
}

function normalizeSearchText(text) {
  return toHalfWidth(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSearchText(text) {
  return normalizeSearchText(text).replace(/\s+/g, "");
}

function buildSearchTokens(text) {
  const normalized = normalizeSearchText(text);
  const compact = normalized.replace(/\s+/g, "");
  const tokenSet = new Set(normalized.split(" ").filter(Boolean));

  if (compact) tokenSet.add(compact);
  if (compact.length >= 2) {
    for (let i = 0; i < compact.length - 1; i += 1) {
      tokenSet.add(compact.slice(i, i + 2));
    }
  }
  if (compact.length >= 5 && compact.length <= 18) {
    for (let i = 0; i < compact.length - 2; i += 1) {
      tokenSet.add(compact.slice(i, i + 3));
    }
  }

  return [...tokenSet].filter((token) => token.length > 0);
}

function buildHighlightTerms(text) {
  const raw = toHalfWidth(text).trim();
  if (!raw) return [];

  const parts = raw
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

  const compact = raw.replace(/\s+/g, "");
  if (compact.length >= 2) parts.push(compact);

  return [...new Set(parts)].sort((a, b) => b.length - a.length);
}

function buildSearchBigrams(text) {
  const compact = compactSearchText(text);
  const output = [];
  for (let i = 0; i < compact.length - 1; i += 1) {
    output.push(compact.slice(i, i + 2));
  }
  return output;
}

function highlightText(text, rawQuery) {
  const source = (text ?? "").toString();
  const terms = buildHighlightTerms(rawQuery).map(escapeRegExp);
  if (!source || !terms.length) return escapeHtml(source);

  const regex = new RegExp(`(${terms.join("|")})`, "giu");
  const parts = source.split(regex);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        return `<mark class="search-mark">${escapeHtml(part)}</mark>`;
      }
      return escapeHtml(part);
    })
    .join("");
}

function weightedSampleWithoutReplacement(items, count, weightFn) {
  const pool = items.map((item) => ({ item, weight: Math.max(0.1, Number(weightFn(item) || 0.1)) }));
  let totalWeight = pool.reduce((sum, row) => sum + row.weight, 0);
  const output = [];
  const pickCount = Math.min(count, pool.length);

  for (let i = 0; i < pickCount; i += 1) {
    let roll = Math.random() * totalWeight;
    let pickedIndex = 0;

    for (let j = 0; j < pool.length; j += 1) {
      roll -= pool[j].weight;
      if (roll <= 0) {
        pickedIndex = j;
        break;
      }
      if (j === pool.length - 1) pickedIndex = j;
    }

    const [picked] = pool.splice(pickedIndex, 1);
    totalWeight -= picked.weight;
    output.push(picked.item);
  }

  return output;
}

function safeParseJSON(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function loadPersisted() {
  let raw = "";
  try {
    raw = localStorage.getItem(LS_KEY);
  } catch (error) {
    console.warn("无法读取本地练习记录，本次将以临时记录运行。", error);
    return;
  }
  if (!raw) return;

  const parsed = safeParseJSON(raw, null);
  if (!parsed || typeof parsed !== "object") return;

  if (parsed.wrongBook && typeof parsed.wrongBook === "object") {
    for (const [id, row] of Object.entries(parsed.wrongBook)) {
      if (!id || !row || typeof row !== "object") continue;
      state.wrongBook.set(id, row);
    }
  }

  if (parsed.performance && typeof parsed.performance === "object") {
    for (const [id, row] of Object.entries(parsed.performance)) {
      if (!id || !row || typeof row !== "object") continue;
      state.performance.set(id, row);
    }
  }

  if (Array.isArray(parsed.seenIds)) {
    for (const id of parsed.seenIds) {
      if (state.bankById.has(id)) {
        state.seenSet.add(id);
      }
    }
  }
}

function savePersisted() {
  const wrongBook = Object.fromEntries(state.wrongBook.entries());
  const performance = Object.fromEntries(state.performance.entries());
  const seenIds = [...state.seenSet].filter((id) => state.bankById.has(id));
  const payload = { wrongBook, performance, seenIds, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("无法保存本地练习记录，不影响本次练习。", error);
  }
}

function formatTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("zh-CN", { hour12: false });
}

function loadBank() {
  const rows = window.QUESTION_BANK;
  if (!Array.isArray(rows) || rows.length === 0) {
    alert("题库数据加载失败，请检查 data/questions.js 文件。");
    return false;
  }

  state.bank = rows;
  state.bankById = new Map(rows.map((q) => [q.question_id, q]));
  state.searchIndex = rows.map(buildSearchEntry);
  return true;
}

function buildTypeFilters() {
  const typeRows = getTypeCounts(state.bank);
  dom.typeFilters.innerHTML = typeRows
    .map(
      ([type, count]) =>
        `<label class="type-pill"><input type="checkbox" value="${escapeHtml(type)}" checked /><span>${escapeHtml(type)}（${count}）</span></label>`,
    )
    .join("");
}

function buildSearchControls() {
  buildSearchTypeFilter();
}

function getSelectedTypes() {
  const inputs = [...dom.typeFilters.querySelectorAll("input[type=checkbox]")];
  if (!inputs.length) {
    return getTypeCounts(state.bank).map(([type]) => type);
  }

  return inputs.filter((el) => el.checked).map((el) => el.value);
}

function getCurrentQuestion() {
  return state.session[state.index];
}

function getValidSeenIds() {
  return [...state.seenSet].filter((id) => state.bankById.has(id));
}

function getUnseenQuestions() {
  return state.bank.filter((q) => q.question_id && !state.seenSet.has(q.question_id));
}

function markQuestionSeen(q) {
  const id = q?.question_id;
  if (!id || state.seenSet.has(id)) return;

  state.seenSet.add(id);
  savePersisted();
  renderCoverage();
}

function getQuestionWeight(q) {
  const id = q.question_id;
  const perf = state.performance.get(id);
  const wrong = state.wrongBook.get(id);

  let weight = 1;
  if (perf) {
    const wrongCount = Number(perf.wrong || 0);
    const streak = Number(perf.streak || 0);
    weight += Math.min(18, wrongCount * 2.5);
    if (perf.lastResult === "wrong") weight += 4;
    if (streak >= 3) weight *= 0.55;
    if (streak >= 6) weight *= 0.35;
  }

  if (wrong) {
    weight += Math.min(10, Number(wrong.wrong_count || 0) * 1.8);
  }

  return Math.max(0.1, weight);
}

function buildSession(selectedTypes, countWanted, forceWrongOnly = false) {
  const mode = forceWrongOnly ? "wrong-only" : dom.practiceMode.value;

  let filtered = state.bank.filter((q) => selectedTypes.includes(q.question_type));
  if (!filtered.length) {
    return { error: "没有符合筛选条件的题目。" };
  }

  if (mode === "wrong-only") {
    filtered = filtered.filter((q) => state.wrongBook.has(q.question_id));
    if (!filtered.length) {
      return { error: "错题集中暂无符合筛选条件的题目。" };
    }
  }

  const limit = Math.min(countWanted, filtered.length);
  const orderMode = dom.orderMode.value;

  let session = [];
  if (orderMode === "sequence") {
    session = filtered.slice(0, limit);
  } else if (mode === "smart" || mode === "wrong-only") {
    session = weightedSampleWithoutReplacement(filtered, limit, getQuestionWeight);
  } else {
    session = shuffle(filtered).slice(0, limit);
  }

  return { session, mode, poolSize: filtered.length };
}

function resetSessionState() {
  state.index = 0;
  state.answers.clear();
  state.checked.clear();
  state.wrongSet.clear();
  dom.resultBox.className = "result-box hidden";
  dom.resultBox.textContent = "";
}

function revealQuestionPanel() {
  if (typeof dom.panel.scrollIntoView !== "function") return;

  window.requestAnimationFrame(() => {
    dom.panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function startSession(forceWrongOnly = false) {
  const selectedTypes = getSelectedTypes();
  if (selectedTypes.length === 0) {
    alert("请至少勾选一种题型。");
    return;
  }

  const countWanted = Number(dom.questionCount.value || "0");
  if (!Number.isInteger(countWanted) || countWanted <= 0) {
    alert("请填写有效的抽题数量。");
    return;
  }

  const result = buildSession(selectedTypes, countWanted, forceWrongOnly);
  if (result.error) {
    alert(result.error);
    return;
  }

  state.session = result.session;
  resetSessionState();
  dom.panel.classList.remove("hidden");
  dom.jumpInput.max = String(state.session.length);
  dom.jumpInput.value = "1";
  renderQuestion();
  revealQuestionPanel();
}

function openQuestionSession(questions, targetQuestionId) {
  if (!questions.length) return;

  state.session = [...questions];
  resetSessionState();
  dom.panel.classList.remove("hidden");
  dom.jumpInput.max = String(state.session.length);

  const targetIndex = Math.max(
    0,
    state.session.findIndex((q) => q.question_id === targetQuestionId),
  );
  state.index = targetIndex >= 0 ? targetIndex : 0;
  dom.jumpInput.value = String(state.index + 1);
  renderQuestion();
  revealQuestionPanel();
}

function createSnippet(question) {
  const parts = [
    question.stem || "",
    extractOptions(question)
      .slice(0, 2)
      .map((opt) => `${opt.letter}. ${opt.text}`)
      .join(" "),
  ]
    .filter(Boolean)
    .join("\n");

  return parts.length > 170 ? `${parts.slice(0, 170)}...` : parts;
}

function buildAnswerPreview(question, rawQuery) {
  const std = normalizeAnswer(question.answer || "", question.question_type);
  const text = `标准答案：${std || "（主观题/未提供）"}${
    question.analysis ? `\n\n解析/评估标准：${question.analysis}` : ""
  }`;
  return highlightText(text, rawQuery);
}

function renderSearchResults() {
  const results = state.searchResults;
  if (!results.length) {
    dom.searchResults.innerHTML = '<div class="search-empty">暂无搜索结果，输入题干片段后试试。</div>';
    return;
  }

  dom.searchResults.innerHTML = results
    .map((row, index) => {
      const q = row.question;
      const matchedText = row.matchedIn.length ? row.matchedIn.join(" / ") : "综合匹配";
      const expanded = state.searchExpandedAnswers.has(q.question_id);
      const rawQuery = dom.searchInput.value.trim();
      return `<article class="search-item">
        <div class="search-item-top">
          <div class="search-item-title">${escapeHtml(q.question_id || "")} · ${escapeHtml(q.question_type || "未分类")}</div>
          <div class="search-score">匹配度 ${row.score}</div>
        </div>
        <div class="search-item-meta">
          <span class="chip">${escapeHtml(q.category || "未分组")}</span>
          <span class="chip chip-soft">${escapeHtml(q.level || "未定级")}</span>
          <span class="chip chip-soft">${escapeHtml(matchedText)}</span>
        </div>
        <pre class="search-item-snippet">${highlightText(createSnippet(q), rawQuery)}</pre>
        <div class="search-item-actions">
          <button class="btn btn-primary" data-action="open-search-result" data-index="${index}">打开这题</button>
          <button class="btn btn-ghost" data-action="toggle-search-answer" data-id="${escapeHtml(q.question_id)}">${
            expanded ? "收起答案" : "展开答案"
          }</button>
        </div>
        ${expanded ? `<div class="search-answer"><p class="search-answer-title">答案与解析</p><pre class="search-answer-body">${buildAnswerPreview(q, rawQuery)}</pre></div>` : ""}
      </article>`;
    })
    .join("");
}

function runSearch() {
  const rawQuery = dom.searchInput.value.trim();
  if (!rawQuery) {
    dom.searchSummary.textContent = "请输入题号、题干片段、选项内容或解析关键词。";
    state.searchResults = [];
    state.searchExpandedAnswers.clear();
    renderSearchResults();
    return;
  }

  const limit = Math.min(50, Math.max(1, Number(dom.searchLimit.value || "10")));
  state.searchExpandedAnswers.clear();
  state.searchResults = searchQuestions(rawQuery, limit);

  if (!state.searchResults.length) {
    dom.searchSummary.textContent = `没有找到和“${rawQuery}”足够接近的题目。可以试试更短的关键词，或切换搜索范围。`;
    renderSearchResults();
    return;
  }

  const scopeLabels = {
    all: "全部内容",
    stem: "题干",
    options: "选项",
    analysis: "解析",
    answer: "答案",
  };
  const typeFilter = dom.searchTypeFilter.value === "all" ? "全部题型" : dom.searchTypeFilter.value;
  dom.searchSummary.textContent = `找到 ${state.searchResults.length} 题，当前范围：${scopeLabels[dom.searchScope.value] || "全部内容"}，题型：${typeFilter}。`;
  renderSearchResults();
}

function clearSearchResults() {
  state.searchResults = [];
  state.searchExpandedAnswers.clear();
  dom.searchInput.value = "";
  dom.searchScope.value = "all";
  dom.searchTypeFilter.value = "all";
  dom.searchSummary.textContent = "支持离线搜题，不需要联网。";
  dom.searchResults.innerHTML = '<div class="search-empty">暂无搜索结果，输入题干片段后试试。</div>';
}

function extractOptions(q) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const rows = [];
  for (const letter of letters) {
    const key = `option_${letter}`;
    if (!Object.prototype.hasOwnProperty.call(q, key)) continue;
    const value = (q[key] ?? "").toString().trim();
    if (value) rows.push({ letter, text: value });
  }
  return rows;
}

function buildSearchEntry(q) {
  const stem = compactSearchText(q.stem || "");
  const options = compactSearchText(extractOptions(q).map((opt) => opt.text).join(" "));
  const analysis = compactSearchText(q.analysis || "");
  const answer = compactSearchText(q.answer || "");
  const meta = compactSearchText(
    [
      q.question_id,
      q.question_type,
      q.category,
      q.level,
      q.tags,
      q.answer,
      q.source_file,
      q.source_sheet,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return {
    question: q,
    stem,
    options,
    analysis,
    answer,
    meta,
    full: `${stem} ${options} ${analysis} ${answer} ${meta}`,
  };
}

function scoreSearchEntry(entry, query) {
  const { compact, raw, tokens, bigrams, scope } = query;
  if (!compact) return { score: 0, matchedIn: [] };

  let score = 0;
  const matchedIn = [];

  const fieldConfigs = {
    stem: { label: "题干", exact: 420, exactScale: 5, tokenScale: 16, tokenMax: 64 },
    options: { label: "选项", exact: 250, exactScale: 3, tokenScale: 11, tokenMax: 42 },
    analysis: { label: "解析", exact: 170, exactScale: 2, tokenScale: 8, tokenMax: 32 },
    answer: { label: "答案", exact: 240, exactScale: 4, tokenScale: 14, tokenMax: 56 },
    meta: { label: "题号/分类", exact: 120, exactScale: 1, tokenScale: 8, tokenMax: 16 },
  };
  const activeFields =
    scope === "all" ? ["stem", "options", "analysis", "answer", "meta"] : [scope, "meta"];

  const idText = (entry.question.question_id || "").toLowerCase();
  if (idText === raw.toLowerCase()) {
    score += 1000;
    matchedIn.push("题号精确匹配");
  }

  for (const fieldName of activeFields) {
    const config = fieldConfigs[fieldName];
    const fieldText = entry[fieldName] || "";
    if (!config || !fieldText) continue;

    if (fieldText.includes(compact)) {
      score += config.exact + Math.min(90, compact.length * config.exactScale);
      matchedIn.push(config.label);
    }
  }

  let tokenHitCount = 0;
  for (const token of tokens) {
    if (token.length === 1 && compact.length > 1) continue;
    for (const fieldName of activeFields) {
      const config = fieldConfigs[fieldName];
      const fieldText = entry[fieldName] || "";
      if (!config || !fieldText || !fieldText.includes(token)) continue;

      score += Math.min(config.tokenMax, token.length * config.tokenScale);
      tokenHitCount += 1;
      matchedIn.push(config.label);
      break;
    }
  }

  if (bigrams.length) {
    let matched = 0;
    const combined = activeFields.map((fieldName) => entry[fieldName] || "").join(" ");
    for (const gram of bigrams) {
      if (combined.includes(gram)) matched += 1;
    }
    const coverage = matched / bigrams.length;
    score += Math.round(coverage * 120);
  }

  if (compact.length >= 4 && tokenHitCount === 0 && score < 130) {
    return { score: 0, matchedIn: [] };
  }

  return { score, matchedIn: [...new Set(matchedIn)] };
}

function searchQuestions(rawQuery, limit) {
  const compact = compactSearchText(rawQuery);
  if (!compact) return [];
  const scope = dom.searchScope.value || "all";
  const typeFilter = dom.searchTypeFilter.value || "all";

  const query = {
    raw: rawQuery.trim(),
    compact,
    tokens: buildSearchTokens(rawQuery),
    bigrams: buildSearchBigrams(rawQuery),
    scope,
  };

  return state.searchIndex
    .filter((entry) => typeFilter === "all" || entry.question.question_type === typeFilter)
    .map((entry) => {
      const { score, matchedIn } = scoreSearchEntry(entry, query);
      return { question: entry.question, score, matchedIn };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.question.question_id.localeCompare(b.question.question_id))
    .slice(0, limit);
}

function renderOptions(q, savedAnswer) {
  const options = extractOptions(q);
  if (!options.length || !OBJECTIVE_TYPES.has(q.question_type)) {
    dom.optionsWrap.innerHTML = "";
    return;
  }

  const inputType = q.question_type === "多选" ? "checkbox" : "radio";
  const normalizedSaved = normalizeAnswer(savedAnswer, q.question_type);
  const selectedSet = new Set(normalizedSaved.split(""));

  dom.optionsWrap.innerHTML = options
    .map((opt) => {
      const checked =
        inputType === "checkbox" ? selectedSet.has(opt.letter) : normalizedSaved === opt.letter;
      return `<label class="option-item">
        <input type="${inputType}" name="answer" value="${opt.letter}" ${checked ? "checked" : ""} />
        <span class="option-text"><strong>${opt.letter}.</strong> ${escapeHtml(opt.text)}</span>
      </label>`;
    })
    .join("");
}

function renderSubjective(q, savedAnswer) {
  const isSubjective = !OBJECTIVE_TYPES.has(q.question_type);
  dom.subjectiveWrap.classList.toggle("hidden", !isSubjective);
  dom.checkBtn.textContent = isSubjective ? "保存作答记录" : "提交并判定";
  if (isSubjective) dom.subjectiveNote.value = savedAnswer || "";
}

function setResultBox(text, cssType) {
  dom.resultBox.textContent = text;
  dom.resultBox.className = `result-box ${cssType}`;
}

function renderQuestion() {
  const q = getCurrentQuestion();
  if (!q) return;

  markQuestionSeen(q);

  const savedAnswer = state.answers.get(q.question_id) || "";
  dom.metaType.textContent = q.question_type || "未分类";
  dom.metaCategory.textContent = q.category || "未分组";
  dom.metaLevel.textContent = q.level || "未定级";
  dom.questionTitle.textContent = `第 ${state.index + 1} 题 · ${q.question_id || ""}`;
  dom.questionStem.textContent = q.stem || "（无题干）";

  renderOptions(q, savedAnswer);
  renderSubjective(q, savedAnswer);

  const checked = state.checked.get(q.question_id);
  if (checked?.shownText) {
    setResultBox(checked.shownText, checked.cssType);
  } else {
    dom.resultBox.className = "result-box hidden";
    dom.resultBox.textContent = "";
  }

  dom.jumpInput.value = String(state.index + 1);
  updateStats();
}

function collectUserAnswer(q) {
  if (!OBJECTIVE_TYPES.has(q.question_type)) {
    return dom.subjectiveNote.value.trim();
  }

  const inputs = [...dom.optionsWrap.querySelectorAll("input[name=answer]")];
  if (q.question_type === "多选") {
    const letters = inputs.filter((i) => i.checked).map((i) => i.value.toUpperCase());
    return [...new Set(letters)].sort().join("");
  }
  const checked = inputs.find((i) => i.checked);
  return checked ? checked.value.toUpperCase() : "";
}

function updatePerformance(q, isCorrect, normalizedUser, normalizedStd) {
  const id = q.question_id;
  const now = new Date().toISOString();
  const wrongBookOutcome = {
    removedFromWrongBook: false,
    rightAfterWrong: 0,
  };

  const perf = state.performance.get(id) || {
    total: 0,
    right: 0,
    wrong: 0,
    streak: 0,
    lastResult: "",
    lastAt: "",
    lastAnswer: "",
  };

  perf.total += 1;
  perf.lastAt = now;
  perf.lastAnswer = normalizedUser;

  if (isCorrect) {
    perf.right += 1;
    perf.streak = Number(perf.streak || 0) + 1;
    perf.lastResult = "correct";
  } else {
    perf.wrong += 1;
    perf.streak = 0;
    perf.lastResult = "wrong";
  }

  state.performance.set(id, perf);

  if (!isCorrect) {
    const wrong = state.wrongBook.get(id) || {
      question_id: id,
      first_wrong_at: now,
      wrong_count: 0,
      right_after_wrong: 0,
      question_type: q.question_type || "",
      category: q.category || "",
      level: q.level || "",
      stem: q.stem || "",
      source_file: q.source_file || "",
      source_sheet: q.source_sheet || "",
    };

    wrong.wrong_count = Number(wrong.wrong_count || 0) + 1;
    wrong.right_after_wrong = 0;
    wrong.last_wrong_at = now;
    wrong.last_user_answer = normalizedUser;
    wrong.standard_answer = normalizedStd;
    state.wrongBook.set(id, wrong);
  } else if (state.wrongBook.has(id)) {
    const wrong = state.wrongBook.get(id);
    wrong.right_after_wrong = Number(wrong.right_after_wrong || 0) + 1;
    wrong.last_right_at = now;
    wrongBookOutcome.rightAfterWrong = wrong.right_after_wrong;

    if (wrong.right_after_wrong >= 2) {
      state.wrongBook.delete(id);
      state.wrongSet.delete(id);
      wrongBookOutcome.removedFromWrongBook = true;
    } else {
      state.wrongBook.set(id, wrong);
    }
  }

  savePersisted();
  renderWrongBook();
  return wrongBookOutcome;
}

function checkAnswer() {
  const q = getCurrentQuestion();
  if (!q) return;

  const userAnswer = collectUserAnswer(q);
  state.answers.set(q.question_id, userAnswer);

  if (!OBJECTIVE_TYPES.has(q.question_type)) {
    state.checked.set(q.question_id, {
      cssType: "subjective",
      shownText: "主观题已保存作答记录。请结合参考答案进行自评。",
      isDone: Boolean(userAnswer),
      isCorrect: false,
      isObjective: false,
    });
    setResultBox("主观题已保存作答记录。请结合参考答案进行自评。", "subjective");
    updateStats();
    return;
  }

  if (!userAnswer) {
    alert("请先选择答案。");
    return;
  }

  const normalizedUser = normalizeAnswer(userAnswer, q.question_type);
  const normalizedStd = normalizeAnswer(q.answer || "", q.question_type);
  const isCorrect = normalizedUser === normalizedStd;

  if (!isCorrect) {
    state.wrongSet.add(q.question_id);
  } else {
    state.wrongSet.delete(q.question_id);
  }

  const wrongBookOutcome = updatePerformance(q, isCorrect, normalizedUser, normalizedStd);
  const wrongBookHint =
    isCorrect && wrongBookOutcome.removedFromWrongBook
      ? "\n错题状态：已连续答对 2 次，自动移出错题集。"
      : isCorrect && wrongBookOutcome.rightAfterWrong === 1
        ? "\n错题状态：已连续答对 1 次，再答对 1 次将自动移出错题集。"
        : "";

  const text = `${isCorrect ? "答对了，继续冲刺。" : "这题再想想。"}\n你的答案：${
    normalizedUser || "（空）"
  }\n标准答案：${normalizedStd || "（空）"}${wrongBookHint}${q.analysis ? `\n\n解析：${q.analysis}` : ""}`;

  state.checked.set(q.question_id, {
    cssType: isCorrect ? "ok" : "bad",
    shownText: text,
    isDone: true,
    isCorrect,
    isObjective: true,
  });

  setResultBox(text, isCorrect ? "ok" : "bad");
  updateStats();
}

function showAnswer() {
  const q = getCurrentQuestion();
  if (!q) return;

  const std = normalizeAnswer(q.answer || "", q.question_type);
  const text = `标准答案：${std || "（主观题/未提供）"}${
    q.analysis ? `\n\n解析/评估标准：${q.analysis}` : ""
  }`;

  const cssType = OBJECTIVE_TYPES.has(q.question_type) ? "bad" : "subjective";
  setResultBox(text, cssType);

  const previous = state.checked.get(q.question_id) || {
    isDone: false,
    isCorrect: false,
    isObjective: OBJECTIVE_TYPES.has(q.question_type),
  };

  state.checked.set(q.question_id, {
    ...previous,
    shownText: text,
    cssType,
  });
}

function gotoQuestion(targetIdx) {
  if (targetIdx < 0 || targetIdx >= state.session.length) return;
  state.index = targetIdx;
  renderQuestion();
}

function renderCoverage() {
  if (!dom.unseenSummary || !dom.unseenBreakdown || !dom.unseenList) return;

  const validSeen = getValidSeenIds();
  const unseen = getUnseenQuestions();
  const total = state.bank.length;
  const seenCount = validSeen.length;
  const percent = total ? Math.round((seenCount / total) * 100) : 0;

  if (!total) {
    dom.unseenSummary.textContent = "题库还没有加载完成。";
    dom.unseenBreakdown.innerHTML = "";
    dom.unseenList.innerHTML = "";
    return;
  }

  if (!unseen.length) {
    dom.unseenSummary.textContent = `已经刷到全部 ${total} 题，覆盖率 100%。`;
    dom.unseenBreakdown.innerHTML = '<span class="coverage-chip done">全部完成</span>';
    dom.unseenList.innerHTML = '<div class="unseen-empty">所有题目都已经刷到过了，可以开始错题专项或智能强化。</div>';
    return;
  }

  const typeRows = getTypeCounts(unseen);
  const preview = unseen.slice(0, 40);
  const hiddenCount = unseen.length - preview.length;

  dom.unseenSummary.textContent = `已刷到 ${seenCount} / ${total} 题，覆盖率 ${percent}%，还剩 ${unseen.length} 题没有刷到。`;
  dom.unseenBreakdown.innerHTML = typeRows
    .map(([type, count]) => `<span class="coverage-chip">${escapeHtml(type)} ${count}</span>`)
    .join("");
  dom.unseenList.innerHTML = [
    ...preview.map(
      (q) => `<article class="unseen-item">
        <div class="unseen-item-main">
          <div class="unseen-item-title">${escapeHtml(q.question_id || "")} · ${escapeHtml(q.question_type || "未分类")}</div>
          <pre class="unseen-item-stem">${escapeHtml((q.stem || "").slice(0, 120))}</pre>
        </div>
        <button class="btn btn-mini" data-action="open-unseen" data-id="${escapeHtml(q.question_id || "")}">打开这题</button>
      </article>`,
    ),
    hiddenCount > 0 ? `<div class="unseen-more">还有 ${hiddenCount} 题未显示，继续刷题后这里会自动减少。</div>` : "",
  ].join("");
}

function updateStats() {
  const total = state.session.length;
  const doneCount = [...state.checked.values()].filter((v) => v.isDone).length;
  const objectiveChecked = [...state.checked.values()].filter((v) => v.isObjective && v.isDone);
  const correctCount = objectiveChecked.filter((v) => v.isCorrect).length;
  const accuracy = objectiveChecked.length ? Math.round((correctCount / objectiveChecked.length) * 100) : 0;
  const validSeen = getValidSeenIds();
  const unseenCount = Math.max(0, state.bank.length - validSeen.length);

  dom.statProgress.textContent = total ? `${state.index + 1} / ${total}` : "0 / 0";
  dom.statDone.textContent = String(doneCount);
  dom.statWrong.textContent = String(state.wrongSet.size);
  dom.statAccuracy.textContent = `${accuracy}%`;
  dom.statWrongBank.textContent = String(state.wrongBook.size);
  dom.statSeen.textContent = String(validSeen.length);
  dom.statUnseen.textContent = String(unseenCount);
}

function renderWrongBook() {
  const entries = [...state.wrongBook.values()].sort((a, b) => {
    const wc = Number(b.wrong_count || 0) - Number(a.wrong_count || 0);
    if (wc !== 0) return wc;
    return (b.last_wrong_at || "").localeCompare(a.last_wrong_at || "");
  });

  if (!entries.length) {
    dom.wrongbookSummary.textContent = "暂无错题。开始练习后答错的题会自动收录在这里。";
    dom.wrongbookList.innerHTML = "<div class=\"wrong-item\">暂无错题记录。</div>";
    updateStats();
    return;
  }

  dom.wrongbookSummary.textContent = `共 ${entries.length} 题。连续答对 2 次会自动移出错题集；智能强化会提高这些题目的出现概率。`;

  const preview = entries.slice(0, 120);
  dom.wrongbookList.innerHTML = preview
    .map((row) => {
      const id = row.question_id;
      return `<article class="wrong-item">
        <div class="wrong-item-top">
          <div>
            <div class="wrong-item-title">${escapeHtml(id)} · ${escapeHtml(row.question_type || "未分类")}</div>
            <div class="wrong-item-meta">错题次数 ${Number(row.wrong_count || 0)} · 连续答对 ${Math.min(2, Number(row.right_after_wrong || 0))}/2 · 最近错误 ${escapeHtml(formatTime(row.last_wrong_at))}</div>
          </div>
          <button class="btn btn-mini" data-action="remove-wrong" data-id="${escapeHtml(id)}">移出错题集</button>
        </div>
        <pre class="wrong-item-stem">${escapeHtml((row.stem || "").slice(0, 220))}</pre>
      </article>`;
    })
    .join("");

  updateStats();
}

function exportWrongBook() {
  const entries = [...state.wrongBook.values()].map((row) => {
    const q = state.bankById.get(row.question_id) || null;
    return { ...row, question: q };
  });

  if (!entries.length) {
    alert("错题集为空，暂无可导出内容。");
    return;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    total: entries.length,
    entries,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  a.href = url;
  a.download = `wrongbook-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function clearWrongBook() {
  if (!window.confirm("确定要清空错题集吗？此操作不可撤销。")) return;
  state.wrongBook.clear();
  savePersisted();
  renderWrongBook();
}

function resetCurrentSession() {
  resetSessionState();
  state.session = [];
  dom.panel.classList.add("hidden");
  updateStats();
}

function bindEvents() {
  dom.searchBtn.addEventListener("click", runSearch);
  dom.clearSearchBtn.addEventListener("click", clearSearchResults);
  dom.startBtn.addEventListener("click", () => startSession(false));
  dom.startWrongBtn.addEventListener("click", () => startSession(true));
  dom.resetBtn.addEventListener("click", resetCurrentSession);

  dom.checkBtn.addEventListener("click", checkAnswer);
  dom.showAnswerBtn.addEventListener("click", showAnswer);
  dom.prevBtn.addEventListener("click", () => gotoQuestion(state.index - 1));
  dom.nextBtn.addEventListener("click", () => gotoQuestion(state.index + 1));

  dom.jumpBtn.addEventListener("click", () => {
    const target = Number(dom.jumpInput.value || "0");
    if (!Number.isInteger(target) || target < 1 || target > state.session.length) return;
    gotoQuestion(target - 1);
  });

  dom.exportWrongBtn.addEventListener("click", exportWrongBook);
  dom.clearWrongBtn.addEventListener("click", clearWrongBook);

  dom.wrongbookList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    const id = target.dataset.id;
    if (!action || !id) return;

    if (action === "remove-wrong") {
      state.wrongBook.delete(id);
      state.wrongSet.delete(id);
      savePersisted();
      renderWrongBook();
    }
  });

  dom.unseenList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.dataset.action !== "open-unseen") return;

    const id = target.dataset.id || "";
    if (!id) return;

    const questions = getUnseenQuestions();
    openQuestionSession(questions, id);
  });

  dom.searchResults.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    if (!action) return;

    if (action === "open-search-result") {
      const index = Number(target.dataset.index || "-1");
      if (!Number.isInteger(index) || index < 0 || index >= state.searchResults.length) return;
      const questions = state.searchResults.map((row) => row.question);
      openQuestionSession(questions, questions[index]?.question_id || "");
      return;
    }

    if (action === "toggle-search-answer") {
      const id = target.dataset.id || "";
      if (!id) return;
      if (state.searchExpandedAnswers.has(id)) {
        state.searchExpandedAnswers.delete(id);
      } else {
        state.searchExpandedAnswers.add(id);
      }
      renderSearchResults();
    }
  });

  dom.searchScope.addEventListener("change", () => {
    if (dom.searchInput.value.trim()) runSearch();
  });
  dom.searchTypeFilter.addEventListener("change", () => {
    if (dom.searchInput.value.trim()) runSearch();
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
      return;
    }
    if (!state.session.length) return;
    if (event.key === "ArrowRight") gotoQuestion(state.index + 1);
    if (event.key === "ArrowLeft") gotoQuestion(state.index - 1);
  });

  dom.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch();
    }
  });
}

function init() {
  if (!loadBank()) return;
  loadPersisted();
  buildTypeFilters();
  buildSearchControls();
  bindEvents();
  clearSearchResults();
  renderCoverage();
  renderWrongBook();
  updateStats();
}

init();
