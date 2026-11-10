(function () {
  const runtime = window.WellnessRuntime;
  if (!runtime?.configured || !runtime.client) return;

  const client = runtime.client;
  const sharedToken = typeof runtime.token === 'string' && runtime.token.startsWith('s-') ? runtime.token.slice(2) : null;
  const token = sharedToken ? null : runtime.token;
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const one = (selector, root = document) => root.querySelector(selector);
  const many = (selector, root = document) => [...root.querySelectorAll(selector)];
  const dateText = (value) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${value}T12:00:00`));

  if (token || sharedToken) {
    const form = one('#player-questionnaire');
    const message = one('#player-message');
    const submit = one('.player-submit');
    const playerCss = document.createElement('style');
    playerCss.textContent = `.shared-player-select{display:grid;gap:7px;margin:16px 0;color:#58665d;font-size:12px}.shared-player-select select,.player-answer-number,.player-answer-choice,.player-answer-text{box-sizing:border-box;width:100%;min-height:42px;border:1px solid #e2e8e1;background:#fff;padding:9px 11px;color:#1d2c26}.player-questionnaire-section{margin-top:22px;padding-top:18px;border-top:1px solid #e2e8e1}.player-questionnaire-section h2{margin:4px 0 6px;font-size:19px}.player-questionnaire-section>p{margin:0 0 14px;color:#748177;font-size:12px}.player-questionnaire-section .formbox{margin-top:10px}`;
    document.head.append(playerCss);
    form.onsubmit = null;
    submit.disabled = true;
    message.textContent = 'Chargement du questionnaire…';

    client.functions.invoke('get-questionnaire', { body: sharedToken ? { sharedToken } : { token } }).then(({ data, error }) => {
      if (error || !Array.isArray(data?.questions) || !data.questions.length) {
        one('#player-questions').replaceChildren();
        message.textContent = 'Ce lien est invalide, expiré ou déjà utilisé. Préviens le staff.';
        return;
      }

      const wellnessQuestions = data.questions;
      const workloadQuestions = sharedToken && Array.isArray(data.workloadQuestions)
        ? data.workloadQuestions.filter((question) => question.metricKey !== 'duration_minutes')
        : [];
      one('.player-card .eyebrow').textContent = `SÉANCE · ${dateText(data.sessionDate)}`;
      one('.player-card h1').textContent = data.title;
      one('.player-card > p:not(.eyebrow)').textContent = sharedToken
        ? 'Choisis ton prénom et complète séparément le questionnaire wellness et le questionnaire de charge.'
        : 'Réponds selon ton ressenti. Tes réponses sont transmises au staff et ne sont pas visibles par les autres joueurs.';
      if (sharedToken) {
        const playerOptions = data.players.map((player) => `<option value="${html(player.id)}">${html(player.display_name)}</option>`).join('');
        one('.player-card > p:not(.eyebrow)').insertAdjacentHTML('afterend', `<label class="shared-player-select" for="shared-player">Ton prénom<select id="shared-player" required><option value="">Choisir ton prénom</option>${playerOptions}</select></label>`);
        form.insertAdjacentHTML('afterend', `<section class="player-questionnaire-section" id="workload-section"><p class="eyebrow">QUESTIONNAIRE 2 · APRÈS LA SÉANCE</p><h2>Charge de travail</h2><p>Évalue l'effort global ressenti pendant la séance.</p><form class="formbox" id="workload-questionnaire"><div id="workload-questions"></div><p class="player-message" id="workload-message" role="status"></p><button class="btn player-submit" id="workload-submit" type="submit">Envoyer ma charge →</button></form></section>`);
      }
      function markupFor(questions, kind) {
        return questions.map((question, index) => {
          let control = '';
          if (question.type === 'scale') {
            const values = Array.from({ length: question.scaleMax - question.scaleMin + 1 }, (_, offset) => question.scaleMin + offset);
            control = `<div class="player-ratings" data-kind="${kind}" data-question="${html(question.id)}" role="radiogroup" aria-label="${html(question.prompt)}">${values.map((value) => `<button class="player-rating" type="button" data-value="${value}" aria-pressed="false" aria-label="Note ${value}">${value}</button>`).join('')}</div><small>${html(question.minLabel)} <span aria-hidden="true">→</span> ${html(question.maxLabel)}</small>`;
          } else if (question.type === 'number') {
            const duration = question.metricKey === 'duration_minutes';
            control = `<input class="player-answer-number" data-kind="${kind}" data-question="${html(question.id)}" type="number" min="${duration ? 1 : 0}" max="${duration ? 300 : 1000}" step="1" inputmode="numeric" aria-label="${html(question.prompt)}">`;
          } else if (question.type === 'short_text') {
            control = `<textarea class="player-answer-text" data-kind="${kind}" data-question="${html(question.id)}" maxlength="500" rows="2" aria-label="${html(question.prompt)}"></textarea>`;
          } else if (question.type === 'single_choice') {
            control = `<select class="player-answer-choice" data-kind="${kind}" data-question="${html(question.id)}" aria-label="${html(question.prompt)}"><option value="">Choisir une réponse</option>${question.options.map((option) => `<option value="${html(option)}">${html(option)}</option>`).join('')}</select>`;
          }
          return `<fieldset class="player-question"><legend>0${index + 1} · ${html(question.prompt)}</legend>${question.helpText ? `<p>${html(question.helpText)}</p>` : ''}${control}</fieldset>`;
        }).join('');
      }

      one('#player-questions').innerHTML = markupFor(wellnessQuestions, 'wellness');
      one('#player-note', form)?.remove();
      if (sharedToken) one('#workload-questions').innerHTML = markupFor(workloadQuestions, 'workload');

      const answers = { wellness: {}, workload: {} };
      const forms = {
        wellness: { form, questions: wellnessQuestions, button: submit, message },
        workload: sharedToken ? {
          form: one('#workload-questionnaire'),
          questions: workloadQuestions,
          button: one('#workload-submit'),
          message: one('#workload-message'),
        } : null,
      };

      function syncPlayerState() {
        const player = data.players?.find((item) => item.id === one('#shared-player')?.value);
        for (const [kind, setup] of Object.entries(forms)) {
          if (!setup) continue;
          const done = kind === 'wellness' ? player?.wellnessDone : player?.workloadDone;
          setup.form.querySelectorAll('input,select,textarea,button.player-rating').forEach((control) => {
            control.disabled = !player || !!done;
          });
          setup.button.disabled = !player || !!done;
          setup.message.textContent = done ? 'Déjà rempli, merci.' : '';
        }
        if (player && player.wellnessDone && player.workloadDone) message.textContent = 'Les deux questionnaires sont remplis. Merci !';
        else message.textContent = '';
      }

      if (sharedToken) {
        one('#shared-player').addEventListener('change', () => {
          answers.wellness = {};
          answers.workload = {};
          form.querySelectorAll('.player-rating').forEach((button) => button.setAttribute('aria-pressed', 'false'));
          one('#workload-questionnaire').querySelectorAll('.player-rating').forEach((button) => button.setAttribute('aria-pressed', 'false'));
          form.querySelectorAll('textarea,input,select').forEach((field) => { if (field.id !== 'shared-player') field.value = ''; });
          one('#workload-questionnaire').querySelectorAll('textarea,input,select').forEach((field) => { field.value = ''; });
          syncPlayerState();
        });
        syncPlayerState();
      } else {
        submit.disabled = false;
      }

      many('.player-ratings').forEach((group) => group.addEventListener('click', (event) => {
        const button = event.target.closest('.player-rating');
        if (!button) return;
        answers[group.dataset.kind][group.dataset.question] = Number(button.dataset.value);
        many('.player-rating', group).forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      }));
      many('.player-answer-text,.player-answer-number').forEach((field) => field.addEventListener('input', () => {
        answers[field.dataset.kind][field.dataset.question] = field.value;
      }));
      many('.player-answer-choice').forEach((field) => field.addEventListener('change', () => {
        answers[field.dataset.kind][field.dataset.question] = field.value;
      }));

      for (const [kind, setup] of Object.entries(forms)) {
        if (!setup) continue;
        setup.form.onsubmit = async (event) => {
          event.preventDefault();
          const missing = setup.questions.some((question) => question.required
            && (answers[kind][question.id] === undefined || answers[kind][question.id] === null || answers[kind][question.id] === ''));
          if (missing) {
            setup.message.textContent = 'Réponds à toutes les questions avant l’envoi.';
            return;
          }
          const selectedPlayer = sharedToken ? one('#shared-player').value : null;
          if (sharedToken && !selectedPlayer) {
            message.textContent = 'Choisis ton prénom avant l’envoi.';
            return;
          }
          const buttonLabel = setup.button.textContent;
          setup.button.disabled = true;
          setup.message.textContent = 'Envoi en cours…';
          const body = sharedToken
            ? { sharedToken, playerId: selectedPlayer, questionnaire: kind, answers: answers[kind] }
            : { token, questionnaire: kind, answers: answers[kind] };
          const result = await client.functions.invoke('submit-wellness', { body });
          if (result.error) {
            setup.button.disabled = false;
            setup.message.textContent = result.data?.error || 'Envoi impossible. Préviens le staff.';
            return;
          }
          setup.button.textContent = 'Envoyé';
          setup.message.textContent = 'Réponses enregistrées.';
          const player = data.players?.find((item) => item.id === selectedPlayer);
          if (player) {
            if (kind === 'wellness') player.wellnessDone = true;
            else player.workloadDone = true;
            syncPlayerState();
          }
        };
      }
      window.WellnessPlayerReady = true;
    });
    return;
  }

  const login = one('#admin-login');
  if (!login) return;
  let admin = { players: [], questions: [], workloadQuestions: [], sessions: [], responses: [], workloadResponses: [], attendance: [] };
  let activeTab = 'sessions';
  let selectedSessionId = '';
  let detailSessionId = '';
  let selectedWorkloadPlayerId = '';
  let workloadChartSection = '';
  let showArchivedPlayers = false;
  let messageTimer;

  // Pondérations McGahan et al. (2019), identifiées par l’id des questions wellness.
  const WELLNESS_WEIGHTS = {
    '00000000-0000-4000-8000-0000000000a1': 14,
    '00000000-0000-4000-8000-0000000000a2': 19,
    '00000000-0000-4000-8000-0000000000a3': 20,
    '00000000-0000-4000-8000-0000000000a4': 19,
    '00000000-0000-4000-8000-0000000000a5': 14,
    '00000000-0000-4000-8000-0000000000a6': 14,
  };
  const MIN_BASELINE = 5;
  const WELLNESS_STATES = {
    green: { label: 'En forme', zone: 'Optimal', css: 'wb-green', action: 'Maintenir ou pousser : appliquer la séance prévue, intensité légèrement augmentable si l’athlète se sent excellent.' },
    orange: { label: 'Forme en baisse', zone: 'Baisse modérée', css: 'wb-orange', action: 'Réguler : garder le cœur de la séance, réduire le volume (1 à 2 séries) ou allonger les récupérations.' },
    red: { label: 'Pas en forme', zone: 'Chute critique', css: 'wb-red', action: 'Alléger drastiquement ou modifier : récupération active (mobilité, cardio zone 2 très léger) ou repos complet.' },
  };

  const css = document.createElement('style');
  css.textContent = `
    #secure-admin{min-height:100vh;background:#f3f5ef;color:#1d2c26;font-family:'DM Sans','Segoe UI',sans-serif}
    .secure-header{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 28px;background:#fff;border-bottom:1px solid #e2e8e1}
    .secure-brand{display:flex;align-items:center;gap:10px}.secure-brand img{width:38px;height:38px;object-fit:contain}.secure-brand strong{font-size:11px;letter-spacing:.7px;color:#8e1b2c}
    .secure-header-actions{display:flex;align-items:center;gap:8px}.secure-nav{display:flex;gap:4px;padding:0 28px;background:#fff;border-bottom:1px solid #e2e8e1}
    .secure-nav button{border:0;background:transparent;padding:13px 12px;color:#6d7971;font-size:12px;border-bottom:2px solid transparent}.secure-nav button.active{color:#8e1b2c;border-color:#8e1b2c;font-weight:600}
    .secure-content{max-width:1180px;margin:0 auto;padding:27px 24px 42px}.secure-title{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px}.secure-title h1{font-size:28px;margin:0}.secure-title p{margin:6px 0 0;color:#7d8981;font-size:12px}
    .secure-panel{background:white;border:1px solid #e2e8e1;padding:18px;margin-bottom:14px}.secure-table{width:100%;border-collapse:collapse;text-align:left}.secure-table th{padding:10px 8px;border-bottom:1px solid #e2e8e1;color:#859087;font:9px 'Space Mono',monospace;text-transform:uppercase}.secure-table td{padding:11px 8px;border-bottom:1px solid #edf0ec;font-size:12px;vertical-align:middle}.secure-table tr:last-child td{border-bottom:0}.secure-actions{display:flex;gap:6px;flex-wrap:wrap}.secure-small{min-height:30px;padding:0 9px;font-size:10px}.secure-muted{color:#839087;font-size:11px}.secure-tag{display:inline-block;padding:4px 7px;background:#f5edcf;color:#756126;font-size:9px}.secure-stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}.secure-stat{background:#fff;border:1px solid #e2e8e1;padding:14px}.secure-stat span{display:block;color:#839087;font:9px 'Space Mono',monospace}.secure-stat strong{display:block;margin-top:8px;font:22px 'Space Mono',monospace}
    .secure-content{max-width:1380px}.tablewrap{overflow:auto;border:1px solid #edf0ec}.secure-table{min-width:760px}.secure-table th{position:sticky;top:0;background:#f7f8f4;z-index:1;line-height:1.4}.secure-table td{line-height:1.45}.secure-results-table{min-width:1180px}.secure-table tbody tr:nth-child(even){background:#fbfcf9}
    .secure-attendance{min-height:30px;border:1px solid #e2e8e1;background:#fff;padding:4px 7px;font-size:11px}
    .secure-row-click{cursor:pointer}.secure-row-click:hover{background:#faf6ea}
    .wb{display:inline-block;padding:4px 8px;font-size:10px;font-weight:600;white-space:nowrap}.wb-green{background:#e6f0e5;color:#3f7d4e}.wb-orange{background:#fdf0d5;color:#a86400}.wb-red{background:#f9eae5;color:#a84433}.wb-pending{background:#edf0ed;color:#74817a}
    .wb-score{font:600 12px 'Space Mono',monospace;padding:6px 9px}.wellness-alert{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;margin-bottom:14px;background:#fff0ec;border:1px solid #e4a397;border-left:4px solid #bf3d32;color:#702c27}.wellness-alert strong{display:block;margin-bottom:3px}.wellness-alert p{margin:0;color:#7e403a;font-size:12px}.wellness-alert .secure-small{margin-left:auto;flex:none}
    .wellness-legend{display:grid;gap:8px;margin-top:6px}.wellness-legend div{display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px;align-items:start;font-size:11px;color:#58665d}
    .secure-dialog{width:min(560px,calc(100vw - 28px));max-height:88vh;overflow:auto;border:0;padding:0;box-shadow:0 20px 70px #102f2833}.secure-dialog::backdrop{background:#102f2877}.secure-dialog form,.secure-dialog-content{padding:22px}.secure-dialog h2{margin:0 0 6px;font-size:20px}.secure-dialog p{color:#748177;font-size:12px}.secure-field{display:grid;gap:6px;margin:12px 0;color:#58665d;font-size:11px}.secure-field input,.secure-field select,.secure-field textarea{width:100%;min-height:38px;border:1px solid #e2e8e1;background:#fff;padding:8px 10px}.secure-field textarea{resize:vertical}.secure-check{display:flex;align-items:center;gap:8px;margin:12px 0;color:#59665d;font-size:11px}.secure-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.secure-error{color:#a84433!important;min-height:16px}.secure-toast{position:fixed;right:20px;bottom:20px;padding:12px 16px;background:#281d20;color:white;font-size:12px;opacity:0;pointer-events:none;transition:opacity .2s}.secure-toast.show{opacity:1}.invite-row{display:grid;grid-template-columns:145px minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid #e2e8e1}.invite-row input{min-width:0;height:34px;border:1px solid #e2e8e1;padding:0 7px;font-size:10px}.invite-row button{height:34px;border:0;background:#8e1b2c;color:white;padding:0 10px;font-size:10px}
    @media(max-width:700px){.secure-header{padding:12px 14px}.secure-nav{padding:0 10px;overflow:auto}.secure-nav button{white-space:nowrap;padding:12px 9px}.secure-content{padding:20px 12px}.secure-title{align-items:flex-start;flex-direction:column}.secure-title h1{font-size:24px}.secure-stat-grid{gap:6px}.secure-stat{padding:10px}.secure-stat span{font-size:7px}.secure-stat strong{font-size:17px}.secure-panel{padding:12px 9px}.invite-row{grid-template-columns:1fr auto}.invite-row input{grid-column:1/-1;grid-row:2}.wellness-legend div{grid-template-columns:1fr}.wellness-alert{flex-wrap:wrap}.wellness-alert .secure-small{margin-left:0}}
  `;
  css.textContent += '\n    .workload-chart-wrap{overflow:auto}.workload-chart{display:block;max-width:none}.workload-chart-empty{margin:0;padding:24px;color:#748177;text-align:center;font-size:12px}.workload-chart-filter{min-width:170px}.secure-session-duration{width:90px;min-height:32px;border:1px solid #e2e8e1;background:#fff;padding:4px 7px}.load-state{display:inline-block;padding:4px 7px;font-size:10px;font-weight:600;white-space:nowrap}.load-under{color:#1760a8}.load-normal{color:#3f7d4e}.load-over{color:#a84433}.load-pending{color:#74817a}.load-state.load-under{background:#e8f1ff}.load-state.load-normal{background:#e6f0e5}.load-state.load-over{background:#f9eae5}.load-state.load-pending{background:#edf0ed}\n  ';
  const TONES = {
    blue: { bg: '#e8f1ff', fg: '#1760a8', bar: '#3b82c4', label: 'Bleu' },
    green: { bg: '#d9efdc', fg: '#2a7a41', bar: '#3f9a55', label: 'Vert' },
    lime: { bg: '#eaf5c8', fg: '#587a14', bar: '#9bc53d', label: 'Vert clair' },
    yellow: { bg: '#fcf1bf', fg: '#7f6400', bar: '#e3b505', label: 'Jaune' },
    orange: { bg: '#fde3c4', fg: '#9a5200', bar: '#e8892b', label: 'Orange' },
    red: { bg: '#f8d7d0', fg: '#a1281a', bar: '#c65343', label: 'Rouge' },
  };
  css.textContent += `\n    ${Object.entries(TONES).map(([name, tone]) => `.tone-${name}{background:${tone.bg};color:${tone.fg}}`).join('')}.tone-badge{display:inline-block;padding:4px 8px;font:600 12px 'Space Mono',monospace;white-space:nowrap}.tone-legend{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.tone-legend .tone-badge{font-size:10px}\n  `;
  document.head.append(css);

  // Seuils de couleur : charge hebdomadaire, charge de séance (UA) et score wellness (%).
  const weekLoadTone = (value) => (value > 2300 ? 'red' : value >= 1900 ? 'orange' : value >= 1500 ? 'green' : 'blue');
  const sessionLoadTone = (value) => (value >= 600 ? 'red' : value >= 400 ? 'orange' : value >= 250 ? 'green' : 'blue');
  const wellnessTone = (value) => (value >= 77 ? 'green' : value >= 62 ? 'lime' : value >= 48 ? 'yellow' : 'red');
  const toneBadge = (tone, text, title = '') => `<span class="tone-badge tone-${tone}"${title ? ` title="${html(title)}"` : ''}>${text}</span>`;
  const toneLegend = (items) => `<div class="tone-legend">${items.map(([tone, text]) => toneBadge(tone, text)).join('')}</div>`;
  const WEEK_LOAD_LEGEND = [['red', '> 2300 UA'], ['orange', '1900 – 2300 UA'], ['green', '1500 – 1899 UA'], ['blue', '< 1500 UA']];
  const SESSION_LOAD_LEGEND = [['red', '≥ 600 UA'], ['orange', '400 – 599 UA'], ['green', '250 – 399 UA'], ['blue', '< 250 UA']];
  const WELLNESS_LEGEND = [['green', '100 – 77 %'], ['lime', '77 – 62 %'], ['yellow', '62 – 48 %'], ['red', '< 48 %']];

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
    const [players, questions, workloadQuestions, sessions, responses, workloadResponses, attendance] = await Promise.all([
      client.from('players').select('id,display_name,position,shirt_number,active,created_at').order('display_name'),
      client.from('questionnaire_questions').select('id,prompt,help_text,question_type,required,scale_min,scale_max,min_label,max_label,options,sort_order,active').order('sort_order'),
      client.from('workload_questions').select('id,prompt,help_text,question_type,metric_key,required,scale_min,scale_max,min_label,max_label,options,sort_order,active').order('sort_order'),
      client.from('sessions').select('id,title,session_date,session_type,status,shared_token,duration_minutes,form_snapshot,workload_snapshot,created_at').order('created_at', { ascending: false }),
      client.from('wellness_responses').select('id,session_id,player_id,answers,note,submitted_at').order('submitted_at', { ascending: false }),
      client.from('workload_responses').select('id,session_id,player_id,answers,duration_minutes,rpe,training_load,submitted_at').order('submitted_at', { ascending: false }),
      client.from('session_attendance').select('session_id,player_id,status,source,updated_at'),
    ]);
    const error = players.error || questions.error || workloadQuestions.error || sessions.error || responses.error || workloadResponses.error || attendance.error;
    if (error) throw error;
    admin = {
      players: players.data || [],
      questions: questions.data || [],
      workloadQuestions: workloadQuestions.data || [],
      sessions: sessions.data || [],
      responses: responses.data || [],
      workloadResponses: workloadResponses.data || [],
      attendance: attendance.data || [],
    };
    if (!selectedSessionId || !admin.sessions.some((session) => session.id === selectedSessionId)) {
      selectedSessionId = admin.sessions[0]?.id || '';
    }
  }

  function openAdmin() {
    one('.access-screen')?.remove();
    one('.shell').hidden = true;
    let root = one('#secure-admin');
    if (!root) {
      document.body.insertAdjacentHTML('beforeend', `<div id="secure-admin"><header class="secure-header"><div class="secure-brand"><img src="https://www.lyonladuchere.fr/app/uploads/2023/08/logo.svg" alt=""><strong>LA DUCHÈRE · U14</strong></div><div class="secure-header-actions"><span class="secure-tag">ADMIN</span><button class="btn secure-small" id="secure-logout" type="button">Déconnexion</button></div></header><nav class="secure-nav" aria-label="Administration"><button data-tab="sessions">Séances & réponses</button><button data-tab="attendance">Présences</button><button data-tab="wellness">Wellness</button><button data-tab="workload">Charge & RPE</button><button data-tab="questions">Questionnaires</button><button data-tab="players">Effectif</button></nav><main class="secure-content" id="secure-content"></main></div>`);
      root = one('#secure-admin');
      root.addEventListener('click', handleAction);
      root.addEventListener('change', (event) => {
        if (event.target.closest('select[data-attendance]')) handleAttendanceChange(event);
        else if (event.target.closest('.secure-answer-edit')) handleAnswerChange(event);
        else if (event.target.matches('.secure-session-duration')) handleSessionDurationChange(event);
        else if (event.target.matches('.secure-player-duration')) handlePlayerDurationChange(event);
        else if (event.target.matches('[data-workload-chart-player]')) {
          selectedWorkloadPlayerId = event.target.value;
          renderAdmin();
        }
      });
      many('.secure-nav button', root).forEach((button) => button.addEventListener('click', () => {
        activeTab = button.dataset.tab;
        detailSessionId = '';
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
    if (activeTab === 'questions') {
      content.innerHTML = renderQuestions();
      content.querySelectorAll('.secure-panel').forEach((panel) => {
        if (panel.querySelector('.eyebrow')?.textContent.includes('QUESTIONS RETIRÉES')) panel.remove();
      });
      const workloadContent = document.createElement('div');
      workloadContent.innerHTML = renderWorkload();
      [...workloadContent.querySelectorAll('.secure-panel')]
        .filter((panel) => {
          const label = panel.querySelector('.eyebrow')?.textContent || '';
          return label.includes('MODÈLE DES PROCHAINES SÉANCES') || label.includes('QUESTIONS RETIRÉES');
        })
        .forEach((panel) => content.append(panel));
    }
    else if (activeTab === 'players') content.innerHTML = renderPlayers();
    else if (activeTab === 'attendance') content.innerHTML = renderAttendance();
    else if (activeTab === 'wellness') content.innerHTML = renderWellness();
    else if (activeTab === 'workload') {
      content.innerHTML = renderWorkload()
        .replace('<th>JOUEUR</th><th>CHARGE · 7 J</th><th>MONOTONIE · 7 J</th><th>FITNESS · 28 J</th><th>DERNIER RPE</th><th>SÉANCES SAISIES</th>', '<th>JOUEUR</th><th>CHARGE · 7 J</th><th>MOYENNE / SEMAINE</th><th>ZONE</th><th>MONOTONIE · 7 J</th><th>DERNIER RPE</th><th>SÉANCES SAISIES</th>')
        .replace('<td colspan="6" class="secure-muted">Aucune donnée de charge pour le moment.', '<td colspan="7" class="secure-muted">Aucune donnée de charge pour le moment.')
        .replace('<th>SÉANCE</th><th>TYPE</th><th>RÉPONSES</th><th>RPE MOYEN</th><th>CHARGE MOYENNE</th><th></th>', '<th>SÉANCE</th><th>TYPE</th><th>DURÉE · STAFF</th><th>RÉPONSES</th><th>RPE MOYEN</th><th>CHARGE MOYENNE</th><th></th>')
        .replace('<td colspan="6" class="secure-muted">Aucune séance créée.', '<td colspan="7" class="secure-muted">Aucune séance créée.')
        .replace('<p>Monotonie = moyenne des charges quotidiennes / écart-type sur 7 jours. Fitness = moyenne hebdomadaire des charges sur 28 jours.</p>', '<p>Charge hebdomadaire comparée à la moyenne individuelle des 4 semaines précédentes : bleu sous 0,8×, vert de 0,8× à 1,3×, rouge au-dessus de 1,3×. Une durée manquante ou moins de 3 semaines mesurées laisse la zone neutre. Monotonie = moyenne des charges quotidiennes / écart-type sur 7 jours.</p>');
      content.querySelectorAll('.secure-panel').forEach((panel) => {
        const label = panel.querySelector('.eyebrow')?.textContent || '';
        if (label.includes('MODÈLE DES PROCHAINES SÉANCES') || label.includes('QUESTIONS RETIRÉES')) panel.remove();
      });
      content.insertAdjacentHTML('afterbegin', workloadChartSection);
    }
    else {
      content.innerHTML = detailSessionId ? renderSessionDetail(detailSessionId) : renderSessions();
      if (detailSessionId) {
        const session = admin.sessions.find((item) => item.id === detailSessionId);
        const firstPanel = content.querySelector(':scope > .secure-panel');
        if (session && firstPanel) firstPanel.insertAdjacentHTML('beforebegin', renderSessionLoadCharts(session));
      }
    }
  }

  const fr = (value, digits = 1) => Number(value).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const isMatch = (session) => session?.session_type === 'match';
  const todayKey = () => new Date().toLocaleDateString('sv-SE');

  function attendanceChoices(session) {
    return isMatch(session)
      ? [['present', 'Convoqué'], ['absent', 'Absent'], ['not_called', 'Non convoqué'], ['injured', 'Blessé'], ['called_u15', 'Convoqué U15D2']]
      : [['present', 'Présent'], ['absent', 'Absent']];
  }

  function attendanceLabel(session, status) {
    return attendanceChoices(session).find(([value]) => value === status)?.[1] || 'À confirmer';
  }

  function wellnessScore(session, response) {
    const questions = Array.isArray(session?.form_snapshot) ? session.form_snapshot : [];
    let total = 0;
    let weight = 0;
    for (const question of questions) {
      const questionWeight = WELLNESS_WEIGHTS[question.id];
      const value = Number(response?.answers?.[question.id]);
      if (!questionWeight || !Number.isFinite(value)) continue;
      total += value * questionWeight;
      weight += questionWeight;
    }
    return weight === 100 ? Math.round((total / 5) * 10) / 10 : null;
  }

  function wellnessFor(session, response) {
    const score = wellnessScore(session, response);
    if (score === null) return { score: null };
    const sessionById = new Map(admin.sessions.map((item) => [item.id, item]));
    const order = (item) => `${item.session_date}|${item.created_at}`;
    const history = admin.responses
      .filter((item) => item.player_id === response.player_id && item.session_id !== session.id)
      .map((item) => ({ item, other: sessionById.get(item.session_id) }))
      .filter(({ other }) => other && order(other) < order(session))
      .sort((a, b) => order(a.other).localeCompare(order(b.other)))
      .map(({ item, other }) => wellnessScore(other, item))
      .filter((value) => value !== null)
      .slice(-30);
    if (history.length < MIN_BASELINE) return { score, state: 'pending', count: history.length };
    const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
    const deviation = Math.sqrt(history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / history.length);
    const z = (score - mean) / Math.max(deviation, 3);
    return { score, mean, z, count: history.length, state: z <= -1 ? 'red' : z <= -0.5 ? 'orange' : 'green' };
  }

  function wellnessCells(info) {
    if (info.score === null) return '<td class="secure-muted">—</td><td class="secure-muted">—</td>';
    if (info.state === 'pending') {
      return `<td>${toneBadge(wellnessTone(info.score), `${fr(info.score)} %`)}</td><td><span class="wb wb-pending" title="Référence personnelle après ${MIN_BASELINE} séances">Référence ${info.count}/${MIN_BASELINE}</span></td>`;
    }
    const state = WELLNESS_STATES[info.state];
    return `<td><span class="tone-badge tone-${wellnessTone(info.score)}" title="${html(state.zone + ' · ' + state.action)}">${fr(info.score)} %</span><div class="secure-muted">habituel ${fr(info.mean)} %</div></td><td><span class="wb ${state.css}" title="${html(state.zone + ' · ' + state.action)}">${state.label}</span></td>`;
  }

  function wellnessLegend() {
    const rows = Object.values(WELLNESS_STATES).map((state) => `<div><span class="wb ${state.css}">${state.label} · ${state.zone}</span><span>${html(state.action)}</span></div>`).join('');
    return `<section class="secure-panel"><p class="eyebrow">SCORE WELLNESS</p><p class="secure-muted">Score pondéré sur 100 % (humeur, sommeil, énergie, douleurs, alimentation, stress). L’état compare le score du jour à la moyenne habituelle du joueur (au moins ${MIN_BASELINE} séances) : orange sous -0,5 écart-type, rouge sous -1.</p>${toneLegend(WELLNESS_LEGEND)}<div class="wellness-legend">${rows}</div></section>`;
  }

  function renderWellnessAlert(session) {
    const playerById = new Map(admin.players.map((player) => [player.id, player]));
    const redPlayers = admin.responses
      .filter((response) => response.session_id === session.id && wellnessFor(session, response).state === 'red')
      .map((response) => ({
        name: playerById.get(response.player_id)?.display_name || 'Joueur',
        score: wellnessScore(session, response),
      }));
    if (!redPlayers.length) return '';
    const list = redPlayers.map((player) => `${html(player.name)} (${fr(player.score)} %)`).join(' · ');
    return `<div class="wellness-alert" role="alert" aria-live="polite"><div><strong>Alerte wellness · ${redPlayers.length} joueur${redPlayers.length === 1 ? '' : 's'} en rouge</strong><p>${list}. Alléger ou remplacer la séance par de la récupération.</p></div></div>`;
  }

  function answerControl(kind, session, player, question, value) {
    const durationField = kind === 'workload' && question.metricKey === 'duration_minutes';
    if ((value === undefined || value === null) && !durationField) return '<td>—</td>';
    const data = `class="secure-answer-edit" data-answer-kind="${kind}" data-session-id="${html(session.id)}" data-player-id="${html(player.id)}" data-question-id="${html(question.id)}"`;
    if (question.type === 'scale') {
      const options = Array.from({ length: question.scaleMax - question.scaleMin + 1 }, (_, index) => question.scaleMin + index)
        .map((number) => `<option value="${number}" ${Number(value) === number ? 'selected' : ''}>${number}</option>`).join('');
      return `<td><select ${data} aria-label="${html(question.prompt)}">${options}</select></td>`;
    }
    if (question.type === 'single_choice') {
      const options = (question.options || []).map((option) => `<option value="${html(option)}" ${value === option ? 'selected' : ''}>${html(option)}</option>`).join('');
      return `<td><select ${data} aria-label="${html(question.prompt)}"><option value="">—</option>${options}</select></td>`;
    }
    if (question.type === 'number') {
      const duration = question.metricKey === 'duration_minutes';
      return `<td><input ${data} type="number" min="${duration ? 1 : 0}" max="${duration ? 300 : 10}" step="1" value="${html(value ?? '')}" aria-label="${html(question.prompt)}"></td>`;
    }
    return `<td><input ${data} type="text" maxlength="500" value="${html(value)}" aria-label="${html(question.prompt)}"></td>`;
  }

  function renderResults(session) {
    const questions = Array.isArray(session.form_snapshot) ? session.form_snapshot : [];
    const responsesByPlayer = new Map(admin.responses.filter((item) => item.session_id === session.id).map((item) => [item.player_id, item]));
    const attendanceByPlayer = new Map(admin.attendance.filter((item) => item.session_id === session.id).map((item) => [item.player_id, item]));
    const players = admin.players.filter((player) => player.active || responsesByPlayer.has(player.id) || attendanceByPlayer.has(player.id));
    const headers = questions.map((question) => `<th>${html(question.prompt)}</th>`).join('');
    const rows = players.map((player) => {
      const response = responsesByPlayer.get(player.id);
      const value = attendanceByPlayer.get(player.id)?.status || (response ? 'present' : '');
      const options = `<option value="" ${!value ? 'selected' : ''}>À confirmer</option>${attendanceChoices(session).map(([status, label]) => `<option value="${status}" ${value === status ? 'selected' : ''}>${label}</option>`).join('')}`;
      const answers = questions.map((question) => answerControl('wellness', session, player, question, response?.answers?.[question.id])).join('');
      const wellness = response ? wellnessCells(wellnessFor(session, response)) : '<td class="secure-muted">—</td><td class="secure-muted">—</td>';
      const note = response
        ? `<input class="secure-answer-edit" data-answer-kind="wellness" data-answer-note="true" data-session-id="${html(session.id)}" data-player-id="${html(player.id)}" type="text" maxlength="240" value="${html(response.note || '')}" aria-label="Note au staff de ${html(player.display_name)}">`
        : '—';
      const wellnessStatus = response
        ? '<span class="secure-tag">Répondu</span>'
        : `<span class="secure-tag">En attente</span><button class="btn button-secondary secure-small" data-action="enter-wellness" data-session-id="${html(session.id)}" data-player-id="${html(player.id)}">Saisir</button>`;
      return `<tr><td><strong>${html(player.display_name)}</strong>${player.active ? '' : ' <span class="secure-muted">(retiré)</span>'}</td><td><select class="secure-attendance" data-attendance="true" data-session-id="${html(session.id)}" data-player-id="${html(player.id)}" aria-label="Présence de ${html(player.display_name)}">${options}</select></td><td><div class="secure-actions">${wellnessStatus}</div></td>${wellness}${answers}<td>${note}</td></tr>`;
    }).join('');
    return `${renderWellnessAlert(session)}<section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">WELLNESS</p><h2>Réponses et état de forme</h2><p>Modifie une réponse directement dans sa cellule.</p></div></div><div class="tablewrap"><table class="secure-table secure-results-table"><thead><tr><th>JOUEUR</th><th>${isMatch(session) ? 'CONVOCATION' : 'PRÉSENCE'}</th><th>QUESTIONNAIRE</th><th>WELLNESS</th><th>ÉTAT</th>${headers}<th>NOTE AU STAFF</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="secure-muted">Aucun joueur dans l’effectif.</td></tr>'}</tbody></table></div></section>${renderWorkloadResults(session)}`;
  }

  function renderWorkloadResults(session) {
    const questions = Array.isArray(session.workload_snapshot)
      ? session.workload_snapshot.filter((question) => question.metricKey !== 'duration_minutes')
      : [];
    const responsesByPlayer = new Map(admin.workloadResponses.filter((item) => item.session_id === session.id).map((item) => [item.player_id, item]));
    const players = admin.players.filter((player) => player.active || responsesByPlayer.has(player.id));
    const headers = questions.map((question) => `<th>${html(question.prompt)}</th>`).join('');
    const matchSession = isMatch(session);
    const rows = players.map((player) => {
      const response = responsesByPlayer.get(player.id);
      const values = questions.map((question) => {
        const value = question.metricKey === 'duration_minutes'
          ? response?.duration_minutes ?? ''
          : response?.answers?.[question.id];
        return answerControl('workload', session, player, question, value);
      }).join('');
      const loadValue = response?.training_load == null ? null : Number(response.training_load);
      const load = loadValue === null ? 'Durée à renseigner' : toneBadge(sessionLoadTone(loadValue), `${fr(loadValue, 0)} UA`);
      const status = response ? '<span class="secure-tag">Répondu</span>' : `<span class="secure-tag">En attente</span><button class="btn button-secondary secure-small" data-action="enter-workload" data-session-id="${html(session.id)}" data-player-id="${html(player.id)}">Saisir</button>`;
      const minutesCell = matchSession
        ? (response
          ? `<td><input class="secure-player-duration" data-session-id="${html(session.id)}" data-player-id="${html(player.id)}" type="number" min="1" max="300" step="1" value="${html(response.duration_minutes ?? '')}" aria-label="Temps de jeu de ${html(player.display_name)} en minutes"></td>`
          : '<td class="secure-muted">—</td>')
        : '';
      return `<tr><td><strong>${html(player.display_name)}</strong></td><td><div class="secure-actions">${status}</div></td>${values}${minutesCell}<td>${load}</td></tr>`;
    }).join('');
    const intro = matchSession
      ? 'Charge de séance = temps de jeu (minutes) × RPE. Renseigne le temps de jeu de chaque joueur : il remplace la durée commune du match.'
      : 'Charge de séance = durée (minutes) × RPE. Modifie les valeurs directement dans le tableau.';
    return `<section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">CHARGE DE TRAVAIL</p><h2>${matchSession ? 'Temps de jeu, RPE et charge' : 'Durée, RPE et charge'}</h2><p>${intro}</p></div></div><div class="tablewrap"><table class="secure-table secure-results-table"><thead><tr><th>JOUEUR</th><th>QUESTIONNAIRE</th>${headers}${matchSession ? '<th>TEMPS DE JEU (MIN)</th>' : ''}<th>CHARGE</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="secure-muted">Aucun joueur dans l’effectif.</td></tr>'}</tbody></table></div></section>`;
  }

  function renderSessionDetail(sessionId) {
    const session = admin.sessions.find((item) => item.id === sessionId);
    if (!session) {
      detailSessionId = '';
      return renderSessions();
    }
    const responses = admin.responses.filter((item) => item.session_id === session.id);
    const counts = {};
    admin.attendance.filter((item) => item.session_id === session.id).forEach((item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
    });
    const summary = attendanceChoices(session).map(([status, label]) => `${counts[status] || 0} ${label.toLowerCase()}`).join(' · ');
    const scores = responses.map((item) => wellnessScore(session, item)).filter((value) => value !== null);
    const average = scores.length ? `${fr(scores.reduce((sum, value) => sum + value, 0) / scores.length)} %` : '—';
    const link = session.shared_token ? `<button class="btn secure-small" data-action="show-link" data-id="${html(session.id)}">Lien joueurs</button>` : '';
    return `<div class="secure-title"><div><p class="eyebrow">${dateText(session.session_date)} · ${isMatch(session) ? 'MATCH' : 'ENTRAÎNEMENT'} · ${session.status === 'open' ? 'OUVERTE' : 'CLÔTURÉE'}</p><h1>${html(session.title)}</h1><p>${responses.length} réponse${responses.length === 1 ? '' : 's'} · ${summary}</p></div><div class="secure-actions">${link}<button class="btn button-secondary" data-action="back-sessions">Retour aux séances</button></div></div><div class="secure-stat-grid"><article class="secure-stat"><span>RÉPONSES</span><strong>${responses.length} / ${admin.players.filter((player) => player.active).length}</strong></article><article class="secure-stat"><span>WELLNESS MOYEN</span><strong>${scores.length ? toneBadge(wellnessTone(scores.reduce((sum, value) => sum + value, 0) / scores.length), average) : average}</strong></article><article class="secure-stat"><span>${isMatch(session) ? 'CONVOQUÉS' : 'PRÉSENTS'}</span><strong>${counts.present || 0}</strong></article></div><section class="secure-panel">${renderResults(session)}</section>${wellnessLegend()}`;
  }

  function renderRankedSessionChart(title, subtitle, entries, unit, color, maximum, decimals, toneFor, legend) {
    const measured = entries
      .filter((entry) => Number.isFinite(entry.value))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'fr'));
    const missing = entries
      .filter((entry) => !Number.isFinite(entry.value))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const ranked = [...measured, ...missing];
    const chartWidth = Math.max(640, ranked.length * 82 + 62);
    const chartHeight = 260;
    const chartLeft = 42;
    const chartRight = 16;
    const chartTop = 22;
    const chartBottom = 190;
    const chartMax = maximum ?? Math.max(100, Math.ceil(Math.max(0, ...measured.map((entry) => entry.value)) / 100) * 100);
    const plotWidth = chartWidth - chartLeft - chartRight;
    const plotHeight = chartBottom - chartTop;
    const grid = [0, 0.5, 1].map((fraction) => {
      const y = chartBottom - fraction * plotHeight;
      return `<line x1="${chartLeft}" y1="${y}" x2="${chartWidth - chartRight}" y2="${y}" stroke="#e2e8e1"/><text x="${chartLeft - 7}" y="${y + 4}" text-anchor="end" fill="#7d8981" font-size="10">${fr(chartMax * fraction, 0)}</text>`;
    }).join('');
    const slot = plotWidth / Math.max(1, ranked.length);
    const bars = ranked.map((entry, index) => {
      const center = chartLeft + index * slot + slot / 2;
      const measuredValue = Number.isFinite(entry.value);
      const barHeight = measuredValue ? entry.value / chartMax * plotHeight : 0;
      const y = chartBottom - barHeight;
      const barWidth = Math.min(38, slot * 0.58);
      const label = entry.name.length > 10 ? `${entry.name.slice(0, 9)}…` : entry.name;
      const valueLabel = measuredValue ? `${fr(entry.value, decimals)} ${unit}` : '—';
      return `<g><title>${html(entry.name)} · ${valueLabel}</title><rect x="${center - barWidth / 2}" y="${y}" width="${barWidth}" height="${barHeight}" rx="2" fill="${measuredValue ? (toneFor ? TONES[toneFor(entry.value)].bar : color) : '#a7b0aa'}"/><text x="${center}" y="${Math.max(chartTop + 10, y - 5)}" text-anchor="middle" fill="#1d2c26" font-size="9">${measuredValue ? fr(entry.value, decimals) : '—'}</text><text x="${center}" y="${chartBottom + 18}" text-anchor="middle" fill="#58665d" font-size="9">${html(label)}</text></g>`;
    }).join('');
    const chart = ranked.length
      ? `<div class="workload-chart-wrap"><svg class="workload-chart" width="${chartWidth}" height="${chartHeight}" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="${html(title)}"><title>${html(title)}</title>${grid}${bars}</svg></div>`
      : '<p class="workload-chart-empty">Aucun joueur dans l’effectif.</p>';
    return `<section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">${html(subtitle)}</p><h2>${html(title)}</h2><p>Du plus élevé à gauche au plus faible à droite. Les joueurs sans mesure sont affichés à la fin avec « — ».</p></div></div>${chart}${legend || ''}</section>`;
  }

  function renderSessionLoadCharts(session) {
    const wellnessByPlayer = new Map(admin.responses
      .filter((response) => response.session_id === session.id)
      .map((response) => [response.player_id, response]));
    const workloadByPlayer = new Map(admin.workloadResponses
      .filter((response) => response.session_id === session.id)
      .map((response) => [response.player_id, response]));
    const attendanceByPlayer = new Set(admin.attendance
      .filter((record) => record.session_id === session.id)
      .map((record) => record.player_id));
    const players = admin.players.filter((player) => player.active
      || wellnessByPlayer.has(player.id)
      || workloadByPlayer.has(player.id)
      || attendanceByPlayer.has(player.id));
    const workloadEntries = players.map((player) => {
      const rawLoad = workloadByPlayer.get(player.id)?.training_load;
      const load = rawLoad == null ? null : Number(rawLoad);
      return { name: player.display_name, value: Number.isFinite(load) ? load : null };
    });
    const wellnessEntries = players.map((player) => {
      const response = wellnessByPlayer.get(player.id);
      const score = response ? wellnessScore(session, response) : null;
      return { name: player.display_name, value: Number.isFinite(score) ? score : null };
    });
    return `${renderRankedSessionChart('Charge par joueur', 'CHARGE DE LA SÉANCE', workloadEntries, 'UA', '#8e1b2c', null, 0, sessionLoadTone, toneLegend(SESSION_LOAD_LEGEND))}${renderRankedSessionChart('Score wellness par joueur', 'WELLNESS DE LA SÉANCE', wellnessEntries, '%', '#4f8d5d', 100, 1, wellnessTone, toneLegend(WELLNESS_LEGEND))}`;
  }

  function renderWellness() {
    const sessionsById = new Map(admin.sessions.map((session) => [session.id, session]));
    const today = todayKey();
    const weekStart = new Date(`${today}T12:00:00`);
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartKey = weekStart.toLocaleDateString('sv-SE');
    const order = (session) => `${session.session_date}|${session.created_at}`;
    const questions = admin.questions.filter((question) => question.active && question.question_type === 'scale');
    const chartEntries = [];
    const playerRows = admin.players.filter((player) => player.active).map((player) => {
      const entries = admin.responses
        .filter((response) => response.player_id === player.id)
        .map((response) => ({ response, session: sessionsById.get(response.session_id) }))
        .filter(({ session }) => session && session.session_date <= today)
        .sort((a, b) => order(a.session).localeCompare(order(b.session)));
      const latest = entries.at(-1);
      const recentScores = entries
        .filter(({ session }) => session.session_date >= weekStartKey)
        .map(({ session, response }) => wellnessScore(session, response))
        .filter((value) => value !== null);
      const weekAverage = recentScores.length ? recentScores.reduce((sum, value) => sum + value, 0) / recentScores.length : null;
      const latestScore = latest ? wellnessScore(latest.session, latest.response) : null;
      chartEntries.push({ name: player.display_name, value: latestScore });
      const answers = questions.map((question) => `<td>${html(latest?.response.answers?.[question.id] ?? '—')}</td>`).join('');
      const scoreCells = latest ? wellnessCells(wellnessFor(latest.session, latest.response)) : '<td class="secure-muted">—</td><td class="secure-muted">—</td>';
      return `<tr><td><strong>${html(player.display_name)}</strong></td>${scoreCells}<td>${weekAverage === null ? '—' : toneBadge(wellnessTone(weekAverage), `${fr(weekAverage)} %`)}</td>${answers}<td>${latest ? dateText(latest.session.session_date) : '—'}</td><td>${entries.length}</td></tr>`;
    }).join('');
    const sessionRows = [...admin.sessions].sort((a, b) => order(b).localeCompare(order(a))).map((session) => {
      const responses = admin.responses.filter((response) => response.session_id === session.id);
      const expectedPlayers = admin.attendance.filter((item) => item.session_id === session.id).length
        || admin.players.filter((player) => player.active).length;
      const scores = responses.map((response) => wellnessScore(session, response)).filter((value) => value !== null);
      const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
      const alerts = responses.filter((response) => wellnessFor(session, response).state === 'red').length;
      return `<tr><td><strong>${html(session.title)}</strong><div class="secure-muted">${dateText(session.session_date)}</div></td><td>${isMatch(session) ? 'Match' : 'Entraînement'}</td><td>${responses.length} / ${expectedPlayers}</td><td>${average === null ? '—' : toneBadge(wellnessTone(average), `${fr(average)} %`)}</td><td>${alerts ? toneBadge('red', `${alerts} joueur${alerts === 1 ? '' : 's'}`) : '—'}</td><td><button class="btn button-secondary secure-small" data-action="view-session" data-id="${html(session.id)}">Détail</button></td></tr>`;
    }).join('');
    const chart = renderRankedSessionChart('Score wellness par joueur', 'DERNIÈRE RÉPONSE · WELLNESS', chartEntries, '%', '#4f8d5d', 100, 1, wellnessTone, toneLegend(WELLNESS_LEGEND));
    const questionHeaders = questions.map((question) => `<th>${html(question.prompt)}</th>`).join('');
    return `<div class="secure-title"><div><p class="eyebrow">BIEN-ÊTRE · SUIVI U14</p><h1>Wellness</h1><p>Réponses au questionnaire wellness. Score pondéré sur 100 %, coloré selon le niveau de forme.</p></div></div>${chart}<section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">SUIVI SÉANCE PAR SÉANCE</p><h2>Wellness par séance</h2><p>Ouvre le détail d’une séance pour consulter et modifier les réponses individuelles.</p></div></div><div class="tablewrap"><table class="secure-table"><thead><tr><th>SÉANCE</th><th>TYPE</th><th>RÉPONSES</th><th>WELLNESS MOYEN</th><th>ALERTES</th><th></th></tr></thead><tbody>${sessionRows || '<tr><td colspan="6" class="secure-muted">Aucune séance créée.</td></tr>'}</tbody></table></div></section><section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">INDICATEURS ATHLÈTE</p><h2>Dernières réponses des joueurs</h2><p>Score et réponses de la dernière séance renseignée, moyenne sur les 7 derniers jours.</p></div></div><div class="tablewrap"><table class="secure-table"><thead><tr><th>JOUEUR</th><th>DERNIER WELLNESS</th><th>ÉTAT</th><th>MOYENNE · 7 J</th>${questionHeaders}<th>DATE</th><th>RÉPONSES</th></tr></thead><tbody>${playerRows || `<tr><td colspan="${6 + questions.length}" class="secure-muted">Aucun joueur actif dans l’effectif.</td></tr>`}</tbody></table></div></section>${wellnessLegend()}`;
  }

  function renderAttendance() {
    const sessionById = new Map(admin.sessions.map((item) => [item.id, item]));
    const today = todayKey();
    const recordsFor = (player, match) => admin.attendance.filter((item) => {
      const session = sessionById.get(item.session_id);
      return item.player_id === player.id && session && session.session_date <= today && isMatch(session) === match;
    });
    const percent = (part, total) => (total ? `${Math.round((part / total) * 100)} %` : '—');
    const rows = admin.players.filter((player) => player.active).map((player) => {
      const training = recordsFor(player, false);
      const matches = recordsFor(player, true);
      const count = (list, status) => list.filter((item) => item.status === status).length;
      const trainingPresent = count(training, 'present');
      const matchPresent = count(matches, 'present');
      return `<tr><td><strong>${html(player.display_name)}</strong></td><td>${trainingPresent} / ${training.length}</td><td><strong>${percent(trainingPresent, training.length)}</strong></td><td>${matchPresent} / ${matches.length}</td><td><strong>${percent(matchPresent, matches.length)}</strong></td><td>${count(matches, 'absent')}</td><td>${count(matches, 'not_called')}</td><td>${count(matches, 'injured')}</td><td>${count(matches, 'called_u15')}</td></tr>`;
    }).join('');
    return `<div class="secure-title"><div><p class="eyebrow">SUIVI DE LA PRÉSENCE</p><h1>Taux de présence</h1><p>Séances passées uniquement. Pour les matchs, le taux compte les joueurs convoqués sur tous les matchs enregistrés.</p></div></div><section class="secure-panel"><div class="tablewrap"><table class="secure-table"><thead><tr><th>JOUEUR</th><th>ENTRAÎNEMENTS</th><th>TAUX</th><th>MATCHS CONVOQUÉ</th><th>TAUX</th><th>ABSENT</th><th>NON CONVOQUÉ</th><th>BLESSÉ</th><th>U15D2</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="secure-muted">Aucun joueur actif dans l’effectif.</td></tr>'}</tbody></table></div></section>`;
  }

  function renderWorkload() {
    const sessionsById = new Map(admin.sessions.map((session) => [session.id, session]));
    const today = todayKey();
    const playerMetrics = [];
    const playerRows = admin.players.filter((player) => player.active).map((player) => {
      const entries = admin.workloadResponses
        .filter((response) => response.player_id === player.id)
        .map((response) => ({ response, session: sessionsById.get(response.session_id) }))
        .filter(({ session }) => session && session.session_date <= today)
        .sort((a, b) => a.session.session_date.localeCompare(b.session.session_date));
      const daily = new Map();
      for (const { response, session } of entries) {
        if (response.training_load != null) {
          daily.set(session.session_date, (daily.get(session.session_date) || 0) + Number(response.training_load));
        }
      }
      const dayValues = (days) => Array.from({ length: days }, (_, offset) => {
        const date = new Date(`${today}T12:00:00`);
        date.setDate(date.getDate() - (days - offset - 1));
        return daily.get(date.toLocaleDateString('sv-SE')) || 0;
      });
      const rollingDates = Array.from({ length: 35 }, (_, offset) => {
        const date = new Date(`${today}T12:00:00`);
        date.setDate(date.getDate() - (34 - offset));
        return date.toLocaleDateString('sv-SE');
      });
      const rolling35 = rollingDates.map((date) => daily.get(date) || 0);
      const recent7 = rolling35.slice(-7);
      const weeklyLoad = recent7.reduce((sum, value) => sum + value, 0);
      const mean7 = weeklyLoad / 7;
      const deviation7 = Math.sqrt(recent7.reduce((sum, value) => sum + (value - mean7) ** 2, 0) / 7);
      const monotony = deviation7 > 0 ? mean7 / deviation7 : null;
      const hasMissingLoadBetween = (startKey, endKey) => admin.sessions
        .filter((session) => session.session_date >= startKey && session.session_date <= endKey)
        .some((session) => {
          const attendance = admin.attendance.find((item) => item.session_id === session.id && item.player_id === player.id);
          if (attendance?.status !== 'present') return false;
          const response = entries.find((entry) => entry.session.id === session.id)?.response;
          return response?.training_load == null;
        });
      const baselineWeeks = Array.from({ length: 4 }, (_, index) => {
        const start = index * 7;
        const end = start + 7;
        const startKey = rollingDates[start];
        const endKey = rollingDates[end - 1];
        const hasMeasuredLoad = entries.some(({ response, session }) => session.session_date >= startKey
          && session.session_date <= endKey && response.training_load != null);
        return {
          load: rolling35.slice(start, end).reduce((sum, value) => sum + value, 0),
          complete: hasMeasuredLoad && !hasMissingLoadBetween(startKey, endKey),
        };
      }).filter((week) => week.complete);
      const baselineCount = baselineWeeks.length;
      const weeklyAverage = baselineCount
        ? baselineWeeks.reduce((sum, week) => sum + week.load, 0) / baselineCount
        : 0;
      const ratio = weeklyAverage > 0 ? weeklyLoad / weeklyAverage : null;
      const hasMissingLoad = hasMissingLoadBetween(rollingDates[28], rollingDates[34]);
      const loadState = hasMissingLoad || baselineCount < 3 || ratio === null
        ? 'load-pending'
        : ratio < 0.8 ? 'load-under' : ratio > 1.3 ? 'load-over' : 'load-normal';
      const loadLabel = { 'load-pending': 'À compléter', 'load-under': 'Sous-charge', 'load-normal': 'Dans la moyenne', 'load-over': 'Surcharge' }[loadState];
      const latest = entries.at(-1)?.response;
      playerMetrics.push({ name: player.display_name, load: weeklyLoad, state: loadState, label: loadLabel });
      return `<tr><td><strong>${html(player.display_name)}</strong></td><td>${toneBadge(weekLoadTone(weeklyLoad), `${fr(weeklyLoad, 0)} UA`)}</td><td>${fr(weeklyAverage, 0)} UA</td><td><span class="load-state ${loadState}">${loadLabel}</span></td><td>${monotony === null ? '—' : fr(monotony)}</td><td>${latest ? `${fr(latest.rpe, 1)} / 10` : '—'}</td><td>${entries.length}</td></tr>`;
    }).join('');
    const workloadSessions = [...admin.sessions].sort((a, b) => b.session_date.localeCompare(a.session_date));
    const sessionRows = workloadSessions.map((session) => {
      const responses = admin.workloadResponses.filter((response) => response.session_id === session.id);
      const expectedPlayers = admin.attendance.filter((item) => item.session_id === session.id).length
        || admin.players.filter((player) => player.active).length;
      const average = (field) => {
        const values = responses.map((response) => response[field]).filter((value) => value != null).map(Number);
        return values.length ? fr(values.reduce((sum, value) => sum + value, 0) / values.length, 1) : '—';
      };
      const loadValues = responses.map((response) => response.training_load).filter((value) => value != null).map(Number);
      const averageLoad = loadValues.length ? loadValues.reduce((sum, value) => sum + value, 0) / loadValues.length : null;
      const averageLoadCell = averageLoad === null ? '—' : toneBadge(sessionLoadTone(averageLoad), `${fr(averageLoad, 1)} UA`);
      const duration = `<input class="secure-session-duration" data-session-id="${html(session.id)}" type="number" min="1" max="300" step="1" value="${html(session.duration_minutes ?? '')}" aria-label="Durée de ${html(session.title)} en minutes">`;
      return `<tr><td><strong>${html(session.title)}</strong><div class="secure-muted">${dateText(session.session_date)}</div></td><td>${session.session_type === 'match' ? 'Match' : 'Entraînement'}</td><td>${duration}</td><td>${responses.length} / ${expectedPlayers}</td><td>${average('rpe')}${responses.length ? ' / 10' : ''}</td><td>${averageLoadCell}</td><td><button class="btn button-secondary secure-small" data-action="view-session" data-id="${html(session.id)}">Détail</button></td></tr>`;
    }).join('');
    const rankedPlayers = playerMetrics.sort((a, b) => b.load - a.load || a.name.localeCompare(b.name, 'fr'));
    const rankingWidth = Math.max(640, rankedPlayers.length * 82 + 62);
    const rankingHeight = 280;
    const rankingLeft = 42;
    const rankingRight = 16;
    const rankingTop = 22;
    const rankingBottom = 210;
    const rankingPlotWidth = rankingWidth - rankingLeft - rankingRight;
    const rankingPlotHeight = rankingBottom - rankingTop;
    const rankingMax = Math.max(100, Math.ceil(Math.max(0, ...rankedPlayers.map((player) => player.load)) / 100) * 100);
    const rankingGrid = [0, 0.5, 1].map((fraction) => {
      const y = rankingBottom - fraction * rankingPlotHeight;
      return `<line x1="${rankingLeft}" y1="${y}" x2="${rankingWidth - rankingRight}" y2="${y}" stroke="#e2e8e1"/><text x="${rankingLeft - 7}" y="${y + 4}" text-anchor="end" fill="#7d8981" font-size="10">${fr(rankingMax * fraction, 0)}</text>`;
    }).join('');
    const rankingBars = rankedPlayers.map((player, index) => {
      const slot = rankingPlotWidth / Math.max(1, rankedPlayers.length);
      const center = rankingLeft + index * slot + slot / 2;
      const barWidth = Math.min(38, slot * 0.58);
      const barHeight = player.load / rankingMax * rankingPlotHeight;
      const y = rankingBottom - barHeight;
      const label = player.name.length > 10 ? `${player.name.slice(0, 9)}…` : player.name;
      return `<g><title>${html(player.name)} · ${fr(player.load, 0)} UA · ${player.label}</title><rect x="${center - barWidth / 2}" y="${y}" width="${barWidth}" height="${barHeight}" rx="2" fill="${TONES[weekLoadTone(player.load)].bar}"/><text x="${center}" y="${Math.max(rankingTop + 10, y - 5)}" text-anchor="middle" fill="#1d2c26" font-size="9">${fr(player.load, 0)}</text><text x="${center}" y="${rankingBottom + 18}" text-anchor="middle" fill="#58665d" font-size="9">${html(label)}</text></g>`;
    }).join('');
    const chart = rankedPlayers.length
      ? `<svg class="workload-chart" width="${rankingWidth}" height="${rankingHeight}" viewBox="0 0 ${rankingWidth} ${rankingHeight}" role="img" aria-label="Classement des charges d’entraînement des joueurs sur les 7 derniers jours"><title>Charge totale sur les 7 derniers jours, du plus élevé à gauche au plus faible à droite</title>${rankingGrid}${rankingBars}</svg>`
      : '<p class="workload-chart-empty">Aucun joueur actif dans l’effectif.</p>';
    workloadChartSection = `<section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">CHARGE D’ENTRAÎNEMENT · 7 JOURS</p><h2>Classement des joueurs</h2><p>Charge totale calculée sur les 7 derniers jours, de la plus élevée à la plus faible. Les joueurs sans charge calculable restent en bas du classement.</p></div></div><div class="workload-chart-wrap">${chart}</div>${toneLegend(WEEK_LOAD_LEGEND)}</section>`;
    const active = admin.workloadQuestions.filter((question) => question.active);
    const archived = admin.workloadQuestions.filter((question) => !question.active);
    const questionRow = (question) => `<tr><td><strong>${html(question.prompt)}</strong><div class="secure-muted">${html(question.help_text)}</div></td><td>${question.metric_key === 'duration_minutes' ? 'Durée · charge' : question.metric_key === 'rpe' ? 'RPE · charge' : question.question_type === 'scale' ? `Échelle ${question.scale_min}–${question.scale_max}` : question.question_type === 'number' ? 'Nombre' : question.question_type === 'short_text' ? 'Texte court' : 'Choix unique'}</td><td><div class="secure-actions"><button class="btn button-secondary secure-small" data-action="edit-workload-question" data-id="${html(question.id)}">Modifier</button>${question.metric_key ? '<span class="secure-muted">Indispensable au calcul</span>' : `<button class="btn button-secondary secure-small" data-action="${question.active ? 'archive-workload-question' : 'restore-workload-question'}" data-id="${html(question.id)}">${question.active ? 'Retirer' : 'Restaurer'}</button>`}</div></td></tr>`;
    return `<div class="secure-title"><div><p class="eyebrow">CHARGE INTERNE · SUIVI U14</p><h1>Charge & RPE</h1><p>Charge séance = durée en minutes × RPE. UA = unités arbitraires.</p></div></div><section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">SUIVI SÉANCE PAR SÉANCE</p><h2>Charge et RPE par séance</h2><p>Chaque séance conserve ses réponses. Ouvre son détail pour consulter les valeurs individuelles et les joueurs en attente.</p></div></div><div class="tablewrap"><table class="secure-table"><thead><tr><th>SÉANCE</th><th>TYPE</th><th>RÉPONSES</th><th>RPE MOYEN</th><th>CHARGE MOYENNE</th><th></th></tr></thead><tbody>${sessionRows || '<tr><td colspan="6" class="secure-muted">Aucune séance créée.</td></tr>'}</tbody></table></div>${toneLegend(SESSION_LOAD_LEGEND)}</section><section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">INDICATEURS ATHLÈTE</p><h2>Monotonie et fitness</h2><p>Monotonie = moyenne des charges quotidiennes / écart-type sur 7 jours. Fitness = moyenne hebdomadaire des charges sur 28 jours.</p></div></div><div class="tablewrap"><table class="secure-table"><thead><tr><th>JOUEUR</th><th>CHARGE · 7 J</th><th>MONOTONIE · 7 J</th><th>FITNESS · 28 J</th><th>DERNIER RPE</th><th>SÉANCES SAISIES</th></tr></thead><tbody>${playerRows || '<tr><td colspan="6" class="secure-muted">Aucune donnée de charge pour le moment.</td></tr>'}</tbody></table></div>${toneLegend(WEEK_LOAD_LEGEND)}</section><section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">MODÈLE DES PROCHAINES SÉANCES</p><h2>Questionnaire de charge</h2><p>La durée et le RPE sont nécessaires au calcul. Les autres questions peuvent être ajoutées ou retirées.</p></div><button class="btn" data-action="new-workload-question">+ Ajouter une question</button></div><div class="tablewrap"><table class="secure-table"><thead><tr><th>QUESTION</th><th>TYPE / INDICATEUR</th><th></th></tr></thead><tbody>${active.map(questionRow).join('') || '<tr><td colspan="3" class="secure-muted">Ajoute les questions du questionnaire de charge.</td></tr>'}</tbody></table></div></section>${archived.length ? `<section class="secure-panel"><p class="eyebrow">QUESTIONS RETIRÉES</p><div class="tablewrap"><table class="secure-table"><tbody>${archived.map(questionRow).join('')}</tbody></table></div></section>` : ''}`;
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
      return `<tr class="secure-row-click" data-action="view-session" data-id="${html(session.id)}"><td><strong>${html(session.title)}</strong></td><td>${dateText(session.session_date)}</td><td>${session.session_type === 'match' ? 'Match' : 'Entraînement'}</td><td>${count} / ${playersActive}</td><td><span class="secure-tag">${session.status === 'open' ? 'Ouverte' : 'Clôturée'}</span></td><td><div class="secure-actions"><button class="btn secure-small" data-action="view-session" data-id="${html(session.id)}">Ouvrir</button><button class="btn button-secondary secure-small" data-action="edit-session" data-id="${html(session.id)}">Modifier</button>${session.status === 'open' ? `<button class="btn button-secondary secure-small" data-action="close-session" data-id="${html(session.id)}">Clôturer</button>` : ''}<button class="btn button-secondary secure-small" data-action="delete-session" data-id="${html(session.id)}">Supprimer</button></div></td></tr>`;
    }).join('');
    const results = selected
      ? `<section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">RÉSULTATS · ${dateText(selected.session_date)}</p><h2>${html(selected.title)} · ${responseCount} / ${playersActive} réponses</h2><p>Clique sur une séance de l’historique pour ouvrir son détail.</p></div></div>${renderResults(selected)}</section>`
      : '<section class="secure-panel secure-muted">Crée une séance pour afficher les résultats du questionnaire.</section>';
    return `<div class="secure-title"><div><p class="eyebrow">SUIVI U14 · LYON - LA DUCHÈRE</p><h1>Séances & réponses</h1><p>Les réponses et synthèses ne sont visibles que par ton compte admin.</p></div><button class="btn" data-action="new-session">+ Nouvelle séance</button></div><div class="secure-stat-grid"><article class="secure-stat"><span>SÉANCES CONSERVÉES</span><strong>${admin.sessions.length}</strong></article><article class="secure-stat"><span>RÉPONSES · SÉANCE SÉLECTIONNÉE</span><strong>${responseCount} / ${playersActive}</strong></article><article class="secure-stat"><span>MOYENNES PAR ÉCHELLE</span><strong>${scaleQuestions.length || '—'}</strong></article></div>${selected ? `<section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">SYNTHÈSE · ${dateText(selected.session_date)}</p><h2>${html(selected.title)}</h2></div></div><div class="secure-muted">${averages || 'Aucune question à échelle dans cette séance.'}</div></section>` : ''}${results}${wellnessLegend()}<section class="secure-panel"><div class="secure-title"><div><p class="eyebrow">HISTORIQUE</p><h2>Séances précédentes</h2></div></div><div class="tablewrap"><table class="secure-table"><thead><tr><th>SÉANCE</th><th>DATE</th><th>TYPE</th><th>RÉPONSES</th><th>ÉTAT</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="secure-muted">Aucune séance enregistrée.</td></tr>'}</tbody></table></div></section>`;
  }

  function renderQuestions() {
    const active = admin.questions.filter((question) => question.active);
    const archived = admin.questions.filter((question) => !question.active);
    const row = (question, index, list) => `<tr><td>${index + 1}</td><td><strong>${html(question.prompt)}</strong><div class="secure-muted">${html(question.help_text)}</div></td><td>${question.question_type === 'scale' ? `Échelle ${question.scale_min}–${question.scale_max}` : question.question_type === 'short_text' ? 'Texte court' : 'Choix unique'}</td><td>${question.required ? 'Obligatoire' : 'Facultative'}</td><td><div class="secure-actions"><button class="btn button-secondary secure-small" data-action="edit-question" data-id="${html(question.id)}">Modifier</button>${question.active ? `<button class="btn button-secondary secure-small" data-action="move-question" data-id="${html(question.id)}" data-direction="-1" ${index===0?'disabled':''}>↑</button><button class="btn button-secondary secure-small" data-action="move-question" data-id="${html(question.id)}" data-direction="1" ${index===list.length-1?'disabled':''}>↓</button><button class="btn secure-small" data-action="archive-question" data-id="${html(question.id)}">Retirer</button>` : `<button class="btn secure-small" data-action="restore-question" data-id="${html(question.id)}">Restaurer</button>`}</div></td></tr>`;
    return `<div class="secure-title"><div><p class="eyebrow">MODÈLE DES PROCHAINES SÉANCES</p><h1>Questionnaire wellness</h1><p>Les séances déjà créées gardent leurs questions d’origine.</p></div><button class="btn" data-action="new-question">+ Ajouter une question</button></div><section class="secure-panel"><div class="tablewrap"><table class="secure-table"><thead><tr><th>#</th><th>QUESTION</th><th>TYPE</th><th>RÉPONSE</th><th></th></tr></thead><tbody>${active.map((question,index)=>row(question,index,active)).join('') || '<tr><td colspan="5" class="secure-muted">Ajoute au moins une question pour créer une séance.</td></tr>'}</tbody></table></div></section>${archived.length ? `<section class="secure-panel"><p class="eyebrow">QUESTIONS RETIRÉES · CONSERVÉES DANS LES ANCIENNES SÉANCES</p><div class="tablewrap"><table class="secure-table"><tbody>${archived.map((question,index)=>row(question,index,archived)).join('')}</tbody></table></div></section>` : ''}`;
  }

  function renderPlayers() {
    const players = admin.players.filter((player) => player.active !== showArchivedPlayers);
    const rows = players.map((player) => `<tr><td><strong>${html(player.display_name)}</strong></td><td>${html(player.shirt_number ?? '—')}</td><td>${html(player.position || '—')}</td><td><div class="secure-actions"><button class="btn button-secondary secure-small" data-action="edit-player" data-id="${html(player.id)}">Modifier la fiche</button><button class="btn ${player.active ? 'button-secondary' : ''} secure-small" data-action="${player.active ? 'archive-player' : 'restore-player'}" data-id="${html(player.id)}">${player.active ? 'Retirer de l’effectif' : 'Réintégrer'}</button></div></td></tr>`).join('');
    return `<div class="secure-title"><div><p class="eyebrow">EFFECTIF DU GROUPE</p><h1>Joueurs U14</h1><p>Retirer un joueur l’archive de l’effectif sans effacer ses anciennes réponses.</p></div><button class="btn" data-action="new-player">+ Ajouter un joueur</button></div><section class="secure-panel"><div class="secure-actions" style="margin-bottom:12px"><button class="btn ${!showArchivedPlayers?'':'button-secondary'} secure-small" data-action="show-active">Effectif actif</button><button class="btn ${showArchivedPlayers?'':'button-secondary'} secure-small" data-action="show-archived">Joueurs retirés</button></div><div class="tablewrap"><table class="secure-table"><thead><tr><th>JOUEUR</th><th>N°</th><th>POSTE</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="secure-muted">Aucun joueur dans cette liste.</td></tr>'}</tbody></table></div></section>`;
  }

  function openManualResponseDialog(sessionId, playerId, kind) {
    const session = admin.sessions.find((item) => item.id === sessionId);
    const player = admin.players.find((item) => item.id === playerId);
    const questions = kind === 'workload'
      ? (session?.workload_snapshot || []).filter((question) => question.metricKey !== 'duration_minutes')
      : session?.form_snapshot || [];
    if (!session || !player || !questions.length) return;
    const title = kind === 'workload' ? 'Saisie manuelle · charge' : 'Saisie manuelle · wellness';
    const fields = questions.map((question, index) => {
      const required = question.required ? 'required' : '';
      let control = '';
      if (question.type === 'scale') {
        const values = Array.from({ length: question.scaleMax - question.scaleMin + 1 }, (_, offset) => question.scaleMin + offset);
        control = `<select data-entry-question="${html(question.id)}" ${required}><option value="">Choisir</option>${values.map((value) => `<option value="${value}">${value}</option>`).join('')}</select>`;
      } else if (question.type === 'number') {
        const duration = question.metricKey === 'duration_minutes';
        control = `<input data-entry-question="${html(question.id)}" type="number" min="${duration ? 1 : 0}" max="${duration ? 300 : 1000}" step="1" ${required}>`;
      } else if (question.type === 'single_choice') {
        control = `<select data-entry-question="${html(question.id)}" ${required}><option value="">Choisir</option>${question.options.map((option) => `<option value="${html(option)}">${html(option)}</option>`).join('')}</select>`;
      } else {
        control = `<textarea data-entry-question="${html(question.id)}" maxlength="500" rows="2" ${required}></textarea>`;
      }
      return `<label class="secure-field">${index + 1}. ${html(question.prompt)}${control}</label>`;
    }).join('');
    const matchEntry = kind === 'workload' && isMatch(session);
    const minutesField = matchEntry
      ? `<label class="secure-field">Temps de jeu (minutes)<input name="played_minutes" type="number" min="1" max="300" step="1" value="${html(session.duration_minutes ?? '')}" required></label>`
      : '';
    const dialog = openDialog(`<form id="manual-response-form"><h2>${title}</h2><p>${html(player.display_name)} · ${dateText(session.session_date)} · ${html(session.title)}</p>${minutesField}${fields}${kind === 'wellness' ? '<label class="secure-field">Note au staff<textarea name="note" maxlength="240" rows="2"></textarea></label>' : ''}<p class="secure-error" id="dialog-error" role="alert"></p><div class="secure-dialog-actions"><button class="btn button-secondary" type="button" data-action="close-dialog">Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>`);
    one('#manual-response-form', dialog).onsubmit = async (event) => {
      event.preventDefault();
      const answers = {};
      for (const question of questions) {
        const field = one(`[data-entry-question="${question.id}"]`, dialog);
        const value = field.value;
        if (question.required && value === '') {
          one('#dialog-error', dialog).textContent = 'Complète les réponses requises avant l’enregistrement.';
          return;
        }
        if (value !== '') answers[question.id] = question.type === 'scale' || question.type === 'number' ? Number(value) : value;
      }
      let result;
      if (kind === 'workload') {
        const rpeQuestion = questions.find((question) => question.metricKey === 'rpe');
        const rpe = Number(rpeQuestion && answers[rpeQuestion.id]);
        if (!rpeQuestion || !Number.isFinite(rpe) || rpe < 0 || rpe > 10) {
          one('#dialog-error', dialog).textContent = 'Vérifie le RPE avant l’enregistrement.';
          return;
        }
        let durationMinutes = session.duration_minutes;
        if (matchEntry) {
          durationMinutes = Number(one('[name="played_minutes"]', dialog).value);
          if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 300) {
            one('#dialog-error', dialog).textContent = 'Le temps de jeu doit être compris entre 1 et 300 minutes.';
            return;
          }
        }
        result = await client.from('workload_responses').insert({ session_id: session.id, player_id: player.id, answers, duration_minutes: durationMinutes, rpe });
      } else {
        result = await client.from('wellness_responses').insert({ session_id: session.id, player_id: player.id, answers, note: one('[name="note"]', dialog)?.value.trim() || '' });
      }
      if (result.error) {
        one('#dialog-error', dialog).textContent = 'Enregistrement impossible. Une réponse existe peut-être déjà.';
        return;
      }
      dialog.close();
      await loadAdmin();
      renderAdmin();
    };
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

  async function handleAttendanceChange(event) {
    const select = event.target.closest('select[data-attendance]');
    if (!select) return;
    const query = client.from('session_attendance');
    const result = select.value
      ? await query.upsert({
        session_id: select.dataset.sessionId,
        player_id: select.dataset.playerId,
        status: select.value,
        source: 'admin',
        updated_at: new Date().toISOString(),
      })
      : await query.delete().eq('session_id', select.dataset.sessionId).eq('player_id', select.dataset.playerId);
    if (result.error) {
      toast('Impossible de modifier cette présence.');
      return;
    }
    await loadAdmin();
    renderAdmin();
    toast('Présence mise à jour.');
  }

  async function handleSessionDurationChange(event) {
    const field = event.target.closest('.secure-session-duration');
    if (!field) return;
    const duration = field.value === '' ? null : Number(field.value);
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 300)) {
      toast('La durée doit être comprise entre 1 et 300 minutes.');
      return;
    }
    const { error } = await client.from('sessions').update({ duration_minutes: duration }).eq('id', field.dataset.sessionId);
    if (error) {
      toast('Impossible d’enregistrer la durée de la séance.');
      return;
    }
    await loadAdmin();
    renderAdmin();
    toast(duration === null ? 'Durée retirée; charges en attente.' : 'Durée enregistrée; charges recalculées.');
  }

  async function handlePlayerDurationChange(event) {
    const field = event.target.closest('.secure-player-duration');
    if (!field) return;
    const response = admin.workloadResponses.find((item) => item.session_id === field.dataset.sessionId && item.player_id === field.dataset.playerId);
    if (!response) return;
    const minutes = field.value === '' ? null : Number(field.value);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 300)) {
      toast('Le temps de jeu doit être compris entre 1 et 300 minutes.');
      return;
    }
    const { error } = await client.from('workload_responses').update({ duration_minutes: minutes }).eq('id', response.id);
    if (error) {
      toast('Impossible d’enregistrer le temps de jeu.');
      return;
    }
    await loadAdmin();
    renderAdmin();
    toast(minutes === null ? 'Temps de jeu retiré; charge en attente.' : 'Temps de jeu enregistré; charge recalculée.');
  }

  async function handleAnswerChange(event) {
    const field = event.target.closest('.secure-answer-edit');
    if (!field) return;
    const { answerKind, sessionId, playerId, questionId } = field.dataset;
    let result;
    if (answerKind === 'wellness') {
      const response = admin.responses.find((item) => item.session_id === sessionId && item.player_id === playerId);
      if (!response) return;
      const values = field.dataset.answerNote
        ? { note: field.value }
        : { answers: { ...response.answers, [questionId]: field.type === 'number' ? Number(field.value) : field.tagName === 'SELECT' && field.value !== '' && !Number.isNaN(Number(field.value)) ? Number(field.value) : field.value } };
      result = await client.from('wellness_responses').update(values).eq('id', response.id);
    } else {
      const response = admin.workloadResponses.find((item) => item.session_id === sessionId && item.player_id === playerId);
      const session = admin.sessions.find((item) => item.id === sessionId);
      if (!response || !session) return;
      const question = session.workload_snapshot?.find((item) => item.id === questionId);
      const value = field.type === 'number' ? Number(field.value) : field.tagName === 'SELECT' && field.value !== '' && !Number.isNaN(Number(field.value)) ? Number(field.value) : field.value;
      const answers = { ...response.answers, [questionId]: value };
      const values = { answers };
      if (question?.metricKey === 'duration_minutes') {
        if (field.value === '') {
          delete answers[questionId];
          values.duration_minutes = null;
        } else if (Number.isInteger(value) && value >= 1 && value <= 300) {
          values.duration_minutes = value;
        } else {
          toast('La durée doit être comprise entre 1 et 300 minutes.');
          return;
        }
      }
      if (question?.metricKey === 'rpe') values.rpe = value;
      result = await client.from('workload_responses').update(values).eq('id', response.id);
    }
    if (result?.error) {
      toast('Impossible d’enregistrer cette réponse.');
      return;
    }
    await loadAdmin();
    renderAdmin();
    toast('Réponse mise à jour.');
  }

  function openSessionDialog(session) {
    const editing = !!session;
    const dialog = openDialog(`<form id="session-form"><h2>${editing ? 'Modifier la séance' : 'Nouvelle séance U14'}</h2><label class="secure-field">Nom de la séance<input name="title" required maxlength="80" value="${html(session?.title || '')}" placeholder="Ex. Entraînement collectif"></label><label class="secure-field">Date<input name="session_date" type="date" required value="${html(session?.session_date || new Date().toLocaleDateString('sv-SE'))}"></label><label class="secure-field">Type<select name="session_type"><option value="training" ${session?.session_type !== 'match' ? 'selected' : ''}>Entraînement</option><option value="match" ${session?.session_type === 'match' ? 'selected' : ''}>Match</option></select></label><label class="secure-field">Durée commune à la séance (minutes)<input name="duration_minutes" type="number" min="1" max="300" step="1" value="${html(session?.duration_minutes ?? '')}" placeholder="Ex. 90"></label><p class="secure-error" id="dialog-error" role="alert"></p><div class="secure-dialog-actions"><button class="btn button-secondary" type="button" data-action="close-dialog">Annuler</button><button class="btn" type="submit">${editing ? 'Enregistrer' : 'Créer la séance'}</button></div></form>`);
    one('#session-form', dialog).onsubmit = async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const durationValue = String(formData.get('duration_minutes') || '');
      const durationMinutes = durationValue === '' ? null : Number(durationValue);
      if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 300)) {
        one('#dialog-error', dialog).textContent = 'La durée doit être comprise entre 1 et 300 minutes.';
        return;
      }
      if (editing) {
        const { error } = await client.from('sessions').update({
          title: String(formData.get('title')).trim(),
          session_date: formData.get('session_date'),
          session_type: formData.get('session_type'),
          duration_minutes: durationMinutes,
        }).eq('id', session.id);
        if (error) {
          one('#dialog-error', dialog).textContent = 'Impossible de modifier la séance.';
          return;
        }
        if (formData.get('session_type') !== 'match') {
          await client.from('session_attendance').update({ status: 'absent', source: 'admin' })
            .eq('session_id', session.id).in('status', ['not_called', 'injured', 'called_u15']);
        }
        dialog.close();
        await loadAdmin();
        renderAdmin();
        return;
      }
      const { data, error } = await client.functions.invoke('create-session-links', { body: { title: formData.get('title'), sessionDate: formData.get('session_date'), sessionType: formData.get('session_type'), durationMinutes } });
      if (error || !data?.sharedUrl) {
        one('#dialog-error', dialog).textContent = data?.error || 'Impossible de créer la séance. Vérifie les joueurs et les questions.';
        return;
      }
      dialog.close();
      await loadAdmin();
      activeTab = 'sessions';
      renderAdmin();
      openInviteDialog(data.sharedUrl, data.session.title);
    };
  }

  function openDeleteSessionDialog(session) {
    const dialog = openDialog(`<form id="delete-session-form"><h2>Supprimer cette séance ?</h2><p>« ${html(session.title)} » et toutes les réponses associées seront supprimées définitivement.</p><p class="secure-error" id="dialog-error" role="alert"></p><div class="secure-dialog-actions"><button class="btn button-secondary" type="button" data-action="close-dialog">Annuler</button><button class="btn" type="submit">Supprimer la séance</button></div></form>`);
    one('#delete-session-form', dialog).onsubmit = async (event) => {
      event.preventDefault();
      const { error } = await client.from('sessions').delete().eq('id', session.id);
      if (error) {
        one('#dialog-error', dialog).textContent = 'Impossible de supprimer la séance.';
        return;
      }
      dialog.close();
      selectedSessionId = '';
      detailSessionId = '';
      await loadAdmin();
      renderAdmin();
    };
  }

  function openInviteDialog(sharedUrl, title) {
    const dialog = openDialog(`<div class="secure-dialog-content"><h2>${html(title)} · lien joueurs</h2><p>Envoie ce lien unique à tout le groupe : chaque joueur choisit son prénom puis répond.</p><div class="invite-row"><strong>Lien commun</strong><input id="shared-invite-url" readonly aria-label="Lien commun du questionnaire"><button id="copy-shared-link" type="button">Copier</button></div><div class="secure-dialog-actions"><button class="btn" type="button" data-action="close-dialog">Terminé</button></div></div>`);
    one('#shared-invite-url', dialog).value = sharedUrl;
    one('#copy-shared-link', dialog).onclick = async () => {
      await navigator.clipboard.writeText(sharedUrl);
      one('#copy-shared-link', dialog).textContent = 'Copié';
    };
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

  function openWorkloadQuestionDialog(question) {
    const editing = !!question;
    const metricKey = question?.metric_key || null;
    const selectedType = question?.question_type || 'short_text';
    const dialog = openDialog(`<form id="workload-question-form"><h2>${editing ? 'Modifier la question charge' : 'Ajouter une question charge'}</h2><label class="secure-field">Question<input name="prompt" required maxlength="180" value="${html(question?.prompt || '')}"></label><label class="secure-field">Aide ou précision<textarea name="help_text" maxlength="240" rows="2">${html(question?.help_text || '')}</textarea></label>${metricKey ? `<p class="secure-tag">Champ de calcul protégé : ${metricKey === 'rpe' ? 'RPE' : 'durée'}</p>` : `<label class="secure-field">Type de réponse<select name="question_type"><option value="short_text" ${selectedType === 'short_text' ? 'selected' : ''}>Texte court</option><option value="number" ${selectedType === 'number' ? 'selected' : ''}>Nombre</option><option value="scale" ${selectedType === 'scale' ? 'selected' : ''}>Échelle chiffrée</option><option value="single_choice" ${selectedType === 'single_choice' ? 'selected' : ''}>Choix unique</option></select></label>`}<div class="scale-fields"><label class="secure-field">Minimum<input name="scale_min" type="number" min="0" max="9" value="${question?.scale_min ?? 1}"></label><label class="secure-field">Maximum<input name="scale_max" type="number" min="1" max="10" value="${question?.scale_max ?? 5}"></label><label class="secure-field">Libellé du minimum<input name="min_label" maxlength="40" value="${html(question?.min_label || '')}"></label><label class="secure-field">Libellé du maximum<input name="max_label" maxlength="40" value="${html(question?.max_label || '')}"></label></div><label class="secure-field choice-fields" hidden>Choix (un par ligne)<textarea name="options" rows="4">${html((question?.options || []).join('\n'))}</textarea></label><label class="secure-check"><input name="required" type="checkbox" ${question?.required !== false ? 'checked' : ''}> Réponse requise</label><p class="secure-error" id="dialog-error" role="alert"></p><div class="secure-dialog-actions"><button class="btn button-secondary" type="button" data-action="close-dialog">Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>`);
    const form = one('#workload-question-form', dialog);
    const toggleType = () => {
      const type = metricKey === 'rpe' ? 'scale' : metricKey === 'duration_minutes' ? 'number' : form.elements.question_type.value;
      one('.scale-fields', form).hidden = type !== 'scale';
      one('.choice-fields', form).hidden = type !== 'single_choice';
    };
    if (!metricKey) form.elements.question_type.onchange = toggleType;
    toggleType();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const type = metricKey === 'rpe' ? 'scale' : metricKey === 'duration_minutes' ? 'number' : form.elements.question_type.value;
      const options = type === 'single_choice' ? form.elements.options.value.split('\n').map((value) => value.trim()).filter(Boolean) : [];
      const values = {
        prompt: form.elements.prompt.value.trim(),
        help_text: form.elements.help_text.value.trim(),
        question_type: type,
        metric_key: metricKey,
        required: metricKey ? true : form.elements.required.checked,
        scale_min: type === 'scale' ? Number(form.elements.scale_min.value) : null,
        scale_max: type === 'scale' ? Number(form.elements.scale_max.value) : null,
        min_label: type === 'scale' ? form.elements.min_label.value.trim() : '',
        max_label: type === 'scale' ? form.elements.max_label.value.trim() : '',
        options,
        active: question?.active ?? true,
        sort_order: question?.sort_order ?? admin.workloadQuestions.length + 1,
      };
      if (type === 'scale' && (values.scale_min >= values.scale_max || values.scale_min < 0 || values.scale_max > 10)) {
        one('#dialog-error', dialog).textContent = 'Choisis une échelle croissante entre 0 et 10.';
        return;
      }
      if (type === 'single_choice' && (options.length < 2 || options.length > 10)) {
        one('#dialog-error', dialog).textContent = 'Ajoute entre 2 et 10 choix.';
        return;
      }
      const result = editing
        ? await client.from('workload_questions').update(values).eq('id', question.id)
        : await client.from('workload_questions').insert(values);
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
    else if (action === 'edit-session') openSessionDialog(admin.sessions.find((item) => item.id === id));
    else if (action === 'delete-session') openDeleteSessionDialog(admin.sessions.find((item) => item.id === id));
    else if (action === 'new-question') openQuestionDialog();
    else if (action === 'edit-question') openQuestionDialog(admin.questions.find((item) => item.id === id));
    else if (action === 'new-workload-question') openWorkloadQuestionDialog();
    else if (action === 'edit-workload-question') openWorkloadQuestionDialog(admin.workloadQuestions.find((item) => item.id === id));
    else if (action === 'enter-wellness') openManualResponseDialog(button.dataset.sessionId, button.dataset.playerId, 'wellness');
    else if (action === 'enter-workload') openManualResponseDialog(button.dataset.sessionId, button.dataset.playerId, 'workload');
    else if (action === 'archive-workload-question' || action === 'restore-workload-question') {
      const { error } = await client.from('workload_questions').update({ active: action === 'restore-workload-question' }).eq('id', id);
      if (error) toast('Impossible de modifier la question charge.');
      else { await loadAdmin(); renderAdmin(); }
    }
    else if (action === 'new-player') openPlayerDialog();
    else if (action === 'edit-player') openPlayerDialog(admin.players.find((item) => item.id === id));
    else if (action === 'view-session') { selectedSessionId = id; detailSessionId = id; activeTab = 'sessions'; renderAdmin(); window.scrollTo(0, 0); }
    else if (action === 'show-link') {
      const target = admin.sessions.find((item) => item.id === id);
      if (target?.shared_token) openInviteDialog(`${location.origin}${location.pathname}?token=s-${target.shared_token}`, target.title);
    }
    else if (action === 'back-sessions') { activeTab = 'sessions'; detailSessionId = ''; renderAdmin(); }
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
