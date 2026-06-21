/**
 * YouTube 文字起こしアプリ用 CORS プロキシ (Cloudflare Worker)
 * =====================================================================
 * ブラウザから YouTube へ直接アクセスできない（CORS）ため、この Worker が
 * 中継します。共有の無料プロキシと違い、自分専用のIPなのでYouTubeの
 * ボット判定に弾かれにくくなります。
 *
 * 使い方（アプリ側）:
 *   「⚙ 詳細設定（CORSプロキシ）」に次を入力して保存:
 *     https://<あなたのWorker名>.workers.dev/?url=
 *
 * リクエスト形式:
 *   https://<worker>.workers.dev/?url=<エンコードした対象URL>
 * =====================================================================
 */
export default {
  async fetch(request) {
    const CORS = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // プリフライト（OPTIONS）に応答
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const target = new URL(request.url).searchParams.get("url");
    if (!target) {
      return new Response("missing ?url= parameter", {
        status: 400,
        headers: CORS,
      });
    }

    // 念のため YouTube 系ドメインのみに転送を限定（オープンプロキシ化を防ぐ）
    let host;
    try {
      host = new URL(target).hostname;
    } catch (e) {
      return new Response("invalid url", { status: 400, headers: CORS });
    }
    const allowed = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|googlevideo\.com|google\.com)$/i;
    if (!allowed.test(host)) {
      return new Response("host not allowed", { status: 403, headers: CORS });
    }

    // 対象へ転送（ブラウザからの method / body をそのまま使う）
    const init = {
      method: request.method,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ja,en;q=0.8",
      },
    };
    const ct = request.headers.get("Content-Type");
    if (ct) init.headers["Content-Type"] = ct;
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    const resp = await fetch(target, init);

    // CORS ヘッダを付けて返す
    const headers = new Headers(resp.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    headers.delete("Content-Security-Policy");
    headers.delete("X-Frame-Options");
    return new Response(resp.body, { status: resp.status, headers });
  },
};
