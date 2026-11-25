(() => {
  'use strict';

  const STORAGE_KEY = 'quoteflow.quotes.v1';
  const CALCULATOR_CURRENCY_KEY = 'calculator-currency';
  const VISITOR_CURRENCY_KEY = 'quoteflow.visitor-currency';
  const FREE_OPEN_QUOTE_LIMIT = 15;
  const FREE_LINE_ITEM_LIMIT = 1;
  const PRO_LINE_ITEM_LIMIT = 20;
  const SUPABASE_CONFIG = window.QUOTEFlow_SUPABASE_CONFIG;
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'CAD', 'AUD', 'NZD', 'CHF', 'JPY', 'CNY', 'INR', 'MXN', 'BRL', 'ZAR', 'SGD', 'HKD', 'SEK', 'NOK', 'DKK', 'PLN'];
  const isPro = () => Boolean(profile.isPro);
  const openQuoteCount = () => quotes.filter(quote => quote.status === 'sent').length;
  const lineItemLimit = () => (isPro() ? PRO_LINE_ITEM_LIMIT : FREE_LINE_ITEM_LIMIT);
  const requirePro = (feature) => {
    if (isPro()) return true;
    showToast(`${feature} is included with Pro. Upgrade from your Pro Desk to unlock it.`, 6000);
    $('#upgrade-strip')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  };
  const currencyOptions = CURRENCIES.map(code => `<option value="${code}">${code}</option>`).join('');
  function formatMoney(amount, currency = 'USD') {
    const code = CURRENCIES.includes(currency) ? currency : 'USD';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(Number(amount) || 0);
  }
  function quoteItemLabels(quote) {
    const labels = (quote.lineItems || []).map(item => String(item.description || '').trim()).filter(Boolean).slice(0, 8);
    if (labels.length) return labels;
    const service = String(quote.service || '').trim();
    return service ? [service] : [];
  }
  function emailSignature() {
    return [profile.fullName, profile.businessName, profile.phone].map(value => String(value || '').trim()).filter(Boolean).join('\n');
  }
  function currencyTotals(items) {
    const totals = new Map();
    for (const item of items) {
      const code = CURRENCIES.includes(item.currency) ? item.currency : 'USD';
      totals.set(code, (totals.get(code) || 0) + Number(item.amount || 0));
    }
    return [...totals];
  }
  function formatTotals(items) {
    return currencyTotals(items).map(([code, amount]) => formatMoney(amount, code)).join(' · ') || formatMoney(0);
  }
  function renderAcceptedTotal(element, items) {
    const totals = currencyTotals(items);
    const split = totals.length > 1;
    element.classList.toggle('is-split', split);
    element.replaceChildren();
    if (!totals.length) {
      const code = CURRENCIES.includes(calculatorCurrency) ? calculatorCurrency : 'USD';
      element.textContent = formatMoney(0, code);
      return;
    }
    if (!split) {
      element.textContent = formatMoney(totals[0][1], totals[0][0]);
      return;
    }
    totals
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .forEach(([code, amount]) => {
        const line = document.createElement('span');
        line.className = 'metric-currency-line';
        const label = document.createElement('small');
        label.textContent = code;
        const figure = document.createElement('b');
        const whole = Math.abs(amount - Math.round(amount)) < 0.001;
        figure.textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: whole ? 0 : 2 }).format(amount);
        line.append(label, figure);
        element.append(line);
      });
  }
  function currencyStep(code) {
    const digits = new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCIES.includes(code) ? code : 'USD' }).resolvedOptions().maximumFractionDigits;
    return digits ? `0.${'0'.repeat(digits - 1)}1` : '1';
  }
  const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateOffset = days => {
    const value = new Date(today);
    value.setDate(value.getDate() + days);
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const $ = selector => document.querySelector(selector);
  const landingScreen = $('#landing-screen');
  const authScreen = $('#auth-screen');
  const appShell = $('#app-shell');
  const authForm = $('#auth-form');
  const registerForm = $('#register-form');
  const authError = $('#auth-error');
  const rows = $('#quote-rows');
  const form = $('#quote-form');
  const dialog = $('#quote-dialog');
  const profileDialog = $('#profile-dialog');
  const profileForm = $('#profile-form');
  const templateDialog = $('#template-dialog');
  const templateForm = $('#template-form');
  const invoiceDialog = $('#invoice-dialog');
  const invoiceForm = $('#invoice-form');
  const lineItemsContainer = $('#quote-line-items');
  const emptyState = $('#empty-state');
  let profile = { fullName: '', businessName: '', phone: '', companyLogoUrl: '', brandColor: '#426DDE', companyAddress: '', defaultCurrency: '', taxId: '', isLifetime: false, referralCode: '', referralCreditsMonths: 0 };
  let quotes = [];
  let templates = [];
  let teamState = { team: null, members: [], pendingInvites: [] };
  let referralState = null;
  let invoiceQuoteId = null;
  let supabaseClient = null;
  let currentUser = null;
  let ownerAnalyticsEnabled = false;
  let quoteChangesChannel = null;
  let activeFilter = 'all';
  let searchTerm = '';
  let sortBy = 'followUp';
  let editingId = null;
  let toastTimer;
  let calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let selectedCalendarDate = null;
  let reminderTimer = null;
  let calculatorCurrency = 'USD';

  function loadLocalQuotes() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter(quote => quote && typeof quote.id === 'string' && typeof quote.customer === 'string' && Number.isFinite(Number(quote.amount)) && ['sent', 'won', 'lost'].includes(quote.status)) : [];
    } catch {
      return [];
    }
  }

  function setSyncStatus(message, isError = false) {
    const status = $('#sync-status');
    status.textContent = message;
    status.classList.toggle('sync-error', isError);
  }

  function showAuthError(message, tone = 'error') {
    authError.textContent = message;
    authError.hidden = !message;
    authError.classList.toggle('is-success', tone === 'success' && Boolean(message));
  }

  function showLanding() {
    landingScreen.hidden = false;
    authScreen.hidden = true;
    appShell.hidden = true;
    registerForm.hidden = true;
    authForm.hidden = false;
    $('#auth-signup-prompt').hidden = false;
    $('#auth-mode-toggle').hidden = false;
  }

  function showSignedOut(mode = 'signin') {
    landingScreen.hidden = true;
    appShell.hidden = true;
    authScreen.hidden = false;
    document.body.classList.remove('nav-open');
    $('#mobile-menu')?.setAttribute('aria-expanded', 'false');
    $('#mobile-menu')?.setAttribute('aria-label', 'Open navigation');
    const recovery = mode === 'recovery';
    $('#google-signin').hidden = recovery;
    $('#auth-divider').hidden = recovery;
    authForm.hidden = false;
    registerForm.hidden = true;
    $('#auth-title').textContent = recovery ? 'Choose a new password.' : 'Welcome back.';
    $('#auth-description').textContent = recovery ? 'Choose a new password, then come back to the quotes, follow-ups, and approvals on your desk.' : 'Sign in to the quotes still open, the follow-ups that are due, and the approvals waiting on your desk.';
    $('#auth-password').autocomplete = recovery ? 'new-password' : 'current-password';
    $('#auth-password').value = '';
    $('#auth-password').placeholder = recovery ? 'Enter your new password' : 'Your password';
    $('#auth-password').required = !recovery;
    $('#auth-submit').textContent = recovery ? 'Update password' : 'Sign in';
    $('#auth-signup-prompt').hidden = recovery;
    $('#auth-mode-toggle').hidden = recovery;
    $('#auth-mode-toggle').textContent = 'Create an account';
    $('#auth-reset').hidden = recovery;
    authForm.dataset.mode = mode;
    authError.hidden = true;
    authError.textContent = '';
    authError.classList.remove('is-success');
    $('#register-error').hidden = true;
    $('#register-error').textContent = '';
  }

  function showRegistration() {
    if (currentUser) return;
    landingScreen.hidden = true;
    authScreen.hidden = false;
    appShell.hidden = true;
    $('#google-signin').hidden = false;
    $('#auth-divider').hidden = false;
    authForm.hidden = true;
    registerForm.hidden = false;
    $('#auth-signup-prompt').hidden = true;
    $('#auth-mode-toggle').hidden = true;
    $('#auth-title').textContent = 'Create your account.';
    $('#auth-description').textContent = 'Create the account, then keep every quote, the next follow-up, and the customer’s approval in one place.';
    $('#register-error').hidden = true;
    $('#register-error').textContent = '';
    registerForm.reset();
  }

  function greetingName() {
    const name = formatDisplayName(profile.fullName || currentUser?.user_metadata?.full_name || '');
    const first = name.split(' ')[0];
    return first && first.length <= 24 ? first : '';
  }
  function updateGreeting() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = greetingName();
    $('#greeting-text').textContent = name ? `${greeting}, ${name}` : greeting;
  }
  function updateDeskIntro(openQuotes, dueQuotes) {
    const subtitle = $('#welcome-subtitle');
    if (!subtitle) return;
    updateGreeting();
    if (!quotes.length) {
      subtitle.textContent = 'From the first quote to the customer’s approval, keep the estimate, the follow-up, and the next conversation in one place.';
      return;
    }
    const openCount = openQuotes.length;
    const dueCount = dueQuotes.length;
    const openLine = openCount
      ? `${openCount} open quote${openCount === 1 ? ' is' : 's are'} still waiting on a decision, worth ${formatTotals(openQuotes)}`
      : 'No open quotes are waiting on a decision';
    const dueLine = dueCount
      ? `${dueCount} follow-up${dueCount === 1 ? ' is' : 's are'} due`
      : 'no follow-ups are due today';
    subtitle.textContent = `${openLine}, and ${dueLine}. Send the next quote, check in before a job goes quiet, and keep the approval on the same record.`;
  }

  function brandedMailbox() {
    const reserved = new Set(['abuse', 'admin', 'administrator', 'billing', 'contact', 'dmarc', 'email', 'hello', 'help', 'hostmaster', 'info', 'legal', 'mail', 'mailer-daemon', 'no-reply', 'noreply', 'owner', 'postmaster', 'privacy', 'quotes', 'root', 'sales', 'security', 'spf', 'staff', 'support', 'team', 'webmaster', 'www']);
    const source = String(profile.businessName || profile.fullName || '');
    const ascii = source.replace(/&/g, ' and ').replace(/['’]/g, '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    let local = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
    if (!local) local = 'studio';
    if (reserved.has(local)) local = `${local}-studio`.slice(0, 64);
    const cleaned = source.replace(/[\r\n]+/g, ' ').replace(/[<>"]/g, '').trim().slice(0, 60);
    const name = cleaned || 'Your business';
    const address = `${local}@elitequoteflow.com`;
    return { name, address, reply: currentUser?.email || '', initials: cleaned ? name.split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() : 'EQ' };
  }
  function showBrandedEmail() {
    const mailbox = brandedMailbox();
    $('#branded-email-name').textContent = mailbox.name;
    $('#branded-email-address').textContent = mailbox.address;
    $('#branded-email-reply').textContent = mailbox.reply || 'the email on your account';
    $('#branded-email-avatar').textContent = mailbox.initials || 'EQ';
    $('#branded-email-lock').hidden = isPro();
    $('#branded-email-dialog').showModal();
  }

  let messageDraft = null;
  function syncMessageChannel() {
    const text = $('#message-form')?.elements.channel.value === 'text';
    $('#message-email-field').hidden = text;
    $('#message-subject-field').hidden = text;
    $('#message-phone-field').hidden = !text;
    $('#message-send').textContent = text ? 'Open text' : 'Send email';
    $('#message-footnote').textContent = text ? 'The text opens in your phone with the message you wrote.' : 'Email is sent from your company address. Replies come back to your account.';
  }
  function openMessageComposer(draft = {}) {
    if (!requirePro('Customer messages')) return;
    messageDraft = draft;
    const mailbox = brandedMailbox();
    const form = $('#message-form');
    form.elements.channel.value = draft.channel || 'email';
    form.elements.email.value = draft.email || '';
    form.elements.phone.value = draft.phone || '';
    form.elements.subject.value = draft.subject || (draft.customer ? `Message for ${draft.customer}` : '');
    form.elements.body.value = draft.body || (draft.customer ? `Hi ${draft.customer},\n\n` : '');
    $('#message-from').textContent = `From ${mailbox.name} <${mailbox.address}>`;
    $('#message-error').textContent = '';
    syncMessageChannel();
    if (typeof $('#message-composer').showModal === 'function') $('#message-composer').showModal();
    else $('#message-composer').setAttribute('open', '');
  }

  function showSignedIn() {
    landingScreen.hidden = true;
    authScreen.hidden = true;
    appShell.hidden = false;
    updateGreeting();
    renderProfile();
    setSyncStatus('Loading cloud quotes');
  }

  function formatDisplayName(value) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    if (!name) return '';
    const letters = name.replace(/[^\p{L}]/gu, '');
    const isUniformCase = letters && (letters === letters.toLocaleLowerCase() || letters === letters.toLocaleUpperCase());
    if (!isUniformCase) return name;
    return name.toLocaleLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_match, separator, letter) => `${separator}${letter.toLocaleUpperCase()}`);
  }

  function renderProfile() {
    const name = formatDisplayName(profile.fullName || currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0]) || 'Your profile';
    const avatar = name.trim().split(/\\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || 'Q';
    $('#upgrade-strip').classList.toggle('is-pro-active', Boolean(profile.isPro));
    const eyebrow = document.querySelector('#upgrade-strip .eyebrow');
    if (eyebrow) eyebrow.textContent = profile.isStaff ? 'STAFF REVIEW' : 'ELITE QUOTE FLOW PRO';
    $('#pro-upgrade-title').textContent = profile.isStaff ? 'Staff review access is active. Pro tools are open for cross-checking the desk.' : profile.isPro ? 'Your Pro Desk is active, from follow-up through getting paid.' : 'Keep follow-ups, deposits, and branded email moving on Pro.';
    const openCount = openQuoteCount();
    $('#pro-upgrade-copy').textContent = profile.isStaff
      ? 'Pro tools are unlocked so your team can cross-check quotes, email, and the rest of the desk. This is not a paid subscription.'
      : profile.isPro
      ? profile.isLifetime ? 'Your one-time purchase gives you permanent access to all Pro tools.' : 'Your Pro tools are ready. Manage billing or cancel your subscription securely.'
      : `Free tracks open quote value and recovered wins after a follow-up date. Pro adds automated reminders, deposits, branded email, multi-item quotes, AI drafting, exports, teams, and invoice collection · $14.99/mo or $149.99 lifetime. Checkout can show a local estimate; the charge stays in US dollars. You have ${openCount}/${FREE_OPEN_QUOTE_LIMIT} open quotes.`;
    const monthlyButton = $('#upgrade-monthly-link');
    const lifetimeButton = $('#upgrade-lifetime-link');
    const manageButton = $('#upgrade-pro-link');
    monthlyButton.hidden = Boolean(profile.isPro);
    lifetimeButton.hidden = Boolean(profile.isPro);
    manageButton.hidden = profile.isStaff || !profile.isPro || Boolean(profile.isLifetime);
    manageButton.textContent = 'Manage subscription';
    lifetimeButton.textContent = profile.isLifetime ? 'Lifetime Pro active' : 'Lifetime · $149.99';
    lifetimeButton.disabled = Boolean(profile.isLifetime);
    if (profile.isLifetime) lifetimeButton.setAttribute('aria-disabled', 'true');
    else lifetimeButton.removeAttribute('aria-disabled');
    document.querySelectorAll('.pro-feature').forEach(button => {
      button.hidden = false;
      button.classList.toggle('is-locked', !profile.isPro);
    });
    document.querySelectorAll('[data-pro-feature]').forEach(link => {
      link.classList.toggle('is-locked', !profile.isPro);
      link.setAttribute('aria-disabled', profile.isPro ? 'false' : 'true');
    });
    document.querySelectorAll('.pro-only-field').forEach(field => {
      field.classList.toggle('is-locked', !profile.isPro);
      field.querySelectorAll('input,select,textarea,button').forEach(control => {
        if (control.dataset.keepEnabled === 'true') return;
        control.disabled = !profile.isPro;
      });
    });
    const freeLimitNote = $('#free-limit-note');
    if (freeLimitNote) {
      freeLimitNote.hidden = Boolean(profile.isPro);
      freeLimitNote.textContent = `Free plan: ${openCount}/${FREE_OPEN_QUOTE_LIMIT} open quotes · 1 line item · mailto send. Upgrade for deposits, reminders, branding, and more.`;
    }
    $('#header-profile-name').textContent = name;
    $('#header-profile-name').title = name;
    $('#header-profile-avatar').textContent = avatar;
    renderTeamPanel();
    renderReferralPanel();
  }

  async function fetchProfile() {
    if (!currentUser) return;
    let profileSelect = 'full_name, business_name, phone, is_pro, stripe_subscription_status, company_logo_url, brand_color, company_address, tax_id, referral_code, referral_credits_months, default_currency';
    let { data, error } = await supabaseClient.from('profiles').select(profileSelect).eq('id', currentUser.id).maybeSingle();
    if (error && /default_currency/i.test(error.message || '')) {
      profileSelect = profileSelect.replace(', default_currency', '');
      const retry = await supabaseClient.from('profiles').select(profileSelect).eq('id', currentUser.id).maybeSingle();
      data = retry.data;
      error = retry.error;
    }
    if (error && /tax_id|referral_code|referral_credits|column .* does not exist|schema cache/i.test(error.message || '')) {
      const legacy = await supabaseClient.from('profiles').select('full_name, business_name, phone, is_pro, stripe_subscription_status, company_logo_url, brand_color, company_address').eq('id', currentUser.id).maybeSingle();
      data = legacy.data ? { ...legacy.data, tax_id: currentUser.user_metadata?.tax_id || '', referral_code: '', referral_credits_months: 0 } : null;
      error = legacy.error;
    }
    if (error) throw error;
    if (!data) {
      const { error: createError } = await upsertProfileRow({
        id: currentUser.id,
        full_name: currentUser.user_metadata?.full_name || '',
        business_name: currentUser.user_metadata?.business_name || '',
        phone: currentUser.user_metadata?.phone || '',
        company_address: currentUser.user_metadata?.company_address || '',
        default_currency: CURRENCIES.includes(currentUser.user_metadata?.default_currency) ? currentUser.user_metadata.default_currency : 'USD'
      });
      if (createError) throw createError;
      return fetchProfile();
    }
    profile = {
      fullName: formatDisplayName(currentUser.user_metadata?.full_name || data?.full_name || ''),
      businessName: currentUser.user_metadata?.business_name || data?.business_name || '',
      phone: currentUser.user_metadata?.phone || data?.phone || '',
      isPro: Boolean(data?.is_pro),
      isStaff: false,
      isLifetime: data?.stripe_subscription_status === 'lifetime',
      companyLogoUrl: data?.company_logo_url || '',
      brandColor: data?.brand_color || '#426DDE',
      companyAddress: data?.company_address || currentUser.user_metadata?.company_address || '',
      defaultCurrency: CURRENCIES.includes(data?.default_currency) ? data.default_currency : (CURRENCIES.includes(currentUser.user_metadata?.default_currency) ? currentUser.user_metadata.default_currency : ''),
      taxId: data?.tax_id || currentUser.user_metadata?.tax_id || '',
      referralCode: data?.referral_code || '',
      referralCreditsMonths: Number(data?.referral_credits_months || 0)
    };
    try {
      const headers = await authHeaders();
      const accessResponse = await fetch('/api/account-access', { headers });
      if (accessResponse.ok) {
        const access = await accessResponse.json();
        profile.isStaff = Boolean(access.staff) && !access.pro;
        profile.isPro = Boolean(access.pro) || Boolean(access.staff);
      }
    } catch (error) {
      console.warn('Could not check staff access', error);
    }
    renderProfile();
    await rememberAccountAddress();
    loadGrowthExtras().catch(() => {});
  }

  async function upsertProfileRow(row) {
    let result = await supabaseClient.from('profiles').upsert(row, { onConflict: 'id' });
    if (result.error && /default_currency|schema cache/i.test(result.error.message || '') && Object.prototype.hasOwnProperty.call(row, 'default_currency')) {
      const { default_currency: _ignored, ...rest } = row;
      result = await supabaseClient.from('profiles').upsert(rest, { onConflict: 'id' });
    }
    return result;
  }

  async function rememberAccountAddress() {
    const address = String(profile.companyAddress || currentUser?.user_metadata?.company_address || '').trim();
    if (address && !profile.companyAddress) {
      profile.companyAddress = address;
      await supabaseClient.from('profiles').update({ company_address: address, updated_at: new Date().toISOString() }).eq('id', currentUser.id);
    }
    if (address || !profileDialog || profileDialog.open) return;
    openProfileDialog();
    const saveError = $('#profile-save-error');
    saveError.classList.remove('is-success');
    saveError.textContent = 'Add your address. It is saved on your account with your name.';
    saveError.hidden = false;
    profileForm.elements.companyAddress.focus();
  }

  async function authHeaders() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` };
  }

  async function loadGrowthExtras() {
    if (!currentUser) return;
    try {
      const headers = await authHeaders();
      const [teamsResponse, referralsResponse] = await Promise.all([
        fetch('/api/teams', { headers }),
        fetch('/api/referrals', { headers })
      ]);
      if (teamsResponse.ok) teamState = await teamsResponse.json();
      if (referralsResponse.ok) {
        referralState = await referralsResponse.json();
        profile.referralCode = referralState.referralCode || profile.referralCode;
        profile.referralCreditsMonths = Number(referralState.creditsMonths || 0);
      }
      renderTeamPanel();
      renderReferralPanel();
    } catch (error) {
      console.warn('Could not load teams/referrals', error);
    }
  }

  function renderTeamPanel() {
    const list = $('#team-members-list');
    const invites = $('#team-pending-invites');
    if (!list) return;
    if (!isPro()) {
      list.innerHTML = '<p>Upgrade to Pro to invite teammates and share your quote desk.</p>';
      if (invites) invites.innerHTML = '';
      return;
    }
    const members = teamState.members || [];
    list.innerHTML = members.length
      ? members.map(member => `<div class="growth-list-item"><span>${escapeHTML(member.invited_email)} · ${escapeHTML(member.role)} · ${escapeHTML(member.invitation_status)}</span>${member.invitation_status === 'pending' || member.invitation_status === 'accepted' ? `<button type="button" class="button button-secondary button-small team-revoke" data-member-id="${escapeHTML(member.id)}">Revoke</button>` : ''}</div>`).join('')
      : '<p>No teammates yet. Invite someone by email.</p>';
    if (invites) {
      const pending = teamState.pendingInvites || [];
      invites.innerHTML = pending.length
        ? pending.map(invite => `<div class="growth-list-item"><span>Invitation to join a team</span><button type="button" class="button button-primary button-small team-accept" data-invite-id="${escapeHTML(invite.id)}">Accept</button></div>`).join('')
        : '<p>No pending invitations for your email.</p>';
    }
  }

  function renderReferralPanel() {
    const panel = $('#referral-panel');
    if (!panel) return;
    const code = referralState?.referralCode || profile.referralCode || 'Loading…';
    const link = referralState?.referralLink || (code && code !== 'Loading…' ? `${window.location.origin}/?ref=${encodeURIComponent(code)}` : '');
    const credits = referralState?.creditsMonths ?? profile.referralCreditsMonths ?? 0;
    $('#referral-code-value').textContent = code;
    $('#referral-link-value').textContent = link || '—';
    $('#referral-credits-value').textContent = `${credits} month${credits === 1 ? '' : 's'} of Pro credit earned`;
    const applied = $('#referral-applied-note');
    if (applied) {
      applied.hidden = !referralState?.referredByCode;
      applied.textContent = referralState?.referredByCode ? `Linked referral: ${referralState.referredByCode}` : '';
    }
  }

  function showCompanyLogo(url) {
    const preview = $('#company-logo-preview');
    const remove = $('#company-logo-remove');
    profileForm.elements.companyLogoUrl.value = url || '';
    if (!preview || !remove) return;
    if (url) {
      preview.src = url;
      preview.hidden = false;
      remove.hidden = false;
    } else {
      preview.removeAttribute('src');
      preview.hidden = true;
      remove.hidden = true;
    }
  }

  function readLogoFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve('');
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('Upload a PNG, JPG, WebP, or GIF logo.'));
      if (file.size > 5 * 1024 * 1024) return reject(new Error('That logo is larger than 5 MB. Choose a smaller image.'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that logo.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('Could not open that logo.'));
        image.onload = () => {
          const scale = Math.min(1, 360 / image.width, 160 / image.height);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          const keepPng = /png|webp|gif/.test(file.type);
          let url = canvas.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.82);
          if (url.length > 120000) url = canvas.toDataURL('image/jpeg', 0.72);
          if (url.length > 120000) return reject(new Error('That logo is still too large after resizing. Try a simpler image.'));
          resolve(url);
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  let logoUpload = Promise.resolve();

  function openProfileDialog() {
    profileForm.elements.fullName.value = formatDisplayName(profile.fullName || currentUser?.user_metadata?.full_name || '');
    profileForm.elements.businessName.value = profile.businessName || currentUser?.user_metadata?.business_name || '';
    profileForm.elements.phone.value = profile.phone || currentUser?.user_metadata?.phone || '';
    showCompanyLogo(profile.companyLogoUrl || '');
    const logoFile = $('#company-logo-file');
    if (logoFile) logoFile.value = '';
    profileForm.elements.brandColor.value = profile.brandColor || '#426DDE';
    profileForm.elements.companyAddress.value = profile.companyAddress || '';
    if (profileForm.elements.taxId) profileForm.elements.taxId.value = profile.taxId || '';
    profileForm.elements.email.value = currentUser?.email || '';
    profileForm.querySelectorAll('.form-field').forEach(field => field.classList.remove('has-error'));
    profileForm.querySelectorAll('.field-error').forEach(error => { error.textContent = ''; });
    $('#profile-save-error').textContent = '';
    $('#profile-save-error').hidden = true;
    if (typeof profileDialog.showModal === 'function') profileDialog.showModal();
    else profileDialog.setAttribute('open', '');
  }

  async function saveProfile(values) {
    if (!isPro()) {
      values.companyLogoUrl = profile.companyLogoUrl || '';
      values.brandColor = profile.brandColor || '#426DDE';
      values.taxId = profile.taxId || '';
    }
    const nextEmail = values.email.trim();
    const { data: authData, error: authError } = await supabaseClient.auth.updateUser({
      data: {
        ...currentUser.user_metadata,
        full_name: values.fullName,
        business_name: values.businessName,
        phone: values.phone,
        company_logo_url: values.companyLogoUrl.startsWith('data:') ? '' : values.companyLogoUrl,
        brand_color: values.brandColor,
        company_address: values.companyAddress,
        tax_id: values.taxId
      }
    });
    if (authError) throw authError;
    if (!authData?.user) throw new Error('Supabase did not return the updated account. Please sign out, sign in again, and retry.');
    if (authData?.user) currentUser = authData.user;
    profile = { ...profile, fullName: values.fullName, businessName: values.businessName, phone: values.phone, companyLogoUrl: values.companyLogoUrl, brandColor: values.brandColor, companyAddress: values.companyAddress, taxId: values.taxId };
    renderProfile();

    let profileTableWarning = '';
    const { error: profileError } = await upsertProfileRow({
      id: currentUser.id,
      full_name: values.fullName,
      business_name: values.businessName,
      phone: values.phone,
      company_logo_url: values.companyLogoUrl,
      brand_color: values.brandColor,
      company_address: values.companyAddress,
      default_currency: CURRENCIES.includes(profile.defaultCurrency) ? profile.defaultCurrency : calculatorCurrency,
      updated_at: new Date().toISOString()
    });
    if (profileError) profileTableWarning = ` Profile backup could not sync: ${profileError.message}`;

    if (nextEmail && nextEmail.toLowerCase() !== currentUser.email?.toLowerCase()) {
      const { data: emailData, error: emailError } = await supabaseClient.auth.updateUser({ email: nextEmail }, { emailRedirectTo: `${window.location.origin}/` });
      if (emailData?.user) currentUser = emailData.user;
      if (emailError) return `Name and profile saved. Email change failed: ${emailError.message}.${profileTableWarning}`;
      return `Profile saved. Check your email to confirm the email address change.${profileTableWarning}`;
    }
    return `Profile updated and synced.${profileTableWarning}`;
  }

  async function fetchCloudQuotes() {
    const { data, error } = await supabaseClient.from('quotes').select('*').order('follow_up', { ascending: true });
    if (error) throw error;
    quotes = (data || []).map(row => ({
      id: row.id,
      customer: row.customer,
      service: row.service,
      email: row.email || '',
      phone: row.phone || '',
      referralSource: row.referral_source || '',
      amount: Number(row.amount),
      currency: row.currency || 'USD',
      lineItems: Array.isArray(row.line_items) ? row.line_items : [],
      subtotalAmount: Number(row.subtotal_amount ?? row.amount),
      taxRate: Number(row.tax_rate || 0),
      discountAmount: Number(row.discount_amount || 0),
      depositPercent: Number(row.deposit_percent || 0),
      viewCount: Number(row.view_count || 0),
      acceptedAt: row.accepted_at || '',
      acceptedByName: row.accepted_by_name || '',
      rejectedReason: row.rejected_reason || '',
      stripePaymentUrl: row.stripe_payment_url || '',
      depositPaidAt: row.deposit_paid_at || '',
      followUp: row.follow_up,
      status: row.status,
      note: row.note || '',
      reminderCount: Number(row.reminder_count || 0),
      lastReminderAt: row.last_reminder_at || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      statusChangedAt: row.status_changed_at,
      publicToken: row.public_token || '',
      quoteTerms: row.quote_terms || '',
      expiresAt: row.expires_at || '',
      invoiceNumber: row.invoice_number || '',
      invoiceStatus: row.invoice_status || 'not_invoiced',
      invoiceDueDate: row.invoice_due_date || '',
      invoicePaidAt: row.invoice_paid_at || ''
    }));
    await fetchTemplates();
    render();
    await loadGrowthFeatures();
    subscribeToQuoteChanges();
    setSyncStatus('Cloud sync active');
  }

  let customerNotes = [];
  let recurringServices = [];
  let bookingRequests = [];
  function selectedCustomerQuotes() {
    const key = $('#history-customer').value;
    return quotes.filter(quote => (quote.email?.toLowerCase() || quote.customer.toLowerCase()) === key);
  }
  function renderCustomerHistory() {
    const select = $('#history-customer');
    const current = select.value;
    const customers = new Map();
    for (const quote of quotes) {
      const key = quote.email?.toLowerCase() || quote.customer.toLowerCase();
      const customer = customers.get(key) || { name: quote.customer, email: quote.email || '', quotes: [] };
      customer.quotes.push(quote);
      customers.set(key, customer);
    }
    select.innerHTML = '<option value="">Select a customer</option>' + [...customers].map(([key, customer]) => `<option value="${escapeHTML(key)}">${escapeHTML(customer.name)}${customer.email ? ` · ${escapeHTML(customer.email)}` : ''} (${customer.quotes.length})</option>`).join('');
    if (customers.has(current)) select.value = current;
    const selected = selectedCustomerQuotes();
    $('#customer-history').replaceChildren();
    if (!selected.length) { $('#customer-history').textContent = 'Select a customer to view their quote history.'; return; }
    const frag = document.createDocumentFragment();
    selected.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).forEach(quote => {
      const row = document.createElement('p');
      row.className = 'growth-entry';
      row.textContent = `${shortDate(quote.createdAt)} · ${quote.service} · ${formatMoney(quote.amount, quote.currency)} · ${quote.status}`;
      frag.appendChild(row);
    });
    customerNotes.filter(note => selected[0].email ? note.customer_email?.toLowerCase() === selected[0].email.toLowerCase() : note.customer_name?.toLowerCase() === selected[0].customer.toLowerCase()).forEach(note => {
      const row = document.createElement('p'); row.className = 'growth-entry growth-note'; row.textContent = `Private note · ${shortDate(note.created_at)} · ${note.note}`; frag.appendChild(row);
    });
    $('#customer-history').append(frag);
  }
  function renderGrowthReport() {
    const metrics = new Map();
    quotes.forEach(quote => {
      const serviceKey = `Service · ${quote.service}`;
      const referralKey = `Referral · ${quote.referralSource || 'Unspecified'}`;
      for (const key of [serviceKey, referralKey]) {
        const item = metrics.get(key) || { count: 0, won: 0, amounts: [] };
        item.count += 1; if (quote.status === 'won') item.won += 1; item.amounts.push(quote); metrics.set(key, item);
      }
    });
    const target = $('#growth-report'); target.replaceChildren();
    if (!metrics.size) { target.textContent = 'Add quotes to see service and referral performance.'; return; }
    [...metrics].sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, item]) => {
      const row = document.createElement('p'); row.className = 'growth-entry';
      row.textContent = `${name} · ${item.count} quotes · ${item.won} won · ${item.count ? Math.round(item.won / item.count * 100) : 0}% conversion · ${formatTotals(item.amounts)}`; target.append(row);
    });
  }
  function renderRecurringServices() {
    const target = $('#recurring-list'); target.replaceChildren();
    if (!recurringServices.length) { target.textContent = 'No recurring services tracked yet.'; return; }
    recurringServices.forEach(plan => {
      const row = document.createElement('div'); row.className = 'growth-entry';
      const label = document.createElement('span'); label.textContent = `${plan.customer} · ${plan.service} · ${formatMoney(plan.amount, plan.currency)} · ${plan.frequency} · next ${shortDate(plan.next_service_date)} · ${plan.status}`;
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'button button-secondary button-small'; toggle.textContent = plan.status === 'active' ? 'Pause' : 'Resume'; toggle.addEventListener('click', async () => {
        const next = plan.status === 'active' ? 'paused' : 'active';
        const { error } = await supabaseClient.from('recurring_service_plans').update({ status: next, updated_at: new Date().toISOString() }).eq('id', plan.id);
        if (error) return showToast(`Could not update plan: ${error.message}`);
        plan.status = next; renderRecurringServices();
      });
      row.append(label, toggle); target.append(row);
    });
  }
  function renderBookingRequests() {
    const target = $('#booking-list'); target.replaceChildren();
    if (!bookingRequests.length) { target.textContent = 'No appointment requests yet. Customers can request a preferred date after accepting a quote.'; return; }
    bookingRequests.forEach(booking => {
      const row = document.createElement('div'); row.className = 'growth-entry';
      const label = document.createElement('span'); label.textContent = `${booking.customer} · ${booking.service} · ${new Date(booking.scheduled_for).toLocaleString()} · ${booking.status}${booking.customer_note ? ` · ${booking.customer_note}` : ''}`;
      const select = document.createElement('select');
      ['requested', 'confirmed', 'completed', 'cancelled'].forEach(status => { const option = document.createElement('option'); option.value = status; option.textContent = status; option.selected = status === booking.status; select.append(option); });
      select.addEventListener('change', async () => { const { error } = await supabaseClient.from('quote_bookings').update({ status: select.value, updated_at: new Date().toISOString() }).eq('id', booking.id); if (error) { showToast(`Could not update request: ${error.message}`); select.value = booking.status; } else booking.status = select.value; });
      row.append(label, select); target.append(row);
    });
  }
  async function loadGrowthFeatures() {
    renderCustomerHistory(); renderGrowthReport();
    const results = await Promise.allSettled([
      supabaseClient.from('customer_notes').select('*').order('created_at', { ascending: false }).limit(250),
      supabaseClient.from('recurring_service_plans').select('*').order('next_service_date'),
      supabaseClient.from('quote_bookings').select('*').order('scheduled_for')
    ]);
    const [notes, plans, bookings] = results;
    if (notes.status === 'fulfilled' && !notes.value.error) customerNotes = notes.value.data || [];
    if (plans.status === 'fulfilled' && !plans.value.error) recurringServices = plans.value.data || [];
    if (bookings.status === 'fulfilled' && !bookings.value.error) bookingRequests = bookings.value.data || [];
    renderCustomerHistory(); renderRecurringServices(); renderBookingRequests();
    const failed = results.find(result => result.status === 'rejected' || result.value?.error);
    if (failed) { $('#recurring-list').textContent = 'Apply supabase-growth-features.sql to enable customer notes, appointment requests, and recurring service plans.'; }
  }

  async function fetchTemplates() {
    const { data, error } = await supabaseClient.from('quote_templates').select('*').order('name');
    if (error) throw error;
    templates = (data || []).map(row => ({ id: row.id, name: row.name, service: row.service, amount: Number(row.amount), currency: row.currency || 'USD', terms: row.quote_terms || '', lineItems: row.line_items || [], subtotalAmount: Number(row.subtotal_amount ?? row.amount), taxRate: Number(row.tax_rate || 0), discountAmount: Number(row.discount_amount || 0), depositPercent: Number(row.deposit_percent || 0) }));
    renderTemplates();
  }

  function renderTemplates() {
    const select = $('#quote-template-select');
    if (select) select.innerHTML = '<option value="">No template</option>' + templates.map(template => `<option value="${escapeHTML(template.id)}">${escapeHTML(template.name)}</option>`).join('');
    const list = $('#template-list');
    if (list) list.innerHTML = templates.length ? templates.map(template => `<div class="template-item"><span><strong>${escapeHTML(template.name)}</strong><small>${escapeHTML(template.service)} · ${formatMoney(template.amount, template.currency)}</small></span><button type="button" data-delete-template="${escapeHTML(template.id)}" class="row-delete" aria-label="Delete ${escapeHTML(template.name)}">×</button></div>`).join('') : '<p class="template-empty">No saved templates yet.</p>';
  }

  async function saveInvoice(quote, values) {
    const paid = values.status === 'paid';
    const { data, error } = await supabaseClient.from('quotes').update({
      invoice_number: values.number.trim() || null,
      invoice_due_date: values.dueDate || null,
      invoice_status: values.status,
      invoice_paid_at: paid ? quote.invoicePaidAt || new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq('id', quote.id).select().single();
    if (error) throw error;
    quote.invoiceNumber = data.invoice_number || '';
    quote.invoiceDueDate = data.invoice_due_date || '';
    quote.invoiceStatus = data.invoice_status;
    quote.invoicePaidAt = data.invoice_paid_at || '';
    render();
  }

  function renderInvoices() {
    const invoiced = quotes.filter(quote => quote.status === 'won');
    $('#invoice-empty').hidden = invoiced.length > 0;
    $('#invoice-rows').innerHTML = invoiced.map(quote => {
      const paid = quote.invoiceStatus === 'paid' || quote.invoicePaidAt;
      const collect = !paid && isPro()
        ? `<button class="button button-primary button-small invoice-collect" data-collect-id="${escapeHTML(quote.id)}">Collect balance</button>`
        : !paid
          ? `<button class="button button-secondary button-small" type="button" data-pro-upsell="invoice">Pro to collect</button>`
          : '';
      return `<tr><td>${escapeHTML(quote.invoiceNumber || 'Draft')}</td><td>${escapeHTML(quote.customer)}</td><td>${formatMoney(quote.amount, quote.currency)}</td><td>${escapeHTML(quote.invoiceDueDate ? shortDate(quote.invoiceDueDate) : '—')}</td><td><span class="invoice-status invoice-${escapeHTML(quote.invoiceStatus || 'not_invoiced')}">${paid ? 'Paid' : quote.invoiceStatus === 'unpaid' ? 'Unpaid' : 'Not invoiced'}</span></td><td class="invoice-actions"><button class="button button-secondary button-small invoice-edit" data-invoice-id="${escapeHTML(quote.id)}">${quote.invoiceStatus && quote.invoiceStatus !== 'not_invoiced' ? 'Update' : 'Record invoice'}</button>${collect}</td></tr>`;
    }).join('');
  }

  async function makeQuoteShareable(quote) {
    if (!quote.publicToken) {
      quote.publicToken = crypto.randomUUID();
      await saveCloudQuote(quote);
    }
    const link = `${window.location.origin}/q/${quote.publicToken}`;
    if (quote.depositPercent > 0 && !quote.stripePaymentUrl) {
      if (!isPro()) {
        showToast('Deposit links are a Pro feature. Your quote link was copied without a deposit checkout.');
      } else {
        try {
          const headers = await authHeaders();
          const response = await fetch('/api/deposit-checkout', { method: 'POST', headers, body: JSON.stringify({ quoteId: quote.id, publicToken: quote.publicToken }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Could not prepare the deposit payment link.');
          quote.stripePaymentUrl = result.url;
          await saveCloudQuote(quote);
        } catch (error) { showToast(`Quote saved; deposit link could not be created: ${error.message}`); }
      }
    }
    try { await navigator.clipboard.writeText(link); showToast('Customer quote link copied. Paste it into an email or text.'); }
    catch { window.prompt('Copy this customer quote link:', link); }
  }

  function printQuoteProposal(quote) {
    const money = value => formatMoney(value, quote.currency || 'USD');
    const rows = (quote.lineItems || []).map(item => `<tr><td>${escapeHTML(item.description || '')}</td><td>${escapeHTML(item.quantity ?? 1)}</td><td>${escapeHTML(money(item.unit_price || 0))}</td><td>${escapeHTML(money(item.total || 0))}</td></tr>`).join('');
    const brandColor = isPro() && /^#[\da-f]{6}$/i.test(profile.brandColor || '') ? profile.brandColor : '#426DDE';
    const subtotal = Number(quote.subtotalAmount ?? quote.amount) || 0;
    const discount = Number(quote.discountAmount || 0);
    const taxRate = Number(quote.taxRate || 0);
    const taxAmount = Math.max(0, (subtotal - discount) * taxRate / 100);
    const depositPercent = Number(quote.depositPercent || 0);
    const depositAmount = Math.max(0, Number(quote.amount || 0) * depositPercent / 100);
    const logo = isPro() && profile.companyLogoUrl ? `<img src="${escapeHTML(profile.companyLogoUrl)}" alt="" style="max-height:56px;max-width:180px;object-fit:contain;margin-bottom:10px">` : '';
    const signature = quote.acceptedAt
      ? `<section class="signature"><h3>Acceptance record</h3><p>Accepted ${escapeHTML(shortDate(quote.acceptedAt))}${quote.acceptedByName ? ` by ${escapeHTML(quote.acceptedByName)}` : ''}.</p></section>`
      : '';
    const proposal = window.open('', '_blank', 'width=900,height=900');
    if (!proposal) return showToast('Allow pop-ups to print or save this quote as PDF.');
    proposal.opener = null;
    proposal.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quote · ${escapeHTML(quote.customer)}</title><style>body{max-width:780px;margin:40px auto;padding:28px;color:#172033;font:15px/1.55 Georgia,'Times New Roman',serif}header{display:flex;justify-content:space-between;gap:18px;padding-bottom:18px;border-bottom:3px solid ${brandColor}}.brand strong{display:block;font:700 20px/1.2 'Trebuchet MS',sans-serif;color:${brandColor}}h1{margin:28px 0 4px;font:700 32px/1.15 'Trebuchet MS',sans-serif}.muted{color:#667085}.amount{font:700 34px/1 'Trebuchet MS',sans-serif;color:${brandColor}}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:10px;border-bottom:1px solid #d9dee8;text-align:left}th{font:700 12px/1.2 'Trebuchet MS',sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#526074}.totals{width:min(320px,100%);margin-left:auto}.totals div{display:flex;justify-content:space-between;gap:18px;padding:6px 0}.terms,.signature{white-space:pre-wrap;border-top:1px solid #d9dee8;padding-top:18px;margin-top:24px}@media print{body{margin:0 auto;padding:12px}button{display:none}}</style></head><body><header><div class="brand">${logo}<strong>${escapeHTML(profile.businessName || 'Elite Quote Flow')}</strong>${profile.companyAddress ? `<div class="muted">${escapeHTML(profile.companyAddress)}</div>` : ''}${profile.taxId ? `<div class="muted">Tax ID: ${escapeHTML(profile.taxId)}</div>` : ''}</div><div class="muted">Prepared ${escapeHTML(shortDate(quote.createdAt || new Date().toISOString()))}${quote.expiresAt ? `<br>Valid through ${escapeHTML(shortDate(quote.expiresAt))}` : ''}</div></header><h1>Service proposal</h1><p class="muted">Prepared for ${escapeHTML(quote.customer)}</p><h2>${escapeHTML(quote.service)}</h2>${rows ? `<table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>` : ''}<div class="totals"><div><span>Subtotal</span><strong>${escapeHTML(money(subtotal))}</strong></div>${discount ? `<div><span>Discount</span><strong>-${escapeHTML(money(discount))}</strong></div>` : ''}${taxRate ? `<div><span>Tax (${escapeHTML(String(taxRate))}%)</span><strong>${escapeHTML(money(taxAmount))}</strong></div>` : ''}<div><span>Total</span><strong class="amount">${escapeHTML(money(quote.amount))}</strong></div>${depositPercent ? `<div><span>Deposit (${escapeHTML(String(depositPercent))}%)</span><strong>${escapeHTML(money(depositAmount))}</strong></div>` : ''}</div>${quote.quoteTerms ? `<section class="terms"><h3>Scope and terms</h3>${escapeHTML(quote.quoteTerms)}</section>` : ''}${signature}<p class="muted">Prepared with Elite Quote Flow</p><script>window.addEventListener('load',()=>window.print())<\/script></body></html>`);
    proposal.document.close();
  }

  function subscribeToQuoteChanges() {
    if (!currentUser) return;
    if (quoteChangesChannel) supabaseClient.removeChannel(quoteChangesChannel);
    quoteChangesChannel = supabaseClient.channel(`quotes-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes' }, () => {
        if (currentUser) refreshQuotes();
      })
      .subscribe();
  }

  async function saveCloudQuote(quote) {
    const payload = {
      customer: quote.customer,
      service: quote.service,
      email: quote.email || '',
      phone: quote.phone || '',
      referral_source: quote.referralSource || '',
      amount: Number(quote.amount),
      currency: quote.currency || 'USD',
      line_items: Array.isArray(quote.lineItems) ? quote.lineItems : [],
      subtotal_amount: Number(quote.subtotalAmount ?? quote.amount),
      tax_rate: Number(quote.taxRate || 0),
      discount_amount: Number(quote.discountAmount || 0),
      deposit_percent: Number(quote.depositPercent || 0),
      follow_up: quote.followUp,
      status: quote.status,
      note: quote.note || '',
      public_token: quote.publicToken || crypto.randomUUID(),
      quote_terms: quote.quoteTerms || '',
      expires_at: quote.expiresAt || null,
      invoice_number: quote.invoiceNumber || null,
      invoice_status: quote.invoiceStatus || 'not_invoiced',
      invoice_due_date: quote.invoiceDueDate || null,
      invoice_paid_at: quote.invoicePaidAt || null,
      updated_at: new Date().toISOString(),
      status_changed_at: quote.statusChangedAt || null
    };
      const query = quote.id.startsWith('local-')
      ? supabaseClient.from('quotes').insert({ ...payload, user_id: currentUser.id }).select().single()
      : supabaseClient.from('quotes').update(payload).eq('id', quote.id).select().single();
    const { data, error } = await query;
    if (error) throw error;
    const saved = {
      id: data.id,
      customer: data.customer,
      service: data.service,
      email: data.email || '',
      phone: data.phone || '',
      referralSource: data.referral_source || '',
      amount: Number(data.amount),
      currency: data.currency || 'USD',
      lineItems: Array.isArray(data.line_items) ? data.line_items : [],
      subtotalAmount: Number(data.subtotal_amount ?? data.amount),
      taxRate: Number(data.tax_rate || 0),
      discountAmount: Number(data.discount_amount || 0),
      depositPercent: Number(data.deposit_percent || 0),
      viewCount: Number(data.view_count || 0),
      acceptedAt: data.accepted_at || '',
      rejectedReason: data.rejected_reason || '',
      stripePaymentUrl: data.stripe_payment_url || '',
      followUp: data.follow_up,
      status: data.status,
      note: data.note || '',
      reminderCount: Number(data.reminder_count || 0),
      lastReminderAt: data.last_reminder_at || '',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      statusChangedAt: data.status_changed_at,
      publicToken: data.public_token || '',
      quoteTerms: data.quote_terms || '',
      expiresAt: data.expires_at || '',
      invoiceNumber: data.invoice_number || '',
      invoiceStatus: data.invoice_status || 'not_invoiced',
      invoiceDueDate: data.invoice_due_date || '',
      invoicePaidAt: data.invoice_paid_at || ''
    };
    const index = quotes.findIndex(item => item.id === quote.id);
    if (index >= 0) quotes[index] = saved;
    else quotes.unshift(saved);
    return saved;
  }

  async function deleteCloudQuote(quote) {
    const { error } = await supabaseClient.from('quotes').delete().eq('id', quote.id);
    if (error) throw error;
  }

  async function refreshQuotes() {
    if (!currentUser) return;
    setSyncStatus('Syncing');
    try {
      await fetchCloudQuotes();
    } catch (error) {
      setSyncStatus('Sync failed', true);
      showToast(`Could not load cloud quotes: ${error.message}`);
    }
  }

  function offerLocalImport() {
    const localQuotes = loadLocalQuotes();
    $('#import-local-button').hidden = localQuotes.length === 0;
    $('#import-local-button').textContent = `Import ${localQuotes.length} local quote${localQuotes.length === 1 ? '' : 's'}`;
  }

  async function handleCheckoutReturn() {
    const url = new URL(window.location.href);
    const checkoutState = url.searchParams.get('checkout');
    if (!checkoutState) return;
    url.searchParams.delete('checkout');
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    if (checkoutState === 'cancelled') {
      showToast('Checkout was cancelled. Your workspace is unchanged.');
      return;
    }
    if (checkoutState !== 'success') return;
    showToast('Payment received. Activating your Pro Desk…', 5000);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await fetchProfile();
      } catch (error) {
        console.error('Could not refresh billing status', error);
      }
      if (profile.isPro) {
        showToast('Your Elite Quote Flow Pro Desk is active.');
        return;
      }
      await new Promise(resolve => window.setTimeout(resolve, 2000));
    }
    showToast('Payment received. Your Pro Desk is syncing; refresh in a moment if it is not active yet.', 6000);
  }

  function analyticsListItem(name, visits) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = name;
    const value = document.createElement('strong');
    value.textContent = String(visits);
    item.append(label, value);
    return item;
  }

  function renderTrafficChart(data) {
    const chart = $('#analytics-traffic-chart');
    const axis = $('#analytics-traffic-axis');
    const rows = Array.isArray(data.hourly) ? data.hourly : [];
    const currentHour = new Date(); currentHour.setMinutes(0, 0, 0);
    const byHour = new Map(rows.map(row => [new Date(row.hour).getTime(), Math.max(0, Number(row.visits) || 0)]));
    const buckets = Array.from({ length: 24 }, (_, index) => {
      const hour = new Date(currentHour.getTime() - (23 - index) * 60 * 60 * 1000);
      return { hour, visits: byHour.get(hour.getTime()) || 0 };
    });
    const max = Math.max(1, ...buckets.map(bucket => bucket.visits));
    chart.replaceChildren();
    buckets.forEach(bucket => {
      const bar = document.createElement('div');
      bar.className = 'analytics-traffic-bar';
      const label = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(bucket.hour);
      bar.title = `${label}: ${bucket.visits} page visit${bucket.visits === 1 ? '' : 's'}`;
      bar.setAttribute('aria-label', bar.title);
      bar.style.height = `${Math.max(bucket.visits ? 5 : 2, Math.round(bucket.visits / max * 100))}%`;
      chart.append(bar);
    });
    axis.replaceChildren();
    [0, 6, 12, 18, 23].forEach(index => {
      const label = document.createElement('span');
      label.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(buckets[index].hour);
      axis.append(label);
    });
    $('#analytics-traffic-total').textContent = `${Number(data.visits24h) || 0} visits`;
  }

  function renderOwnerAnalytics(data) {
    $('#analytics-visits').textContent = String(data.visits24h || 0);
    renderTrafficChart(data);
    $('#analytics-quote-views').textContent = String(data.quoteViews24h || 0);
    $('#analytics-accepted').textContent = String(data.decisions24h?.accepted || 0);
    $('#analytics-declined').textContent = String(data.decisions24h?.declined || 0);
    const renderList = (selector, values, emptyLabel, formatter = item => `${item.name} · ${item.visits}`) => {
      const list = $(selector);
      list.replaceChildren();
      if (!values.length) {
        const item = document.createElement('li');
        item.textContent = emptyLabel;
        list.append(item);
      } else values.forEach(value => {
        const item = document.createElement('li');
        item.textContent = formatter(value);
        list.append(item);
      });
    };
    renderList('#analytics-sources', data.sources || [], 'No referrers yet');
    renderList('#analytics-countries', data.countries || [], 'No country data yet');
    renderList('#analytics-decisions-by-country', data.decisionsByCountry || [], 'No quote decisions in the last 24 hours', item => `${item.country} · ${item.decision}: ${item.count}`);
  }

  async function loadOwnerAnalytics() {
    if (!currentUser || !ownerAnalyticsEnabled) return;
    const errorElement = $('#analytics-error');
    errorElement.hidden = true;
    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const response = await fetch('/api/analytics', { headers: { Authorization: `Bearer ${sessionData.session?.access_token || ''}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Analytics request failed.');
      renderOwnerAnalytics(data);
    } catch (error) {
      errorElement.textContent = `Could not load analytics: ${error.message}`;
      errorElement.hidden = false;
    }
  }

  async function initializeOwnerAnalytics() {
    if (!currentUser || !supabaseClient) return;
    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const response = await fetch('/api/analytics', { headers: { Authorization: `Bearer ${sessionData.session?.access_token || ''}` } });
      if (response.status === 403) {
        ownerAnalyticsEnabled = false;
        $('#owner-analytics').hidden = true;
        $('#owner-analytics-nav').hidden = true;
        return;
      }
      if (response.status === 503) {
        ownerAnalyticsEnabled = false;
        $('#owner-analytics').hidden = true;
        $('#owner-analytics-nav').hidden = true;
        console.warn('Owner analytics is unavailable until its storage binding is provisioned.');
        return;
      }
      ownerAnalyticsEnabled = true;
      $('#owner-analytics').hidden = false;
      $('#owner-analytics-nav').hidden = false;
      if (response.ok) {
        const data = await response.json();
        renderOwnerAnalytics(data);
      } else {
        const data = await response.json();
        const error = $('#analytics-error');
        error.textContent = data.error || 'Analytics service is unavailable.';
        error.hidden = false;
      }
    } catch (error) {
      ownerAnalyticsEnabled = false;
      $('#owner-analytics').hidden = true;
      $('#owner-analytics-nav').hidden = true;
      console.error('Owner analytics initialization failed:', error.message);
    }
  }

  async function recordPageVisit() {
    const currentPath = window.location.pathname;
    if (currentPath === '/api/analytics' || currentPath.startsWith('/q/')) return;
    try {
      const { data: sessionData } = supabaseClient ? await supabaseClient.auth.getSession() : { data: {} };
      const headers = { 'Content-Type': 'application/json' };
      if (sessionData.session?.access_token) headers.Authorization = `Bearer ${sessionData.session.access_token}`;
      await fetch('/api/analytics', {
        method: 'POST',
        headers,
        body: JSON.stringify({ event: 'pageview', path: currentPath, referrer: document.referrer || '' })
      });
    } catch (error) {
      console.warn('Analytics event was not recorded:', error.message);
    }
  }

  let keepVerifiedSignIn = false;
  function showVerifiedSignIn() {
    keepVerifiedSignIn = true;
    showSignedOut('signin');
    showAuthError('Email verified. Sign in to open your desk.', 'success');
  }

  async function startApplication() {
    if (!window.supabase || !SUPABASE_CONFIG?.url || !SUPABASE_CONFIG?.anonKey) {
      showLanding();
      showToast('Sign-in service is not configured. Please try again later.');
      return;
    }
    const callback = window.EliteQuoteFlowAuth?.read(window.location.href) || {};
    if (callback.consumed) window.history.replaceState({}, '', window.EliteQuoteFlowAuth.cleanError(window.location.href));
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    let verifyError = '';
    try {
      if (callback.tokenHash && callback.type) {
        const { error } = await supabaseClient.auth.verifyOtp({ token_hash: callback.tokenHash, type: callback.type });
        window.history.replaceState({}, '', window.EliteQuoteFlowAuth.cleanVerify(window.location.href));
        if (error) {
          verifyError = error.message || 'Could not verify that email.';
          callback.consumed = callback.consumed || window.EliteQuoteFlowAuth.consumedText(verifyError);
        }
      }
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      currentUser = data.session?.user || null;
      await recordPageVisit();
      if (callback.type === 'recovery' && currentUser) {
        showSignedOut('recovery');
      } else if (currentUser) {
        showSignedIn();
        if (!callback.consumed && ['signup', 'email', 'magiclink', 'invite'].includes(callback.type)) showToast('Email verified. Welcome to Elite Quote Flow.');
        await fetchProfile();
        await loadCalculatorPreferences(currentUser.id);
        await initializeOwnerAnalytics();
        await refreshQuotes();
        await handleCheckoutReturn();
        offerLocalImport();
      } else if (callback.consumed && callback.type !== 'recovery') {
        showVerifiedSignIn();
      } else if (verifyError) {
        showSignedOut('signin');
        showAuthError(verifyError);
      } else {
        showLanding();
      }
    } catch (error) {
      if (window.EliteQuoteFlowAuth?.consumedText(error.message) && callback.type !== 'recovery') {
        showVerifiedSignIn();
      } else {
        showLanding();
        showToast(`Could not connect to the sign-in service: ${error.message}`, 6000);
      }
    }
    supabaseClient.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user || null;
      const previousId = currentUser?.id;
      currentUser = nextUser;
      if (nextUser && previousId !== nextUser.id) loadCalculatorPreferences(nextUser.id).catch(() => {});
      if (event === 'PASSWORD_RECOVERY' && nextUser) {
        showSignedOut('recovery');
      } else if (!nextUser) {
        if (quoteChangesChannel) {
          supabaseClient.removeChannel(quoteChangesChannel);
          quoteChangesChannel = null;
        }
        quotes = [];
        render();
        $('#header-profile-name').textContent = 'Your profile';
        $('#header-profile-avatar').textContent = 'Q';
        if (keepVerifiedSignIn) showVerifiedSignIn();
        else showLanding();
      } else if (nextUser.id !== previousId) {
        showSignedIn();
        window.setTimeout(async () => {
          if (currentUser?.id !== nextUser.id) return;
          await fetchProfile();
          await loadCalculatorPreferences(nextUser.id);
          await initializeOwnerAnalytics();
          await refreshQuotes();
          offerLocalImport();
        }, 0);
      }
    });
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function asDate(value) {
    const [year, month, day] = String(value || '').split('-').map(Number);
    if (!year || !month || !day) return null;
    const result = new Date(year, month - 1, day);
    result.setHours(0, 0, 0, 0);
    return Number.isNaN(result.getTime()) ? null : result;
  }

  function daysUntil(value) {
    const date = asDate(value);
    return date ? Math.round((date.getTime() - today.getTime()) / 86400000) : Infinity;
  }

  function acceptanceDate(quote) {
    const raw = quote.acceptedAt || quote.statusChangedAt || '';
    const parsed = raw ? new Date(raw) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
    return null;
  }

  function isRecoveredByFollowUp(quote) {
    if (quote.status !== 'won') return false;
    const followUp = asDate(quote.followUp);
    if (!followUp) return false;
    const accepted = acceptanceDate(quote);
    if (!accepted) return false;
    const acceptedDay = new Date(accepted);
    acceptedDay.setHours(0, 0, 0, 0);
    const followUpDue = acceptedDay.getTime() >= followUp.getTime();
    const hadReminder = Number(quote.reminderCount || 0) > 0 || Boolean(quote.lastReminderAt);
    return followUpDue || hadReminder;
  }

  function isDue(quote) {
    return quote.status === 'sent' && daysUntil(quote.followUp) <= 0;
  }

  function isUpcoming(quote) {
    return quote.status === 'sent' && daysUntil(quote.followUp) > 0;
  }

  function shortDate(value) {
    const date = asDate(value);
    return date ? dateFormat.format(date) : 'Not set';
  }

  function initials(name) {
    return String(name).trim().split(/\s+/).slice(0, 2).map(word => word[0] || '').join('').toUpperCase() || '?';
  }

  function renderRow(quote) {
    const delta = daysUntil(quote.followUp);
    let dateClass = '';
    let caption = 'Scheduled check-in';
    if (quote.status === 'sent' && delta < 0) {
      dateClass = 'overdue';
      caption = `${Math.abs(delta)} day${Math.abs(delta) === 1 ? '' : 's'} overdue`;
    } else if (quote.status === 'sent' && delta === 0) {
      dateClass = 'today';
      caption = 'Due today';
    } else if (quote.status !== 'sent') {
      caption = quote.status === 'won' ? 'Quote accepted' : 'Quote closed';
    } else if (Number.isFinite(delta)) {
      caption = `In ${delta} day${delta === 1 ? '' : 's'}`;
    }
    const statuses = [
      ['sent', 'Awaiting'],
      ['won', 'Accepted'],
      ['lost', 'Closed']
    ].map(([value, label]) => `<option value="${value}" ${quote.status === value ? 'selected' : ''}>${label}</option>`).join('');
    const contact = [quote.email, quote.phone].filter(Boolean).map(escapeHTML).join(' · ');
    const referral = quote.referralSource ? `<span class="customer-referral" title="Referral source">From ${escapeHTML(quote.referralSource)}</span>` : '';
    const actions = `<div class="row-actions"><button class="row-message" type="button" aria-label="Message ${escapeHTML(quote.customer)}" title="Write an email or text">✎</button>${quote.status === 'sent' ? `<button class="row-email" type="button" aria-label="Send follow-up email to ${escapeHTML(quote.customer)}" title="Send follow-up email" ${quote.email ? '' : 'disabled'}>✉</button>${quote.phone ? `<a class="row-call" href="tel:${escapeHTML(quote.phone.replace(/[^\d+]/g, ''))}" aria-label="Call ${escapeHTML(quote.customer)}" title="Call customer">☎</a>` : ''}` : ''}<button class="row-share-quote" type="button" aria-label="Copy customer quote link for ${escapeHTML(quote.customer)}" title="Copy customer quote link">🔗</button><button class="row-send-quote" type="button" aria-label="Draft quote email to ${escapeHTML(quote.customer)}" title="Draft quote email" ${quote.email ? '' : 'disabled'}>➤</button><button class="row-print-quote" type="button" aria-label="Print proposal for ${escapeHTML(quote.customer)}" title="Print or save as PDF">▤</button><button class="row-edit" type="button" aria-label="Edit quote for ${escapeHTML(quote.customer)}" title="Edit quote">✎</button><button class="row-delete" type="button" aria-label="Delete quote for ${escapeHTML(quote.customer)}" title="Delete quote">×</button></div>`;
    return `<tr data-id="${escapeHTML(quote.id)}">
      <td><div class="customer-cell"><span class="customer-avatar">${escapeHTML(initials(quote.customer))}</span><span><button type="button" class="customer-name customer-history-open" data-customer-history="${escapeHTML(quote.email?.toLowerCase() || quote.customer.toLowerCase())}" aria-label="View history for ${escapeHTML(quote.customer)}">${escapeHTML(quote.customer)}</button>${contact ? `<span class="customer-contact">${contact}</span>` : ''}${referral}${quote.note ? `<span class="customer-note" title="${escapeHTML(quote.note)}">${escapeHTML(quote.note)}</span>` : ''}</span></div></td>
      <td class="service-cell">${escapeHTML(quote.service)}${quote.lineItems?.length ? `<span class="customer-contact">${quote.lineItems.length} item${quote.lineItems.length === 1 ? '' : 's'}${quote.viewCount ? ` · ${quote.viewCount} view${quote.viewCount === 1 ? '' : 's'}` : ''}</span>` : quote.viewCount ? `<span class="customer-contact">${quote.viewCount} view${quote.viewCount === 1 ? '' : 's'}</span>` : ''}</td>
      <td class="amount-cell">${formatMoney(quote.amount, quote.currency)}</td>
      <td><span class="follow-date ${dateClass}">${escapeHTML(shortDate(quote.followUp))}</span><span class="follow-caption">${escapeHTML(caption)}</span></td>
      <td><select class="status-select status-${escapeHTML(quote.status)}" aria-label="Status for ${escapeHTML(quote.customer)}">${statuses}</select></td>
      <td>${actions}</td>
    </tr>`;
  }

  function matchesFilter(quote) {
    if (activeFilter === 'follow-up') return isDue(quote);
    if (activeFilter === 'upcoming') return isUpcoming(quote);
    return activeFilter === 'all' || quote.status === activeFilter;
  }

  function render() {
    const query = searchTerm.trim().toLocaleLowerCase();
    const visible = quotes.filter(quote => matchesFilter(quote) && (!query || `${quote.customer} ${quote.service} ${quote.note || ''} ${quote.email || ''} ${quote.phone || ''} ${quote.referralSource || ''}`.toLocaleLowerCase().includes(query)));
    visible.sort((a, b) => {
      if (sortBy === 'amount-desc') return Number(b.amount) - Number(a.amount);
      if (sortBy === 'amount-asc') return Number(a.amount) - Number(b.amount);
      if (sortBy === 'customer') return a.customer.localeCompare(b.customer);
      if (sortBy === 'newest') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      return (asDate(a.followUp)?.getTime() ?? Infinity) - (asDate(b.followUp)?.getTime() ?? Infinity);
    });
    rows.innerHTML = visible.map(renderRow).join('');
    emptyState.hidden = visible.length > 0;
    $('#empty-title').textContent = quotes.length ? 'No matching quotes' : 'Your next opportunity starts here';
    $('#empty-copy').textContent = quotes.length ? 'Try a different search or filter to find a quote.' : 'Add your first estimate to keep customer details, quote value, and the next follow-up together.';
    $('#empty-add-button').textContent = quotes.length ? '＋ Add quote' : '＋ Add your first quote';
    $('#empty-add-button').hidden = quotes.length > 0;

    const dueQuotes = quotes.filter(isDue);
    const upcomingQuotes = quotes.filter(isUpcoming);
    const openQuotes = quotes.filter(quote => quote.status === 'sent');
    const wonThisMonth = quotes.filter(quote => {
      if (quote.status !== 'won') return false;
      const accepted = new Date(quote.statusChangedAt || quote.createdAt || Date.now());
      return accepted.getFullYear() === today.getFullYear() && accepted.getMonth() === today.getMonth();
    });
    const decided = quotes.filter(quote => quote.status === 'won' || quote.status === 'lost');
    const rate = decided.length ? Math.round(quotes.filter(quote => quote.status === 'won').length / decided.length * 100) : 0;
    $('#metric-open').textContent = formatTotals(openQuotes);
    $('#metric-due').textContent = String(dueQuotes.length);
    $('#due-caption').textContent = dueQuotes.length ? `${dueQuotes.filter(quote => daysUntil(quote.followUp) < 0).length} overdue · ${dueQuotes.filter(quote => daysUntil(quote.followUp) === 0).length} due today` : 'No follow-ups due today';
    renderAcceptedTotal($('#metric-won'), wonThisMonth);
    const wonCurrencies = currencyTotals(wonThisMonth);
    $('#won-caption').textContent = wonCurrencies.length > 1
      ? `${wonThisMonth.length} accepted quotes · ${wonCurrencies.length} currencies kept separate`
      : `${wonThisMonth.length} accepted quote${wonThisMonth.length === 1 ? '' : 's'}`;
    const recoveredQuotes = quotes.filter(isRecoveredByFollowUp);
    const recoveredEl = $('#metric-recovered');
    const recoveredCaption = $('#recovered-caption');
    if (recoveredEl) recoveredEl.textContent = formatTotals(recoveredQuotes);
    if (recoveredCaption) {
      recoveredCaption.textContent = recoveredQuotes.length
        ? `${recoveredQuotes.length} accepted after follow-up was due${isPro() ? '' : ' · Pro automates reminder emails'}`
        : 'Accepted after follow-up was due · not a guarantee of results';
    }
    $('#metric-rate').textContent = `${rate}%`;
    renderPipeline();
    renderCustomerHistory();
    renderGrowthReport();
    renderCalendar();
    renderInvoices();
    updateQuoteCalculator();
    updateDeskIntro(openQuotes, dueQuotes);
    $('#nav-total').textContent = String(quotes.length);
    $('#nav-followups').textContent = String(dueQuotes.length);
    $('#count-all').textContent = String(quotes.length);
    $('#count-follow-up').textContent = String(dueQuotes.length);
    $('#count-upcoming').textContent = String(upcomingQuotes.length);
    $('#count-sent').textContent = String(quotes.filter(quote => quote.status === 'sent').length);
    $('#count-won').textContent = String(quotes.filter(quote => quote.status === 'won').length);
    $('#count-lost').textContent = String(quotes.filter(quote => quote.status === 'lost').length);
    $('#table-summary').textContent = `Showing ${visible.length} of ${quotes.length} quote${quotes.length === 1 ? '' : 's'}`;
  }

  function hideToast() {
    const toast = $('#toast');
    if (!toast) return;
    toast.classList.remove('is-visible');
    if (typeof toast.hidePopover === 'function' && toast.matches(':popover-open')) toast.hidePopover();
  }

  function showToast(message, duration = 2800, options = {}) {
    const toast = $('#toast');
    if (!toast) return;
    const error = options.error === true || /could not|was not|failed|unavailable|not saved|not deleted|not configured|invalid|try again/i.test(String(message || ''));
    const text = document.createElement('p');
    text.textContent = message;
    toast.replaceChildren(text);
    if (options.action?.label && typeof options.action.onClick === 'function') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-primary button-small toast-action';
      button.textContent = options.action.label;
      button.addEventListener('click', () => {
        hideToast();
        options.action.onClick();
      });
      toast.append(button);
    }
    toast.classList.toggle('is-error', error);
    toast.classList.add('is-visible');
    if (typeof toast.showPopover === 'function') {
      try { if (!toast.matches(':popover-open')) toast.showPopover(); } catch { /* The notice is already in the top layer. */ }
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, error ? Math.max(duration, 8000) : duration);
  }

  function renderLineItemFields(items = []) {
    const rows = Array.isArray(items) && items.length ? items : [{ description: '', quantity: 1, unit_price: '' }];
    lineItemsContainer.replaceChildren(...rows.slice(0, 20).map(item => {
      const row = document.createElement('div'); row.className = 'quote-line-item';
      const description = document.createElement('input'); description.name = 'lineDescription'; description.maxLength = 120; description.placeholder = 'Labor, materials, or service'; description.value = String(item.description || ''); description.setAttribute('aria-label', 'Quote item description');
      const quantity = document.createElement('input'); quantity.name = 'lineQuantity'; quantity.type = 'number'; quantity.min = '0.01'; quantity.step = '0.01'; quantity.value = String(item.quantity || 1); quantity.setAttribute('aria-label', 'Item quantity');
      const unitPrice = document.createElement('input'); unitPrice.name = 'lineUnitPrice'; unitPrice.type = 'number'; unitPrice.min = '0'; unitPrice.step = currencyStep(form.elements.currency.value || 'USD'); unitPrice.placeholder = 'Unit price'; unitPrice.value = item.unit_price === undefined ? '' : String(item.unit_price); unitPrice.setAttribute('aria-label', 'Item unit price');
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'row-delete quote-line-item-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Remove quote item'); remove.disabled = rows.length < 2;
      row.append(description, quantity, unitPrice, remove); return row;
    }));
    lineItemsContainer.querySelectorAll('.quote-line-item-remove').forEach(button => { button.disabled = lineItemsContainer.children.length < 2; });
    lineItemsContainer.querySelectorAll('input').forEach(input => input.addEventListener('input', updateLineItemsPreview));
    updateLineItemsPreview();
  }

  function updateLineItemsPreview() {
    if (!lineItemsContainer) return;
    const subtotal = [...lineItemsContainer.querySelectorAll('.quote-line-item')].reduce((sum, row) => {
      const description = row.querySelector('[name="lineDescription"]').value.trim();
      if (!description) return sum;
      const quantity = Math.max(0, Number(row.querySelector('[name="lineQuantity"]').value) || 0);
      const price = Math.max(0, Number(row.querySelector('[name="lineUnitPrice"]').value) || 0);
      return sum + quantity * price;
    }, 0);
    const target = $('#quote-items-total');
    if (target) target.textContent = `Items subtotal: ${formatMoney(subtotal, form.elements.currency.value || 'USD')}`;
  }

  function openDialog(quote = null, presetAmount = null, presetFollowUp = null, importPreset = null) {
    editingId = quote ? quote.id : null;
    form.reset();
    form.elements.currency.value = quote?.currency || importPreset?.currency || calculatorCurrency || 'USD';
    renderLineItemFields(quote?.lineItems || []);
    clearUnusedAiDraft();
    form.querySelectorAll('.form-field').forEach(field => field.classList.remove('has-error'));
    form.querySelectorAll('.field-error').forEach(error => { error.textContent = ''; });
    const importing = Boolean(importPreset) && !quote;
    $('#dialog-kicker').textContent = quote ? 'UPDATE OPPORTUNITY' : importing ? 'IMPORTED ESTIMATE' : 'A NEW OPPORTUNITY';
    $('#dialog-title').textContent = quote ? 'Edit quote' : importing ? 'Review imported quote' : 'Add a quote';
    $('#dialog-description').textContent = quote
      ? 'Update the details for this quote.'
      : importing
        ? 'Confirm the extracted fields, then save. Amounts are only filled when clearly labeled in the source.'
        : 'Capture the details and choose when to check in.';
    $('#quote-template-select').value = '';
    $('#save-quote-button').innerHTML = quote ? 'Save changes <span aria-hidden="true">↗</span>' : 'Save quote <span aria-hidden="true">↗</span>';
    if (quote) {
      for (const field of ['customer', 'service', 'email', 'phone', 'referralSource', 'amount', 'followUp', 'note']) form.elements[field].value = quote[field] ?? '';
      form.elements.currency.value = quote.currency || 'USD';
      form.elements.taxRate.value = quote.taxRate || 0;
      form.elements.discountAmount.value = quote.discountAmount || 0;
      form.elements.depositPercent.value = quote.depositPercent || 0;
      form.elements.terms.value = quote.quoteTerms || '';
      form.elements.expiresAt.value = quote.expiresAt || '';
    } else {
      form.elements.followUp.value = asDate(presetFollowUp) ? presetFollowUp : dateOffset(3);
      form.elements.currency.value = importPreset?.currency || calculatorCurrency;
      form.elements.taxRate.value = 0;
      form.elements.discountAmount.value = 0;
      form.elements.depositPercent.value = 0;
      if (importPreset) {
        for (const field of ['customer', 'service', 'email', 'phone', 'note']) {
          if (importPreset[field]) form.elements[field].value = importPreset[field];
        }
        if (importPreset.terms) form.elements.terms.value = importPreset.terms;
        if (importPreset.amount !== undefined && importPreset.amount !== null && importPreset.amount !== '') {
          form.elements.amount.value = Number(importPreset.amount).toFixed(2);
        } else if (presetAmount !== null) {
          form.elements.amount.value = Number(presetAmount).toFixed(2);
        }
        if (importPreset.currency && CURRENCIES.includes(importPreset.currency)) {
          form.elements.currency.value = importPreset.currency;
        }
      } else if (presetAmount !== null) {
        form.elements.amount.value = Number(presetAmount).toFixed(2);
      }
    }
    $('#quote-currency-label').textContent = form.elements.currency.value;
    form.elements.amount.step = currencyStep(form.elements.currency.value);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    setTimeout(() => form.elements.customer.focus(), 30);
  }

  function clearUnusedAiDraft() {
    const preview = $('#ai-scope-preview');
    const text = $('#ai-scope-preview-text');
    if (text) text.textContent = '';
    if (preview) preview.hidden = true;
  }

  function closeDialog() {
    clearUnusedAiDraft();
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function renderPipeline() {
    const stages = [
      { status: 'sent', label: 'Awaiting', color: 'pipeline-awaiting' },
      { status: 'won', label: 'Accepted', color: 'pipeline-accepted' },
      { status: 'lost', label: 'Closed', color: 'pipeline-closed' }
    ];
    const totalCount = quotes.length;
    $('#pipeline-total').textContent = `${formatTotals(quotes)} total`;
    $('#pipeline-stages').innerHTML = stages.map(stage => {
      const items = quotes.filter(quote => quote.status === stage.status);
      const amount = formatTotals(items);
      const share = totalCount > 0 ? Math.round(items.length / totalCount * 100) : 0;
      return `<button class="pipeline-stage ${stage.color}" type="button" data-pipeline-filter="${stage.status}" aria-label="Show ${items.length} ${stage.label.toLowerCase()} quotes worth ${escapeHTML(amount)}"><span class="pipeline-stage-heading"><strong>${stage.label}</strong><span>${items.length} quote${items.length === 1 ? '' : 's'}</span></span><span class="pipeline-bar" aria-hidden="true"><i style="width:${share}%"></i></span><span class="pipeline-stage-value">${amount} <small>${share}% of quotes</small></span></button>`;
    }).join('');
  }

  function renderCalendar() {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    $('#calendar-month-label').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(calendarMonth);
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let index = 0; index < firstWeekday; index += 1) cells.push('<span class="calendar-blank" aria-hidden="true"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const date = new Date(year, month, day);
      const dayQuotes = quotes.filter(quote => quote.status === 'sent' && quote.followUp === key);
      const selected = key === selectedCalendarDate;
      const todayClass = key === dateOffset(0) ? ' is-today' : '';
      const selectedClass = selected ? ' is-selected' : '';
      const eventClass = dayQuotes.length ? ' has-events' : '';
      cells.push(`<button class="calendar-day${todayClass}${selectedClass}${eventClass}" type="button" data-calendar-date="${key}" aria-label="${dateFormat.format(date)}${dayQuotes.length ? `, ${dayQuotes.length} follow-ups` : ''}" aria-pressed="${selected}"><span>${day}</span>${dayQuotes.length ? `<i>${dayQuotes.length}</i>` : ''}</button>`);
    }
    while (cells.length % 7) cells.push('<span class="calendar-blank" aria-hidden="true"></span>');
    const headings = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<span class="calendar-weekday">${day}</span>`).join('');
    $('#calendar-grid').innerHTML = headings + cells.join('');
    renderCalendarSelection();
  }

  function renderCalendarSelection() {
    const key = selectedCalendarDate || dateOffset(0);
    const matches = quotes.filter(quote => quote.status === 'sent' && quote.followUp === key);
    const label = dateFormat.format(asDate(key) || today);
    const selection = $('#calendar-selection');
    if (!matches.length) {
      selection.textContent = `${label} · No follow-ups scheduled.`;
      return;
    }
    selection.innerHTML = `<strong>${escapeHTML(label)} · ${matches.length} follow-up${matches.length === 1 ? '' : 's'}</strong>${matches.map(quote => `<button class="calendar-event" type="button" data-calendar-quote="${escapeHTML(quote.id)}"><span>${escapeHTML(quote.customer)}</span><span>${formatMoney(quote.amount, quote.currency)}</span></button>`).join('')}`;
  }

  function calculatorNumbers() {
    const hours = Math.max(0, Number($('#calc-hours').value) || 0);
    const rate = Math.max(0, Number($('#calc-rate').value) || 0);
    const materials = Math.max(0, Number($('#calc-materials').value) || 0);
    const margin = Math.min(89, Math.max(0, Number($('#calc-margin').value) || 0));
    const cost = hours * rate + materials;
    const price = cost / (1 - margin / 100);
    return { price, cost, profit: price - cost, hours, rate, materials, margin };
  }

  function setCalculatorCurrency(currency, persist = true) {
    calculatorCurrency = CURRENCIES.includes(currency) ? currency : 'USD';
    const select = $('#calc-currency');
    if (select) select.value = calculatorCurrency;
    const symbol = new Intl.NumberFormat(undefined, { style: 'currency', currency: calculatorCurrency }).formatToParts(0).find(part => part.type === 'currency')?.value || calculatorCurrency;
    $('#calc-currency-symbol-rate').textContent = symbol;
    $('#calc-currency-symbol-materials').textContent = symbol;
    updateQuoteCalculator();
    if (persist && currentUser) localStorage.setItem(`quoteflow.${currentUser.id}.${CALCULATOR_CURRENCY_KEY}`, calculatorCurrency);
  }

  function updateQuoteCalculator() {
    const { price, profit } = calculatorNumbers();
    $('#calc-price').textContent = formatMoney(price, calculatorCurrency);
    $('#calc-profit').textContent = formatMoney(profit, calculatorCurrency);
    if (currentUser) {
      const values = calculatorNumbers();
      for (const [id, value] of [['calc-hours', values.hours], ['calc-rate', values.rate], ['calc-materials', values.materials], ['calc-margin', values.margin]]) {
        localStorage.setItem(`quoteflow.${currentUser.id}.${id}`, String(value));
      }
    }
  }

  async function loadCalculatorPreferences(userId) {
    for (const id of ['calc-hours', 'calc-rate', 'calc-materials', 'calc-margin']) {
      const stored = localStorage.getItem(`quoteflow.${userId}.${id}`);
      if (stored !== null) $(`#${id}`).value = stored;
    }
    const storedCurrency = localStorage.getItem(`quoteflow.${userId}.${CALCULATOR_CURRENCY_KEY}`);
    if (CURRENCIES.includes(storedCurrency)) {
      setCalculatorCurrency(storedCurrency, false);
      return;
    }
    const detected = await detectVisitorCurrency();
    setCalculatorCurrency(detected || (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Africa/Lagos' || Intl.DateTimeFormat().resolvedOptions().locale?.endsWith('-NG') ? 'NGN' : 'USD'), false);
  }

  async function detectVisitorCurrency() {
    try {
      const saved = localStorage.getItem(VISITOR_CURRENCY_KEY);
      if (CURRENCIES.includes(saved)) return saved;
    } catch { /* Ask the site which currency matches this visit. */ }
    try {
      const response = await fetch('/api/visitor-locale', { headers: { Accept: 'application/json' } });
      if (!response.ok) return '';
      const body = await response.json();
      if (!CURRENCIES.includes(body.currency) || body.ip) return '';
      try { localStorage.setItem(VISITOR_CURRENCY_KEY, body.currency); } catch { /* Keep the detected currency for this visit. */ }
      return body.currency;
    } catch { return ''; }
  }

  function checkReminders() {
    if (!currentUser || !('Notification' in window) || Notification.permission !== 'granted') return;
    for (const quote of quotes.filter(isDue)) {
      const key = `quoteflow.reminded.${currentUser.id}.${quote.id}.${dateOffset(0)}`;
      if (localStorage.getItem(key)) continue;
      new Notification('Elite Quote Flow follow-up due', { body: `Follow up with ${quote.customer} about ${quote.service}.`, tag: key });
      localStorage.setItem(key, '1');
    }
  }

  async function enableReminders() {
    if (!('Notification' in window)) return showToast('This browser does not support desktop reminders.');
    if (!currentUser) return showToast('Sign in to enable reminders.');
    const permission = await Notification.requestPermission();
    const button = $('#enable-reminders-button');
    if (permission === 'granted') {
      button.textContent = 'Reminders enabled';
      showToast(isPro()
        ? 'Browser reminders enabled. Pro also emails customers automatically on follow-up dates when Resend is configured.'
        : 'Browser reminders enabled. Automated customer email reminders are included with Pro.');
      checkReminders();
    } else {
      button.textContent = 'Reminders blocked';
      showToast('Allow notifications for this site in your browser settings to enable reminders.');
    }
  }

  function setFilter(filter) {
    activeFilter = filter;
    document.querySelectorAll('.filter-tab').forEach(tab => {
      const selected = tab.dataset.filter === filter;
      tab.classList.toggle('is-selected', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    render();
    $('#quotes').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function clearFieldError(fieldName) {
    const input = form.elements[fieldName];
    const wrapper = input.closest('.form-field');
    wrapper.classList.remove('has-error');
    wrapper.querySelector('.field-error').textContent = '';
  }

  [$('#new-quote-button'), $('#new-quote-button-secondary'), $('#empty-add-button')].forEach(button => button.addEventListener('click', () => openDialog()));
  document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', closeDialog));
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
  $('#focus-button').addEventListener('click', () => setFilter('follow-up'));

  const importDialog = $('#import-estimate-dialog');
  const importForm = $('#import-estimate-form');
  const importStatus = $('#import-estimate-status');
  const importReview = $('#import-estimate-review');
  const importContinue = $('#import-estimate-continue');
  let pendingImport = null;

  function setImportStatus(message, kind = '') {
    if (!importStatus) return;
    importStatus.textContent = message || '';
    importStatus.classList.toggle('is-error', kind === 'error');
    importStatus.classList.toggle('is-loading', kind === 'loading');
  }

  function closeImportDialog() {
    if (!importDialog) return;
    if (typeof importDialog.close === 'function') importDialog.close();
    else importDialog.removeAttribute('open');
  }

  function openImportDialog() {
    if (!currentUser) return showToast('Sign in to import an estimate.');
    if (!importDialog || !importForm) return showToast('Import is unavailable right now.');
    importForm.reset();
    pendingImport = null;
    if (importReview) importReview.hidden = true;
    if (importContinue) importContinue.hidden = true;
    const currencySelect = $('#import-review-currency');
    if (currencySelect && !currencySelect.options.length) currencySelect.innerHTML = currencyOptions;
    if (currencySelect) currencySelect.value = calculatorCurrency || 'USD';
    setImportStatus('Upload a file or paste text, then extract fields to review.');
    if (typeof importDialog.showModal === 'function') importDialog.showModal();
    else importDialog.setAttribute('open', '');
  }

  function fillImportReview(parsed) {
    pendingImport = parsed;
    if (!importReview) return;
    importReview.hidden = false;
    if (importContinue) importContinue.hidden = false;
    $('#import-review-customer').value = parsed.fields.customer || '';
    $('#import-review-service').value = parsed.fields.service || '';
    $('#import-review-email').value = parsed.fields.email || '';
    $('#import-review-phone').value = parsed.fields.phone || '';
    $('#import-review-amount').value = parsed.fields.amount || '';
    const currencySelect = $('#import-review-currency');
    if (currencySelect) {
      if (!currencySelect.options.length) currencySelect.innerHTML = currencyOptions;
      currencySelect.value = CURRENCIES.includes(parsed.fields.currency) ? parsed.fields.currency : (calculatorCurrency || 'USD');
    }
    $('#import-review-terms').value = parsed.fields.terms || '';
    const warnings = $('#import-estimate-warnings');
    if (warnings) warnings.textContent = (parsed.warnings || []).join(' ') || 'Review the fields below, then continue to the quote form.';
  }

  async function runEstimateImport() {
    const api = window.QuoteFlowEstimateImport;
    if (!api) {
      setImportStatus('Import helper failed to load. Refresh and try again.', 'error');
      return;
    }
    const fileInput = $('#import-estimate-file');
    const paste = ($('#import-estimate-paste')?.value || '').trim();
    const file = fileInput?.files?.[0] || null;
    if (!file && !paste) {
      setImportStatus('Choose a file or paste estimate text first.', 'error');
      return;
    }
    setImportStatus('Extracting fields…', 'loading');
    if (importContinue) importContinue.hidden = true;
    try {
      let parsed;
      if (file) parsed = await api.extractFromFile(file);
      else parsed = api.parseEstimateText(paste, { sourceType: 'paste' });
      if (paste && file) {
        const fromPaste = api.parseEstimateText(paste, { sourceType: 'paste', filename: file.name });
        parsed.fields = {
          ...parsed.fields,
          customer: fromPaste.fields.customer || parsed.fields.customer,
          service: fromPaste.fields.service || parsed.fields.service,
          email: fromPaste.fields.email || parsed.fields.email,
          phone: fromPaste.fields.phone || parsed.fields.phone,
          amount: fromPaste.fields.amount || parsed.fields.amount,
          currency: fromPaste.fields.currency || parsed.fields.currency,
          terms: fromPaste.fields.terms || parsed.fields.terms,
          note: parsed.fields.note || fromPaste.fields.note
        };
        parsed.warnings = [...new Set([...(parsed.warnings || []), ...(fromPaste.warnings || [])])];
      }
      fillImportReview(parsed);
      setImportStatus(parsed.extractedText ? 'Fields extracted. Confirm them, then continue.' : 'Ready for review. Confirm or complete the fields before saving.');
    } catch (error) {
      pendingImport = null;
      if (importReview) importReview.hidden = true;
      setImportStatus(error.message || 'Could not import that estimate.', 'error');
    }
  }

  function continueImportedEstimate() {
    if (!pendingImport) return setImportStatus('Extract fields before continuing.', 'error');
    const amountValue = $('#import-review-amount')?.value;
    const preset = {
      customer: ($('#import-review-customer')?.value || '').trim(),
      service: ($('#import-review-service')?.value || '').trim(),
      email: ($('#import-review-email')?.value || '').trim(),
      phone: ($('#import-review-phone')?.value || '').trim(),
      amount: amountValue === '' || amountValue === undefined ? '' : amountValue,
      currency: $('#import-review-currency')?.value || calculatorCurrency || 'USD',
      terms: ($('#import-review-terms')?.value || '').trim().slice(0, 2000),
      note: (pendingImport.fields.note || '').slice(0, 240)
    };
    closeImportDialog();
    openDialog(null, null, null, preset);
    showToast('Review the imported fields, then save the quote.');
  }

  [$('#import-estimate-button'), $('#import-estimate-button-secondary'), $('#empty-import-button')].forEach(button => {
    button?.addEventListener('click', openImportDialog);
  });
  document.querySelectorAll('.import-estimate-close').forEach(button => button.addEventListener('click', closeImportDialog));
  importDialog?.addEventListener('click', event => { if (event.target === importDialog) closeImportDialog(); });
  $('#import-estimate-parse')?.addEventListener('click', event => { event.preventDefault(); runEstimateImport(); });
  importContinue?.addEventListener('click', event => { event.preventDefault(); continueImportedEstimate(); });
  importForm?.addEventListener('submit', event => {
    event.preventDefault();
    if (importContinue && !importContinue.hidden) continueImportedEstimate();
    else runEstimateImport();
  });
  async function startBillingAction(button, endpoint, body) {
    if (!currentUser || !supabaseClient) return showToast('Sign in before managing your plan.');
    const original = button.innerHTML;
    const label = endpoint === '/api/create-portal-session' ? 'Opening subscription settings…' : 'Opening secure checkout…';
    button.disabled = true;
    button.textContent = label;
    let step = 'reading your sign-in session';
    try {
      let { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) {
        const refreshed = await supabaseClient.auth.refreshSession();
        if (refreshed.error) throw new Error('Your sign-in expired. Please sign in again.');
        session = refreshed.data.session;
      }
      if (!session?.access_token) throw new Error('Your sign-in expired. Please sign in again.');
      step = 'contacting the billing service';
      const sendBillingRequest = accessToken => fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body)
      });
      let response = await sendBillingRequest(session.access_token);
      let responseText = await response.text();
      let result;
      try { result = responseText ? JSON.parse(responseText) : {}; }
      catch { throw new Error(`Billing service returned an unexpected response (${response.status}).`); }
      if (endpoint === '/api/create-portal-session' && response.status === 401 && /session/i.test(result.error || '')) {
        const refreshed = await supabaseClient.auth.refreshSession();
        if (refreshed.error || !refreshed.data.session?.access_token) throw new Error('Your sign-in expired. Sign out, sign back in, then retry.');
        response = await sendBillingRequest(refreshed.data.session.access_token);
        responseText = await response.text();
        try { result = responseText ? JSON.parse(responseText) : {}; }
        catch { throw new Error(`Billing service returned an unexpected response (${response.status}).`); }
      }
      if (!response.ok || !result.url) throw new Error(result.error || `Could not open billing (${response.status}).`);
      window.location.assign(result.url);
    } catch (error) {
      showToast(`Billing action failed while ${step}: ${error?.message || String(error)}`, 6000);
      button.disabled = false;
      button.innerHTML = original;
    }
  }
  $('#upgrade-monthly-link').addEventListener('click', event => startBillingAction(event.currentTarget, '/api/create-monthly-checkout-session', { plan: 'monthly' }));
  $('#upgrade-lifetime-link').addEventListener('click', event => startBillingAction(event.currentTarget, '/api/create-checkout-session', { plan: 'lifetime' }));
  $('#upgrade-pro-link').addEventListener('click', event => startBillingAction(event.currentTarget, '/api/create-portal-session', {}));
  $('#invite-button').addEventListener('click', async () => {
    if (!referralState?.referralLink) {
      try { await loadGrowthExtras(); } catch { /* ignore */ }
    }
    const inviteUrl = referralState?.referralLink || window.location.origin;
    const title = 'Try Elite Quote Flow for your business';
    const text = 'I use Elite Quote Flow to keep customer quotes and follow-ups organized. Check it out:';
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: inviteUrl });
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    const body = `${text} ${inviteUrl}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  });
  $('#team-invite-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!requirePro('Team invites')) return;
    const email = $('#team-invite-email')?.value.trim().toLowerCase();
    if (!email) return showToast('Enter a teammate email.');
    try {
      const headers = await authHeaders();
      const response = await fetch('/api/teams', { method: 'POST', headers, body: JSON.stringify({ email, role: $('#team-invite-role')?.value || 'member' }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not invite teammate.');
      $('#team-invite-email').value = '';
      await loadGrowthExtras();
      showToast(`Invitation sent to ${email}.`);
    } catch (error) { showToast(error.message, 6000); }
  });
  $('#team-members-list')?.addEventListener('click', async event => {
    const button = event.target.closest('.team-revoke');
    if (!button) return;
    if (!requirePro('Team management')) return;
    try {
      const headers = await authHeaders();
      const response = await fetch('/api/teams', { method: 'PATCH', headers, body: JSON.stringify({ memberId: button.dataset.memberId, status: 'revoked' }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not revoke teammate.');
      await loadGrowthExtras();
      showToast('Teammate access revoked.');
    } catch (error) { showToast(error.message, 6000); }
  });
  $('#team-pending-invites')?.addEventListener('click', async event => {
    const button = event.target.closest('.team-accept');
    if (!button) return;
    try {
      const headers = await authHeaders();
      const response = await fetch('/api/teams/accept', { method: 'POST', headers, body: JSON.stringify({ inviteId: button.dataset.inviteId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not accept invitation.');
      await loadGrowthExtras();
      showToast('Team invitation accepted.');
    } catch (error) { showToast(error.message, 6000); }
  });
  $('#copy-referral-link')?.addEventListener('click', async () => {
    if (!requirePro('Referral credits')) return;
    const link = referralState?.referralLink || $('#referral-link-value')?.textContent;
    if (!link || link === '—') return showToast('Referral link is not ready yet.');
    try { await navigator.clipboard.writeText(link); showToast('Referral link copied.'); }
    catch { window.prompt('Copy your referral link:', link); }
  });
  $('#apply-referral-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const code = $('#apply-referral-code')?.value.trim().toUpperCase();
    if (!code) return showToast('Enter a referral code.');
    try {
      const headers = await authHeaders();
      const response = await fetch('/api/referrals', { method: 'POST', headers, body: JSON.stringify({ code }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not apply referral code.');
      await loadGrowthExtras();
      showToast('Referral code linked. When you upgrade to Pro, your referrer earns a credit month.');
    } catch (error) { showToast(error.message, 6000); }
  });
  document.querySelectorAll('.filter-tab').forEach(tab => tab.addEventListener('click', () => setFilter(tab.dataset.filter)));
  document.querySelectorAll('[data-nav-filter]').forEach(link => link.addEventListener('click', () => setFilter(link.dataset.navFilter)));
  document.querySelectorAll('[data-feature-target]').forEach(link => link.addEventListener('click', () => {
    document.body.classList.remove('nav-open');
    const feature = link.dataset.proFeature;
    const action = link.dataset.featureAction;
    if (action === 'branded-email') showBrandedEmail();
    else if (action === 'message') openMessageComposer();
    else {
      if (feature && !isPro()) requirePro(feature);
      if (action === 'templates' && (!feature || isPro())) $('#manage-templates-button')?.click();
      else if (action === 'import' && (!feature || isPro())) $('#import-estimate-button')?.click();
      else if (action === 'ai-draft' && isPro()) { $('#new-quote-button')?.click(); $('#ai-scope-draft')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else document.getElementById(link.dataset.featureTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    document.querySelectorAll('[data-feature-target]').forEach(item => item.classList.toggle('active', item === link));
  }));
  $('#pipeline-stages').addEventListener('click', event => {
    const stage = event.target.closest('[data-pipeline-filter]');
    if (stage) setFilter(stage.dataset.pipelineFilter);
  });
  $('#search-input').addEventListener('input', event => { searchTerm = event.target.value; render(); });
  $('#sort-select').addEventListener('change', event => { sortBy = event.target.value; render(); });
  ['calc-hours', 'calc-rate', 'calc-materials', 'calc-margin'].forEach(id => $(`#${id}`).addEventListener('input', updateQuoteCalculator));
  $('#calc-currency').innerHTML = currencyOptions;
  $('#calc-currency').addEventListener('change', event => setCalculatorCurrency(event.currentTarget.value));
  $('#calendar-prev').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); renderCalendar(); });
  $('#calendar-next').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); renderCalendar(); });
  $('#calendar-today').addEventListener('click', () => { calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1); selectedCalendarDate = dateOffset(0); renderCalendar(); });
  $('#calendar-grid').addEventListener('click', event => {
    const day = event.target.closest('[data-calendar-date]');
    if (!day) return;
    selectedCalendarDate = day.dataset.calendarDate;
    renderCalendar();
    openDialog(null, null, selectedCalendarDate);
  });
  $('#calendar-selection').addEventListener('click', event => {
    const item = event.target.closest('[data-calendar-quote]');
    if (!item) return;
    const quote = quotes.find(entry => entry.id === item.dataset.calendarQuote);
    if (quote) openDialog(quote);
  });
  $('#use-calculated-quote').addEventListener('click', () => {
    if (!currentUser) return showToast('Sign in to add this estimate to your quotes.');
    openDialog(null, calculatorNumbers().price);
    form.elements.currency.value = calculatorCurrency;
    $('#quote-currency-label').textContent = calculatorCurrency;
    form.elements.amount.step = currencyStep(calculatorCurrency);
  });
  $('#add-quote-line-item').addEventListener('click', () => {
    const current = [...lineItemsContainer.querySelectorAll('.quote-line-item')].map(row => ({ description: row.querySelector('[name="lineDescription"]').value, quantity: row.querySelector('[name="lineQuantity"]').value, unit_price: row.querySelector('[name="lineUnitPrice"]').value }));
    if (current.length >= lineItemLimit()) {
      if (!isPro()) return requirePro('Multiple quote line items');
      return showToast(`A quote can contain up to ${PRO_LINE_ITEM_LIMIT} items.`);
    }
    current.push({ description: '', quantity: 1, unit_price: '' }); renderLineItemFields(current);
    lineItemsContainer.lastElementChild?.querySelector('[name="lineDescription"]')?.focus();
  });
  lineItemsContainer.addEventListener('click', event => {
    if (!event.target.closest('.quote-line-item-remove')) return;
    const rows = [...lineItemsContainer.querySelectorAll('.quote-line-item')].map(row => ({ description: row.querySelector('[name="lineDescription"]').value, quantity: row.querySelector('[name="lineQuantity"]').value, unit_price: row.querySelector('[name="lineUnitPrice"]').value }));
    rows.splice([...lineItemsContainer.children].indexOf(event.target.closest('.quote-line-item')), 1); renderLineItemFields(rows);
  });
  $('#enable-reminders-button').addEventListener('click', enableReminders);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });

  form.querySelectorAll('input,textarea').forEach(input => input.addEventListener('input', () => clearFieldError(input.name)));
  form.elements.currency.innerHTML = currencyOptions;
  templateForm.elements.currency.innerHTML = currencyOptions;
  $('#calc-currency').innerHTML = currencyOptions;
  setCalculatorCurrency('USD', false);
  detectVisitorCurrency().then(currency => { if (currency && !currentUser) setCalculatorCurrency(currency, false); });
  form.elements.currency.addEventListener('change', () => {
    $('#quote-currency-label').textContent = form.elements.currency.value;
    form.elements.amount.step = currencyStep(form.elements.currency.value);
    lineItemsContainer.querySelectorAll('[name="lineUnitPrice"]').forEach(input => { input.step = currencyStep(form.elements.currency.value); });
    updateLineItemsPreview();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentUser || !supabaseClient) return showToast('Sign in before saving quotes.');
    const data = new FormData(form);
    const values = {
      customer: String(data.get('customer') || '').trim(),
      service: String(data.get('service') || '').trim(),
      amount: Number(data.get('amount')),
      currency: String(data.get('currency') || 'USD'),
      taxRate: Math.max(0, Math.min(100, Number(data.get('taxRate')) || 0)),
      discountAmount: Math.max(0, Number(data.get('discountAmount')) || 0),
      depositPercent: Math.max(0, Math.min(100, Number(data.get('depositPercent')) || 0)),
      lineItems: [...lineItemsContainer.querySelectorAll('.quote-line-item')].map(row => {
        const description = row.querySelector('[name="lineDescription"]').value.trim();
        if (!description) return null;
        const quantity = Math.max(0.01, Number(row.querySelector('[name="lineQuantity"]').value) || 1);
        const enteredPrice = row.querySelector('[name="lineUnitPrice"]').value;
        const unitPrice = Math.max(0, enteredPrice === '' ? Number(data.get('amount')) : Number(enteredPrice));
        return { description, quantity, unit_price: unitPrice, total: Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100 };
      }).filter(Boolean),
      followUp: String(data.get('followUp') || ''),
      email: String(data.get('email') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      referralSource: String(data.get('referralSource') || '').trim(),
      note: String(data.get('note') || '').trim(),
      quoteTerms: String(data.get('terms') || '').trim(),
      expiresAt: String(data.get('expiresAt') || '')
    };
    const emailValid = !values.email || form.elements.email.validity.valid;
    const errors = {
      customer: values.customer ? '' : 'Add the customer name.',
      service: values.service ? '' : 'Add a service description.',
      email: emailValid ? '' : 'Enter a valid email or leave this blank.',
      amount: values.lineItems.length ? '' : Number.isFinite(values.amount) && values.amount > 0 && values.amount <= 99999999 ? '' : 'Enter a positive total or add at least one priced item.',
      currency: CURRENCIES.includes(values.currency) ? '' : 'Choose a supported currency.',
      followUp: asDate(values.followUp) ? '' : 'Choose a follow-up date.'
    };
    if (values.taxRate > 100 || values.discountAmount < 0 || values.depositPercent > 100) return showToast('Tax and deposit percentages must be 0–100, and discount cannot be negative.');
    if (!isPro() && values.depositPercent > 0) return requirePro('Deposit collection');
    if (!isPro() && values.lineItems.length > FREE_LINE_ITEM_LIMIT) return requirePro('Multiple quote line items');
    if (!editingId && !isPro() && openQuoteCount() >= FREE_OPEN_QUOTE_LIMIT) {
      return requirePro(`More than ${FREE_OPEN_QUOTE_LIMIT} open quotes`);
    }
    let firstInvalid = null;
    Object.entries(errors).forEach(([name, message]) => {
      const input = form.elements[name];
      const wrapper = input?.closest('.form-field');
      if (wrapper) {
        wrapper.classList.toggle('has-error', Boolean(message));
        wrapper.querySelector('.field-error').textContent = message;
      }
      if (message && !firstInvalid) firstInvalid = input;
    });
    if (firstInvalid) {
      const field = firstInvalid.closest('.form-field');
      field?.scrollIntoView({ block: 'center' });
      firstInvalid.focus();
      const firstMessage = Object.values(errors).find(Boolean);
      if (firstMessage) showToast(firstMessage, 6000, { error: true });
      return;
    }
    const wasEditing = Boolean(editingId);
    if (values.lineItems.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0)) return showToast('Each quote item needs a positive quantity and a valid unit price.');
    values.subtotalAmount = values.lineItems.length ? values.lineItems.reduce((sum, item) => sum + item.total, 0) : values.amount;
    values.amount = Math.max(0, Math.round(((values.subtotalAmount - values.discountAmount) * (1 + values.taxRate / 100) + Number.EPSILON) * 100) / 100);
    if (values.amount <= 0) return showToast('The total must remain above zero after discount and tax.');
    const previousQuote = editingId ? quotes.find(quote => quote.id === editingId) : null;
    const previousSnapshot = previousQuote ? { ...previousQuote } : null;
    const selectedTemplate = templates.find(template => template.id === $('#quote-template-select').value);
    if (selectedTemplate && !previousQuote) {
      values.service = selectedTemplate.service;
      values.currency = selectedTemplate.currency || 'USD';
      if (!values.lineItems.length && selectedTemplate.lineItems?.length) values.lineItems = selectedTemplate.lineItems;
      if (values.taxRate === 0) values.taxRate = selectedTemplate.taxRate || 0;
      if (values.discountAmount === 0) values.discountAmount = selectedTemplate.discountAmount || 0;
      if (values.depositPercent === 0) values.depositPercent = selectedTemplate.depositPercent || 0;
      values.subtotalAmount = selectedTemplate.subtotalAmount || selectedTemplate.amount;
      values.amount = Math.max(0, Math.round(((values.subtotalAmount - values.discountAmount) * (1 + values.taxRate / 100) + Number.EPSILON) * 100) / 100);
      form.elements.currency.value = values.currency;
      $('#quote-currency-label').textContent = values.currency;
      form.elements.amount.step = currencyStep(values.currency);
      if (!values.quoteTerms) values.quoteTerms = selectedTemplate.terms;

    }
    const quote = previousQuote
      ? { ...previousQuote, ...values, updatedAt: new Date().toISOString() }
      : { id: `local-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`, ...values, status: 'sent', createdAt: new Date().toISOString() };
    if (previousQuote) Object.assign(previousQuote, quote);
    else quotes.unshift(quote);
    render();
    $('#save-quote-button').disabled = true;
    setSyncStatus('Saving');
    try {
      await saveCloudQuote(quote);
      render();
      closeDialog();
      setFilter('all');
      setSyncStatus('Cloud sync active');
      showToast(wasEditing ? 'Quote updated and synced.' : 'Quote added and synced.');
      editingId = null;
      form.querySelector('#save-quote-button').disabled = false;
    } catch (error) {
      if (previousQuote && previousSnapshot) Object.assign(previousQuote, previousSnapshot);
      else quotes = quotes.filter(item => item.id !== quote.id);
      render();
      await refreshQuotes();
      $('#save-quote-button').disabled = false;
      setSyncStatus('Sync failed', true);
      showToast(`Quote was not saved: ${error.message}`);
    }
  });

  rows.addEventListener('change', async event => {
    const select = event.target.closest('.status-select');
    if (!select) return;
    const row = select.closest('tr');
    const quote = quotes.find(item => item.id === row.dataset.id);
    if (!quote) return;
    const oldStatus = quote.status;
    const oldStatusChangedAt = quote.statusChangedAt;
    quote.status = select.value;
    quote.statusChangedAt = new Date().toISOString();
    try {
      setSyncStatus('Saving');
      await saveCloudQuote(quote);
      render();
      setSyncStatus('Cloud sync active');
      showToast(`Quote marked ${select.options[select.selectedIndex].text.toLowerCase()}.`);
    } catch (error) {
      quote.status = oldStatus;
      quote.statusChangedAt = oldStatusChangedAt;
      render();
      setSyncStatus('Sync failed', true);
      showToast(`Status was not saved: ${error.message}`);
    }
  });

  async function sendCustomerEmail(quote, subject, body, successLabel) {
    const mailto = `mailto:${encodeURIComponent(quote.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (!isPro()) {
      window.location.href = mailto;
      return true;
    }
    try {
      const headers = await authHeaders();
      const response = await fetch('/api/send-quote-email', { method: 'POST', headers, body: JSON.stringify({ quoteId: quote.id, subject, body }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not send the email.');
      showToast(result.from ? `${successLabel} as ${result.from}.` : `${successLabel}.`);
      return true;
    } catch (error) {
      showToast(error.message || 'Could not send the email.', 9000, {
        error: true,
        action: { label: 'Open email app', onClick: () => { window.location.href = mailto; } }
      });
      return false;
    }
  }

  rows.addEventListener('click', async event => {
    const row = event.target.closest('tr');
    if (!row) return;
    const quote = quotes.find(item => item.id === row.dataset.id);
    if (!quote) return;
    if (event.target.closest('.row-print-quote')) {
      printQuoteProposal(quote);
      return;
    }
    if (event.target.closest('.row-edit')) {
      openDialog(quote);
      return;
    }
    if (event.target.closest('.row-share-quote')) {
      try { await makeQuoteShareable(quote); } catch (error) { showToast(`Could not create quote link: ${error.message}`); }
      return;
    }
    if (event.target.closest('.row-message')) {
      openMessageComposer({ email: quote.email, phone: quote.phone, customer: quote.customer, quote, successLabel: 'Message sent' });
      return;
    }
    if (event.target.closest('.row-send-quote')) {
      if (!quote.email) return showToast('Add the customer email before drafting a quote email.');
      if (!quote.publicToken) {
        try { await makeQuoteShareable(quote); }
        catch (error) { return showToast(`Could not create quote link: ${error.message}`); }
      }
      const quoteLink = `${window.location.origin}/q/${quote.publicToken}`;
      const subject = `Your ${quote.service} quote from ${profile.businessName || profile.fullName || 'our team'}`;
      const followUpDate = shortDate(quote.followUp);
      const items = quoteItemLabels(quote).map(label => `- ${label}`).join('\n');
      const body = `Hi ${quote.customer},\n\nThank you for the opportunity to quote this work.\n\n${items}\n\nQuote total: ${formatMoney(quote.amount, quote.currency)}\n\nReview and respond to your quote: ${quoteLink}\n\nPlease let me know if you have any questions. I’ll plan to follow up on ${followUpDate}.\n\nBest,\n${emailSignature()}`;
      if (isPro()) return openMessageComposer({ email: quote.email, phone: quote.phone, customer: quote.customer, subject, body, quote, successLabel: 'Quote email sent' });
      await sendCustomerEmail(quote, subject, body, 'Quote email sent');
      return;
    }
    if (event.target.closest('.row-email')) {
      if (!quote.email) return showToast('Add the customer email before sending a follow-up.');
      if (!quote.publicToken) {
        try { await makeQuoteShareable(quote); }
        catch (error) { return showToast(`Could not create quote link: ${error.message}`); }
      }
      const quoteLink = `${window.location.origin}/q/${quote.publicToken}`;
      const subject = `Following up on your ${quote.service} quote`;
      const items = quoteItemLabels(quote).map(label => `- ${label}`).join('\n');
      const body = `Hi ${quote.customer},\n\nA quick reminder of the quote I sent.\n\n${items}\n\nQuote total: ${formatMoney(quote.amount, quote.currency)}\n\nReview your quote: ${quoteLink}\n\nDo you have any questions, or is there anything else I can help with?\n\nBest,\n${emailSignature()}`;
      if (isPro()) return openMessageComposer({ email: quote.email, phone: quote.phone, customer: quote.customer, subject, body, quote, successLabel: 'Follow-up sent' });
      await sendCustomerEmail(quote, subject, body, 'Follow-up sent');
      return;
    }
    const button = event.target.closest('.row-delete');
    if (!button || !window.confirm(`Delete the quote for ${quote.customer}? This cannot be undone.`)) return;
    quotes = quotes.filter(item => item.id !== quote.id);
    render();
    try {
      setSyncStatus('Saving');
      await deleteCloudQuote(quote);
      setSyncStatus('Cloud sync active');
      showToast('Quote removed.');
    } catch (error) {
      await refreshQuotes();
      setSyncStatus('Sync failed', true);
      showToast(`Quote was not deleted: ${error.message}`);
    }
  });

  function downloadExport(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvForRows(fields, records) {
    const escapeCSV = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    return `\uFEFF${[fields.join(','), ...records.map(record => fields.map(field => escapeCSV(record[field])).join(','))].join('\r\n')}`;
  }

  $('#export-button').addEventListener('click', () => {
    if (!requirePro('Quote export')) return;
    if (!quotes.length) return showToast('Add a quote before exporting your list.');
    const fields = ['customer', 'service', 'email', 'phone', 'referralSource', 'amount', 'currency', 'followUp', 'status', 'note', 'createdAt'];
    downloadExport(`elite-quote-flow-quotes-${dateOffset(0)}.csv`, csvForRows(fields, quotes), 'text/csv;charset=utf-8;');
    showToast('Quote list exported as CSV.');
  });

  $('#export-customers-button').addEventListener('click', () => {
    if (!requirePro('Customer export')) return;
    if (!quotes.length) return showToast('Add a quote before exporting your customers.');
    const fields = ['customer', 'email', 'phone', 'referralSource'];
    const uniqueCustomers = new Map();
    for (const quote of quotes) {
      const key = quote.email.trim().toLocaleLowerCase() || `${quote.customer.trim().toLocaleLowerCase()}|${quote.phone.trim()}`;
      const existing = uniqueCustomers.get(key);
      if (!existing || (!existing.email && quote.email) || (!existing.phone && quote.phone) || (!existing.referralSource && quote.referralSource)) {
        uniqueCustomers.set(key, {
          customer: quote.customer,
          email: quote.email || existing?.email || '',
          phone: quote.phone || existing?.phone || '',
          referralSource: quote.referralSource || existing?.referralSource || ''
        });
      }
    }
    downloadExport(`elite-quote-flow-customers-${dateOffset(0)}.csv`, csvForRows(fields, [...uniqueCustomers.values()]), 'text/csv;charset=utf-8;');
    showToast(`Exported ${uniqueCustomers.size} unique customers as CSV.`);
  });

  $('#export-calendar-button').addEventListener('click', () => {
    if (!requirePro('Calendar export')) return;
    const scheduled = quotes.filter(quote => quote.status === 'sent' && asDate(quote.followUp));
    if (!scheduled.length) return showToast('Add an open quote with a follow-up date before exporting your calendar.');
    const escapeICS = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const utcStamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const events = scheduled.map(quote => {
      const [year, month, day] = quote.followUp.split('-').map(Number);
      const nextDay = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10).replace(/-/g, '');
      const details = [`Quote follow-up: ${quote.customer}`, `Service: ${quote.service}`, `Amount: ${formatMoney(quote.amount, quote.currency)}`, quote.email && `Email: ${quote.email}`, quote.phone && `Phone: ${quote.phone}`, quote.note && `Note: ${quote.note}`].filter(Boolean).join('\n');
      const uid = `${encodeURIComponent(quote.id)}@elitequoteflow.com`;
      return ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utcStamp(new Date())}`, `DTSTART;VALUE=DATE:${quote.followUp.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${nextDay}`, `SUMMARY:${escapeICS(`Follow up: ${quote.customer} — ${quote.service}`)}`, `DESCRIPTION:${escapeICS(details)}`, `URL:${escapeICS(window.location.origin)}`, 'END:VEVENT'].join('\r\n');
    });
    const calendar = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Elite Quote Flow//Follow-up Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR'].join('\r\n');
    downloadExport(`elite-quote-flow-follow-ups-${dateOffset(0)}.ics`, calendar, 'text/calendar;charset=utf-8;');
    showToast(`Exported ${scheduled.length} follow-ups to calendar.`);
  });

  $('#export-accounting-button').addEventListener('click', () => {
    if (!requirePro('Accounting export')) return;
    const records = quotes.filter(quote => quote.status === 'won').map(quote => {
      const currency = quote.currency || 'USD';
      const taxRate = Math.max(0, Number(quote.taxRate) || 0);
      const discount = Math.max(0, Number(quote.discountAmount) || 0);
      const taxableSubtotal = Math.max(0, Number(quote.subtotalAmount ?? quote.amount) - discount);
      return {
        seller_business_name: profile.businessName || '',
        seller_tax_id: profile.taxId || '',
        seller_address: profile.companyAddress || '',
        customer: quote.customer,
        invoice_number: quote.invoiceNumber || '',
        invoice_date: quote.statusChangedAt?.slice(0, 10) || quote.createdAt?.slice(0, 10) || '',
        due_date: quote.invoiceDueDate || '',
        subtotal: Number(quote.subtotalAmount ?? quote.amount).toFixed(2),
        discount: discount.toFixed(2),
        tax_rate_percent: taxRate.toFixed(2),
        tax_amount: (taxableSubtotal * taxRate / 100).toFixed(2),
        amount: Number(quote.amount).toFixed(2),
        currency,
        status: quote.invoiceStatus === 'paid' ? 'Paid' : 'Unpaid',
        description: quote.service
      };
    });
    if (!records.length) return showToast('Accept a quote before exporting invoice records.');
    const fields = ['seller_business_name', 'seller_tax_id', 'seller_address', 'customer', 'invoice_number', 'invoice_date', 'due_date', 'subtotal', 'discount', 'tax_rate_percent', 'tax_amount', 'amount', 'currency', 'status', 'description'];
    downloadExport(`elite-quote-flow-accounting-${dateOffset(0)}.csv`, csvForRows(fields, records), 'text/csv;charset=utf-8;');
    showToast('Accounting CSV exported for QuickBooks/Xero import. Live accounting sync is not included; review the file before importing.');
  });

  $('#manage-templates-button').addEventListener('click', async () => {
    try {
      await fetchTemplates();
      if (typeof templateDialog.showModal === 'function') templateDialog.showModal();
      else templateDialog.setAttribute('open', '');
    } catch (error) { showToast(`Could not load templates: ${error.message}`); }
  });
  document.querySelectorAll('.template-close').forEach(button => button.addEventListener('click', () => templateDialog.close()));
  templateDialog.addEventListener('click', event => { if (event.target === templateDialog) templateDialog.close(); });
  templateForm.addEventListener('submit', async event => {
    event.preventDefault();
    const name = templateForm.elements.name.value.trim();
    const service = templateForm.elements.service.value.trim();
    const amount = Number(templateForm.elements.amount.value);
    if (!name || !service || !Number.isFinite(amount) || amount <= 0) return showToast('Enter a name, service, and positive amount.');
    const currency = CURRENCIES.includes(templateForm.elements.currency.value) ? templateForm.elements.currency.value : 'USD';
    const { error } = await supabaseClient.from('quote_templates').insert({ user_id: currentUser.id, name, service, amount, currency, quote_terms: templateForm.elements.terms.value.trim(), line_items: [], subtotal_amount: amount, tax_rate: 0, discount_amount: 0, deposit_percent: 0 });
    if (error) return showToast(`Template not saved: ${error.message}`);
    templateForm.reset();
    await fetchTemplates();
    showToast('Quote template saved.');
  });
  $('#template-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-template]');
    if (!button || !confirm('Delete this template?')) return;
    const { error } = await supabaseClient.from('quote_templates').delete().eq('id', button.dataset.deleteTemplate);
    if (error) return showToast(`Template not deleted: ${error.message}`);
    await fetchTemplates();
  });
  $('#quote-template-select').addEventListener('change', () => {
    const template = templates.find(item => item.id === $('#quote-template-select').value);
    if (!template) return;
    form.elements.service.value = template.service;
    form.elements.amount.value = template.amount.toFixed(2);
    form.elements.currency.value = template.currency || 'USD';
    $('#quote-currency-label').textContent = form.elements.currency.value;
    form.elements.amount.step = currencyStep(form.elements.currency.value);
    form.elements.terms.value = template.terms;
    form.elements.taxRate.value = template.taxRate || 0;
    form.elements.discountAmount.value = template.discountAmount || 0;
    form.elements.depositPercent.value = template.depositPercent || 0;
    renderLineItemFields(template.lineItems || []);
  });
  $('#invoice-rows').addEventListener('click', async event => {
    if (event.target.closest('[data-pro-upsell="invoice"]')) return requirePro('Invoice balance collection');
    const collect = event.target.closest('[data-collect-id]');
    if (collect) {
      if (!requirePro('Invoice balance collection')) return;
      const quote = quotes.find(item => item.id === collect.dataset.collectId);
      if (!quote) return;
      collect.disabled = true;
      try {
        const headers = await authHeaders();
        const response = await fetch('/api/invoice-checkout', { method: 'POST', headers, body: JSON.stringify({ quoteId: quote.id }) });
        const result = await response.json();
        if (!response.ok || !result.url) throw new Error(result.error || 'Could not open invoice checkout.');
        window.location.assign(result.url);
      } catch (error) {
        showToast(error.message, 6000);
        collect.disabled = false;
      }
      return;
    }
    const button = event.target.closest('[data-invoice-id]');
    const quote = button && quotes.find(item => item.id === button.dataset.invoiceId);
    if (quote) openInvoiceDialog(quote);
  });
  document.querySelectorAll('.invoice-close').forEach(button => button.addEventListener('click', () => invoiceDialog.close()));
  invoiceDialog.addEventListener('click', event => { if (event.target === invoiceDialog) invoiceDialog.close(); });
  invoiceForm.addEventListener('submit', async event => {
    event.preventDefault();
    const quote = quotes.find(item => item.id === invoiceQuoteId);
    if (!quote) return;
    const button = invoiceForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await saveInvoice(quote, { number: invoiceForm.elements.number.value, dueDate: invoiceForm.elements.dueDate.value, status: invoiceForm.elements.status.value });
      invoiceDialog.close();
      showToast('Invoice status saved. No payment was collected.');
    } catch (error) { showToast(`Invoice not saved: ${error.message}`); }
    finally { button.disabled = false; }
  });

  $('#export-contacts-button').addEventListener('click', () => {
    if (!requirePro('Contact export')) return;
    if (!quotes.length) return showToast('Add a quote before exporting your contacts.');
    const escapeVCard = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const contacts = new Map();
    for (const quote of quotes) {
      if (!quote.email && !quote.phone) continue;
      const key = quote.email.trim().toLocaleLowerCase() || quote.phone.replace(/[^\\d+]/g, '');
      const existing = contacts.get(key) || { name: quote.customer, email: '', phone: '', note: '' };
      existing.email ||= quote.email;
      existing.phone ||= quote.phone;
      if (quote.referralSource && !existing.note) existing.note = `Referred by ${quote.referralSource}`;
      contacts.set(key, existing);
    }
    if (!contacts.size) return showToast('Add an email or phone number to at least one customer first.');
    const cards = [...contacts.values()].map(contact => [
      'BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVCard(contact.name)}`,
      `N:${escapeVCard(contact.name)};;;;`, contact.email && `EMAIL;TYPE=INTERNET:${escapeVCard(contact.email)}`,
      contact.phone && `TEL;TYPE=CELL:${escapeVCard(contact.phone)}`, contact.note && `NOTE:${escapeVCard(contact.note)}`,
      'END:VCARD'
    ].filter(Boolean).join('\r\n'));
    downloadExport(`elite-quote-flow-contacts-${dateOffset(0)}.vcf`, `${cards.join('\r\n')}\r\n`, 'text/vcard;charset=utf-8;');
    showToast(`Exported ${contacts.size} contacts as VCF.`);
  });

  registerForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!supabaseClient) {
      $('#register-error').textContent = 'Supabase did not load. Check your connection and reload the page.';
      $('#register-error').hidden = false;
      return;
    }
    const password = $('#register-password').value;
    if (password !== $('#register-password-confirm').value) {
      $('#register-error').textContent = 'Passwords do not match.';
      $('#register-error').hidden = false;
      return;
    }
    $('#register-error').classList.remove('is-success');
    const button = $('#register-submit');
    button.disabled = true;
    button.textContent = 'Creating account…';
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email: $('#register-email').value.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            full_name: $('#signup-name').value.trim(),
            business_name: $('#signup-business').value.trim()
          }
        }
      });
      if (error) throw error;
      if (!data.session) {
        $('#register-error').textContent = 'Account created. Check your email to confirm it, then sign in.';
        $('#register-error').classList.add('is-success');
        $('#register-error').hidden = false;
        return;
      }
      $('#register-error').classList.remove('is-success');
      $('#register-error').hidden = true;
      showToast('Account created. Welcome to Elite Quote Flow.');
    } catch (error) {
      $('#register-error').textContent = error.message || 'Could not create your account.';
      $('#register-error').hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Create account';
    }
  });

  $('#google-signin').addEventListener('click', async () => {
    if (!supabaseClient) {
      const registerVisible = !registerForm.hidden;
      const errorElement = registerVisible ? $('#register-error') : authError;
      errorElement.textContent = 'Supabase did not load. Check your connection and reload the page.';
      errorElement.hidden = false;
      return;
    }
    const registerVisible = !registerForm.hidden;
    const errorElement = registerVisible ? $('#register-error') : authError;
    errorElement.textContent = '';
    errorElement.hidden = true;
    const button = $('#google-signin');
    button.disabled = true;
    button.textContent = 'Connecting to Google…';
    try {
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/` }
      });
      if (error) throw error;
    } catch (error) {
      errorElement.textContent = error.message || 'Google sign-in failed. Please try again.';
      errorElement.hidden = false;
      button.disabled = false;
      button.innerHTML = '<span class="google-g" aria-hidden="true">G</span>Continue with Google';
    }
  });

  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!supabaseClient) return showAuthError('Supabase did not load. Check your connection and reload the page.');
    showAuthError('');
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const mode = authForm.dataset.mode;
    const submitButton = $('#auth-submit');
    submitButton.disabled = true;
    submitButton.textContent = mode === 'recovery' ? 'Updating password…' : 'Signing in…';
    try {
      if (mode === 'recovery') {
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) throw error;
        await supabaseClient.auth.signOut();
        showSignedOut('signin');
        showAuthError('Password updated. Sign in with your new password.');
      } else {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      showAuthError(error.message || 'Authentication failed. Please try again.');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = authForm.dataset.mode === 'recovery' ? 'Update password' : 'Sign in';
    }
  });

  $('#landing-signin').addEventListener('click', () => showSignedOut('signin'));
  $('#landing-demo').addEventListener('click', () => showSignedOut('signin'));
  $('#landing-start').addEventListener('click', showRegistration);
  $('#landing-create').addEventListener('click', showRegistration);
  ['landing-calc-cta','landing-steps-cta','landing-pricing-cta'].forEach(id => document.getElementById(id)?.addEventListener('click', showRegistration));
  $('#landing-pro-cta').addEventListener('click', showRegistration);
  const updateLeadEstimate = () => {
    const quotes = Math.max(0, Math.min(10000, Number($('#lead-calc-quotes').value) || 0));
    const amount = Math.max(0, Math.min(100000000, Number($('#lead-calc-amount').value) || 0));
    const rate = Math.max(0, Math.min(100, Number($('#lead-calc-rate').value) || 0));
    const lift = Math.max(0, Math.min(50, Number($('#lead-calc-lift').value) || 0));
    const extraWon = quotes * lift / 100;
    const opportunity = Math.round(extraWon * amount * 100) / 100;
    const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: Intl.DateTimeFormat().resolvedOptions().locale?.endsWith('-NG') ? 'NGN' : 'USD', maximumFractionDigits: 0 }).format(opportunity);
    $('#lead-calc-result').textContent = money;
    $('#lead-calc-copy').textContent = `${extraWon.toFixed(1)} additional accepted quotes per month in this scenario (${rate}% current acceptance + ${lift} percentage points).`;
  };
  ['lead-calc-quotes','lead-calc-amount','lead-calc-rate','lead-calc-lift'].forEach(id => document.getElementById(id)?.addEventListener('input', updateLeadEstimate));
  updateLeadEstimate();
  $('#auth-home').addEventListener('click', event => { event.preventDefault(); showLanding(); });
  $('#draft-quote-scope').addEventListener('click', async event => {
    if (!requirePro('AI scope drafting')) return;
    const button = event.currentTarget;
    const data = new FormData(form);
    const notes = [
      `Customer/job: ${String(data.get('customer') || '').trim()}`,
      `Service: ${String(data.get('service') || '').trim()}`,
      `Line item: ${String(data.get('lineDescription') || '').trim()}`,
      `Existing scope and terms: ${String(data.get('terms') || '').trim()}`
    ].filter(line => !line.endsWith(': ')).join('\n');
    if (!String(data.get('service') || '').trim() && !String(data.get('lineDescription') || '').trim()) return showToast('Add a service or line item before asking AI to draft a scope.');
    const draftLabel = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Drafting…';
    try {
      const response = await fetch('/api/support-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'draft', messages: [{ role: 'user', content: `Draft a scope of work based only on these notes. Do not invent missing facts. Keep it under 1200 characters.\n${notes}` }] }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not draft the scope.');
      if (result.mode !== 'ai') throw new Error(result.reply || 'AI drafting is temporarily unavailable.');
      $('#ai-scope-preview-text').textContent = result.reply.slice(0, 2000);
      $('#ai-scope-preview').hidden = false;
      $('#ai-scope-preview').scrollIntoView({ block: 'nearest' });
      showToast('Review the AI draft. It stays out of the quote until you use it.');
    } catch (error) { showToast(error.message, 6000); }
    finally { button.disabled = false; button.innerHTML = draftLabel; }
  });
  $('#ai-scope-use').addEventListener('click', () => {
    const draft = $('#ai-scope-preview-text').textContent.trim();
    if (!draft) return clearUnusedAiDraft();
    const terms = $('#quote-terms');
    terms.value = draft;
    terms.dispatchEvent(new Event('input', { bubbles: true }));
    clearUnusedAiDraft();
    showToast('AI draft added to the scope. Edit it before you save.');
  });
  $('#ai-scope-discard').addEventListener('click', () => {
    clearUnusedAiDraft();
    showToast('AI draft discarded. It will not be included when you send the quote.');
  });
  $('#register-signin').addEventListener('click', () => showSignedOut('signin'));
  $('#auth-mode-toggle').addEventListener('click', showRegistration);
  $('#header-profile-button').addEventListener('click', openProfileDialog);
  $('#message-form')?.querySelectorAll('[name="channel"]').forEach(input => input.addEventListener('change', syncMessageChannel));
  $('#message-close')?.addEventListener('click', () => $('#message-composer')?.close());
  $('#message-cancel')?.addEventListener('click', () => $('#message-composer')?.close());
  $('#message-composer')?.addEventListener('click', event => { if (event.target === $('#message-composer')) $('#message-composer').close(); });
  $('#message-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!requirePro('Customer messages')) return;
    const messageForm = event.currentTarget;
    const channel = messageForm.elements.channel.value;
    const body = messageForm.elements.body.value.trim();
    const error = $('#message-error');
    error.textContent = '';
    if (body.length < 2) { error.textContent = 'Write the message first.'; return; }
    if (channel === 'text') {
      const phone = messageForm.elements.phone.value.replace(/[^\d+]/g, '');
      if (phone.length < 7) { error.textContent = 'Enter the customer phone number.'; return; }
      window.location.href = `sms:${phone}?&body=${encodeURIComponent(body)}`;
      $('#message-composer').close();
      showToast('Text opened on this phone with your message.');
      return;
    }
    const email = messageForm.elements.email.value.trim();
    const subject = messageForm.elements.subject.value.trim();
    if (!messageForm.elements.email.checkValidity() || !email) { error.textContent = 'Enter the customer email.'; return; }
    if (!subject) { error.textContent = 'Enter a subject.'; return; }
    const button = $('#message-send');
    button.disabled = true;
    try {
      if (messageDraft?.quote) {
        const sent = await sendCustomerEmail(messageDraft.quote, subject, body, messageDraft.successLabel || 'Message sent');
        if (sent) $('#message-composer').close();
        return;
      }
      const headers = await authHeaders();
      const response = await fetch('/api/send-customer-message', { method: 'POST', headers, body: JSON.stringify({ to: email, subject, body }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not send the message.');
      showToast(result.from ? `Message sent as ${result.from}.` : 'Message sent.');
      $('#message-composer').close();
    } catch (sendError) {
      error.textContent = sendError.message || 'Could not send the message.';
    } finally {
      button.disabled = false;
    }
  });
  $('#branded-email-close')?.addEventListener('click', () => $('#branded-email-dialog')?.close());
  $('#branded-email-dialog')?.addEventListener('click', event => { if (event.target === $('#branded-email-dialog')) $('#branded-email-dialog').close(); });
  $('#branded-email-profile')?.addEventListener('click', () => { $('#branded-email-dialog')?.close(); openProfileDialog(); });
  $('#company-logo-file')?.addEventListener('change', () => {
    const file = $('#company-logo-file').files?.[0];
    const field = $('#company-logo-field');
    const fieldError = field?.querySelector('.field-error');
    if (fieldError) fieldError.textContent = '';
    if (!file) return;
    logoUpload = readLogoFile(file).then(url => {
      showCompanyLogo(url);
      $('#company-logo-file').value = '';
    }).catch(error => {
      if (fieldError) fieldError.textContent = error.message || 'Could not use that logo.';
      $('#company-logo-file').value = '';
    });
  });
  $('#company-logo-remove')?.addEventListener('click', () => {
    showCompanyLogo('');
    const file = $('#company-logo-file');
    if (file) file.value = '';
  });
  document.querySelectorAll('.profile-close').forEach(button => button.addEventListener('click', () => profileDialog.close()));
  profileDialog.addEventListener('click', event => { if (event.target === profileDialog) profileDialog.close(); });
  $('#save-profile-button').addEventListener('click', async () => {
    if (!supabaseClient || !currentUser) {
      const saveError = $('#profile-save-error');
      saveError.textContent = 'Your session is not connected. Sign out, sign back in, then try again.';
      saveError.hidden = false;
      return;
    }
    const fullName = profileForm.elements.fullName.value.trim();
    const email = profileForm.elements.email.value.trim();
    const errors = {
      fullName: fullName ? '' : 'Enter your name.',
      email: profileForm.elements.email.validity.valid ? '' : 'Enter a valid email address.'
    };
    Object.entries(errors).forEach(([name, message]) => {
      const input = profileForm.elements[name];
      input.closest('.form-field').classList.toggle('has-error', Boolean(message));
      const fieldError = input.closest('.form-field').querySelector('.field-error');
      if (fieldError) fieldError.textContent = message;
    });
    if (Object.values(errors).some(Boolean)) {
      $('#profile-save-error').textContent = Object.values(errors).find(Boolean);
      $('#profile-save-error').hidden = false;
      return;
    }
    const button = $('#save-profile-button');
    const saveError = $('#profile-save-error');
    saveError.textContent = '';
    saveError.hidden = true;
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await logoUpload;
      const resultMessage = await saveProfile({ fullName, businessName: profileForm.elements.businessName.value.trim(), phone: profileForm.elements.phone.value.trim(), companyLogoUrl: profileForm.elements.companyLogoUrl.value.trim(), brandColor: profileForm.elements.brandColor.value, companyAddress: profileForm.elements.companyAddress.value.trim(), taxId: profileForm.elements.taxId.value.trim(), email });
      saveError.textContent = resultMessage;
      saveError.hidden = false;
      saveError.classList.add('is-success');
      button.textContent = 'Saved';
      window.setTimeout(() => profileDialog.close(), 1400);
    } catch (error) {
      const details = error?.message || error?.error_description || error?.hint || String(error);
      saveError.classList.remove('is-success');
      saveError.textContent = `Profile could not be saved: ${details}`;
      saveError.hidden = false;
      console.error('Elite Quote Flow profile save failed', error);
    } finally {
      button.disabled = false;
      if (saveError.classList.contains('is-success')) button.textContent = 'Saved';
      else button.textContent = 'Save profile';
    }
  });
  profileForm.elements.fullName.addEventListener('input', () => {
    const field = profileForm.elements.fullName.closest('.form-field');
    field.classList.remove('has-error');
    field.querySelector('.field-error').textContent = '';
    const feedback = $('#profile-save-error');
    feedback.textContent = '';
    feedback.hidden = true;
  });
  $('#auth-reset').addEventListener('click', async () => {
    if (!supabaseClient) return showAuthError('Supabase did not load. Check your connection and reload the page.');
    const email = $('#auth-email').value.trim();
    if (!email) return showAuthError('Enter your email address first, then request a password reset.');
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/` });
      if (error) throw error;
      showAuthError('If an account exists for that address, a password-reset email is on the way.');
    } catch (error) {
      showAuthError(error.message || 'Could not request a password reset.');
    }
  });

  $('#sign-out-button').addEventListener('click', async () => {
    if (!supabaseClient) return showToast('Supabase is not connected.');
    setSyncStatus('Signing out');
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      setSyncStatus('Sign out failed', true);
      showToast(error.message);
    }
  });

  $('#import-local-button').addEventListener('click', async () => {
    const localQuotes = loadLocalQuotes();
    if (!localQuotes.length || !currentUser) return;
    if (!window.confirm(`Import ${localQuotes.length} quotes from this browser into your account? This will not delete your cloud quotes.`)) return;
    $('#import-local-button').disabled = true;
    let imported = 0;
    try {
      const payload = localQuotes.map(quote => ({
        user_id: currentUser.id,
        customer: quote.customer,
        service: quote.service,
        email: quote.email || '',
        phone: quote.phone || '',
        referral_source: quote.referralSource || '',
        amount: Number(quote.amount),
        currency: quote.currency || 'USD',
        follow_up: quote.followUp,
        status: quote.status,
        note: quote.note || '',
        created_at: quote.createdAt || new Date().toISOString(),
        status_changed_at: quote.statusChangedAt || null
      }));
      const { error } = await supabaseClient.from('quotes').insert(payload);
      if (error) throw error;
      imported = payload.length;
      await refreshQuotes();
      localStorage.removeItem(STORAGE_KEY);
      offerLocalImport();
      showToast(`Imported ${imported} quotes to your account.`);
    } catch (error) {
      showToast(`Imported ${imported} quotes before an error: ${error.message}`);
    } finally {
      $('#import-local-button').disabled = false;
    }
  });

  window.addEventListener('online', refreshQuotes);
  reminderTimer = window.setInterval(checkReminders, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });
  $('#refresh-analytics-button').addEventListener('click', loadOwnerAnalytics);
  $('#owner-analytics-nav').addEventListener('click', event => {
    event.preventDefault();
    document.body.classList.remove('nav-open');
    $('#mobile-menu').setAttribute('aria-expanded', 'false');
    $('#mobile-menu').setAttribute('aria-label', 'Open navigation');
    $('#owner-analytics').scrollIntoView({ behavior: 'smooth', block: 'start' });
    loadOwnerAnalytics();
  });
  const mobileMenuButton = $('#mobile-menu');
  const setMobileNavigation = open => {
    document.body.classList.toggle('nav-open', open);
    mobileMenuButton.setAttribute('aria-expanded', String(open));
    mobileMenuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };
  mobileMenuButton.addEventListener('click', () => setMobileNavigation(!document.body.classList.contains('nav-open')));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setMobileNavigation(false); });
  document.addEventListener('click', event => {
    if (!document.body.classList.contains('nav-open')) return;
    if (event.target.closest('#main-sidebar, #mobile-menu')) return;
    setMobileNavigation(false);
  });
  const supportDialog = $('#support-dialog');
  const supportMessages = $('#support-messages');
  const supportHistory = [];
  const appendSupportMessage = (role, text) => {
    const message = document.createElement('p');
    message.className = `support-message support-${role}`;
    message.textContent = text;
    supportMessages.appendChild(message);
    supportMessages.scrollTop = supportMessages.scrollHeight;
  };
  $('#quote-rows').addEventListener('click', event => {
    const button = event.target.closest('[data-customer-history]'); if (!button) return;
    $('#history-customer').value = button.dataset.customerHistory; renderCustomerHistory();
    const details = $('#history-detail'); details.replaceChildren();
    selectedCustomerQuotes().forEach(quote => { const row = document.createElement('p'); row.className = 'growth-entry'; row.textContent = `${shortDate(quote.createdAt)} · ${quote.service} · ${formatMoney(quote.amount, quote.currency)} · ${quote.status}`; details.append(row); });
    customerNotes.filter(note => selectedCustomerQuotes()[0]?.email ? note.customer_email?.toLowerCase() === selectedCustomerQuotes()[0].email.toLowerCase() : note.customer_name?.toLowerCase() === selectedCustomerQuotes()[0]?.customer.toLowerCase()).forEach(note => { const row = document.createElement('p'); row.className = 'growth-entry'; row.textContent = `Private note · ${shortDate(note.created_at)} · ${note.note}`; details.append(row); });
    $('#history-dialog').showModal();
  });
  $('#history-customer').addEventListener('change', renderCustomerHistory);
  const saveCustomerNote = async input => {
    const selected = selectedCustomerQuotes(); const text = input.value.trim();
    if (!selected.length || !text) return;
    const customer = selected[0];
    const { data, error } = await supabaseClient.from('customer_notes').insert({ customer_email: customer.email || '', customer_name: customer.customer, note: text }).select().single();
    if (error) return showToast(`Could not save customer note: ${error.message}`);
    customerNotes.unshift(data); input.value = ''; renderCustomerHistory();
  };
  $('#customer-note-form').addEventListener('submit', event => { event.preventDefault(); saveCustomerNote($('#customer-note-input')); });
  $('#history-note-form').addEventListener('submit', event => { event.preventDefault(); saveCustomerNote($('#history-note-input')); });
  $('#history-close').addEventListener('click', () => $('#history-dialog').close());
  $('#recurring-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!requirePro('Recurring services')) return; const form = event.currentTarget; const data = new FormData(form);
    const customer = String(data.get('customer') || '').trim(); const service = String(data.get('service') || '').trim(); const amount = Number(data.get('amount')); const date = String(data.get('next_service_date') || '');
    if (!customer || !service || !Number.isFinite(amount) || amount < 0 || !asDate(date)) return showToast('Enter a customer, service, valid amount, and next service date.');
    const { data: plan, error } = await supabaseClient.from('recurring_service_plans').insert({ customer, email: String(data.get('email') || ''), service, amount, currency: 'USD', frequency: String(data.get('frequency')), next_service_date: date }).select().single();
    if (error) return showToast(`Could not add recurring service: ${error.message}`);
    recurringServices.push(plan); form.reset(); renderRecurringServices();
  });
  $('#refresh-bookings').addEventListener('click', loadGrowthFeatures);
  $('#support-launch').addEventListener('click', () => supportDialog.showModal());
  $('#landing-support-launch').addEventListener('click', () => supportDialog.showModal());
  $('#support-close').addEventListener('click', () => supportDialog.close());
  supportDialog.addEventListener('click', event => { if (event.target === supportDialog) supportDialog.close(); });
  async function loadPublishedCustomerReviews() {
    const target = $('#published-customer-reviews');
    try {
      const response = await fetch('/api/customer-reviews');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Reviews are temporarily unavailable.');
      target.replaceChildren();
      if (!result.reviews?.length) { const empty = document.createElement('p'); empty.className = 'review-loading'; empty.textContent = 'Be the first to share your experience.'; target.append(empty); return; }
      result.reviews.forEach(review => {
        const card = document.createElement('article'); card.className = 'landing-review-card';
        const stars = document.createElement('span'); stars.className = 'landing-benefit-icon review-stars'; stars.setAttribute('aria-label', `${review.rating} out of 5 stars`); stars.textContent = '★'.repeat(review.rating);
        const quote = document.createElement('blockquote'); quote.textContent = `“${review.review_text}”`;
        const author = document.createElement('p'); author.className = 'review-author'; author.textContent = `${review.customer_name} · ${review.business_name}`;
        card.append(stars, quote, author); target.append(card);
      });
    } catch { target.textContent = 'Customer reviews are temporarily unavailable.'; }
  }
  loadPublishedCustomerReviews();
  $('#customer-review-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $('#customer-review-status');
    const button = $('#customer-review-submit');
    status.textContent = '';
    button.disabled = true;
    button.textContent = 'Submitting…';
    try {
      const fields = Object.fromEntries(new FormData(form));
      const response = await fetch('/api/customer-reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Review could not be submitted.');
      status.textContent = result.message || 'Thank you for sharing your experience.';
      form.reset();
      await loadPublishedCustomerReviews();
    } catch (error) { status.textContent = error.message || 'Could not submit your review. Please try again later.'; }
    finally { button.disabled = false; button.textContent = 'Submit review'; }
  });
  $('#support-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('#support-input');
    const text = input.value.trim();
    if (!text) return;
    supportHistory.push({ role: 'user', content: text });
    appendSupportMessage('user', text);
    input.value = '';
    const send = $('#support-send');
    send.disabled = true;
    send.textContent = 'Thinking…';
    try {
      const response = await fetch('/api/support-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: supportHistory }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Support is temporarily unavailable.');
      supportHistory.push({ role: 'assistant', content: result.reply });
      appendSupportMessage('assistant', result.reply);
    } catch (error) {
      appendSupportMessage('assistant', `${error.message} Please contact the business that sent your quote for account-specific help.`);
    } finally {
      send.disabled = false;
      send.textContent = 'Send';
      input.focus();
    }
  });
  document.querySelectorAll('.side-nav [data-feature-target], .side-nav #import-estimate-button, .side-nav #invite-button').forEach(link => link.addEventListener('click', () => { document.body.classList.remove('nav-open'); $('#mobile-menu').setAttribute('aria-expanded', 'false'); $('#mobile-menu').setAttribute('aria-label', 'Open navigation'); }));
  const referralParam = new URLSearchParams(window.location.search).get('ref');
  if (referralParam && /^EQF[A-Z0-9]{4,16}$/i.test(referralParam)) {
    try { localStorage.setItem('quoteflow.referralCode', referralParam.toUpperCase()); } catch { /* ignore */ }
  }
  const applyStoredReferral = async () => {
    if (!currentUser || !supabaseClient) return;
    let code = '';
    try { code = localStorage.getItem('quoteflow.referralCode') || ''; } catch { code = ''; }
    if (!code) return;
    try {
      const headers = await authHeaders();
      const response = await fetch('/api/referrals', { method: 'POST', headers, body: JSON.stringify({ code }) });
      if (response.ok || response.status === 409) {
        try { localStorage.removeItem('quoteflow.referralCode'); } catch { /* ignore */ }
        await loadGrowthExtras();
      }
    } catch { /* ignore until tables exist */ }
  };
  function applyLandingEntryIntent() {
    if (currentUser) return;
    const params = new URLSearchParams(window.location.search);
    const start = params.get('start') || params.get('signup');
    const signin = params.get('signin');
    let changed = false;
    if (start === '1' || start === 'true') {
      showRegistration();
      params.delete('start');
      params.delete('signup');
      changed = true;
    } else if (signin === '1' || signin === 'true') {
      showSignedOut('signin');
      params.delete('signin');
      changed = true;
    }
    if (!changed) return;
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', nextUrl);
  }
  showLanding();
  void startApplication().then(() => applyLandingEntryIntent());
  const watchAuthForReferral = setInterval(() => {
    if (currentUser) {
      applyStoredReferral();
      clearInterval(watchAuthForReferral);
    }
  }, 1500);
  window.setTimeout(() => clearInterval(watchAuthForReferral), 30000);
})();
