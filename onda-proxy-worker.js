/* =========================================================
   Proxy Onda — Cloudflare Worker (gratuit)
   Rôle : servir vos flux IPTV en https pour Onda Player
   - ajoute les en-têtes CORS autorisant la lecture dans le navigateur
   - suit les redirections du serveur IPTV (liens à jeton)
   - réécrit les playlists HLS (.m3u8) pour que chaque segment passe aussi par le proxy
   - transmet l'en-tête Range (avance rapide dans les films)
   ⚠️ Changez la valeur de KEY ci-dessous : sans la clé, personne d'autre ne peut utiliser votre proxy.
   ========================================================= */
const KEY = 'CHANGE-MOI-par-un-mot-secret';
const UA = 'VLC/3.0.20 LibVLC/3.0.20'; // beaucoup de serveurs IPTV acceptent mieux ce lecteur

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type'
};

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, {headers: CORS});
    const self = new URL(req.url);
    const target = self.searchParams.get('url');

    // Détection automatique par Onda Player
    if (target === 'onda:ping') return new Response(JSON.stringify({onda: 1}), {headers: {...CORS, 'content-type': 'application/json'}});
    if (KEY && self.searchParams.get('k') !== KEY) return new Response('Clé invalide', {status: 403, headers: CORS});
    if (!target || !/^https?:\/\//i.test(target)) return new Response('Paramètre url manquant', {status: 400, headers: CORS});

    const h = new Headers({'User-Agent': UA, 'Accept': '*/*'});
    const range = req.headers.get('Range'); if (range) h.set('Range', range);

    let res;
    try { res = await fetch(target, {method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers: h, redirect: 'follow'}); }
    catch (e) { return new Response('Serveur IPTV injoignable : ' + e.message, {status: 502, headers: CORS}); }

    const finalUrl = res.url || target;
    const ct = res.headers.get('content-type') || '';
    const base = self.origin + self.pathname + '?k=' + encodeURIComponent(KEY) + '&url=';

    // Playlist HLS : on réécrit chaque adresse (segments, sous-playlists, clés) vers le proxy
    if (res.ok && (/mpegurl/i.test(ct) || /\.m3u8$/i.test(new URL(finalUrl).pathname))) {
      const txt = await res.text();
      const wrap = x => base + encodeURIComponent(new URL(x, finalUrl).href);
      const out = txt.split(/\r?\n/).map(line => {
        const t = line.trim();
        if (!t) return line;
        if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, x) => 'URI="' + wrap(x) + '"');
        return wrap(t);
      }).join('\n');
      return new Response(out, {status: res.status, headers: {...CORS, 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-cache'}});
    }

    // Tout le reste (segments .ts, flux en direct, films mp4/mkv) : transmis en continu
    const out = new Headers(CORS);
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'last-modified']) {
      const v = res.headers.get(k); if (v) out.set(k, v);
    }
    return new Response(res.body, {status: res.status, headers: out});
  }
};
