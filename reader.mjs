import { DOMParser } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { discovery } from './discovery.mjs';

export const sources = [
  { id: 'openai', name: 'OpenAI News', url: 'https://openai.com/news/rss.xml' },
  { id: 'zenn-ai', name: 'Zenn AI', url: 'https://zenn.dev/topics/ai/feed' },
  { id: 'zenn-llm', name: 'Zenn LLM', url: 'https://zenn.dev/topics/llm/feed' },
  { id: 'zenn-codex', name: 'Zenn Codex', url: 'https://zenn.dev/topics/codex/feed' },
  {
    id: 'zenn-claudecode',
    name: 'Zenn Claude Code',
    url: 'https://zenn.dev/topics/claudecode/feed',
  },
  {
    id: 'zenn-agentskills',
    name: 'Zenn Agent Skills',
    url: 'https://zenn.dev/topics/agentskills/feed',
  },
  { id: 'zenn-skills', name: 'Zenn Skills', url: 'https://zenn.dev/topics/skills/feed' },
  {
    id: 'google-ai',
    name: 'Google AI',
    url: 'https://blog.google/innovation-and-ai/technology/ai/rss/',
  },
];
// Official catalog commit feeds. Entries describe catalog edits, not Skill releases.
export const catalogSources = [
  {
    id: 'openai-plugins-updates',
    name: 'OpenAI Plugins 掲載例',
    url: 'https://github.com/openai/plugins/commits/main.atom',
    catalogUrl: 'https://github.com/openai/plugins',
  },
  {
    id: 'anthropic-plugins-updates',
    name: 'Claude Plugins Official',
    url: 'https://github.com/anthropics/claude-plugins-official/commits/main.atom',
    catalogUrl: 'https://github.com/anthropics/claude-plugins-official',
  },
];
const allSources = [...sources, ...catalogSources];
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 100;
const MAX_MANUAL = 500;
const TIMEOUT = 12000;
const empty = () => ({
  articles: [],
  catalogUpdates: [],
  flags: {},
  manual: [],
  sources: {},
  discoverySaved: {},
});
const text = (node) => node?.textContent?.trim() || '';
const children = (node, name) =>
  [...(node?.childNodes || [])].filter(
    (n) => n.nodeType === 1 && (n.localName || n.nodeName.split(':').at(-1)) === name,
  );
const child = (node, name) => children(node, name)[0];
const field = (node, name) => text(child(node, name));
const plain = (s, limit) =>
  String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
export function validUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
export function xUrl(value) {
  const url = validUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(parsed.hostname)
  )
    return null;
  if (!/^\/[A-Za-z0-9_]{1,15}\/status\/[0-9]+\/?$/.test(parsed.pathname)) return null;
  parsed.search = '';
  return parsed.href;
}
export function parseFeed(xml, sourceId, at = new Date().toISOString()) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('XML宣言が許可されていません');
  const document = new DOMParser({
    onError: () => {
      throw new Error('XMLが壊れています');
    },
  }).parseFromString(xml, 'text/xml');
  const root = document.documentElement;
  const kind = root?.localName || root?.nodeName;
  if (!['rss', 'RDF', 'feed'].includes(kind)) throw new Error('RSS/Atom形式ではありません');
  if (kind === 'rss' && !child(root, 'channel')) throw new Error('RSSのchannelがありません');
  const entries =
    kind === 'feed'
      ? children(root, 'entry')
      : kind === 'RDF'
        ? children(root, 'item')
        : children(child(root, 'channel'), 'item');
  const found = new Map();
  let invalid = 0;
  for (const entry of entries) {
    const atom = kind === 'feed';
    const links = children(entry, 'link');
    const link = atom
      ? links
          .find((n) => !n.getAttribute('rel') || n.getAttribute('rel') === 'alternate')
          ?.getAttribute('href')
      : field(entry, 'link');
    const url = validUrl(link);
    const title = plain(field(entry, 'title'), 300);
    if (!url || !title) {
      invalid++;
      continue;
    }
    const rawDate = atom
      ? field(entry, 'published') || field(entry, 'updated')
      : field(entry, 'pubDate') || field(entry, 'date');
    const publishedAt =
      rawDate && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null;
    const summary = plain(
      atom ? field(entry, 'summary') || field(entry, 'content') : field(entry, 'description'),
      300,
    );
    const author = plain(
      atom
        ? field(child(entry, 'author'), 'name')
        : field(entry, 'creator') || field(entry, 'author'),
      120,
    );
    found.set(url, {
      id: createHash('sha256').update(url).digest('hex'),
      url,
      title,
      summary,
      author,
      publishedAt,
      firstFetchedAt: at,
      lastFetchedAt: at,
      sourceIds: [sourceId],
    });
  }
  if (entries.length && !found.size) throw new Error('有効な記事がありません');
  const articles = [...found.values()]
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
    .slice(0, MAX_ITEMS);
  return { articles, invalid, total: entries.length };
}
export async function fetchFeed(url, fetcher = fetch) {
  const response = await fetcher(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: {
      'User-Agent': 'AgentOffice-AIReader/0.1',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
  });
  if (!response.ok || response.status >= 300) {
    await response.body?.cancel?.();
    throw new Error(`HTTP ${response.status}`);
  }
  if (!/\b(xml|rss|atom)\b/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel?.();
    throw new Error('XMLではない応答');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new Error('フィードが2MiBを超えました');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export class Reader {
  constructor({ dataDir, fetcher = fetch }) {
    this.file = join(dataDir, 'state.json');
    this.dataDir = dataDir;
    this.fetcher = fetcher;
    this.state = empty();
    this.refreshing = false;
    this.writing = Promise.resolve();
  }
  async load() {
    try {
      this.state = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`保存データを読めません: ${error.message}`);
    }
    if (
      !Array.isArray(this.state.articles) ||
      !Array.isArray(this.state.manual) ||
      !this.state.flags ||
      typeof this.state.flags !== 'object' ||
      !this.state.sources ||
      typeof this.state.sources !== 'object'
    )
      throw new Error('保存データの形式が不正です');
    if (this.state.discoverySaved == null) this.state.discoverySaved = {};
    if (this.state.catalogUpdates == null) this.state.catalogUpdates = [];
    if (!Array.isArray(this.state.catalogUpdates)) throw new Error('保存データの形式が不正です');
    if (typeof this.state.discoverySaved !== 'object' || Array.isArray(this.state.discoverySaved))
      throw new Error('保存データの形式が不正です');
  }
  async save(nextState) {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(nextState), { mode: 0o600 });
    await rename(temp, this.file);
  }
  updateState(change) {
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        const next = structuredClone(this.state);
        change(next);
        await this.save(next);
        this.state = next;
      });
    return this.writing;
  }
  snapshot() {
    return {
      ...this.state,
      storageError: this.storageError || null,
      refreshing: this.refreshing,
      discovery,
      sources: allSources.map((s) => ({
        ...s,
        kind: catalogSources.includes(s) ? 'catalog' : 'news',
        ...(this.state.sources[s.id] || {}),
        updating: this.refreshing && this.updating?.has(s.id),
      })),
    };
  }
  async refresh() {
    if (this.refreshing) return this.snapshot();
    this.refreshing = true;
    this.updating = new Set(allSources.map((s) => s.id));
    try {
      const results = [];
      for (let i = 0; i < allSources.length; i += 2)
        await Promise.all(
          allSources.slice(i, i + 2).map(async (source) => {
            const at = new Date().toISOString();
            try {
              const parsed = parseFeed(await fetchFeed(source.url, this.fetcher), source.id, at);
              results.push({ source, at, parsed });
            } catch (error) {
              results.push({ source, at, error: error.message });
            } finally {
              this.updating.delete(source.id);
            }
          }),
        );
      await this.updateState((next) => {
        results.sort(
          (a, b) =>
            allSources.findIndex((source) => source.id === a.source.id) -
            allSources.findIndex((source) => source.id === b.source.id),
        );
        for (const { source, at, parsed, error } of results) {
          const old = next.sources[source.id] || {};
          next.sources[source.id] = {
            ...old,
            lastAttemptAt: at,
            ...(error
              ? { error }
              : {
                  error: null,
                  lastSuccessAt: at,
                  count: parsed.articles.length,
                  invalid: parsed.invalid,
                }),
          };
        }
        for (const [key, group] of [
          ['articles', sources],
          ['catalogUpdates', catalogSources],
        ]) {
          const byUrl = new Map(next[key].map((a) => [a.url, { ...a, sourceIds: [] }]));
          for (const { source, at, parsed, error } of results) {
            if (!group.includes(source)) continue;
            if (error) {
              for (const item of next[key])
                if (item.sourceIds.includes(source.id))
                  byUrl.get(item.url)?.sourceIds.push(source.id);
              continue;
            }
            for (const item of parsed.articles) {
              const previous = byUrl.get(item.url);
              if (previous) {
                previous.sourceIds.push(source.id);
                previous.lastFetchedAt = at;
                if (!previous.author && item.author) previous.author = item.author;
              } else byUrl.set(item.url, item);
            }
          }
          const ordered = [...byUrl.values()]
            .filter((item) => item.sourceIds.length || next.flags[item.id]?.saved)
            .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
          next[key] = ordered
            .filter((item) => next.flags[item.id]?.saved)
            .concat(
              ordered
                .filter((item) => !next.flags[item.id]?.saved)
                .slice(0, key === 'articles' ? 500 : 100),
            );
        }
      });
      return this.snapshot();
    } finally {
      this.refreshing = false;
      this.updating.clear();
    }
  }
  async flag(id, key, value) {
    if (!['read', 'saved'].includes(key) || typeof value !== 'boolean')
      throw new Error('記事の操作が不正です');
    await this.updateState((next) => {
      if (![...next.articles, ...next.catalogUpdates].some((a) => a.id === id))
        throw new Error('記事の操作が不正です');
      next.flags[id] = { ...next.flags[id], [key]: value };
    });
    return this.snapshot();
  }
  async saveDiscovery(id, value) {
    if (!discovery.some((item) => item.id === id) || typeof value !== 'boolean')
      throw new Error('発見候補の操作が不正です');
    await this.updateState((next) => {
      next.discoverySaved[id] = value;
    });
    return this.snapshot();
  }
  async addX(url, title) {
    const normalized = xUrl(url);
    if (!normalized || typeof title !== 'string' || title.length > 200)
      throw new Error('X投稿のURLまたはタイトルが不正です');
    await this.updateState((next) => {
      if (!next.manual.some((x) => x.url === normalized)) {
        if (next.manual.length >= MAX_MANUAL) throw new Error('手動保存の上限に達しました');
        next.manual.unshift({
          id: createHash('sha256').update(normalized).digest('hex'),
          url: normalized,
          title: title.trim() || 'Xの投稿',
          savedAt: new Date().toISOString(),
        });
      }
    });
    return this.snapshot();
  }
  async removeX(id) {
    await this.updateState((next) => {
      next.manual = next.manual.filter((item) => item.id !== id);
    });
    return this.snapshot();
  }
}
