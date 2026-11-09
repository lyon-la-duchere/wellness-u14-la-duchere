(function () {
  const runtime = window.WellnessRuntime;
  if (!runtime?.configured || !runtime.client) return;

  const client = runtime.client;
  const token = runtime.token;
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const one = (selector, root = document) => root.querySelector(selector);
  const many = (selector, root = document) => [...root.querySelectorAll(selector)];
  const dateText = (value) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${value}T12:00:00`));

  if (token) {
    const form = one('#player-questionnaire');
    const message = one('#player-message');
    const submit = one('.player-submit');
    const answers = {};
    form.onsubmit = null;
    submit.disabled = true;
    message.textContent = 'Chargement du questionnaire…';

    client.functions.invoke('get-questionnaire', { body: { token } }).then(({ data, error }) => {
      if (error || !Array.isArray(data?.questions) || !data.questions.length) {
        one('#player-questions').replaceChildren();
        message.textContent = 'Ce lien est invalide, expiré ou déjà utilisé. Préviens le staff.';
        return;
      }

      const questions = data.questions;
      one('.player-card .eyebrow').textContent = `SÉANCE · ${dateText(data.sessionDate)}`;
      one('.player-card h1').textContent = data.title;
      one('.player-card > p:not(.eyebrow)').textContent = 'Réponds selon ton ressenti. Tes réponses sont transmises au staff et ne sont pas visibles par les autres joueurs.';
      one('#player-questions').innerHTML = questions.map((question, index) => {
        const required = question.required ? ' · obligatoire' : ' · facultatif';
        let control = '';
        if (question.type === 'scale') {
          const values = Array.from({ length: question.scaleMax - question.scaleMin + 1 }, (_, offset) => question.scaleMin + offset);
          control = `<div class="player-ratings" data-question="${html(question.id)}" role="radiogroup" aria-label="${html(question.prompt)}">${values.map((value) => `<button class="player-rating" type="button" data-value="${value}" aria-pressed="false" aria-label="Note ${value}">${value}</button>`).join('')}</div><small>${html(question.minLabel)} <span aria-hidden="true">→</span> ${html(question.maxLabel)}</small>`;
        } else if (question.type === 'short_text') {
          control = `<textarea class="player-answer-text" data-question="${html(question.id)}" maxlength="500" rows="2" aria-label="${html(question.prompt)}"></textarea>`;
        } else if (question.type === 'single_choice') {
          control = `<select class="player-answer-choice" data-question="${html(question.id)}" aria-label="${html(question.prompt)}"><option value="">Choisir une réponse</option>${question.options.map((option) => `<option value="${html(option)}">${html(option)}</option>`).join('')}</select>`;
        }
        return `<fieldset class="player-question"><legend>0${index + 1} · ${html(question.prompt)}${required}</legend>${question.helpText ? `<p>${html(question.helpText)}</p>` : ''}${control}</fieldset>`;
      }).join('');
      one('#player-note')?.remove();

      many('.player-ratings').forEach((group) => group.addEventListener('click', (event) => {
        const button = event.target.closest('.player-rating');
        if (!button) return;
        answers[group.dataset.question] = Number(button.dataset.value);
        many('.player-rating', group).forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      }));
      many('.player-answer-text').forEach((field) => field.addEventListener('input', () => {
        answers[field.dataset.question] = field.value;
      }));
      many('.player-answer-choice').forEach((field) => field.addEventListener('change', () => {
        answers[field.dataset.question] = field.value;
      }));
      submit.disabled = false;
      message.textContent = '';

      form.onsubmit = async (event) => {
        event.preventDefault();
        const missing = questions.some((question) => question.required
          && (answers[question.id] === undefined || answers[question.id] === null || answers[question.id] === ''));
        if (missing) {
          message.textContent = 'Réponds aux questions obligatoires avant l’envoi.';
          return;
        }
        submit.disabled = true;
        message.textContent = 'Envoi en cours…';
        const result = await client.functions.invoke('submit-wellness', { body: { token, answers } });
        if (result.error) {
          submit.disabled = false;
          message.textContent = 'Envoi impossible. Vérifie ton lien ou préviens le staff.';
          return;
        }
        one('.player-card').innerHTML = '<div class="player-thanks"><p class="eyebrow">RÉPONSE ENREGISTRÉE</p><h1>Merci, c’est envoyé.</h1><p>Tu peux fermer cette page.</p></div>';
      };
      window.WellnessPlayerReady = true;
    });
    return;
  }

  const login = one('#admin-login');
  if (!login) return;
  let admin = { players: [], questions: [], sessions: [], responses: [] };
  let activeTab = 'sessions';
  let selectedSessionId = '';
  let showArchivedPlayers = false;
  let messageTimer;

  const css = document.createElement('style');
  css.textContent = `
    #secure-admin{min-height:100vh;background:#f3f5ef;color:#1d2c26;font-family:'DM Sans','Segoe UI',sans-serif}
    .secure-header{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 28px;background:#fff;border-bottom:1px solid #e2e8e1}
    .secure-brand{display:flex;align-items:center;gap:10px}.secure-brand img{width:38px;height:38px;object-fit:contain}.secure-brand strong{font-size:11px;letter-spacing:.7px;color:#8e1b2c}
    .secure-header-actions{display:flex;align-items:center;gap:8px}.secure-nav{display:flex;gap:4px;padding:0 28px;background:#fff;border-bottom:1px solid #e2e8e1}
    .secure-nav button{border:0;background:transparent;padding:13px 12px;color:#6d7971;font-size:12px;border-bottom:2px solid transparent}.secure-nav button.active{color:#8e1b2c;border-color:#8e1b2c;font-weight:600}
    .secure-content{max-width:1180px;margin:0 auto;padding:27px 24px 42px}.secure-title{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px}.secure-title h1{font-size:28px;margin:0}.secure-title p{margin:6px 0 0;color:#7d8981;font-size:12px}
    .secure-panel{background:white;border:1px solid #e2e8e1;padding:18px;margin-bottom:14px}.secure-table{width:100%;border-collapse:collapse;text-align:left}.secure-table th{padding:10px 8px;border-bottom:1px solid #e2e8e1;color:#859087;font:9px 'Space Mono',monospace;text-transform:uppercase}.secure-table td{padding:11px 8px;border-bottom:1px solid #edf0ec;font-size:12px;vertical-align:middle}.secure-table tr:last-child td{border-bottom:0}.secure-actions{display:flex;gap:6px;flex-wrap:wrap}.secure-small{min-height:30px;padding:0 9px;font-size:10px}.secure-muted{color:#839087;font-size:11px}.secure-tag{display:inline-block;padding:4px 7px;background:#f5edcf;color:#756126;font-size:9px}.secure-stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}.secure-stat{background:#fff;border:1px solid #e2e8e1;padding:14px}.secure-stat span{display:block;color:#839087;font:9px 'Space Mono',monospace}.secure-stat strong{display:block;margin-top:8px;font:22px 'Space Mono',monospace}
    .secure-dialog{width:min(560px,calc(100vw - 28px));max-height:88vh;overflow:auto;border:0;padding:0;box-shadow:0 20px 70px #102f2833}.secure-dialog::backdrop{background:#102f2877}.secure-dialog form,.secure-dialog-content{padding:22px}.secure-dialog h2{margin:0 0 6px;font-size:20px}.secure-dialog p{color:#748177;font-size:12px}.secure-field{display:grid;gap:6px;margin:12px 0;color:#58665d;font-size:11px}.secure-field input,.secure-field select,.secure-field textarea{width:100%;min-height:38px;border:1px solid #e2e8e1;background:#fff;padding:8px 10px}.secure-field textarea{resize:vertical}.secure-check{display:flex;align-items:center;gap:8px;margin:12px 0;color:#59665d;font-size:11px}.secure-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.secure-error{color:#a84433!important;min-height:16px}.secure-toast{position:fixed;right:20px;bottom:20px;padding:12px 16px;background:#281d20;color:white;font-size:12px;opacity:0;pointer-events:none;transition:opacity .2s}.secure-toast.show{opacity:1}.invite-row{display:grid;grid-template-columns:145px minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid #e2e8e1}.invite-row input{min-width:0;height:34px;border:1px solid #e2e8e1;padding:0 7px;font-size:10px}.invite-row button{height:34px;border:0;background:#8e1b2c;color:white;padding:0 10px;font-size:10px}
+    @media(max-width:700px){.secure-header{padding:12px 14px}.secure-nav{padding:0 10px;overflow:auto}.secure-nav button{white-space:nowrap;padding:12px 9px}.secure-content{padding:20px 12px}.secure-title{align-items:flex-start;flex-direction:column}.secure-title h1{font-size:24px}.secure-stat-grid{gap:6px}.secure-stat{padding:10px}.secure-stat span{font-size:7px}.secure-stat strong{font-size:17px}.secure-panel{padding:12px 9px}.invite-row{grid-template-columns:1fr auto}.invite-row input{grid-column:1/-1;grid-row:2}}
+  `;
  document.head.append(css);

  function toast(text) {
    let node = one('#secure-toast');
    if (!node) {
      document.body.insertAdjacentHTML('beforeend', '<div id="secure-toast" class="secure-toast" role="status"></div>');
      node = one('#secure-toast');
    }
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => node.classList.remove('show'), 2600);
  }

  async function loadAdmin() {
    const [players, questions, sessions, responses] = await Promise.all([
      client.from('players').select('id,display_name,position,shirt_number,active,created_at').order('display_name'),
      client.from('questionnaire_questions').select('id,prompt,help_text,question_type,required,scale_min,scale_max,min_label,max_label,options,sort_order,active').order('sort_order'),
      client.from('sessions').select('id,title,session_date,status,form_snapshot,created_at').order('created_at', { ascending: false }),
      client.from('wellness_responses').select('id,session_id,player_id,answers,note,submitted_at').order('submitted_at', { ascending: false }),
    ]);
    const error = players.error || questions.error || sessions.error || responses.error;
    if (error) throw error;
    admin = { players: players.data || [], questions: questions.data || [], sessions: sessions.data || [], responses: responses.data || [] };
    if (!selectedSessionId || !admin.sessions.some((session) => session.id === selectedSessionId)) {
      selectedSessionId = admin.sessions[0]?.id || '';
    }
  }

  function openAdmin() {
    one('.access-screen')?.remove();
    one('.shell').hidden = true;
    let root = one('#secure-admin');
    if (!root) {
      document.body.insertAdjacentHTML('beforeend', `<div id="secure-admin"><header class="secure-header"><div class="secure-brand"><img src="https://www.lyonladuchere.fr/app/uploads/2023/08/logo.svg" alt=""><strong>LA DUCHÈRE · U14</strong></div><div class="secure-header-actions"><span class="secure-tag">ADMIN</span><button class="btn secure-small" id="secure-logout" type="button">Déconnexion</button></div></header><nav class="secure-nav" aria-label="Administration"><button data-tab="sessions">Séances & réponses</button><button data-tab="questions">Questionnaire</button><button data-tab="players">Effectif</button></nav><main class="secure-content" id="secure-content"></main></div>`);
      root = one('#secure-admin');
      root.addEventListener('click', handleAction);
      many('.secure-nav button', root).forEach((button) => button.addEventListener('click', () => {
        activeTab = button.dataset.tab;
        renderAdmin();
      }));
      one('#secure-logout').onclick = async () => {
        await client.auth.signOut();
        location.reload();
      };
    }
    renderAdmin();
  }

  function renderAdmin() {
    many('.secure-nav button').forEach((button) => button.classList.toggle('active', button.dataset.tab === activeTab));
    const content = one('#secure-content');
    if (activeTab === 'questions') content.innerHTML = renderQuestions();
    else if (activeTab === 'players') content.innerHTML = renderPlayers();
    else content.innerHTML = renderSessions();
  }

  function renderSessions() {
    const selected = admin.sessions.find((session) => session.id === selectedSessionId);
    const responseCount = selected ? admin.responses.filter((response) => response.session_id === selected.id).length : 0;
    const playersActive = admin.players.filter((player) => player.active).length;
    const scaleQuestions = selected?.form_snapshot?.filter((question) => question.type === 'scale') || [];
    const averages = scaleQuestions.map((question) => {
      const values = admin.responses.filter((response) => response.session_id === selected.id)
        .map((response) => Number(response.answers?.[question.id])).filter(Number.isFinite);
      const average = values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : '—';
      return `<span>${html(question.prompt)} · ${average}</span>`;
    }).join('');
    const rows = admin.sessions.map((session) => {
      const count = admin.responses.filter((response) => response.session_id === session.id).length;
      return `<tr><td><strong>${html(session.title)}</strong></td><td>${dateText(session.session_date)}</td><td>${count} / ${playersActive}</td><td><span class="secure-tag">${session.status === 'open' ? 'Ouverte' : 'Clôturée'}</span></td><td><div class="secure-actions"><button class="btn secure-small" data-action="view-session" data-id="${html(session.id)}">Réponses</button>${session.status === 'open' ? `<button class="btn button-secondary secure-small" data-action="close-session" data-id="${html(session.id)}">Clôturer</button>` : ''}</div></td></tr>`;
    }).join('');
    return `<div class="secure-title"><div><p class="eyebrow">SUIVI U14 · LYON - LA DUCHÈRE</p><h1>Séances & réponses</h1><p>Les réponses et synthèses ne sont visibles que par ton compte admin.</p></div><button class="btn" data-action="new-session">+ Nouvelle séance</button></div><div class="secure-stat-grid"><article class="secure-stat"><span>SÉANCES CONSERVÉES</span><strong>${admin.sessions.length}</strong></article><article class="secure-stat"><span>RÉPONSES · SÉANCE SÉLECTIONNÉE</span><strong>${responseCount} / ${playersActive}</strong></article><article class="secure-stat"><span>MOYENNES PAR ÉCHELLE</span><strong>${scaleQuestions.length || '—'}</strong></article></div>${selected ? `<section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">SYNTHÈSE · ${dateText(selected.session_date)}</p><h2>${html(selected.title)}</h2></div><button class="btn button-secondary secure-small" data-action="view-session" data-id="${html(selected.id)}">Voir le détail</button></div><div class="secure-muted">${averages || 'Aucune question à échelle dans cette séance.'}</div></section>` : '<section class="secure-panel secure-muted">Aucune séance. Crée une séance pour envoyer le questionnaire à l’effectif.</section>'}<section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">HISTORIQUE</p><h2>Séances précédentes</h2></div></div><div class="tablewrap"><table class="secure-table"><thead><tr><th>SÉANCE</th><th>DATE</th><th>RÉPONSES</th><th>ÉTAT</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="secure-muted">Aucune séance enregistrée.</td></tr>'}</tbody></table></div></section>`;
  }

  function renderQuestions() {
    const active = admin.questions.filter((question) => question.active);
    const archived = admin.questions.filter((question) => !question.active);
    const row = (question, index, list) => `<tr><td>${index + 1}</td><td><strong>${html(question.prompt)}</strong><div class="secure-muted">${html(question.help_text)}</div></td><td>${question.question_type === 'scale' ? `Échelle ${question.scale_min}–${question.scale_max}` : question.question_type === 'short_text' ? 'Texte court' : 'Choix unique'}</td><td>${question.required ? 'Obligatoire' : 'Facultative'}</td><td><div class="secure-actions"><button class="btn button-secondary secure-small" data-action="edit-question" data-id="${html(question.id)}">Modifier</button>${question.active ? `<button class="btn button-secondary secure-small" data-action="move-question" data-id="${html(question.id)}" data-direction="-1" ${index===0?'disabled':''}>↑</button><button class="btn button-secondary secure-small" data-action="move-question" data-id="${html(question.id)}" data-direction="1" ${index===list.length-1?'disabled':''}>↓</button><button class="btn secure-small" data-action="archive-question" data-id="${html(question.id)}">Retirer</button>` : `<button class="btn secure-small" data-action="restore-question" data-id="${html(question.id)}">Restaurer</button>`}</div></td></tr>`;
    return `<div class="secure-title"><div><p class="eyebrow">MODÈLE DES PROCHAINES SÉANCES</p><h1>Questionnaire</h1><p>Les séances déjà créées gardent leurs questions d’origine.</p></div><button class="btn" data-action="new-question">+ Ajouter une question</button></div><section class="secure-panel"><div class="tablewrap"><table class="secure-table"><thead><tr><th>#</th><th>QUESTION</th><th>TYPE</th><th>RÉPONSE</th><th></th></tr></thead><tbody>${active.map((question,index)=>row(question,index,active)).join('') || '<tr><td colspan="5" class="secure-muted">Ajoute au moins une question pour créer une séance.</td></tr>'}</tbody></table></div></section>${archived.length ? `<section class="secure-panel"><p class="eyebrow">QUESTIONS RETIRÉES · CONSERVÉES DANS LES ANCIENNES SÉANCES</p><div class="tablewrap"><table class="secure-table"><tbody>${archived.map((question,index)=>row(question,index,archived)).join('')}</tbody></table></div></section>` : ''}`;
  }

  function renderPlayers() {
    const players = admin.players.filter((player) => player.active !== showArchivedPlayers);
    const rows = players.map((player) => `<tr><td><strong>${html(player.display_name)}</strong></td><td>${html(player.shirt_number ?? '—')}</td><td>${html(player.position || '—')}</td><td><div class="secure-actions"><button class="btn button-secondary secure-small" data-action="edit-player" data-id="${html(player.id)}">Modifier la fiche</button><button class="btn ${player.active ? 'button-secondary' : ''} secure-small" data-action="${player.active ? 'archive-player' : 'restore-player'}" data-id="${html(player.id)}">${player.active ? 'Retirer de l’effectif' : 'Réintégrer'}</button></div></td></tr>`).join('');
    return `<div class="secure-title"><div><p class="eyebrow">EFFECTIF DU GROUPE</p><h1>Joueurs U14</h1><p>Retirer un joueur l’archive de l’effectif sans effacer ses anciennes réponses.</p></div><button class="btn" data-action="new-player">+ Ajouter un joueur</button></div><section class="secure-panel"><div class="secure-actions" style="margin-bottom:12px"><button class="btn ${!showArchivedPlayers?'':'button-secondary'} secure-small" data-action="show-active">Effectif actif</button><button class="btn ${showArchivedPlayers?'':'button-secondary'} secure-small" data-action="show-archived">Joueurs retirés</button></div><div class="tablewrap"><table class="secure-table"><thead><tr><th>JOUEUR</th><th>N°</th><th>POSTE</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="secure-muted">Aucun joueur dans cette liste.</td></tr>'}</tbody></table></div></section>`;
  }

  function renderHistory(sessionId) {
    const session = admin.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const questions = Array.isArray(session.form_snapshot) ? session.form_snapshot : [];
    const responses = admin.responses.filter((response) => response.session_id === session.id);
    selectedSessionId = session.id;
    const playerById = new Map(admin.players.map((player) => [player.id, player]));
    const headers = questions.map((question) => `<th>${html(question.prompt)}</th>`).join('');
    const rows = responses.map((response) => {
      const player = playerById.get(response.player_id);
      const sentAt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(response.submitted_at));
      const cells = questions.map((question) => `<td>${html(response.answers?.[question.id] ?? '—')}</td>`).join('');
      return `<tr><td><strong>${html(player?.display_name || 'Joueur retiré')}</strong></td>${cells}<td>${html(response.note || '—')}</td><td>${sentAt}</td></tr>`;
    }).join('');
    one('#secure-content').innerHTML = `<div class="secure-title"><div><p class="eyebrow">${dateText(session.session_date)} · ${session.status === 'open' ? 'OUVERTE' : 'CLÔTURÉE'}</p><h1>${html(session.title)}</h1><p>${responses.length} réponse${responses.length === 1 ? '' : 's'} enregistrée${responses.length === 1 ? '' : 's'}</p></div><button class="btn button-secondary" data-action="back-sessions">Retour aux séances</button></div><section class="secure-panel"><div class="tablewrap"><table class="secure-table"><thead><tr><th>JOUEUR</th>${headers}<th>NOTE AU STAFF</th><th>ENVOYÉ LE</th></tr></thead><tbody>${rows || `<tr><td colspan="${questions.length + 3}" class="secure-muted">Aucune réponse reçue pour cette séance.</td></tr>`}</tbody></table></div></section>`;
  }

  function openDialog(markup) {
    const old = one('#secure-dialog');
    old?.remove();
    document.body.insertAdjacentHTML('beforeend', `<dialog id="secure-dialog" class="secure-dialog">${markup}</dialog>`);
    const dialog = one('#secure-dialog');
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="close-dialog"]')) dialog.close();
    });
    dialog.showModal();
    return dialog;
  }

  function openSessionDialog() {
    const dialog = openDialog(`<form id="create-session-form"><h2>Nouvelle séance U14</h2><p>Un lien de réponse individuel sera créé pour chaque joueur actif.</p><label class="secure-field">Nom de la séance<input name="title" required maxlength="80" placeholder="Ex. Entraînement collectif"></label><label class="secure-field">Date<input name="session_date" type="date" required value="${new Date().toLocaleDateString('sv-SE')}"></label><p class="secure-error" id="dialog-error" role="alert"></p><div class="secure-dialog-actions"><button class="btn button-secondary" type="button" data-action="close-dialog">Annuler</button><button class="btn" type="submit">Créer et préparer les liens</button></div></form>`);
    one('#create-session-form', dialog).onsubmit = async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const { data, error } = await client.functions.invoke('create-session-links', { body: { title: formData.get('title'), sessionDate: formData.get('session_date') } });
      if (error || !data?.links) {
        one('#dialog-error', dialog).textContent = data?.error || 'Impossible de créer la séance. Vérifie les joueurs et les questions.';
        return;
      }
      dialog.close();
      await loadAdmin();
      activeTab = 'sessions';
      renderAdmin();
      openInviteDialog(data.links, data.session.title);
    };
  }

  function openInviteDialog(links, title) {
    const dialog = openDialog(`<div class="secure-dialog-content"><h2>${html(title)} · liens joueurs</h2><p>Chaque lien est personnel, à usage unique et ne donne aucun accès aux réponses.</p><div id="secure-invites"></div><div class="secure-dialog-actions"><button class="btn" type="button" data-action="close-dialog">Terminé</button></div></div>`);
    const list = one('#secure-invites', dialog);
    links.forEach((invite) => {
      const row = document.createElement('div');
      row.className = 'invite-row';
      const name = document.createElement('strong');
      name.textContent = invite.playerName;
      const link = document.createElement('input');
      link.readOnly = true;
      link.value = invite.url;
      link.setAttribute('aria-label', `Lien questionnaire ${invite.playerName}`);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copier';
      copy.onclick = async () => {
        await navigator.clipboard.writeText(invite.url);
        copy.textContent = 'Copié';
      };
      row.append(name, link, copy);
      list.append(row);
    });
  }

  function openQuestionDialog(question) {
    const editing = !!question;
    const selectedType = question?.question_type || 'scale';
    const dialog = openDialog(`<form id="question-form"><h2>${editing ? 'Modifier la question' : 'Ajouter une question'}</h2><label class="secure-field">Question<input name="prompt" required maxlength="180" value="${html(question?.prompt || '')}" placeholder="Ex. Comment évalues-tu ton sommeil ?"></label><label class="secure-field">Aide ou précision<textarea name="help_text" maxlength="240" rows="2">${html(question?.help_text || '')}</textarea></label><label class="secure-field">Type de réponse<select name="question_type"><option value="scale" ${selectedType==='scale'?'selected':''}>Échelle chiffrée</option><option value="short_text" ${selectedType==='short_text'?'selected':''}>Texte court</option><option value="single_choice" ${selectedType==='single_choice'?'selected':''}>Choix unique</option></select></label><div class="scale-fields"><label class="secure-field">Minimum<input name="scale_min" type="number" min="1" max="9" value="${question?.scale_min ?? 1}"></label><label class="secure-field">Maximum<input name="scale_max" type="number" min="2" max="10" value="${question?.scale_max ?? 5}"></label><label class="secure-field">Libellé du minimum<input name="min_label" maxlength="40" value="${html(question?.min_label || '')}"></label><label class="secure-field">Libellé du maximum<input name="max_label" maxlength="40" value="${html(question?.max_label || '')}"></label></div><label class="secure-field choice-fields" hidden>Choix (un par ligne)<textarea name="options" rows="4">${html((question?.options || []).join('\n'))}</textarea></label><label class="secure-check"><input name="required" type="checkbox" ${question?.required !== false ? 'checked' : ''}> Réponse obligatoire</label><p class="secure-error" id="dialog-error" role="alert"></p><div class="secure-dialog-actions"><button class="btn button-secondary" type="button" data-action="close-dialog">Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>`);
    const form = one('#question-form', dialog);
    const toggleType = () => {
      const type = form.elements.question_type.value;
      one('.scale-fields', form).hidden = type !== 'scale';
      one('.choice-fields', form).hidden = type !== 'single_choice';
    };
    form.elements.question_type.onchange = toggleType;
    toggleType();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const type = form.elements.question_type.value;
      const options = type === 'single_choice' ? form.elements.options.value.split('\n').map((value) => value.trim()).filter(Boolean) : [];
      const values = {
        prompt: form.elements.prompt.value.trim(),
        help_text: form.elements.help_text.value.trim(),
        question_type: type,
        required: form.elements.required.checked,
        scale_min: type === 'scale' ? Number(form.elements.scale_min.value) : null,
        scale_max: type === 'scale' ? Number(form.elements.scale_max.value) : null,
        min_label: type === 'scale' ? form.elements.min_label.value.trim() : '',
        max_label: type === 'scale' ? form.elements.max_label.value.trim() : '',
        options,
        active: question?.active ?? true,
        sort_order: question?.sort_order ?? admin.questions.length + 1,
      };
      if (type === 'scale' && (values.scale_min >= values.scale_max || values.scale_max > 10)) {
        one('#dialog-error', dialog).textContent = 'Choisis une échelle croissante entre 1 et 10.';
        return;
      }
      if (type === 'single_choice' && (options.length < 2 || options.length > 10)) {
        one('#dialog-error', dialog).textContent = 'Ajoute entre 2 et 10 choix.';
        return;
      }
      const result = editing
        ? await client.from('questionnaire_questions').update(values).eq('id', question.id)
        : await client.from('questionnaire_questions').insert(values);
      if (result.error) {
        one('#dialog-error', dialog).textContent = 'Enregistrement impossible. Vérifie les champs.';
        return;
      }
      dialog.close();
      await loadAdmin();
      renderAdmin();
    };
  }

  function openPlayerDialog(player) {
    const editing = !!player;
    const dialog = openDialog(`<form id="player-edit-form"><h2>${editing ? 'Modifier la fiche joueur' : 'Ajouter un joueur U14'}</h2><label class="secure-field">Nom et prénom<input name="display_name" required maxlength="80" value="${html(player?.display_name || '')}"></label><label class="secure-field">Poste<input name="position" maxlength="40" value="${html(player?.position || '')}" placeholder="Ex. Milieu"></label><label class="secure-field">Numéro de maillot<input name="shirt_number" type="number" min="1" max="99" value="${player?.shirt_number ?? ''}"></label><p class="secure-error" id="dialog-error" role="alert"></p><div class="secure-dialog-actions"><button class="btn button-secondary" type="button" data-action="close-dialog">Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>`);
    one('#player-edit-form', dialog).onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = { display_name: form.elements.display_name.value.trim(), position: form.elements.position.value.trim(), shirt_number: form.elements.shirt_number.value ? Number(form.elements.shirt_number.value) : null };
      const result = editing
        ? await client.from('players').update(values).eq('id', player.id)
        : await client.from('players').insert(values);
      if (result.error) {
        one('#dialog-error', dialog).textContent = 'Enregistrement impossible. Vérifie le numéro ou le nom.';
        return;
      }
      dialog.close();
      await loadAdmin();
      renderAdmin();
    };
  }

  async function handleAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === 'new-session') openSessionDialog();
    else if (action === 'new-question') openQuestionDialog();
    else if (action === 'edit-question') openQuestionDialog(admin.questions.find((item) => item.id === id));
    else if (action === 'new-player') openPlayerDialog();
    else if (action === 'edit-player') openPlayerDialog(admin.players.find((item) => item.id === id));
    else if (action === 'view-session') renderHistory(id);
    else if (action === 'back-sessions') { activeTab = 'sessions'; renderAdmin(); }
    else if (action === 'close-session') {
      const { error } = await client.from('sessions').update({ status: 'closed' }).eq('id', id);
      if (error) toast('Impossible de clôturer la séance.');
      else { await loadAdmin(); renderAdmin(); }
    } else if (action === 'archive-question' || action === 'restore-question') {
      const { error } = await client.from('questionnaire_questions').update({ active: action === 'restore-question' }).eq('id', id);
      if (error) toast('Impossible de modifier la question.');
      else { await loadAdmin(); renderAdmin(); }
    } else if (action === 'move-question') {
      const active = admin.questions.filter((item) => item.active);
      const index = active.findIndex((item) => item.id === id);
      const other = active[index + Number(button.dataset.direction)];
      if (!other) return;
      const current = active[index];
      await client.from('questionnaire_questions').update({ sort_order: other.sort_order }).eq('id', current.id);
      await client.from('questionnaire_questions').update({ sort_order: current.sort_order }).eq('id', other.id);
      await loadAdmin(); renderAdmin();
    } else if (action === 'archive-player' || action === 'restore-player') {
      const { error } = await client.from('players').update({ active: action === 'restore-player' }).eq('id', id);
      if (error) toast('Impossible de modifier l’effectif.');
      else { await loadAdmin(); renderAdmin(); }
    } else if (action === 'show-active') { showArchivedPlayers = false; renderAdmin(); }
    else if (action === 'show-archived') { showArchivedPlayers = true; renderAdmin(); }
    else if (action === 'close-dialog') one('#secure-dialog')?.close();
  }

  login.onsubmit = async (event) => {
    event.preventDefault();
    const button = one('#admin-login button');
    button.disabled = true;
    one('#login-error').textContent = '';
    const { data, error } = await client.auth.signInWithPassword({ email: one('#admin-email').value.trim(), password: one('#admin-password').value });
    if (error || !data.user) {
      one('#login-error').textContent = 'Connexion impossible.';
      button.disabled = false;
      return;
    }
    const { data: allowed, error: roleError } = await client.rpc('is_app_admin');
    if (roleError || allowed !== true) {
      await client.auth.signOut();
      one('#login-error').textContent = 'Ce compte n’est pas autorisé à consulter les réponses.';
      button.disabled = false;
      return;
    }
    try {
      await loadAdmin();
      openAdmin();
    } catch {
      await client.auth.signOut();
      one('#login-error').textContent = 'Chargement des données impossible. Vérifie le schéma et les règles Supabase.';
      button.disabled = false;
    }
  };
  client.auth.getSession().then(async ({ data }) => {
    if (!data.session) return;
    const { data: allowed, error } = await client.rpc('is_app_admin');
    if (error || allowed !== true) {
      await client.auth.signOut();
      return;
    }
    try {
      await loadAdmin();
      openAdmin();
    } catch {
      await client.auth.signOut();
      one('#login-error').textContent = 'Chargement des données impossible.';
    }
  });
  window.WellnessAdminReady = true;
})();
