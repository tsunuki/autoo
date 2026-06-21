// ごく軽量なMarkdownパーサー（見出し/太字/斜体/コード/リスト/改行に対応）
// 外部ライブラリなしで動かすための最小実装
window.renderMarkdown = function (text) {
  if (!text) return "";

  // HTMLエスケープ（XSS対策）
  const escape = (s) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const lines = escape(text).split("\n");
  const html = [];
  let inList = false;

  const inline = (s) =>
    s
      // インラインコード `code`
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // 太字 **text**
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      // 斜体 *text*
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  for (let raw of lines) {
    const line = raw.trimEnd();

    // 箇条書き  - item / * item
    const listMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (listMatch) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push("<li>" + inline(listMatch[1]) + "</li>");
      continue;
    }
    if (inList) {
      html.push("</ul>");
      inList = false;
    }

    // 見出し  ###/##/#
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      html.push(`<h${level}>` + inline(h[2]) + `</h${level}>`);
      continue;
    }

    if (line === "") {
      html.push("");
      continue;
    }

    html.push("<p>" + inline(line) + "</p>");
  }

  if (inList) html.push("</ul>");
  return html.join("\n");
};
