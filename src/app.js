// ===== ITパスポート暗記アプリ 本体 =====
(function () {
  "use strict";

  const STORAGE = {
    custom: "itp_custom_questions",
    bookmarks: "itp_bookmarks",
    stats: "itp_stats",
    wrong: "itp_wrong_counts",
  };

  // ---- 永続化ヘルパ ----
  const load = (key, fallback) => {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  };
  const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  // ---- 状態 ----
  let customQuestions = load(STORAGE.custom, []);
  let bookmarks = load(STORAGE.bookmarks, []); // id配列
  let stats = load(STORAGE.stats, { total: 0, correct: 0 });
  let wrongCounts = load(STORAGE.wrong, {}); // {id: count}

  let studyList = [];
  let studyIndex = 0;
  let quizList = [];
  let quizIndex = 0;

  // ---- 全問題（内蔵＋自作） ----
  const allQuestions = () => window.BUILTIN_QUESTIONS.concat(customQuestions);

  // ---- フィルタ適用 ----
  function getFiltered() {
    const term = $("#searchInput").value.trim().toLowerCase();
    const cat = $("#categoryFilter").value;
    const bmOnly = $("#bookmarkOnly").checked;
    return allQuestions().filter((q) => {
      if (cat && q.category !== cat) return false;
      if (bmOnly && !bookmarks.includes(q.id)) return false;
      if (term) {
        const hay = (q.question + " " + (q.explanation || "") + " " + q.choices.join(" ")).toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }

  // ---- ショートカット ----
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

  // ============ タブ切替 ============
  $all(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $all(".tab").forEach((t) => t.classList.remove("active"));
      $all(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $("#" + tab.dataset.tab).classList.add("active");
      refreshActive();
    });
  });

  function currentTab() {
    const active = $(".tab.active");
    return active ? active.dataset.tab : "study";
  }

  function refreshActive() {
    const tab = currentTab();
    if (tab === "study") renderStudy();
    else if (tab === "quiz") loadQuiz();
    else if (tab === "manage") renderCustomList();
    else if (tab === "stats") renderStats();
  }

  // ============ 学習モード ============
  function renderStudy() {
    studyList = getFiltered();
    if (studyIndex >= studyList.length) studyIndex = 0;
    const empty = studyList.length === 0;
    $("#studyCard").classList.toggle("hidden", empty);
    $(".nav-buttons").classList.toggle("hidden", empty);
    $("#studyEmpty").classList.toggle("hidden", !empty);
    if (empty) return;

    const q = studyList[studyIndex];
    $("#studyCategory").textContent = q.category;
    $("#studyCounter").textContent = `${studyIndex + 1} / ${studyList.length}`;
    $("#studyQuestion").textContent = q.question;
    const ansHtml =
      `<strong>正解：</strong>${escapeHtml(q.choices[q.answer])}` +
      (q.explanation ? "<hr style='border:none;border-top:1px solid #e5e7eb;margin:10px 0'>" + window.renderMarkdown(q.explanation) : "");
    $("#studyAnswer").innerHTML = ansHtml;
    $("#studyAnswer").classList.add("hidden");
    $("#studyReveal").textContent = "答えを見る";
    updateBookmarkBtn(q.id);
  }

  function updateBookmarkBtn(id) {
    const on = bookmarks.includes(id);
    $("#studyBookmark").textContent = on ? "⭐ 解除" : "⭐ お気に入り";
    $("#studyBookmark").classList.toggle("primary", on);
  }

  $("#studyReveal").addEventListener("click", () => {
    const a = $("#studyAnswer");
    a.classList.toggle("hidden");
    $("#studyReveal").textContent = a.classList.contains("hidden") ? "答えを見る" : "答えを隠す";
  });
  $("#studyNext").addEventListener("click", () => {
    if (!studyList.length) return;
    studyIndex = (studyIndex + 1) % studyList.length;
    renderStudy();
  });
  $("#studyPrev").addEventListener("click", () => {
    if (!studyList.length) return;
    studyIndex = (studyIndex - 1 + studyList.length) % studyList.length;
    renderStudy();
  });
  $("#studyShuffle").addEventListener("click", () => {
    studyList = shuffle(getFiltered());
    studyIndex = 0;
    // シャッフル結果を維持するため一時表示
    const empty = studyList.length === 0;
    if (!empty) {
      const q = studyList[0];
      $("#studyCategory").textContent = q.category;
      $("#studyCounter").textContent = `1 / ${studyList.length}`;
      $("#studyQuestion").textContent = q.question;
      $("#studyAnswer").innerHTML =
        `<strong>正解：</strong>${escapeHtml(q.choices[q.answer])}` +
        (q.explanation ? "<hr style='border:none;border-top:1px solid #e5e7eb;margin:10px 0'>" + window.renderMarkdown(q.explanation) : "");
      $("#studyAnswer").classList.add("hidden");
      $("#studyReveal").textContent = "答えを見る";
      updateBookmarkBtn(q.id);
    }
  });
  $("#studyBookmark").addEventListener("click", () => {
    if (!studyList.length) return;
    const id = studyList[studyIndex].id;
    toggleBookmark(id);
    updateBookmarkBtn(id);
  });

  function toggleBookmark(id) {
    const i = bookmarks.indexOf(id);
    if (i === -1) bookmarks.push(id);
    else bookmarks.splice(i, 1);
    save(STORAGE.bookmarks, bookmarks);
  }

  // ============ クイズモード ============
  function loadQuiz() {
    quizList = shuffle(getFiltered());
    quizIndex = 0;
    renderQuiz();
  }

  function renderQuiz() {
    const empty = quizList.length === 0;
    $("#quizCard").classList.toggle("hidden", empty);
    $("#quizEmpty").classList.toggle("hidden", !empty);
    if (empty) return;

    const q = quizList[quizIndex];
    $("#quizCategory").textContent = q.category;
    $("#quizCounter").textContent = `${quizIndex + 1} / ${quizList.length}`;
    $("#quizQuestion").textContent = q.question;
    $("#quizExplanation").classList.add("hidden");
    $("#quizNext").classList.add("hidden");

    const box = $("#quizChoices");
    box.innerHTML = "";
    q.choices.forEach((choice, i) => {
      if (choice == null || choice === "") return;
      const btn = document.createElement("button");
      btn.className = "choice";
      btn.textContent = choice;
      btn.addEventListener("click", () => answerQuiz(q, i, btn));
      box.appendChild(btn);
    });
  }

  function answerQuiz(q, picked, btn) {
    const buttons = $all("#quizChoices .choice");
    buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === q.answer) b.classList.add("correct");
    });
    const correct = picked === q.answer;
    if (!correct) {
      btn.classList.add("wrong");
      wrongCounts[q.id] = (wrongCounts[q.id] || 0) + 1;
      save(STORAGE.wrong, wrongCounts);
    }
    stats.total += 1;
    if (correct) stats.correct += 1;
    save(STORAGE.stats, stats);

    const exp = $("#quizExplanation");
    exp.innerHTML =
      (correct ? "<strong style='color:#16a34a'>正解！</strong>" : "<strong style='color:#dc2626'>不正解</strong>") +
      (q.explanation ? "<hr style='border:none;border-top:1px solid #e5e7eb;margin:10px 0'>" + window.renderMarkdown(q.explanation) : "");
    exp.classList.remove("hidden");
    $("#quizNext").classList.remove("hidden");
  }

  $("#quizNext").addEventListener("click", () => {
    quizIndex += 1;
    if (quizIndex >= quizList.length) {
      // 一周したら再シャッフル
      quizList = shuffle(getFiltered());
      quizIndex = 0;
    }
    renderQuiz();
  });

  // ============ 問題管理 ============
  const form = $("#questionForm");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const editId = $("#editId").value;
    const choices = [0, 1, 2, 3].map((i) => $("#fChoice" + i).value.trim());
    const data = {
      id: editId || "c" + Date.now(),
      category: $("#fCategory").value,
      question: $("#fQuestion").value.trim(),
      choices: choices,
      answer: parseInt($("#fAnswer").value, 10),
      explanation: $("#fExplanation").value.trim(),
    };
    // 空欄の選択肢は除外（最低2つ必要）
    data.choices = data.choices.filter((c, i) => c !== "" || i < 2);
    if (data.choices.filter((c) => c !== "").length < 2) {
      alert("選択肢は最低2つ入力してください。");
      return;
    }
    if (data.answer >= data.choices.length || data.choices[data.answer] === "") {
      alert("正解に指定した選択肢が空です。正しい選択肢を選んでください。");
      return;
    }

    if (editId) {
      const idx = customQuestions.findIndex((q) => q.id === editId);
      if (idx !== -1) customQuestions[idx] = data;
    } else {
      customQuestions.push(data);
    }
    save(STORAGE.custom, customQuestions);
    resetForm();
    renderCustomList();
    updateFooter();
  });

  $("#formReset").addEventListener("click", resetForm);

  function resetForm() {
    form.reset();
    $("#editId").value = "";
    $("#formTitle").textContent = "問題を追加";
  }

  function renderCustomList() {
    $("#customCount").textContent = `（${customQuestions.length}件）`;
    const list = $("#customList");
    list.innerHTML = "";
    if (customQuestions.length === 0) {
      list.innerHTML = '<p class="empty">まだ自作問題はありません。上のフォームから追加できます。</p>';
      return;
    }
    customQuestions.forEach((q) => {
      const div = document.createElement("div");
      div.className = "custom-item";
      div.innerHTML =
        `<div class="q">${escapeHtml(q.question)}</div>` +
        `<div class="muted">${escapeHtml(q.category)} ・ 正解：${escapeHtml(q.choices[q.answer] || "")}</div>`;
      const actions = document.createElement("div");
      actions.className = "actions";
      const editBtn = document.createElement("button");
      editBtn.className = "btn";
      editBtn.textContent = "✏️ 編集";
      editBtn.addEventListener("click", () => editQuestion(q.id));
      const delBtn = document.createElement("button");
      delBtn.className = "btn ghost";
      delBtn.textContent = "🗑 削除";
      delBtn.addEventListener("click", () => deleteQuestion(q.id));
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      div.appendChild(actions);
      list.appendChild(div);
    });
  }

  function editQuestion(id) {
    const q = customQuestions.find((x) => x.id === id);
    if (!q) return;
    $("#editId").value = q.id;
    $("#fCategory").value = q.category;
    $("#fQuestion").value = q.question;
    [0, 1, 2, 3].forEach((i) => ($("#fChoice" + i).value = q.choices[i] || ""));
    $("#fAnswer").value = q.answer;
    $("#fExplanation").value = q.explanation || "";
    $("#formTitle").textContent = "問題を編集";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function deleteQuestion(id) {
    if (!confirm("この問題を削除しますか？")) return;
    customQuestions = customQuestions.filter((q) => q.id !== id);
    save(STORAGE.custom, customQuestions);
    renderCustomList();
    updateFooter();
  }

  // ============ 成績 ============
  function renderStats() {
    $("#statTotal").textContent = stats.total;
    $("#statCorrect").textContent = stats.correct;
    const rate = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;
    $("#statRate").textContent = rate + "%";

    const weak = Object.entries(wrongCounts)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1]);
    const list = $("#weakList");
    list.innerHTML = "";
    if (weak.length === 0) {
      list.innerHTML = '<p class="empty">まだ間違えた問題はありません 🎉</p>';
      return;
    }
    const map = {};
    allQuestions().forEach((q) => (map[q.id] = q));
    weak.forEach(([id, count]) => {
      const q = map[id];
      if (!q) return;
      const div = document.createElement("div");
      div.className = "weak-item";
      div.innerHTML =
        `<span>${escapeHtml(q.question)}</span>` +
        `<span class="wrong-count">×${count}</span>`;
      list.appendChild(div);
    });
  }

  $("#resetStats").addEventListener("click", () => {
    if (!confirm("成績と苦手記録をリセットしますか？")) return;
    stats = { total: 0, correct: 0 };
    wrongCounts = {};
    save(STORAGE.stats, stats);
    save(STORAGE.wrong, wrongCounts);
    renderStats();
  });

  // ============ フィルタ変更 ============
  ["#searchInput", "#categoryFilter", "#bookmarkOnly"].forEach((sel) => {
    $(sel).addEventListener("input", () => {
      studyIndex = 0;
      refreshActive();
    });
  });

  // ============ ユーティリティ ============
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function updateFooter() {
    $("#footerInfo").textContent = `内蔵問題 ${window.BUILTIN_QUESTIONS.length}問 ＋ 自作 ${customQuestions.length}問`;
  }

  // ============ 初期化 ============
  updateFooter();
  renderStudy();
})();
