/* =========================================================================
 * YouTube 文字起こしアプリ（ブラウザ完結 / 字幕取得方式）
 *
 * YouTube が持つ字幕トラック（手動字幕・自動生成字幕の両方）を
 * CORS プロキシ経由で取得し、全文テキストとして表示・保存します。
 * サーバー不要。データ（履歴・設定）はブラウザの localStorage に保存。
 * ========================================================================= */
(function () {
  "use strict";

  // ---- 設定 ----------------------------------------------------------------
  const LS_HISTORY = "yt_transcript_history_v1";
  const LS_PROXY = "yt_transcript_proxy_v1";
  const MAX_HISTORY = 30;

  // CORS プロキシ候補（上から順に試す）。対象URLを末尾に付与する。
  const BUILTIN_PROXIES = [
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
    (u) => "https://thingproxy.freeboard.io/fetch/" + u,
  ];

  // ---- DOM ----------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const els = {
    form: $("urlForm"),
    url: $("urlInput"),
    go: $("goBtn"),
    status: $("status"),
    result: $("result"),
    vidTitle: $("vidTitle"),
    vidMeta: $("vidMeta"),
    thumb: $("thumb"),
    langSelect: $("langSelect"),
    tsToggle: $("tsToggle"),
    transcript: $("transcript"),
    copyBtn: $("copyBtn"),
    downloadBtn: $("downloadBtn"),
    wordCount: $("wordCount"),
    historyList: $("historyList"),
    clearHistory: $("clearHistory"),
    proxyInput: $("proxyInput"),
    saveProxy: $("saveProxy"),
    proxyHint: $("proxyHint"),
  };

  // ---- 状態 ----------------------------------------------------------------
  let current = null; // { videoId, title, author, length, tracks, lang, lines }

  // ---- ユーティリティ ------------------------------------------------------
  function setStatus(msg, kind) {
    els.status.textContent = msg || "";
    els.status.className = "status" + (kind ? " " + kind : "");
    els.status.classList.toggle("hidden", !msg);
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }

  function decodeEntities(str) {
    if (!str) return "";
    const ta = document.createElement("textarea");
    ta.innerHTML = str;
    return ta.value;
  }

  // YouTube URL / ID から動画IDを取り出す
  function extractVideoId(input) {
    if (!input) return null;
    const s = input.trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    let m;
    if ((m = s.match(/[?&]v=([\w-]{11})/))) return m[1];
    if ((m = s.match(/youtu\.be\/([\w-]{11})/))) return m[1];
    if ((m = s.match(/youtube\.com\/(?:embed|shorts|live|v)\/([\w-]{11})/))) return m[1];
    if ((m = s.match(/([\w-]{11})/))) return m[1];
    return null;
  }

  // ---- プロキシ取得 --------------------------------------------------------
  function getProxies() {
    const custom = localStorage.getItem(LS_PROXY);
    const list = [];
    if (custom) {
      list.push((u) =>
        custom.includes("{url}")
          ? custom.replace("{url}", encodeURIComponent(u))
          : custom + encodeURIComponent(u)
      );
    }
    return list.concat(BUILTIN_PROXIES);
  }

  async function proxyFetch(targetUrl) {
    let lastErr;
    for (const build of getProxies()) {
      try {
        const res = await fetch(build(targetUrl), { redirect: "follow" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const text = await res.text();
        if (!text || text.length < 20) throw new Error("空のレスポンス");
        return text;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("すべてのプロキシで失敗しました");
  }

  // ---- HTML から JSON オブジェクトを抽出（波括弧マッチング） ---------------
  function extractJsonAfter(text, marker) {
    const idx = text.indexOf(marker);
    if (idx === -1) return null;
    const start = text.indexOf("{", idx);
    if (start === -1) return null;
    let depth = 0,
      inStr = false,
      esc = false;
    for (let j = start; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, j + 1));
          } catch (e) {
            return null;
          }
        }
      }
    }
    return null;
  }

  function getPlayerResponse(html) {
    return (
      extractJsonAfter(html, "ytInitialPlayerResponse") ||
      extractJsonAfter(html, '"playerResponse":')
    );
  }

  function trackLabel(t) {
    const name =
      (t.name &&
        (t.name.simpleText ||
          (t.name.runs && t.name.runs[0] && t.name.runs[0].text))) ||
      t.languageCode ||
      "字幕";
    const auto = t.kind === "asr" ? "（自動生成）" : "";
    return name + auto;
  }

  // ---- 字幕本文の取得 ------------------------------------------------------
  async function fetchTranscriptLines(baseUrl) {
    const url = baseUrl + (baseUrl.includes("?") ? "&" : "?") + "fmt=json3";
    const raw = await proxyFetch(url);
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      // json3 が取れない場合は XML フォールバック
      return parseXmlTranscript(await proxyFetch(baseUrl));
    }
    const lines = [];
    for (const ev of data.events || []) {
      if (!ev.segs) continue;
      const text = ev.segs
        .map((s) => s.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (text) lines.push({ start: ev.tStartMs || 0, text });
    }
    return lines;
  }

  function parseXmlTranscript(xml) {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const lines = [];
    doc.querySelectorAll("text").forEach((node) => {
      const text = decodeEntities(node.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (text)
        lines.push({
          start: Math.round(parseFloat(node.getAttribute("start") || "0") * 1000),
          text,
        });
    });
    return lines;
  }

  // ---- メイン処理 ----------------------------------------------------------
  async function handleSubmit(e) {
    e.preventDefault();
    const videoId = extractVideoId(els.url.value);
    if (!videoId) {
      setStatus("YouTube の URL または動画IDを正しく入力してください。", "error");
      return;
    }

    els.go.disabled = true;
    els.result.classList.add("hidden");
    setStatus("動画情報を取得中… ⏳", "loading");

    try {
      const html = await proxyFetch(
        `https://www.youtube.com/watch?v=${videoId}&hl=ja`
      );
      const pr = getPlayerResponse(html);
      if (!pr)
        throw new Error(
          "動画情報を解析できませんでした（プロキシ設定を確認してください）。"
        );

      const status = pr.playabilityStatus && pr.playabilityStatus.status;
      if (status && status !== "OK") {
        const reason =
          (pr.playabilityStatus && pr.playabilityStatus.reason) || status;
        throw new Error("この動画は再生できません：" + reason);
      }

      const tracks =
        (pr.captions &&
          pr.captions.playerCaptionsTracklistRenderer &&
          pr.captions.playerCaptionsTracklistRenderer.captionTracks) ||
        [];
      if (!tracks.length) {
        throw new Error(
          "この動画には字幕がありません。字幕取得方式では文字起こしできません（自動生成字幕も無い動画です）。"
        );
      }

      const details = pr.videoDetails || {};
      current = {
        videoId,
        title: decodeEntities(details.title || "(タイトル不明)"),
        author: decodeEntities(details.author || ""),
        length: parseInt(details.lengthSeconds || "0", 10),
        tracks,
        lang: null,
        lines: [],
      };

      // 言語セレクトを構築（日本語→英語→先頭の優先順で初期選択）
      populateLangSelect(tracks);
      const initial = pickPreferredIndex(tracks);
      els.langSelect.value = String(initial);

      await loadTrack(initial);
    } catch (err) {
      console.error(err);
      setStatus("⚠ " + (err.message || "取得に失敗しました。"), "error");
    } finally {
      els.go.disabled = false;
    }
  }

  function populateLangSelect(tracks) {
    els.langSelect.innerHTML = "";
    tracks.forEach((t, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = trackLabel(t);
      els.langSelect.appendChild(opt);
    });
  }

  function pickPreferredIndex(tracks) {
    const byLang = (code) =>
      tracks.findIndex((t) => (t.languageCode || "").startsWith(code));
    let i = tracks.findIndex(
      (t) => (t.languageCode || "").startsWith("ja") && t.kind !== "asr"
    );
    if (i === -1) i = byLang("ja");
    if (i === -1)
      i = tracks.findIndex(
        (t) => (t.languageCode || "").startsWith("en") && t.kind !== "asr"
      );
    if (i === -1) i = byLang("en");
    return i === -1 ? 0 : i;
  }

  async function loadTrack(index) {
    if (!current) return;
    const track = current.tracks[index];
    if (!track) return;
    setStatus("字幕を取得中… ⏳", "loading");
    try {
      const lines = await fetchTranscriptLines(track.baseUrl);
      if (!lines.length) throw new Error("字幕の本文を取得できませんでした。");
      current.lang = trackLabel(track);
      current.lines = lines;
      renderResult();
      saveHistory(current);
      renderHistory();
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus("⚠ " + (err.message || "字幕の取得に失敗しました。"), "error");
    }
  }

  // ---- 表示 ----------------------------------------------------------------
  function renderResult() {
    els.vidTitle.textContent = current.title;
    const parts = [];
    if (current.author) parts.push(current.author);
    if (current.length) parts.push("長さ " + fmtTime(current.length * 1000));
    if (current.lang) parts.push(current.lang);
    els.vidMeta.textContent = parts.join(" ・ ");
    els.thumb.src = `https://i.ytimg.com/vi/${current.videoId}/hqdefault.jpg`;
    els.thumb.alt = current.title;
    renderTranscript();
    els.result.classList.remove("hidden");
    els.result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderTranscript() {
    const showTs = els.tsToggle.checked;
    els.transcript.innerHTML = "";
    const frag = document.createDocumentFragment();
    current.lines.forEach((ln) => {
      const div = document.createElement("div");
      div.className = "tline";
      if (showTs) {
        const a = document.createElement("a");
        a.className = "tstamp";
        a.textContent = fmtTime(ln.start);
        a.href = `https://www.youtube.com/watch?v=${current.videoId}&t=${Math.floor(
          ln.start / 1000
        )}s`;
        a.target = "_blank";
        a.rel = "noopener";
        div.appendChild(a);
      }
      const span = document.createElement("span");
      span.className = "ttext";
      span.textContent = ln.text;
      div.appendChild(span);
      frag.appendChild(div);
    });
    els.transcript.appendChild(frag);

    const full = plainText(false);
    const chars = full.replace(/\n/g, "").length;
    const words = full.split(/\s+/).filter(Boolean).length;
    els.wordCount.textContent = `${current.lines.length} 行 ・ ${chars.toLocaleString()} 文字 ・ ${words.toLocaleString()} 語`;
  }

  function plainText(withTs) {
    return current.lines
      .map((ln) => (withTs ? `[${fmtTime(ln.start)}] ${ln.text}` : ln.text))
      .join("\n");
  }

  // ---- コピー / ダウンロード ----------------------------------------------
  async function copyTranscript() {
    if (!current) return;
    const text = plainText(els.tsToggle.checked);
    try {
      await navigator.clipboard.writeText(text);
      flash(els.copyBtn, "✓ コピーしました");
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      flash(els.copyBtn, "✓ コピーしました");
    }
  }

  function downloadTranscript() {
    if (!current) return;
    const text =
      `${current.title}\n${current.author}\nhttps://www.youtube.com/watch?v=${current.videoId}\n字幕: ${current.lang}\n\n` +
      plainText(els.tsToggle.checked);
    const safe =
      current.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) ||
      current.videoId;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${safe}_文字起こし.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash(els.downloadBtn, "✓ 保存しました");
  }

  function flash(btn, msg) {
    const orig = btn.textContent;
    btn.textContent = msg;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = orig;
      btn.disabled = false;
    }, 1400);
  }

  // ---- 履歴 ----------------------------------------------------------------
  function loadHistoryStore() {
    try {
      return JSON.parse(localStorage.getItem(LS_HISTORY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveHistory(item) {
    let store = loadHistoryStore().filter((h) => h.videoId !== item.videoId);
    store.unshift({
      videoId: item.videoId,
      title: item.title,
      author: item.author,
      length: item.length,
      lang: item.lang,
      lines: item.lines,
      savedAt: Date.now(),
    });
    store = store.slice(0, MAX_HISTORY);
    localStorage.setItem(LS_HISTORY, JSON.stringify(store));
  }

  function renderHistory() {
    const store = loadHistoryStore();
    els.historyList.innerHTML = "";
    els.clearHistory.classList.toggle("hidden", store.length === 0);
    if (!store.length) {
      els.historyList.innerHTML =
        '<p class="empty">まだ履歴はありません。文字起こしすると、ここに保存され、オフラインでも読み返せます。</p>';
      return;
    }
    store.forEach((h) => {
      const card = document.createElement("button");
      card.className = "history-item";
      card.innerHTML = `
        <img src="https://i.ytimg.com/vi/${h.videoId}/default.jpg" alt="" loading="lazy" />
        <span class="hi-body">
          <span class="hi-title"></span>
          <span class="hi-meta"></span>
        </span>`;
      card.querySelector(".hi-title").textContent = h.title;
      card.querySelector(".hi-meta").textContent =
        `${h.author || ""}${h.author ? " ・ " : ""}${h.lines.length}行`;
      card.addEventListener("click", () => {
        current = Object.assign({}, h, { tracks: [], lang: h.lang });
        els.url.value = `https://www.youtube.com/watch?v=${h.videoId}`;
        renderResult();
        setStatus("📁 履歴から読み込みました（保存時点の内容）。", "");
      });
      els.historyList.appendChild(card);
    });
  }

  // ---- プロキシ設定 --------------------------------------------------------
  function initProxyUI() {
    els.proxyInput.value = localStorage.getItem(LS_PROXY) || "";
    els.saveProxy.addEventListener("click", () => {
      const v = els.proxyInput.value.trim();
      if (v) localStorage.setItem(LS_PROXY, v);
      else localStorage.removeItem(LS_PROXY);
      els.proxyHint.textContent = v
        ? "✓ カスタムプロキシを優先して使用します。"
        : "✓ 既定のプロキシ候補を使用します。";
    });
  }

  // ---- 初期化 --------------------------------------------------------------
  function init() {
    els.form.addEventListener("submit", handleSubmit);
    els.langSelect.addEventListener("change", () =>
      loadTrack(parseInt(els.langSelect.value, 10))
    );
    els.tsToggle.addEventListener("change", () => current && renderTranscript());
    els.copyBtn.addEventListener("click", copyTranscript);
    els.downloadBtn.addEventListener("click", downloadTranscript);
    els.clearHistory.addEventListener("click", () => {
      if (confirm("履歴をすべて削除しますか？")) {
        localStorage.removeItem(LS_HISTORY);
        renderHistory();
      }
    });
    initProxyUI();
    renderHistory();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
