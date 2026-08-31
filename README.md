# AgentEngine

複数のAIコーディングCLI（ハーネス）を1つのチームとして動かすCUIツール。
インストール済みのハーネスをPATHから自動検出し、それぞれに `AGENT.md` で役割を割り当て、
同じチャット形式のトランスクリプト上で議論させます。

## 対応ハーネス

| ハーネス | バイナリ | 備考 |
|---|---|---|
| Claude Code | `claude` | `--output-format json`ネイティブ対応 |
| OpenAI Codex CLI | `codex` | `exec --output-last-message`でテキスト取得 |
| Agy | `agy` | `--output-format json`ネイティブ対応 |
| Qwen Code | `qwen` | `--output-format json`（イベント配列）から`result`を抽出 |
| pi | `pi` | `--system-prompt`/`--append-system-prompt`をネイティブ対応 |
| opencode | `opencode` | `run --format json`（NDJSON）から`text`イベントを抽出 |

いずれもPATHにあれば自動検出され、`team.yaml`側で`harness: <id>`として指定するだけで使えます。

## インストール

```bash
npm install
npm run build
npm link   # `agentengine` コマンドをグローバルに使えるようにする
```

## クイックスタート

```bash
# 1. インストール済みハーネスを検出
agentengine detect

# 2. team.yaml + agents/*/AGENT.md の雛形を生成
agentengine init

# 3. 生成された設定を検証
agentengine doctor

# 4. チーム構成を確認
agentengine team list

# 5. セッション開始（実端末=TTYで実行すると、色分けチャット＋
#    ステータス行＋割り込み入力ボックス付きのInk UIが起動する。
#    パイプ/CI経由など非TTYの場合は自動でプレーンなコンソール出力にフォールバックする）
agentengine run "このプロジェクトの認証まわりを見直したい"
```

セッション中は `<<DONE>>`（`team.yaml`の`stopKeyword`）を含む返信が出るか、`maxTurns`に達すると終了します。
対話UIでは入力ボックスに文章を打ってEnterで会話に割り込めます（`/quit`で終了）。

## デフォルトのチーム構成（人間の組織を模した2階層）

`agentengine init`が生成する既定の7エージェントは、以下の思想で構成されています:

- **品質・判断ティア**（推論力重視・少数精鋭）: `manager` / `designer` / `reviewer` / `security-advisor`
  — Claude Code（Opus）とCodex CLIが担当し、方針決定・設計・最終レビュー・セキュリティ監査を行う。
- **量産ティア**（ボリュームのある実作業）: `builder-qwen` / `builder-pi` / `builder-opencode`
  — Qwen Code / pi / opencode の3ハーネスがそれぞれ独立してコード生成・文書作成を担当し、
  各自のペルソナに「他の2人のBuilderの直近の投稿を簡単にレビューする」責務を持たせることで、
  ラウンドロビンの会話の中で自然にBuilder同士の相互レビューが起きるようにしてある。

ラウンドロビンの順序は `manager → designer → builder-qwen → builder-pi → builder-opencode →
reviewer → security-advisor` で、Managerが指示 → Designerが設計 → 3人のBuilderが実装＋相互レビュー
→ Reviewer/Security Advisorが最終ゲート、という一巡になるよう並べています。役割・ハーネス・モデルの
組み合わせは`team.yaml`/`agents/*/AGENT.md`で自由に編集できます。

## 設定ファイル

- **`team.yaml`**: エージェントの並び順（ラウンドロビン）とセッション全体の設定
  （`maxTurns` / `stopKeyword` / `perTurnTimeoutMs` / `onFailure: skip|halt`）。
- **`agents/<role>/AGENT.md`**: 各エージェントの役割・ハーネス・モデル・ペルソナ本文。
  role/harness/model/toolsEnabled はここのfrontmatterが正であり、`team.yaml`側では二重管理しない。

```markdown
---
role: builder-qwen
harness: qwen
displayName: "Builder (Qwen Code)"
toolsEnabled: false   # true にするとファイル編集等のツール実行を許可（既定は安全なチャット専用モード）
---

あなたはこのチームのBuilderです。...
```

## セッションの保存先

`.agentengine/sessions/<timestamp>/` に以下を保存します（`.gitignore`済み）:
- `transcript.jsonl` — 1行1発言、クラッシュ耐性あり
- `transcript.md` — 人間可読なMarkdown版
- `meta.json` — タスク内容・チーム構成・各ハーネスの検出バージョン

## 既知の制約 / 動作確認済み事項

このマシン上で6ハーネス全てを実際に呼び出して検証済み:

- **Claude Code / Codex CLI / Agy**: 正常に動作を確認。JSON出力から本文・usage・コストを正しく抽出。
- **pi**: 正常に動作するが、バックエンド側の**間欠的な応答遅延**を観測（同一プロンプトが数秒で返る
  こともあれば120秒超かかることもある）。これはpi側の問題であり、AgentEngineの
  タイムアウト（`perTurnTimeoutMs`）＋`onFailure: skip`で正しく吸収されることを確認済み
  （該当ターンは`[ERROR] ... timed out`として記録され、セッションは継続する）。
- **opencode**: 正常に動作を確認。NDJSONの`text`イベントから本文、`step_finish`からusage/costを抽出。
- **Qwen Code**: コマンド自体は正しく動作するが、このマシンでは認証未設定
  （`401 Incorrect API key provided`）のためAPI呼び出しが失敗する。ツール側のバグではなく、
  DashScope等のAPIキー未設定によるもの。`qwen`の認証設定（環境変数でのAPIキー指定）を行えば
  解消する見込み（このセッションでは未検証）。エラーは`[ERROR]`として記録され、
  `onFailure: skip`のままなら他のエージェントの進行は妨げない。

## 未実装（今後の拡張）

- マネージャー主導のターン選択（現状はラウンドロビン固定。`TurnSelector`インターフェースは
  拡張できるよう用意済み）
- ハーネス側のネイティブセッション継続（`--resume`等）を使った会話の再開
- 分割ペイン・コスト集計付きの本格ダッシュボード（`SessionBus`イベント経由で疎結合に
  拡張できる設計にしてある）
