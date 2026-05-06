const OBJECTIVE_TYPES = new Set(["单选", "多选", "判断"]);
const LS_KEY = "quiz_trainer_state_v1";

const state = {
  bank: [],
  bankById: new Map(),
  session: [],
  index: 0,
  answers: new Map(),
  checked: new Map(),
  wrongSet: new Set(),
  wrongBook: new Map(),
  performance: new Map(),
};

const dom = {
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
  const raw = localStorage.getItem(LS_KEY);
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
}

function savePersisted() {
  const wrongBook = Object.fromEntries(state.wrongBook.entries());
  const performance = Object.fromEntries(state.performance.entries());
  const payload = { wrongBook, performance, savedAt: new Date().toISOString() };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
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

function getSelectedTypes() {
  return [...dom.typeFilters.querySelectorAll("input[type=checkbox]:checked")].map((el) => el.value);
}

function getCurrentQuestion() {
  return state.session[state.index];
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
    wrong.last_wrong_at = now;
    wrong.last_user_answer = normalizedUser;
    wrong.standard_answer = normalizedStd;
    state.wrongBook.set(id, wrong);
  } else if (state.wrongBook.has(id)) {
    const wrong = state.wrongBook.get(id);
    wrong.right_after_wrong = Number(wrong.right_after_wrong || 0) + 1;
    wrong.last_right_at = now;
    state.wrongBook.set(id, wrong);
  }

  savePersisted();
  renderWrongBook();
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

  updatePerformance(q, isCorrect, normalizedUser, normalizedStd);

  const text = `${isCorrect ? "答对了，继续冲刺。" : "这题再想想。"}\n你的答案：${
    normalizedUser || "（空）"
  }\n标准答案：${normalizedStd || "（空）"}${q.analysis ? `\n\n解析：${q.analysis}` : ""}`;

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

function updateStats() {
  const total = state.session.length;
  const doneCount = [...state.checked.values()].filter((v) => v.isDone).length;
  const objectiveChecked = [...state.checked.values()].filter((v) => v.isObjective && v.isDone);
  const correctCount = objectiveChecked.filter((v) => v.isCorrect).length;
  const accuracy = objectiveChecked.length ? Math.round((correctCount / objectiveChecked.length) * 100) : 0;

  dom.statProgress.textContent = total ? `${state.index + 1} / ${total}` : "0 / 0";
  dom.statDone.textContent = String(doneCount);
  dom.statWrong.textContent = String(state.wrongSet.size);
  dom.statAccuracy.textContent = `${accuracy}%`;
  dom.statWrongBank.textContent = String(state.wrongBook.size);
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

  dom.wrongbookSummary.textContent = `共 ${entries.length} 题。抽题模式选“智能强化”会自动提高这些题目的出现概率。`;

  const preview = entries.slice(0, 120);
  dom.wrongbookList.innerHTML = preview
    .map((row) => {
      const id = row.question_id;
      return `<article class="wrong-item">
        <div class="wrong-item-top">
          <div>
            <div class="wrong-item-title">${escapeHtml(id)} · ${escapeHtml(row.question_type || "未分类")}</div>
            <div class="wrong-item-meta">错题次数 ${Number(row.wrong_count || 0)} · 最近错误 ${escapeHtml(formatTime(row.last_wrong_at))}</div>
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
      savePersisted();
      renderWrongBook();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!state.session.length) return;
    if (event.key === "ArrowRight") gotoQuestion(state.index + 1);
    if (event.key === "ArrowLeft") gotoQuestion(state.index - 1);
  });
}

function init() {
  if (!loadBank()) return;
  loadPersisted();
  buildTypeFilters();
  bindEvents();
  renderWrongBook();
  updateStats();
}

init();
