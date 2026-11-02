import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('取得失敗と古いキャッシュを知らせ、OSダーク設定からテーマを切り替える', async () => {
  class Element {
    constructor() {
      this.value = '';
      this.textContent = '';
      this.children = [];
    }
    replaceChildren(...children) {
      this.children = children;
    }
    append(...children) {
      this.children.push(...children);
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    addEventListener() {}
  }
  const elements = new Map();
  const document = {
    documentElement: { dataset: {} },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement() {
      return new Element();
    },
  };
  const state = {
    articles: [],
    flags: {},
    manual: [],
    sources: [
      {
        id: 'google-ai',
        name: 'Google AI',
        error: '通信失敗',
        lastSuccessAt: '2025-01-01T00:00:00Z',
      },
    ],
  };
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  runInNewContext(script, {
    document,
    Option: class extends Element {
      constructor(label, value) {
        super();
        this.textContent = label;
        this.value = value;
      }
    },
    fetch: async () => new Response(JSON.stringify(state)),
    Response,
    localStorage: { getItem: () => null },
    matchMedia: () => ({ matches: true }),
    setInterval: () => 0,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const notice = document.getElementById('notice');
  assert.match(notice.textContent, /取得できません/);
  assert.match(notice.textContent, /古い記事の可能性/);
  assert.equal(notice.className, 'error');
  document.getElementById('theme').onclick();
  assert.equal(document.documentElement.dataset.theme, 'light');
  document.getElementById('theme').onclick();
  assert.equal(document.documentElement.dataset.theme, 'dark');
});
test('旧記事もキーワードで話題分類し、検索・情報源・未読の絞り込みと併用できる', async () => {
  class Element {
    constructor() {
      this.value = '';
      this.children = [];
      this.textContent = '';
      this.listeners = {};
    }
    replaceChildren(...children) {
      this.children = children;
    }
    append(...children) {
      this.children.push(...children);
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }
  }
  const elements = new Map();
  const document = {
    documentElement: { dataset: {} },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement() {
      return new Element();
    },
  };
  const article = (id, title, summary, sourceIds) => ({
    id,
    title,
    summary,
    sourceIds,
    url: `https://zenn.dev/example/articles/${id}`,
    publishedAt: null,
    lastFetchedAt: null,
  });
  const data = {
    articles: [
      {
        ...article('one', 'CodexでSKILL.mdを作ってみた', '実践メモ', ['zenn-codex']),
        author: '執筆者',
      },
      article('two', 'Claude Codeの基本', '入門', ['zenn-claudecode']),
    ],
    flags: { one: { read: true, saved: true } },
    manual: [],
    discoverySaved: { sample: true },
    discovery: [
      {
        id: 'sample',
        name: '候補',
        kind: 'Skill',
        purpose: '用途',
        environment: '提供元表記: Pi',
        url: 'https://example.com/candidate',
        instructions: 'https://example.com/readme',
      },
    ],
    catalogUpdates: [
      {
        id: 'update',
        title: 'Update plugin listing',
        url: 'https://github.com/openai/plugins/commit/abc',
        sourceIds: ['openai-plugins-updates'],
        publishedAt: '2026-11-01T10:00:00Z',
        lastFetchedAt: '2026-11-01T11:00:00Z',
      },
    ],
    sources: [
      {
        id: 'zenn-codex',
        name: 'Zenn Codex',
        error: '通信失敗',
        lastSuccessAt: '2025-01-01T00:00:00Z',
      },
      { id: 'zenn-claudecode', name: 'Zenn Claude Code', lastSuccessAt: '2026-11-01T00:00:00Z' },
      {
        id: 'openai-plugins-updates',
        name: 'OpenAI Plugins 掲載例',
        kind: 'catalog',
        catalogUrl: 'https://github.com/openai/plugins',
        error: '通信失敗',
        lastSuccessAt: '2025-02-01T00:00:00Z',
      },
    ],
  };
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  document.getElementById('view').value = 'all';
  runInNewContext(script, {
    document,
    Option: class extends Element {
      constructor(label, value) {
        super();
        this.textContent = label;
        this.value = value;
      }
    },
    fetch: async () => new Response(JSON.stringify(data)),
    Response,
    localStorage: { getItem: () => null },
    setInterval: () => 0,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const get = (id) => document.getElementById(id);
  assert.equal(get('articles').children.length, 2);
  assert.match(get('articles').children[0].children[2].textContent, /Zenn Codex.*著者 執筆者/);
  assert.match(
    get('articles').children[0].children[3].textContent,
    /機械的分類.*Codex.*Skills.*活用事例/,
  );
  get('topic').value = 'skills';
  get('topic').listeners.change();
  assert.equal(get('articles').children.length, 1);
  get('search').value = 'Claude';
  get('search').listeners.input();
  assert.match(get('articles').children[0].textContent, /条件に合う記事はありません/);
  get('search').value = '';
  get('search').listeners.input();
  get('view').value = 'unread';
  get('view').listeners.change();
  assert.match(get('articles').children[0].textContent, /条件に合う記事はありません/);
  get('view').value = 'saved';
  get('view').listeners.change();
  assert.equal(get('articles').children.length, 1);
  get('source').value = 'zenn-claudecode';
  get('source').listeners.change();
  assert.match(get('articles').children[0].textContent, /条件に合う記事はありません/);
  get('show-discovery').onclick();
  assert.equal(get('discovery-panel').hidden, false);
  assert.equal(get('reading-panel').hidden, true);
  assert.equal(get('show-discovery')['aria-pressed'], 'true');
  const discoveryText = (item) =>
    [item.textContent, ...(item.children || []).map(discoveryText)].join(' ');
  assert.match(
    discoveryText(get('discovery-items')),
    /固定候補.*候補.*提供元表記: Pi.*実動作: 未確認/,
  );
  assert.match(get('discovery-status').textContent, /Zenn Codex 最終成功/);
  assert.doesNotMatch(get('discovery-status').textContent, /関連記事の最終取得成功/);
  assert.equal(get('discovery-status').className, 'error');
  get('discovery-view').value = 'updates';
  get('discovery-view').listeners.change();
  assert.match(
    discoveryText(get('discovery-items')),
    /取得したカタログ更新.*Update plugin listing.*カタログ更新・前回取得分/,
  );
  assert.match(discoveryText(get('discovery-items')), /新しいSkill・プラグインのリリース.*未確認/);
  const findChild = (node, id) =>
    node.id === id ? node : node.children?.map((child) => findChild(child, id)).find(Boolean);
  assert.equal(
    findChild(get('discovery-items'), 'discovery-update-update')['aria-label'],
    'Update plugin listingを保存',
  );
  get('discovery-view').value = 'saved';
  get('discovery-view').listeners.change();
  assert.match(discoveryText(get('discovery-items')), /候補/);
  assert.match(discoveryText(get('discovery-items')), /CodexでSKILL\.mdを作ってみた/);
});
test('公式ガイドは記事一覧と別の固定案内で日時や取得済みを表示しない', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const guide = html.match(/<section class="guides"[\s\S]*?<\/section>/)?.[0];
  assert.ok(guide);
  assert.match(guide, /公式の使い方ガイド/);
  assert.match(guide, /learn\.chatgpt\.com\/docs\/build-skills/);
  assert.match(guide, /code\.claude\.com\/docs\/en\/skills/);
  assert.doesNotMatch(guide, /公開日時|取得成功|確認済み|自動更新/);
});
