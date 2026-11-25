(() => {
  const OK = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
  const TYPES = {pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png'};
  const FAIL = 'Senden fehlgeschlagen. Bitte schreiben Sie an info@textflows.de oder per WhatsApp: 0176 316 188 33.';

  const uuid = () => crypto.randomUUID ? crypto.randomUUID() :
    '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

  async function send(path, options) {
    const url = TF.url.replace(/\/$/, '');
    const res = await fetch(url + path, {...options, headers: {apikey: TF.key, ...options.headers}});
    if (!res.ok) throw new Error(res.status + ' ' + await res.text());
  }

  document.querySelectorAll('form[data-quelle]').forEach(form => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const status = form.querySelector('.status');
      const button = form.querySelector('button');
      const d = new FormData(form);
      if (d.get('website')) return;               // Spam-Falle
      const files = [...form.elements.dateien.files];
      const ext = f => f.name.split('.').pop().toLowerCase();
      if (files.length > 5 || files.some(f => f.size > 10 * 1048576 || !OK.includes(ext(f)))) {
        status.textContent = 'Bitte max. 5 Dateien (PDF, Word, JPG, PNG), je höchstens 10 MB.';
        return;
      }
      button.disabled = true;
      status.textContent = 'Wird gesendet …';
      try {
        const id = uuid(), paths = [];
        for (const [i, f] of files.entries()) {
          const path = `${id}/${i + 1}.${ext(f)}`;
          await send('/storage/v1/object/dokumente/' + path,
            {method: 'POST', headers: {'Content-Type': TYPES[ext(f)]}, body: f});
          paths.push(path);
        }
        const t = k => (d.get(k) || '').trim() || null;
        const name = t('name') || [t('vorname'), t('nachname')].filter(Boolean).join(' ') || null;
        await send('/rest/v1/anfragen', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', Prefer: 'return=minimal'},
          body: JSON.stringify({id, quelle: form.dataset.quelle, name, email: t('email'),
            telefon: t('telefon'), nachricht: t('nachricht'), leistung: t('leistung'),
            von_sprache: t('von_sprache'), nach_sprache: t('nach_sprache'),
            termin: t('termin'), ort: t('ort'), dateien: paths})
        });
        // E-Mail-Hinweis ohne persoenliche Daten
        fetch('https://formsubmit.co/ajax/info@textflows.de', {
          method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
          body: JSON.stringify({_subject: 'Neue Anfrage über die Website',
            Hinweis: 'Bitte im Panel ansehen: https://www.textflows.de/panel'})
        }).catch(() => {});
        form.reset();
        status.textContent = 'Vielen Dank! Ihre Anfrage ist angekommen.';
      } catch (err) {
        console.error(err);
        status.textContent = FAIL;
      }
      button.disabled = false;
    });
  });
})();
