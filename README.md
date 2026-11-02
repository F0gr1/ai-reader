# AI情報リーダー

リポジトリ: [F0gr1/ai-reader](https://github.com/F0gr1/ai-reader)。[Agent Office](https://github.com/F0gr1/agent-office) とは独立して利用・更新できます。

Agent Officeから独立して動く、公開RSS/Atomの記事リーダーです。記事のタイトル・短い抜粋・原文リンクを保存します。AI要約とXの自動取得には対応しません。

## 起動

```sh
npm ci --offline --omit=dev
npm start
```

Node.js 22以降を使用します。独立リポジトリのルートで上記を実行してください。同梱の `vendor/xmldom` を使うため依存導入にネット接続は不要です。固定URLは`http://127.0.0.1:4318/`です。4318に別プロセスがある場合、停止・上書きせず起動に失敗します。保存先は既定で `.data/state.json`、`AI_READER_DATA_DIR`で変更できます。Officeから起動するには、このリポジトリをOffice側の `services/ai-reader` に配置します。配布版で外部のOffice保存先を指定した場合は、その配下のai-readerを使います。

初期情報源は受付の2026-10-29実取得記録に基づくOpenAI News、Zenn AI、Zenn LLM、Google AIです。Zenn公式の[トピック別RSS案内](https://zenn.dev/zenn/articles/zenn-feed-rss)と[Codex](https://zenn.dev/topics/codex)・[Claude Code](https://zenn.dev/topics/claudecode)のトピックページに基づき、固定情報源としてZenn Codex・Zenn Claude Code・Zenn Agent Skills・Zenn Skillsを加えました。受付が追加4フィードの実取得とXML解析を確認しています。GitHub BlogもHTTP 200でしたが本文が約1.9MBのため初期群から外しました。1ソース2MiB、12秒、最大100記事、同時2件を上限とします。起動時と手動操作時に更新し、定期取得はしません。

話題の絞り込みは記事の見出し・抜粋とZennトピック名のキーワードによる機械的分類です。AIによる内容・信頼性の検証は行いません。公式の使い方ガイドは固定リンクとして記事とは別に表示します。ガイドの更新確認やRSS取得は行いません。Claude Codeの[開発での使い方・活用手順](https://code.claude.com/docs/en/common-workflows)も案内します。ガイドは[OpenAIのSkills作成](https://learn.chatgpt.com/docs/build-skills)・[Codexの開発ワークフロー](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex)・[Claude CodeのSkills](https://code.claude.com/docs/en/skills)・[Claude Codeの指示ファイル](https://code.claude.com/docs/en/memory)です。

```sh
npm test
```

利用者が入力したRSS URLの自動取得は未対応です。Xは`https://x.com/<user>/status/<数字>`形式などの元投稿URLを手動保存できます。X本文の取得や認証、非公式ミラーは行いません。

## Skills・プラグインを見つける

記事とは別の画面で、調査時点の固定候補、既存フィードから見出し等で抽出した関連記事、OpenAI・Anthropic公式GitHubカタログのAtomコミットフィードから取得した更新を表示します。コミットは掲載内容の変更であり、新Skillやプラグインのリリースとは限りません。候補には用途・種別・提供元が表記する対象環境・一次リンク・導入手順リンクを載せ、保存して再訪できます。環境での実動作は未確認です。関連X投稿は元投稿へのリンクだけを表示し、Xの自動取得や導入の自動実行はしません。

固定候補には[ChatGPT / Codex公式Plugins Directoryの案内](https://learn.chatgpt.com/docs/plugins)、[OpenAIのCodexプラグイン掲載例](https://github.com/openai/plugins)、[AnthropicのClaude Codeプラグインディレクトリ](https://github.com/anthropics/claude-plugins-official)、[pi-autoresearch](https://github.com/davebcn87/pi-autoresearch)と別作者の[Claude向けautoresearch-skill](https://github.com/agusmdev/autoresearch-skill)を掲載しています。OpenAIのGitHubリポジトリは公開ディレクトリ全体ではなく掲載例です。Atomフィードは手動更新時とアプリ起動時に取得を試みます。取得失敗時は情報源ごとに前回成功時刻を示し、保存済み更新を残します。受付環境で2026-11-02にアプリ経由の2フィード取得を確認しました（計40件）。既存記事の履歴・既読・保存、Xの手動URLは以前と同じ保存領域に残ります。

追加の探し先としてSuperpowers、Vercel Agent Skills、Skills.sh、DrivelineのAutoresearchを掲載しています。Skills.shのTrendingは外部サイトで確認できます。Xの紹介例は2026年3月12日の投稿であり、最新の人気を示すものではありません。
