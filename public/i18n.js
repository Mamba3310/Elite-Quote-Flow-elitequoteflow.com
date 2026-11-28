(() => {
  'use strict';

  const LANGUAGES = [
    ['en', 'English', 'us'],
    ['fr', 'Français', 'fr'],
    ['es', 'Español', 'es'],
    ['pt', 'Português', 'br'],
    ['zh', '中文', 'cn']

  ];
  const rows = [
    ['Language', 'Langue', 'Idioma', 'Idioma', '语言'],
    ['Sign in', 'Connexion', 'Entrar', 'Entrar', '登录'],
    ['Sign out', 'Déconnexion', 'Salir', 'Sair', '退出'],
    ['Start free', 'Commencer gratuitement', 'Empezar gratis', 'Começar grátis', '免费开始'],
    ['For landscapers', 'Pour les paysagistes', 'Para paisajistas', 'Para paisagistas', '面向园艺公司'],
    ['All service pros', 'Tous les services', 'Todos los oficios', 'Todos os serviços', '所有服务行业'],
    ['Send the quote.', 'Envoyez le devis.', 'Envíe el presupuesto.', 'Envie o orçamento.', '发送报价。'],
    ['Win the follow-up.', 'Gagnez le suivi.', 'Gane el seguimiento.', 'Ganhe o acompanhamento.', '赢得后续跟进。'],
    ['Create your free account', 'Créer votre compte gratuit', 'Cree su cuenta gratis', 'Crie sua conta grátis', '创建免费账户'],
    ['Already have an account? Sign in', 'Vous avez déjà un compte ? Connexion', '¿Ya tiene cuenta? Entrar', 'Já tem conta? Entrar', '已有账户？登录'],
    ['Overview', 'Aperçu', 'Resumen', 'Visão geral', '概览'],
    ['Site analytics', 'Analytique du site', 'Analítica del sitio', 'Análise do site', '网站分析'],
    ['Quotes', 'Devis', 'Presupuestos', 'Orçamentos', '报价'],
    ['Follow-ups', 'Suivis', 'Seguimientos', 'Acompanhamentos', '跟进事项'],
    ['Follow-up', 'Suivi', 'Seguimiento', 'Acompanhamento', '跟进'],
    ['Calendar', 'Calendrier', 'Calendario', 'Calendário', '日历'],
    ['Calculator', 'Calculateur', 'Calculadora', 'Calculadora', '计算器'],
    ['Templates', 'Modèles', 'Plantillas', 'Modelos', '模板'],
    ['Customer history', 'Historique client', 'Historial del cliente', 'Histórico do cliente', '客户记录'],
    ['Invoices', 'Factures', 'Facturas', 'Faturas', '发票'],
    ['Appointments', 'Rendez-vous', 'Citas', 'Compromissos', '预约'],
    ['Import estimate', 'Importer un devis', 'Importar un presupuesto', 'Importar um orçamento', '导入估价'],
    ['Invite a friend', 'Inviter un ami', 'Invitar a un amigo', 'Convidar um amigo', '邀请朋友'],
    ['Online now', 'En ligne', 'En línea', 'Online agora', '当前在线'],
    ['Free is included', 'Le gratuit est inclus', 'Lo gratis está incluido', 'O grátis está incluído', '已包含免费功能'],
    ['on every account', 'sur chaque compte', 'en cada cuenta', 'em cada conta', '在每个账户中'],
    ['Cloud sync', 'Cloud', 'Nube', 'Nuvem', '云同步'],
    ['Syncing your account', 'Synchronisation', 'Sincronizando', 'Sincronizando', '正在同步'],
    ['Account', 'Compte', 'Cuenta', 'Conta', '账户'],
    ['Your profile', 'Votre profil', 'Su perfil', 'Seu perfil', '你的资料'],
    ['Good morning', 'Bonjour', 'Buenos días', 'Bom dia', '早上好'],
    ['Good afternoon', 'Bon après-midi', 'Buenas tardes', 'Boa tarde', '下午好'],
    ['Good evening', 'Bonsoir', 'Buenas noches', 'Boa noite', '晚上好'],
    ['New quote', 'Nouveau devis', 'Nuevo presupuesto', 'Novo orçamento', '新建报价'],
    ['Customers', 'Clients', 'Clientes', 'Clientes', '客户'],
    ['Accounting', 'Comptabilité', 'Contabilidad', 'Contabilidade', '会计'],
    ['Contacts', 'Contacts', 'Contactos', 'Contatos', '联系人'],
    ['Welcome back.', 'Bon retour.', 'Bienvenido de nuevo.', 'Bom ver você de novo.', '欢迎回来。'],
    ['Continue with Google', 'Continuer avec Google', 'Continuar con Google', 'Continuar com o Google', '使用 Google 继续'],
    ['or use your email', 'ou utilisez votre e-mail', 'o use su correo', 'ou use seu e-mail', '或使用邮箱'],
    ['Password', 'Mot de passe', 'Contraseña', 'Senha', '密码'],
    ['Forgot password?', 'Mot de passe oublié ?', '¿Olvidó la contraseña?', 'Esqueceu a senha?', '忘记密码？'],
    ['New to Elite Quote Flow?', 'Nouveau sur Elite Quote Flow ?', '¿Nuevo en Elite Quote Flow?', 'Novo no Elite Quote Flow?', '第一次使用 Elite Quote Flow？'],
    ['Create an account', 'Créer un compte', 'Crear una cuenta', 'Criar uma conta', '创建一个账户'],
    ['Create account', 'Créer le compte', 'Crear cuenta', 'Criar conta', '创建账户'],
    ['Full name', 'Nom complet', 'Nombre completo', 'Nome completo', '全名'],
    ['Address', 'Adresse', 'Dirección', 'Endereço', '地址'],
    ['Your quotes', 'Vos devis', 'Sus presupuestos', 'Seus orçamentos', '你的报价'],
    ['All', 'Tous', 'Todos', 'Todos', '全部'],
    ['Upcoming', 'À venir', 'Próximos', 'Próximos', '即将到来'],
    ['Awaiting', 'En attente', 'En espera', 'Aguardando', '等待中'],
    ['Accepted', 'Accepté', 'Aceptado', 'Aceito', '已接受'],
    ['Closed', 'Fermé', 'Cerrado', 'Encerrado', '已关闭'],
    ['Sort', 'Trier', 'Ordenar', 'Ordenar', '排序'],
    ['Today', 'Aujourd’hui', 'Hoy', 'Hoje', '今天'],
    ['Need a hand?', 'Besoin d’aide ?', '¿Necesita ayuda?', 'Precisa de ajuda?', '需要帮忙吗？'],
    ['Yes, help me', 'Oui, aidez-moi', 'Sí, ayúdeme', 'Sim, me ajude', '好，帮帮我'],
    ['Not now', 'Pas maintenant', 'Ahora no', 'Agora não', '暂时不用'],
    ['Ask me a question.', 'Posez-moi une question.', 'Hágame una pregunta.', 'Faça uma pergunta.', '问我一个问题。'],
    ['Send', 'Envoyer', 'Enviar', 'Enviar', '发送'],
    ['Cancel', 'Annuler', 'Cancelar', 'Cancelar', '取消'],
    ['Quote Desk', 'Bureau des devis', 'Mesa de presupuestos', 'Mesa de orçamentos', '报价台'],
    ['OPEN QUOTE VALUE', 'VALEUR DES DEVIS OUVERTS', 'VALOR DE PRESUPUESTOS ABIERTOS', 'VALOR DOS ORÇAMENTOS ABERTOS', '未决报价金额'],
    ['FOLLOW-UPS DUE', 'SUIVIS À FAIRE', 'SEGUIMIENTOS PENDIENTES', 'ACOMPANHAMENTOS VENCIDOS', '待跟进'],
    ['ACCEPTED THIS MONTH', 'ACCEPTÉ CE MOIS', 'ACEPTADO ESTE MES', 'ACEITO NESTE MÊS', '本月已接受'],
    ['ACCEPTANCE RATE', 'TAUX D’ACCEPTATION', 'TASA DE ACEPTACIÓN', 'TAXA DE ACEITAÇÃO', '接受率'],
    ['Message', 'Message', 'Mensaje', 'Mensagem', '消息'],
    ['Deposits', 'Acomptes', 'Anticipos', 'Sinais', '定金'],
    ['Exports', 'Exports', 'Exportaciones', 'Exportações', '导出'],
    ['Teams', 'Équipes', 'Equipos', 'Equipes', '团队'],
    ['Recurring', 'Récurrent', 'Recurrente', 'Recorrente', '循环'],
    ['Referrals', 'Parrainages', 'Referencias', 'Indicações', '推荐'],
    ['Search customer or service…', 'Rechercher un client ou un service…', 'Buscar cliente o servicio…', 'Buscar cliente ou serviço…', '搜索客户或服务…'],
    ['Previous month', 'Mois précédent', 'Mes anterior', 'Mês anterior', '上个月'],
    ['Next month', 'Mois suivant', 'Mes siguiente', 'Próximo mês', '下个月'],
    ['Enable reminders', 'Activer les rappels', 'Activar recordatorios', 'Ativar lembretes', '开启提醒'],
    ['Add quote', 'Ajouter un devis', 'Añadir presupuesto', 'Adicionar orçamento', '添加报价'],
    ['Import local quotes', 'Importer les devis locaux', 'Importar presupuestos locales', 'Importar orçamentos locais', '导入本地报价'],
    ['QUOTE DESK', 'BUREAU DES DEVIS', 'MESA DE PRESUPUESTOS', 'MESA DE ORÇAMENTOS', '报价台'],
    ['Attachments', 'Pièces jointes', 'Archivos adjuntos', 'Anexos', '附件'],
    ['Up to 3 files, 2 MB each. PDF, image, text, or CSV. Email only.', 'Jusqu’à 3 fichiers, 2 Mo chacun. PDF, image, texte ou CSV. E-mail seulement.', 'Hasta 3 archivos, 2 MB cada uno. PDF, imagen, texto o CSV. Solo correo.', 'Até 3 arquivos, 2 MB cada. PDF, imagem, texto ou CSV. Somente e-mail.', '最多 3 个文件，每个 2 MB。PDF、图片、文本或 CSV。仅限邮件。'],
    ['Send to several customers', 'Envoyer à plusieurs clients', 'Enviar a varios clientes', 'Enviar para vários clientes', '发送给多位客户'],
    ['Select all', 'Tout sélectionner', 'Seleccionar todo', 'Selecionar tudo', '全选'],
    ['One send can include 25 customers. Use {{customer}} where the name should appear.', 'Un envoi peut inclure 25 clients. Utilisez {{customer}} là où le nom doit apparaître.', 'Un envío puede incluir 25 clientes. Use {{customer}} donde deba aparecer el nombre.', 'Um envio pode incluir 25 clientes. Use {{customer}} onde o nome deve aparecer.', '一次最多发送给 25 位客户。在需要显示姓名的地方使用 {{customer}}。'],
    ['Add an email on a quote before sending to several customers.', 'Ajoutez un e-mail sur un devis avant d’envoyer à plusieurs clients.', 'Añada un correo en un presupuesto antes de enviar a varios clientes.', 'Adicione um e-mail em um orçamento antes de enviar para vários clientes.', '先在报价上添加邮箱，再发送给多位客户。'],
    ['Choose at least one customer.', 'Choisissez au moins un client.', 'Elija al menos un cliente.', 'Escolha pelo menos um cliente.', '至少选择一位客户。'],
    ['Choose up to 25 customers in one send.', 'Choisissez jusqu’à 25 clients par envoi.', 'Elija hasta 25 clientes en un envío.', 'Escolha até 25 clientes em um envio.', '一次最多选择 25 位客户。', 'Yan oníbàárà tí kò ju 25 lọ ní ìfiránṣẹ́ kan.']
  ];
  const phrases = { fr: {}, es: {}, pt: {}, zh: {} };
  const codes = ['fr', 'es', 'pt', 'zh'];
  for (const row of rows) {
    codes.forEach((code, index) => { phrases[code][row[0]] = row[index + 1]; });
  }
  const reverse = Object.fromEntries(codes.map(code => [code, new Map(Object.entries(phrases[code]).map(([english, value]) => [value, english]))]));
  const english = new Set(rows.map(row => row[0]));
  let current = 'en';
  const skip = '.language-switch, [data-assistant], #quote-rows, #invoice-rows, #customer-history, #history-detail, #recurring-list, #booking-list, #growth-report, #team-members-list, #template-list, #toast';

  function sourceOf(text) {
    if (english.has(text)) return text;
    for (const map of Object.values(reverse)) {
      if (map.has(text)) return map.get(text);
    }
    return '';
  }

  function translated(englishText) {
    if (!englishText) return '';
    if (current === 'en') return englishText;
    return phrases[current][englishText] || englishText;
  }

  function applyTo(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest(skip)) continue;
      const raw = node.nodeValue;
      if (!raw || !raw.trim()) continue;
      const trimmed = raw.trim();
      const englishText = sourceOf(trimmed);
      if (!englishText) continue;
      const next = translated(englishText);
      if (next !== trimmed) node.nodeValue = raw.replace(trimmed, next);
    }
    root.querySelectorAll('[placeholder], [aria-label], [title]').forEach(element => {
      if (element.closest('.language-switch')) return;
      for (const attr of ['placeholder', 'aria-label', 'title']) {
        const value = element.getAttribute(attr);
        if (!value) continue;
        const englishText = sourceOf(value.trim());
        if (!englishText) continue;
        const next = translated(englishText);
        if (next !== value) element.setAttribute(attr, value.replace(value.trim(), next));
      }
    });
  }

  function ensureFont() {
    if (current !== 'zh') return;
    if (document.getElementById('eqf-language-font')) return;
    const link = document.createElement('link');
    link.id = 'eqf-language-font';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&family=Noto+Sans+SC:wght@400;600;700&display=swap';
    document.head.appendChild(link);
  }

  function paintLanguageSwitch(select) {
    const label = select.closest('.language-switch');
    if (!label) return;
    let menu = label.querySelector('.language-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'language-menu';
      const currentButton = document.createElement('button');
      currentButton.type = 'button';
      currentButton.className = 'language-current';
      currentButton.setAttribute('aria-haspopup', 'listbox');
      currentButton.setAttribute('aria-expanded', 'false');
      const list = document.createElement('div');
      list.className = 'language-list';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', 'Language');
      menu.append(currentButton, list);
      label.append(menu);
      currentButton.addEventListener('click', () => {
        const open = menu.classList.toggle('open');
        currentButton.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', event => {
        if (!label.contains(event.target)) {
          menu.classList.remove('open');
          currentButton.setAttribute('aria-expanded', 'false');
        }
      });
    }
    const list = menu.querySelector('.language-list');
    list.replaceChildren(...LANGUAGES.map(([code, name, flag]) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'language-option';
      option.dataset.lang = code;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', code === current ? 'true' : 'false');
      option.innerHTML = `<img src="flags/${flag}.svg" alt="" width="18" height="12"><span></span>`;
      option.querySelector('span').textContent = name;
      option.addEventListener('click', () => {
        menu.classList.remove('open');
        menu.querySelector('.language-current').setAttribute('aria-expanded', 'false');
        setLanguage(code);
      });
      return option;
    }));
    const chosen = LANGUAGES.find(([code]) => code === current) || LANGUAGES[0];
    const currentButton = menu.querySelector('.language-current');
    currentButton.innerHTML = `<img src="flags/${chosen[2]}.svg" alt="" width="18" height="12"><span></span>`;
    currentButton.querySelector('span').textContent = chosen[1];
    currentButton.setAttribute('aria-label', chosen[1]);
  }
  function fillSelects() {
    document.querySelectorAll('.language-switch-select').forEach(select => {
      if (!select.options.length) {
        select.innerHTML = LANGUAGES.map(([code, label]) => `<option value="${code}">${label}</option>`).join('');
        select.addEventListener('change', () => setLanguage(select.value));
      }
      select.value = current;
      paintLanguageSwitch(select);
    });
  }

  function setLanguage(code) {
    current = LANGUAGES.some(([value]) => value === code) ? code : 'en';
    try { localStorage.setItem('eqf-language', current); } catch { /* storage can be blocked */ }
    document.documentElement.lang = current;
    ensureFont();
    if (typeof window.eqfOnLanguage === 'function') window.eqfOnLanguage();
    applyTo(document.body);
    fillSelects();
  }

  function detect() {
    try {
      const saved = localStorage.getItem('eqf-language');
      if (LANGUAGES.some(([code]) => code === saved)) return saved;
    } catch { /* storage can be blocked */ }
    const nav = (navigator.language || 'en').toLowerCase();
    if (nav.startsWith('zh')) return 'zh';
    const base = nav.split('-')[0];
    return LANGUAGES.some(([code]) => code === base) ? base : 'en';
  }

  window.eqfTranslate = text => translated(sourceOf(String(text || '').trim()) || text);
  window.eqfApplyLanguage = () => setLanguage(current);
  window.eqfLanguage = () => current;

  function start() {
    setLanguage(detect());
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        observer.disconnect();
        applyTo(document.body);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
