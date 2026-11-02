import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Reader, parseFeed, xUrl, fetchFeed, sources, catalogSources } from '../reader.mjs';
const feed = (items) =>
  `<rss><channel>${items.map(([title, url]) => `<item><title>${title}</title><link>${url}</link><description>&lt;b&gt;説明&lt;/b&gt;</description><pubDate>Wed, 29 Oct 2025 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const response = (xml) => new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
test('Google AIは受付が200を確認した移転先URLを使う', () => {
  assert.equal(
    sources.find((source) => source.id === 'google-ai').url,
    'https://blog.google/innovation-and-ai/technology/ai/rss/',
  );
});
test('追加情報源はCodex・Claude Code・Skillsの固定トピックRSSを使う', () => {
  assert.equal(sources.length, 8);
  assert.equal(
    sources.find((s) => s.id === 'zenn-agentskills').url,
    'https://zenn.dev/topics/agentskills/feed',
  );
  assert.equal(
    sources.find((s) => s.id === 'zenn-skills').url,
    'https://zenn.dev/topics/skills/feed',
  );
  assert.equal(
    sources.find((s) => s.id === 'zenn-codex').url,
    'https://zenn.dev/topics/codex/feed',
  );
  assert.equal(
    sources.find((s) => s.id === 'zenn-claudecode').url,
    'https://zenn.dev/topics/claudecode/feed',
  );
});
test('RSSとAtomを解析し、重複URLとHTMLを処理する', () => {
  const result = parseFeed(
    feed([
      ['A', 'https://example.com/a#one'],
      ['A2', 'https://example.com/a#two'],
    ]),
    'one',
  );
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].summary, '説明');
  assert.equal(result.articles[0].url, 'https://example.com/a');
  assert.equal(
    parseFeed(
      '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom</title><link href="https://example.com/atom"/></entry></feed>',
      'one',
    ).articles.length,
    1,
  );
});
test('RSSとAtomに著者名がある場合は記事へ保持する', () => {
  const rss =
    '<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item><title>実践</title><link>https://example.com/rss</link><dc:creator>執筆者</dc:creator></item></channel></rss>';
  const atom =
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Guide</title><link href="https://example.com/atom"/><author><name>Writer</name></author></entry></feed>';
  assert.equal(parseFeed(rss, 'zenn-codex').articles[0].author, '執筆者');
  assert.equal(parseFeed(atom, 'openai').articles[0].author, 'Writer');
});
test('壊れたXML、DOCTYPE、無効な記事を拒否する', () => {
  assert.throws(() => parseFeed('<rss><channel><item></channel></rss>', 'one'));
  assert.throws(() => parseFeed('<rss/>', 'one'), /channel/);
  assert.equal(parseFeed('<rss><channel/></rss>', 'one').total, 0);
  assert.throws(() => parseFeed('<!DOCTYPE rss><rss><channel/></rss>', 'one'));
  assert.throws(() => parseFeed(feed([['bad', 'javascript:alert(1)']]), 'one'));
});
test('channel欠落時は失敗とし、既存記事と成功日時を保つ', async () => {
  const reader = new Reader({
    dataDir: '/unused',
    fetcher: async () => response('<rss/>'),
  });
  const article = parseFeed(feed([['既存', 'https://example.com/old']]), 'openai').articles[0];
  reader.state.articles = [article];
  reader.state.sources.openai = { lastSuccessAt: '2025-01-01T00:00:00Z' };
  reader.save = async () => {};
  await reader.refresh();
  assert.equal(reader.state.articles[0].url, article.url);
  assert.equal(reader.state.sources.openai.lastSuccessAt, '2025-01-01T00:00:00Z');
  assert.match(reader.state.sources.openai.error, /channel/);
});
test('保存失敗後は記事とXの操作を公開状態へ反映しない', async () => {
  const reader = new Reader({ dataDir: '/unused' });
  const article = parseFeed(feed([['既存', 'https://example.com/old']]), 'openai').articles[0];
  reader.state.articles = [article];
  reader.save = async () => {
    throw new Error('disk full');
  };
  await assert.rejects(reader.flag(article.id, 'saved', true), /disk full/);
  assert.equal(reader.snapshot().flags[article.id], undefined);
  await assert.rejects(reader.addX('https://x.com/example/status/123', '投稿'), /disk full/);
  assert.equal(reader.snapshot().manual.length, 0);
  reader.state.manual = [{ id: 'one', url: 'https://x.com/example/status/123' }];
  await assert.rejects(reader.removeX('one'), /disk full/);
  assert.equal(reader.snapshot().manual.length, 1);
});
test('取得のサイズとリダイレクトを制限する', async () => {
  await assert.rejects(
    fetchFeed(
      'https://example.com',
      async () => new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/' } }),
    ),
  );
  await assert.rejects(
    fetchFeed('https://example.com', async () => response('x'.repeat(2 * 1024 * 1024 + 1))),
  );
});
test('重複ソース統合、失敗時キャッシュ、既読・保存の再読込', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reader-test-'));
  let fail = false;
  const fetcher = async (url) =>
    fail && url.includes('zenn.dev')
      ? Promise.reject(new Error('通信失敗'))
      : response(feed([['記事', 'https://example.com/a']]));
  try {
    const reader = new Reader({ dataDir: dir, fetcher });
    await reader.load();
    await reader.refresh();
    assert.equal(reader.state.articles.length, 1);
    assert.equal(reader.state.articles[0].sourceIds.length, sources.length);
    const id = reader.state.articles[0].id;
    await reader.flag(id, 'read', true);
    await reader.flag(id, 'saved', true);
    await reader.addX('https://x.com/example/status/123', '投稿');
    fail = true;
    await reader.refresh();
    assert.equal(reader.state.articles.length, 1);
    assert.equal(reader.state.sources['zenn-ai'].error, '通信失敗');
    const reopened = new Reader({ dataDir: dir });
    await reopened.load();
    assert.equal(reopened.state.flags[id].read, true);
    assert.equal(reopened.state.flags[id].saved, true);
    assert.equal(reopened.state.manual.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('旧state.jsonの既読・保存・Xと重複記事を追加元の更新後も保持する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reader-old-state-'));
  const article = parseFeed(feed([['Codexの使い方', 'https://example.com/codex']]), 'openai')
    .articles[0];
  try {
    await writeFile(
      join(dir, 'state.json'),
      JSON.stringify({
        articles: [article],
        flags: { [article.id]: { read: true, saved: true } },
        manual: [{ id: 'old-x', url: 'https://x.com/user/status/123', title: '投稿' }],
        sources: { openai: { lastSuccessAt: '2025-01-01T00:00:00Z' } },
      }),
    );
    const reader = new Reader({
      dataDir: dir,
      fetcher: async () => response(feed([['Codexの使い方', 'https://example.com/codex']])),
    });
    await reader.load();
    await reader.refresh();
    assert.equal(reader.state.articles.length, 1);
    assert.equal(reader.state.articles[0].sourceIds.length, sources.length);
    assert.deepEqual(reader.state.flags[article.id], { read: true, saved: true });
    assert.equal(reader.state.manual[0].id, 'old-x');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('X投稿URLは正式な投稿形式だけ受け付ける', () => {
  assert.ok(xUrl('https://x.com/user/status/123'));
  assert.equal(xUrl('https://x.com.evil/user/status/123'), null);
  assert.equal(xUrl('http://x.com/user/status/123'), null);
});
test('固定候補の保存は旧記事・既読・Xを保ち、再読込できる', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reader-discovery-'));
  const article = parseFeed(feed([['既存', 'https://example.com/old']]), 'openai').articles[0];
  try {
    await writeFile(
      join(dir, 'state.json'),
      JSON.stringify({
        articles: [article],
        flags: { [article.id]: { read: true, saved: true } },
        manual: [{ id: 'old-x', url: 'https://x.com/user/status/123', title: '投稿' }],
        sources: {},
      }),
    );
    const reader = new Reader({ dataDir: dir });
    await reader.load();
    await reader.saveDiscovery('pi-autoresearch', true);
    const reopened = new Reader({ dataDir: dir });
    await reopened.load();
    assert.equal(reopened.snapshot().discoverySaved['pi-autoresearch'], true);
    assert.deepEqual(reopened.state.flags[article.id], { read: true, saved: true });
    assert.equal(reopened.state.manual[0].id, 'old-x');
    await reopened.saveDiscovery('pi-autoresearch', false);
    assert.equal(reopened.snapshot().discoverySaved['pi-autoresearch'], false);
    await assert.rejects(reopened.saveDiscovery('arbitrary-id', true), /不正/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('公式カタログAtomは記事と分けて取得し、保存後の失敗でも履歴を残す', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reader-catalog-'));
  const commit =
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Update plugin listing</title><link href="https://github.com/openai/plugins/commit/abc"/><updated>2026-11-01T10:00:00Z</updated></entry></feed>';
  let fail = false;
  const fetcher = async (url) => {
    if (url === catalogSources[0].url) {
      if (fail) throw new Error('通信失敗');
      return new Response(commit, { headers: { 'Content-Type': 'application/atom+xml' } });
    }
    return response(feed([['記事', 'https://example.com/article']]));
  };
  try {
    const reader = new Reader({ dataDir: dir, fetcher });
    await reader.load();
    await reader.refresh();
    assert.equal(reader.state.articles.length, 1);
    assert.equal(reader.state.catalogUpdates.length, 2);
    const update = reader.state.catalogUpdates.find((item) =>
      item.sourceIds.includes(catalogSources[0].id),
    );
    assert.equal(update.title, 'Update plugin listing');
    assert.equal(
      reader.snapshot().sources.find((source) => source.id === catalogSources[0].id).kind,
      'catalog',
    );
    await reader.flag(update.id, 'saved', true);
    const successAt = reader.state.sources[catalogSources[0].id].lastSuccessAt;
    fail = true;
    await reader.refresh();
    const reopened = new Reader({ dataDir: dir });
    await reopened.load();
    assert.equal(reopened.state.sources[catalogSources[0].id].lastSuccessAt, successAt);
    assert.equal(reopened.state.sources[catalogSources[0].id].error, '通信失敗');
    assert.equal(
      reopened.state.catalogUpdates.some((item) => item.id === update.id),
      true,
    );
    assert.equal(reopened.state.flags[update.id].saved, true);
    assert.equal(reopened.state.articles.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
