(() => {
  'use strict';

  const LANGUAGES = [
    ['en', 'English'],
    ['fr', 'Français'],
    ['es', 'Español'],
    ['pt', 'Português'],
    ['zh', '中文'],
    ['yo', 'Yorùbá']
  ];
  const rows = [
    ['Language', 'Langue', 'Idioma', 'Idioma', '语言', 'Èdè'],
    ['Sign in', 'Connexion', 'Entrar', 'Entrar', '登录', 'Wọlé'],
    ['Sign out', 'Déconnexion', 'Salir', 'Sair', '退出', 'Jáde'],
    ['Start free', 'Commencer gratuitement', 'Empezar gratis', 'Começar grátis', '免费开始', 'Bẹ̀rẹ̀ lọ́fẹ̀ẹ́'],
    ['For landscapers', 'Pour les paysagistes', 'Para paisajistas', 'Para paisagistas', '面向园艺公司', 'Fún àwọn olùtọ́jú ọgbà'],
    ['All service pros', 'Tous les services', 'Todos los oficios', 'Todos os serviços', '所有服务行业', 'Gbogbo iṣẹ́'],
    ['24/7 AI help', 'Aide IA 24h/24', 'Ayuda de IA 24/7', 'Ajuda de IA 24/7', '全天候 AI 帮助', 'Ìrànlọ́wọ́ AI ní gbogbo ìgbà'],
    ['Send the quote.', 'Envoyez le devis.', 'Envíe el presupuesto.', 'Envie o orçamento.', '发送报价。', 'Fi ìdíyelé ránṣẹ́.'],
    ['Win the follow-up.', 'Gagnez le suivi.', 'Gane el seguimiento.', 'Ganhe o acompanhamento.', '赢得后续跟进。', 'Jèrè àtẹ̀lé.'],
    ['Create your free account', 'Créer votre compte gratuit', 'Cree su cuenta gratis', 'Crie sua conta grátis', '创建免费账户', 'Ṣẹ̀dá àkántì ọ̀fẹ́ẹ́ rẹ'],
    ['Already have an account? Sign in', 'Vous avez déjà un compte ? Connexion', '¿Ya tiene cuenta? Entrar', 'Já tem conta? Entrar', '已有账户？登录', 'O ní àkántì tẹ́lẹ̀? Wọlé'],
    ['Overview', 'Aperçu', 'Resumen', 'Visão geral', '概览', 'Àkópọ̀'],
    ['Site analytics', 'Analytique du site', 'Analítica del sitio', 'Análise do site', '网站分析', 'Àyẹ̀wò ojú òpó'],
    ['Quotes', 'Devis', 'Presupuestos', 'Orçamentos', '报价', 'Àwọn ìdíyelé'],
    ['Follow-ups', 'Suivis', 'Seguimientos', 'Acompanhamentos', '跟进事项', 'Àwọn àtẹ̀lé'],
    ['Follow-up', 'Suivi', 'Seguimiento', 'Acompanhamento', '跟进', 'Àtẹ̀lé'],
    ['Calendar', 'Calendrier', 'Calendario', 'Calendário', '日历', 'Kàlẹ́ndà'],
    ['Calculator', 'Calculateur', 'Calculadora', 'Calculadora', '计算器', 'Ẹ̀rọ ìṣirò'],
    ['Templates', 'Modèles', 'Plantillas', 'Modelos', '模板', 'Àwọn àpẹẹrẹ'],
    ['Customer history', 'Historique client', 'Historial del cliente', 'Histórico do cliente', '客户记录', 'Ìtàn oníbàárà'],
    ['Invoices', 'Factures', 'Facturas', 'Faturas', '发票', 'Àwọn ìnwọ́ìsì'],
    ['Appointments', 'Rendez-vous', 'Citas', 'Compromissos', '预约', 'Àwọn ìpàdé'],
    ['Import estimate', 'Importer un devis', 'Importar un presupuesto', 'Importar um orçamento', '导入估价', 'Gbé ìdíyelé wọlé'],
    ['Invite a friend', 'Inviter un ami', 'Invitar a un amigo', 'Convidar um amigo', '邀请朋友', 'Pè ọ̀rẹ́'],
    ['Online now', 'En ligne', 'En línea', 'Online agora', '当前在线', 'Ó wà báyìí'],
    ['Ask the assistant', 'Demander à l’assistant', 'Preguntar a la asistente', 'Falar com a assistente', '询问助手', 'Bèèrè lọ́wọ́ olùrànlọ́wọ́'],
    ['Free is included', 'Le gratuit est inclus', 'Lo gratis está incluido', 'O grátis está incluído', '已包含免费功能', 'Ọ̀fẹ́ẹ́ wà nínú'],
    ['on every account', 'sur chaque compte', 'en cada cuenta', 'em cada conta', '在每个账户中', 'gbogbo àkántì'],
    ['Cloud sync', 'Cloud', 'Nube', 'Nuvem', '云同步', 'Àwọsánmà'],
    ['Syncing your account', 'Synchronisation', 'Sincronizando', 'Sincronizando', '正在同步', 'Ń dọ́gba'],
    ['Account', 'Compte', 'Cuenta', 'Conta', '账户', 'Àkántì'],
    ['Your profile', 'Votre profil', 'Su perfil', 'Seu perfil', '你的资料', 'Profáìlì rẹ'],
    ['Good morning', 'Bonjour', 'Buenos días', 'Bom dia', '早上好', 'Ẹ kú àárọ̀'],
    ['Good afternoon', 'Bon après-midi', 'Buenas tardes', 'Boa tarde', '下午好', 'Ẹ kú ọ̀sán'],
    ['Good evening', 'Bonsoir', 'Buenas noches', 'Boa noite', '晚上好', 'Ẹ kú ìrọ̀lẹ́'],
    ['New quote', 'Nouveau devis', 'Nuevo presupuesto', 'Novo orçamento', '新建报价', 'Ìdíyelé tuntun'],
    ['Customers', 'Clients', 'Clientes', 'Clientes', '客户', 'Àwọn oníbàárà'],
    ['Accounting', 'Comptabilité', 'Contabilidad', 'Contabilidade', '会计', 'Ìṣirò owó'],
    ['Contacts', 'Contacts', 'Contactos', 'Contatos', '联系人', 'Àwọn olùbásọ̀rọ̀'],
    ['Welcome back.', 'Bon retour.', 'Bienvenido de nuevo.', 'Bom ver você de novo.', '欢迎回来。', 'Káàbọ̀ padà.'],
    ['Continue with Google', 'Continuer avec Google', 'Continuar con Google', 'Continuar com o Google', '使用 Google 继续', 'Tẹ̀síwájú pẹ̀lú Google'],
    ['or use your email', 'ou utilisez votre e-mail', 'o use su correo', 'ou use seu e-mail', '或使用邮箱', 'tàbí lo ímeèlì rẹ'],
    ['Password', 'Mot de passe', 'Contraseña', 'Senha', '密码', 'Ọ̀rọ̀ aṣínà'],
    ['Forgot password?', 'Mot de passe oublié ?', '¿Olvidó la contraseña?', 'Esqueceu a senha?', '忘记密码？', 'O gbàgbé ọ̀rọ̀ aṣínà?'],
    ['New to Elite Quote Flow?', 'Nouveau sur Elite Quote Flow ?', '¿Nuevo en Elite Quote Flow?', 'Novo no Elite Quote Flow?', '第一次使用 Elite Quote Flow？', 'O ṣẹ̀ṣẹ̀ dé Elite Quote Flow?'],
    ['Create an account', 'Créer un compte', 'Crear una cuenta', 'Criar uma conta', '创建一个账户', 'Ṣẹ̀dá àkántì kan'],
    ['Create account', 'Créer le compte', 'Crear cuenta', 'Criar conta', '创建账户', 'Ṣẹ̀dá àkántì'],
    ['Full name', 'Nom complet', 'Nombre completo', 'Nome completo', '全名', 'Orúkọ kíkún'],
    ['Address', 'Adresse', 'Dirección', 'Endereço', '地址', 'Àdírẹ́sì'],
    ['Your quotes', 'Vos devis', 'Sus presupuestos', 'Seus orçamentos', '你的报价', 'Àwọn ìdíyelé rẹ'],
    ['All', 'Tous', 'Todos', 'Todos', '全部', 'Gbogbo'],
    ['Upcoming', 'À venir', 'Próximos', 'Próximos', '即将到来', 'Tó ń bọ̀'],
    ['Awaiting', 'En attente', 'En espera', 'Aguardando', '等待中', 'Ń dúró'],
    ['Accepted', 'Accepté', 'Aceptado', 'Aceito', '已接受', 'Tí a gbà'],
    ['Closed', 'Fermé', 'Cerrado', 'Encerrado', '已关闭', 'Tí a ti'],
    ['Sort', 'Trier', 'Ordenar', 'Ordenar', '排序', 'Ṣàtò'],
    ['Today', 'Aujourd’hui', 'Hoy', 'Hoje', '今天', 'Òní'],
    ['Need a hand?', 'Besoin d’aide ?', '¿Necesita ayuda?', 'Precisa de ajuda?', '需要帮忙吗？', 'Ṣé o nílò ìrànlọ́wọ́?'],
    ['I can walk you through it.', 'Je peux vous guider.', 'Puedo guiarle.', 'Posso orientar você.', '我可以带你了解。', 'Mo lè ṣe àfihàn rẹ̀ fún ọ.'],
    ['Yes, help me', 'Oui, aidez-moi', 'Sí, ayúdeme', 'Sim, me ajude', '好，帮帮我', 'Bẹ́ẹ̀ni, ràn mí lọ́wọ́'],
    ['Not now', 'Pas maintenant', 'Ahora no', 'Agora não', '暂时不用', 'Kì í ṣe nísinsìnyí'],
    ['Ask me a question.', 'Posez-moi une question.', 'Hágame una pregunta.', 'Faça uma pergunta.', '问我一个问题。', 'Bèèrè ìbéèrè lọ́wọ́ mi.'],
    ['Send', 'Envoyer', 'Enviar', 'Enviar', '发送', 'Firánṣẹ́'],
    ['Cancel', 'Annuler', 'Cancelar', 'Cancelar', '取消', 'Fagilé'],
    ['Quote Desk', 'Bureau des devis', 'Mesa de presupuestos', 'Mesa de orçamentos', '报价台', 'Tábìlì ìdíyelé'],
    ['OPEN QUOTE VALUE', 'VALEUR DES DEVIS OUVERTS', 'VALOR DE PRESUPUESTOS ABIERTOS', 'VALOR DOS ORÇAMENTOS ABERTOS', '未决报价金额', 'IYE ÌDÍYELÉ TÓ ṢÍ'],
    ['FOLLOW-UPS DUE', 'SUIVIS À FAIRE', 'SEGUIMIENTOS PENDIENTES', 'ACOMPANHAMENTOS VENCIDOS', '待跟进', 'ÀWỌN ÀTẸ̀LÉ TÓ YẸ'],
    ['ACCEPTED THIS MONTH', 'ACCEPTÉ CE MOIS', 'ACEPTADO ESTE MES', 'ACEITO NESTE MÊS', '本月已接受', 'ÈYÍ TÍ A GBÀ NÍ OṢÙ YÌÍ'],
    ['ACCEPTANCE RATE', 'TAUX D’ACCEPTATION', 'TASA DE ACEPTACIÓN', 'TAXA DE ACEITAÇÃO', '接受率', 'ÒṢÙWỌ̀N ÌGBÀ'],
    ['Message', 'Message', 'Mensaje', 'Mensagem', '消息', 'Ìfiránṣẹ́'],
    ['Deposits', 'Acomptes', 'Anticipos', 'Sinais', '定金', 'Àwọn ìsanwó'],
    ['Exports', 'Exports', 'Exportaciones', 'Exportações', '导出', 'Àwọn ìgbéjáde'],
    ['Teams', 'Équipes', 'Equipos', 'Equipes', '团队', 'Àwọn ẹgbẹ́'],
    ['Recurring', 'Récurrent', 'Recurrente', 'Recorrente', '循环', 'Tí ń tún ṣẹlẹ̀'],
    ['Referrals', 'Parrainages', 'Referencias', 'Indicações', '推荐', 'Àwọn ìtọ́kasí'],
    ['Search customer or service…', 'Rechercher un client ou un service…', 'Buscar cliente o servicio…', 'Buscar cliente ou serviço…', '搜索客户或服务…', 'Wá oníbàárà tàbí iṣẹ́…'],
    ['Previous month', 'Mois précédent', 'Mes anterior', 'Mês anterior', '上个月', 'Oṣù tó kọjá'],
    ['Next month', 'Mois suivant', 'Mes siguiente', 'Próximo mês', '下个月', 'Oṣù tó ń bọ̀'],
    ['Enable reminders', 'Activer les rappels', 'Activar recordatorios', 'Ativar lembretes', '开启提醒', 'Tan ìránilétí'],
    ['Add quote', 'Ajouter un devis', 'Añadir presupuesto', 'Adicionar orçamento', '添加报价', 'Fi ìdíyelé kún'],
    ['Import local quotes', 'Importer les devis locaux', 'Importar presupuestos locales', 'Importar orçamentos locais', '导入本地报价', 'Gbé àwọn ìdíyelé ìbílẹ̀ wọlé'],
    ['QUOTE DESK', 'BUREAU DES DEVIS', 'MESA DE PRESUPUESTOS', 'MESA DE ORÇAMENTOS', '报价台', 'TÁBÌLÌ ÌDÍYELÉ']
  ];
  const phrases = { fr: {}, es: {}, pt: {}, zh: {}, yo: {} };
  const codes = ['fr', 'es', 'pt', 'zh', 'yo'];
  for (const row of rows) {
    codes.forEach((code, index) => { phrases[code][row[0]] = row[index + 1]; });
  }
  const reverse = Object.fromEntries(codes.map(code => [code, new Map(Object.entries(phrases[code]).map(([english, value]) => [value, english]))]));
  const english = new Set(rows.map(row => row[0]));
  let current = 'en';
  const skip = '.language-switch, #quote-rows, #invoice-rows, #customer-history, #history-detail, #recurring-list, #booking-list, #growth-report, #team-members-list, #template-list, #toast';

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
    if (current !== 'zh' && current !== 'yo') return;
    if (document.getElementById('eqf-language-font')) return;
    const link = document.createElement('link');
    link.id = 'eqf-language-font';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&family=Noto+Sans+SC:wght@400;600;700&display=swap';
    document.head.appendChild(link);
  }

  function fillSelects() {
    document.querySelectorAll('.language-switch-select').forEach(select => {
      if (!select.options.length) {
        select.innerHTML = LANGUAGES.map(([code, label]) => `<option value="${code}">${label}</option>`).join('');
        select.addEventListener('change', () => setLanguage(select.value));
      }
      select.value = current;
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
