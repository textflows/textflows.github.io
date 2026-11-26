(() => {
  const $ = id => document.getElementById(id);
  const base = TF.url.replace(/\/$/, '');
  let token = sessionStorage.getItem('tf_token');

  async function api(path, options = {}) {
    const headers = {apikey: TF.key, ...options.headers};
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(base + path, {...options, headers});
    if (res.status === 401) logout();
    if (!res.ok) throw new Error(res.status + ' ' + await res.text());
    return res;
  }
  function logout() {
    token = null; sessionStorage.removeItem('tf_token');
    $('rows').replaceChildren(); $('app').hidden = true; $('login').hidden = false;
  }
  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text) e.textContent = text;       // nie innerHTML: Eingaben kommen von Fremden
    if (cls) e.className = cls;
    return e;
  }
  function button(text, fn) {
    const b = el('button', text, 'small');
    b.onclick = () => fn().catch(e => $('status').textContent = e.message);
    return b;
  }
  async function download(path) {
    const blob = await (await api('/storage/v1/object/authenticated/dokumente/' + path)).blob();
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = path.replace('/', '_'); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function remove(r) {
    let missing = 0;
    if (r.dateien.length) {
      const res = await api('/storage/v1/object/dokumente', {method: 'DELETE',
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify({prefixes: r.dateien})});
      missing = r.dateien.length - (await res.json()).length;
    }
    const res = await api('/rest/v1/anfragen?id=eq.' + r.id,
      {method: 'DELETE', headers: {Prefer: 'return=representation'}});
    if (!(await res.json()).length) throw new Error('Keine Berechtigung oder Eintrag nicht gefunden.');
    await load();
    if (missing > 0) $('status').textContent =
      'Eintrag gelöscht. Bitte in Supabase unter Storage prüfen, ob noch Dateien vorhanden sind.';
  }
  // Zweimal klicken statt Dialogfenster (Browser koennen Dialoge unterdruecken)
  function deleteButton(r) {
    let armed = false, timer;
    const b = button('Löschen', async () => {
      if (!armed) {
        armed = true; b.textContent = 'Wirklich löschen?';
        timer = setTimeout(() => { armed = false; b.textContent = 'Löschen'; }, 6000);
        return;
      }
      clearTimeout(timer); b.disabled = true; b.textContent = 'Wird gelöscht …';
      try { await remove(r); }
      catch (e) {
        armed = false; b.disabled = false; b.textContent = 'Löschen';
        alertText('Löschen fehlgeschlagen: ' + e.message);
      }
    });
    return b;
  }
  function alertText(text) {
    $('status').textContent = text;
    $('status').scrollIntoView({block: 'center'});
  }
  async function load() {
    const rows = await (await api('/rest/v1/anfragen?select=*&order=created_at.desc&limit=200')).json();
    $('login').hidden = true; $('app').hidden = false;
    $('status').textContent = rows.length ? '' : 'Noch keine Anfragen.';
    $('rows').replaceChildren(...rows.map(r => {
      const tr = el('tr'), files = el('td'), act = el('td');
      const line = a => a.filter(Boolean).join('\n');
      tr.append(el('td', new Date(r.created_at).toLocaleString('de-DE') + (r.erledigt ? '\n✔ erledigt' : '')),
        el('td', line([r.name, r.email, r.telefon])),
        el('td', line([r.leistung, r.von_sprache && `${r.von_sprache} → ${r.nach_sprache}`,
          r.termin && 'Termin: ' + r.termin, r.ort && 'Ort: ' + r.ort, r.nachricht])), files, act);
      r.dateien.forEach(p => files.append(button('Datei ' + p.split('/')[1], () => download(p))));
      act.append(button(r.erledigt ? 'Wieder offen' : 'Erledigt', async () => {
        await api('/rest/v1/anfragen?id=eq.' + r.id, {method: 'PATCH',
          headers: {'Content-Type': 'application/json'}, body: JSON.stringify({erledigt: !r.erledigt})});
        await load();
      }), deleteButton(r));
      return tr;
    }));
  }
  $('login').addEventListener('submit', async e => {
    e.preventDefault();
    const d = new FormData(e.target);
    try {
      token = null;
      const res = await api('/auth/v1/token?grant_type=password', {method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email: d.get('email'), password: d.get('password')})});
      token = (await res.json()).access_token;
      sessionStorage.setItem('tf_token', token);
      e.target.reset();
      await load();
    } catch (err) { $('status').textContent = 'Anmeldung fehlgeschlagen.'; console.error(err); }
  });
  // Sicherung: alle Anfragen und Dateien als eine ZIP-Datei (ohne Komprimierung)
  const crcTable = Array.from({length: 256}, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(entries) {
    const enc = new TextEncoder(), parts = [], dir = [];
    const now = new Date();
    const time = now.getHours() << 11 | now.getMinutes() << 5 | now.getSeconds() >> 1;
    const date = (now.getFullYear() - 1980) << 9 | (now.getMonth() + 1) << 5 | now.getDate();
    const record = (size, fields) => {
      const v = new DataView(new ArrayBuffer(size)); let o = 0;
      for (const [n, len] of fields) { len === 2 ? v.setUint16(o, n, true) : v.setUint32(o, n, true); o += len; }
      return new Uint8Array(v.buffer);
    };
    let offset = 0;
    for (const [name, data] of entries) {
      const n = enc.encode(name), crc = crc32(data), len = data.length;
      const head = record(30, [[0x04034b50,4],[20,2],[0x0800,2],[0,2],[time,2],[date,2],[crc,4],[len,4],[len,4],[n.length,2],[0,2]]);
      dir.push(record(46, [[0x02014b50,4],[20,2],[20,2],[0x0800,2],[0,2],[time,2],[date,2],[crc,4],[len,4],[len,4],
        [n.length,2],[0,2],[0,2],[0,2],[0,2],[0,4],[offset,4]]), n);
      parts.push(head, n, data);
      offset += head.length + n.length + len;
    }
    const size = dir.reduce((s, p) => s + p.length, 0);
    const end = record(22, [[0x06054b50,4],[0,2],[0,2],[entries.length,2],[entries.length,2],[size,4],[offset,4],[0,2]]);
    return new Blob([...parts, ...dir, end], {type: 'application/zip'});
  }
  function csv(rows) {
    const cols = ['created_at','erledigt','quelle','name','email','telefon','leistung','von_sprache','nach_sprache','termin','ort','nachricht','dateien','id'];
    const cell = v => {
      let s = Array.isArray(v) ? v.join(', ') : String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;      // keine Formeln aus fremden Eingaben
      return '"' + s.replace(/"/g, '""') + '"';
    };
    return '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => cell(r[c])).join(';'))].join('\r\n');
  }
  async function backup() {
    const rows = [];
    for (let from = 0; ; from += 500) {
      const page = await (await api(`/rest/v1/anfragen?select=*&order=created_at.desc,id&limit=500&offset=${from}`)).json();
      rows.push(...page);
      if (page.length < 500) break;
    }
    const enc = new TextEncoder(), errors = [];
    const entries = [['anfragen.csv', enc.encode(csv(rows))], ['anfragen.json', enc.encode(JSON.stringify(rows, null, 2))]];
    const paths = rows.flatMap(r => r.dateien || []);
    for (const [i, p] of paths.entries()) {
      $('status').textContent = `Sicherung läuft … Datei ${i + 1} von ${paths.length}`;
      try {
        const res = await api('/storage/v1/object/authenticated/dokumente/' + p);
        entries.push(['dateien/' + p, new Uint8Array(await res.arrayBuffer())]);
      } catch (e) {
        if (!token) throw e;
        errors.push(p + ': ' + e.message);
      }
    }
    if (errors.length) entries.push(['fehler.txt', enc.encode(errors.join('\r\n'))]);
    const a = el('a'); a.href = URL.createObjectURL(zip(entries));
    a.download = `textflows-sicherung-${new Date().toLocaleDateString('sv-SE')}.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    $('status').textContent = `Sicherung erstellt: ${rows.length} Anfragen, ${paths.length - errors.length} Dateien.` +
      (errors.length ? ` ${errors.length} Dateien fehlen (siehe fehler.txt).` : '');
  }
  $('backup').onclick = () => {
    $('backup').disabled = true;
    backup().catch(e => $('status').textContent = 'Sicherung fehlgeschlagen: ' + e.message)
      .finally(() => $('backup').disabled = false);
  };
  $('reload').onclick = () => load().catch(e => $('status').textContent = e.message);
  $('logout').onclick = logout;
  if (token) load().catch(logout);
})();
