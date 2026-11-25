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
  $('reload').onclick = () => load().catch(e => $('status').textContent = e.message);
  $('logout').onclick = logout;
  if (token) load().catch(logout);
})();
