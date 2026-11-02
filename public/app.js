const $ = (id) => document.getElementById(id);
const make = (tag, value, className) => {
  const element = document.createElement(tag);
  if (value != null) element.textContent = value;
  if (className) element.className = className;
  return element;
};
let state = null,
  token = null,
  busy = false,
  sourceSignature = '',
  currentPanel = 'reading';
const date = (value) => (value ? new Date(value).toLocaleString('ja-JP') : '不明');
const topicNames = {
  codex: 'Codex',
  claude: 'Claude Code',
  skills: 'Skills・指示ファイル',
  practice: '活用事例',
};
function topicsFor(article) {
  const words = `${article.title} ${article.summary}`;
  const ids = article.sourceIds || [];
  const topics = [];
  if (/\bcodex\b/i.test(words) || ids.includes('zenn-codex')) topics.push('codex');
  if (/claude\s*code|claudecode/i.test(words) || ids.includes('zenn-claudecode'))
    topics.push('claude');
  if (
    /\bskills?\b|SKILL\.md|AGENTS\.md|CLAUDE\.md|スキル/i.test(words) ||
    ids.includes('zenn-agentskills') ||
    ids.includes('zenn-skills')
  )
    topics.push('skills');
  if (
    /実践|活用|事例|使ってみ|試してみ|導入し|作ってみ|ワークフロー|workflow|use case/i.test(words)
  )
    topics.push('practice');
  return topics;
}
const notice = (message, className = '') => {
  $('notice').textContent = message;
  $('notice').className = className;
};
async function load() {
  const response = await fetch('/api/state', { cache: 'no-store' });
  if (!response.ok) throw new Error('記事を読み込めません');
  const next = await response.json();
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  render();
}
async function post(path, body = {}) {
  if (!token) {
    const response = await fetch('/api/session');
    token = (await response.json()).token;
  }
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Reader-Token': token },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作に失敗しました');
  return data;
}
async function change(path, body, success) {
  try {
    state = await post(path, body);
    render();
    notice(success);
  } catch (error) {
    notice(error.message, 'error');
  }
}
function render() {
  if (!state) return;
  const focused = document.activeElement;
  const focusId = focused?.id;
  $('reading-panel').hidden = currentPanel !== 'reading';
  $('discovery-panel').hidden = currentPanel !== 'discovery';
  $('show-reading').setAttribute('aria-pressed', String(currentPanel === 'reading'));
  $('show-discovery').setAttribute('aria-pressed', String(currentPanel === 'discovery'));
  const selector = $('source');
  const newsSources = state.sources.filter((source) => source.kind !== 'catalog');
  const nextSignature = JSON.stringify(newsSources.map(({ id, name }) => [id, name]));
  if (nextSignature !== sourceSignature) {
    const previous = selector.value;
    selector.replaceChildren(new Option('すべての情報源', ''));
    for (const source of newsSources) selector.append(new Option(source.name, source.id));
    selector.value = previous;
    sourceSignature = nextSignature;
  }
  const failures = newsSources.filter((s) => s.error);
  const stale = newsSources.some(
    (s) => s.lastSuccessAt && Date.now() - Date.parse(s.lastSuccessAt) > 86400000,
  );
  notice(
    state.storageError
      ? state.storageError
      : currentPanel === 'discovery'
        ? state.refreshing
          ? '情報源を更新中です。取得済みの候補と更新を表示しています。'
          : 'Skills・プラグインの候補と更新を表示しています。'
        : state.refreshing
          ? '情報源を更新中です。前回の記事を表示しています。'
          : failures.length
            ? `${failures.length}件の情報源を取得できません。${state.articles.length ? '前回取得した記事を表示中です。' : ''}${stale ? '古い記事の可能性があります。' : ''}`
            : stale
              ? '古い記事の可能性があります。記事を更新してください。'
              : state.articles.length
                ? '記事を表示しています。'
                : newsSources.some((s) => s.lastSuccessAt)
                  ? '正常に取得しましたが記事はありません。'
                  : '初回取得前です。',
    state.storageError || failures.length ? 'error' : stale ? 'warning' : '',
  );
  const list = $('articles');
  list.replaceChildren();
  const query = $('search').value.trim().toLocaleLowerCase(),
    filter = selector.value,
    topic = $('topic').value,
    view = $('view').value;
  const articles = state.articles.filter(
    (a) =>
      (!filter || a.sourceIds.includes(filter)) &&
      (!topic || topicsFor(a).includes(topic)) &&
      (!query || `${a.title} ${a.summary}`.toLocaleLowerCase().includes(query)) &&
      (view === 'all' || (view === 'unread' ? !state.flags[a.id]?.read : state.flags[a.id]?.saved)),
  );
  if (!articles.length)
    list.append(
      make('p', state.articles.length ? '条件に合う記事はありません。' : '記事はまだありません。'),
    );
  for (const article of articles) {
    const card = make('article'),
      title = make('h3', article.title),
      summary = make('p', article.summary),
      meta = make(
        'p',
        `${article.sourceIds.map((id) => state.sources.find((s) => s.id === id)?.name || id).join('・')}${article.author ? ` · 著者 ${article.author}` : ''} · 公開 ${date(article.publishedAt)} · 取得 ${date(article.lastFetchedAt)}`,
        'meta',
      );
    const actions = make('div', null, 'actions'),
      link = make('a', '原文を開く');
    const topics = topicsFor(article);
    link.href = article.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const read = make('button', state.flags[article.id]?.read ? '未読に戻す' : '既読にする');
    read.type = 'button';
    read.id = `read-${article.id}`;
    read.onclick = () =>
      change(
        '/api/flag',
        { id: article.id, key: 'read', value: !state.flags[article.id]?.read },
        '既読状態を保存しました',
      );
    const saved = make('button', state.flags[article.id]?.saved ? '保存を解除' : '保存');
    saved.type = 'button';
    saved.id = `saved-${article.id}`;
    saved.onclick = () =>
      change(
        '/api/flag',
        { id: article.id, key: 'saved', value: !state.flags[article.id]?.saved },
        '保存状態を更新しました',
      );
    actions.append(link, read, saved);
    card.append(title, summary, meta);
    if (topics.length)
      card.append(
        make('p', `話題（機械的分類）: ${topics.map((id) => topicNames[id]).join('・')}`, 'meta'),
      );
    card.append(actions);
    list.append(card);
  }
  const sourceList = $('sources');
  sourceList.replaceChildren();
  for (const source of newsSources) {
    const item = make('div', null, 'source-item');
    item.append(
      make('strong', source.name),
      make(
        'p',
        source.updating
          ? '更新中'
          : source.error
            ? `取得失敗: ${source.error}`
            : source.lastSuccessAt
              ? `取得成功: ${source.count ?? 0}件`
              : '未取得',
        source.error ? 'error' : '',
      ),
      make('p', `最終試行 ${date(source.lastAttemptAt)} / 最終成功 ${date(source.lastSuccessAt)}`),
    );
    sourceList.append(item);
  }
  const manual = $('manual');
  manual.replaceChildren();
  for (const item of state.manual) {
    const card = make('article'),
      link = make('a', item.title);
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const remove = make('button', '削除');
    remove.type = 'button';
    remove.id = `remove-${item.id}`;
    remove.onclick = () => change('/api/x/remove', { id: item.id }, '手動保存を削除しました');
    card.append(link, make('p', `手動保存・自動取得なし · ${date(item.savedAt)}`, 'meta'), remove);
    manual.append(card);
  }
  renderDiscovery();
  $('refresh').disabled = state.refreshing || busy;
  if (focusId && document.activeElement !== focused)
    ($(focusId) || (currentPanel === 'discovery' ? $('discovery-view') : null))?.focus({
      preventScroll: true,
    });
}
function externalLink(label, url) {
  const link = make('a', label);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}
function renderDiscovery() {
  const list = $('discovery-items');
  list.replaceChildren();
  const catalog = state.sources.filter((source) => source.kind === 'catalog');
  const catalogFailures = catalog.filter((source) => source.error);
  const newsFailures = state.sources.filter((source) => source.kind !== 'catalog' && source.error);
  const newsSuccess = state.sources
    .filter((source) => source.kind !== 'catalog')
    .map((source) => source.lastSuccessAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const catalogStatus = catalog.length
    ? `カタログ更新: ${catalog.map((source) => `${source.name} ${source.error ? `取得失敗（前回成功 ${date(source.lastSuccessAt)}）` : source.lastSuccessAt ? `取得成功 ${date(source.lastSuccessAt)}` : '未取得'}`).join(' / ')}。`
    : '';
  $('discovery-status').textContent = state.refreshing
    ? '情報源を更新中です。表示中の項目には前回取得分が含まれます。'
    : `${catalogStatus}${newsFailures.length ? `記事フィード${newsFailures.length}件の取得に失敗しました。失敗した情報源の関連記事は前回取得分です。${newsFailures.map((source) => `${source.name} 最終成功 ${date(source.lastSuccessAt)}`).join(' / ')}。` : `関連記事の最終取得成功 ${date(newsSuccess)}。`}固定候補は自動更新されません。`;
  $('discovery-status').className =
    catalogFailures.length || newsFailures.length ? 'error' : 'note';
  const view = $('discovery-view').value || 'all';
  const showCandidates = view === 'all' || view === 'candidates' || view === 'saved';
  const showRelated = view === 'all' || view === 'related' || view === 'saved';
  const showUpdates = view === 'all' || view === 'updates' || view === 'saved';
  const candidates = (state.discovery || []).filter(
    (item) => showCandidates && (view !== 'saved' || state.discoverySaved?.[item.id]),
  );
  if (candidates.length) list.append(make('h3', '固定候補'));
  for (const item of candidates) {
    const card = make('article', null, 'discovery-card');
    const links = make('div', null, 'actions');
    links.append(externalLink('配布元・掲載元', item.url));
    if (item.mention) links.append(externalLink('関連するX投稿', item.mention));
    if (item.instructions) links.append(externalLink('導入手順を確認', item.instructions));
    if (item.updates) links.append(externalLink('カタログ更新履歴', item.updates));
    const saved = !!state.discoverySaved?.[item.id];
    const button = make('button', saved ? '保存を解除' : '後で検討する');
    button.type = 'button';
    button.id = `discovery-save-${item.id}`;
    button.setAttribute('aria-label', `${item.name}を${saved ? '保存解除' : '保存'}`);
    button.onclick = () =>
      change(
        '/api/discovery/save',
        { id: item.id, value: !saved },
        `${item.name}の保存状態を更新しました`,
      );
    links.append(button);
    card.append(
      make('h4', item.name),
      make('p', item.purpose),
      make(
        'p',
        `${item.kind} · 固定候補 · ${item.environment} · ${item.verification || '実動作: 未確認'}`,
        'meta',
      ),
    );
    if (item.updates)
      card.append(
        make('p', '更新履歴はカタログの変更です。個別Skillのリリースとは限りません。', 'note'),
      );
    if (item.mentionNote) card.append(make('p', item.mentionNote, 'note'));
    card.append(links);
    list.append(card);
  }
  const updates = (state.catalogUpdates || []).filter(
    (item) => showUpdates && (view !== 'saved' || state.flags[item.id]?.saved),
  );
  if (updates.length) list.append(make('h3', '取得したカタログ更新'));
  for (const item of updates) {
    const card = make('article', null, 'discovery-card');
    const source = state.sources.find((entry) => entry.id === item.sourceIds[0]);
    const saved = !!state.flags[item.id]?.saved;
    const actions = make('div', null, 'actions');
    const button = make('button', saved ? '保存を解除' : '後で検討する');
    button.type = 'button';
    button.id = `discovery-update-${item.id}`;
    button.setAttribute('aria-label', `${item.title}を${saved ? '保存解除' : '保存'}`);
    button.onclick = () =>
      change(
        '/api/flag',
        { id: item.id, key: 'saved', value: !saved },
        `${item.title}の保存状態を更新しました`,
      );
    actions.append(externalLink('変更内容', item.url));
    if (source?.catalogUrl) actions.append(externalLink('公式カタログ', source.catalogUrl));
    actions.append(button);
    card.append(
      make('h4', item.title),
      make(
        'p',
        `カタログ更新${source?.error ? '・前回取得分' : ''} · ${source?.name || item.sourceIds[0]} · 更新 ${date(item.publishedAt)} · 取得 ${date(item.lastFetchedAt)}`,
        'meta',
      ),
      make(
        'p',
        '掲載内容の変更です。新しいSkill・プラグインのリリースや対応環境の実動作は未確認です。配布元と導入手順は変更内容から確認してください。',
        'note',
      ),
      actions,
    );
    list.append(card);
  }
  const related = state.articles.filter(
    (article) =>
      showRelated &&
      /\bskills?\b|plugins?|SKILL\.md|スキル|プラグイン/i.test(
        `${article.title} ${article.summary}`,
      ) &&
      (view !== 'saved' || state.flags[article.id]?.saved),
  );
  if (related.length) list.append(make('h3', '取得した関連記事'));
  for (const article of related) {
    const card = make('article', null, 'discovery-card');
    const actions = make('div', null, 'actions');
    const saved = !!state.flags[article.id]?.saved;
    const button = make('button', saved ? '保存を解除' : '後で検討する');
    button.type = 'button';
    button.id = `discovery-article-${article.id}`;
    button.setAttribute('aria-label', `${article.title}を${saved ? '保存解除' : '保存'}`);
    button.onclick = () =>
      change(
        '/api/flag',
        { id: article.id, key: 'saved', value: !saved },
        `${article.title}の保存状態を更新しました`,
      );
    actions.append(externalLink('記事の原文', article.url), button);
    card.append(
      make('h4', article.title),
      make(
        'p',
        `取得した関連記事 · ${article.sourceIds.map((id) => state.sources.find((s) => s.id === id)?.name || id).join('・')} · 公開 ${date(article.publishedAt)} · 取得 ${date(article.lastFetchedAt)}`,
        'meta',
      ),
      make(
        'p',
        '見出しによる機械的な抽出です。配布元・導入手順・対応環境は原文から確認してください。',
        'note',
      ),
      actions,
    );
    list.append(card);
  }
  if (!candidates.length && !related.length && !updates.length)
    list.append(
      make(
        'p',
        view === 'saved'
          ? '保存済みの候補や関連記事、カタログ更新はありません。'
          : view === 'updates'
            ? catalogFailures.length
              ? 'カタログ更新を取得できません。情報源の状態をご確認ください。'
              : '取得したカタログ更新はありません。情報源を更新してください。'
            : view === 'related'
              ? '取得した関連記事はありません。記事の更新結果をご確認ください。'
              : '表示できる候補はありません。',
      ),
    );
}
$('show-reading').onclick = () => {
  currentPanel = 'reading';
  render();
};
$('show-discovery').onclick = () => {
  currentPanel = 'discovery';
  render();
};
$('discovery-view').addEventListener('change', render);
$('search').addEventListener('input', render);
$('source').addEventListener('change', render);
$('topic').addEventListener('change', render);
$('view').addEventListener('change', render);
$('refresh').onclick = async () => {
  if (busy) return;
  busy = true;
  try {
    state = await post('/api/refresh');
    render();
    const poll = setInterval(async () => {
      try {
        await load();
        if (!state.refreshing) clearInterval(poll);
      } catch {
        clearInterval(poll);
        notice('更新結果を確認できません', 'error');
      }
    }, 700);
  } catch (error) {
    notice(error.message, 'error');
  } finally {
    busy = false;
  }
};
$('x-form').onsubmit = async (event) => {
  event.preventDefault();
  await change(
    '/api/x',
    { url: $('x-url').value, title: $('x-title').value },
    'X投稿を保存しました',
  );
};
let theme = null;
try {
  theme = localStorage.getItem('reader-theme');
} catch {
  /* Private storage can be disabled. */
}
if (theme) document.documentElement.dataset.theme = theme;
$('theme').onclick = () => {
  const current =
    document.documentElement.dataset.theme ||
    (globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('reader-theme', next);
  } catch {
    /* Theme still applies for this visit. */
  }
};
load().catch((error) => notice(error.message, 'error'));

setInterval(() => {
  if (document.visibilityState === 'visible' && !busy)
    load().catch(() => notice('更新状態を確認できません', 'error'));
}, 5000);
