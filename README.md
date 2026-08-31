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
#    フェーズ表示＋ステータス行＋割り込み入力ボックス付きのInk UIが起動する。
#    パイプ/CI経由など非TTYの場合は自動でプレーンなコンソール出力にフォールバックする）
agentengine run "このプロジェクトの認証まわりを見直したい"
```

## オーケストレーション方式（`team.yaml`の`orchestration`）

`orchestration: round-robin`（既定値）と `orchestration: phased`（`agentengine init`が生成する既定
team.yamlはこちら）の2方式がある。

### `round-robin` — 汎用フラット方式
全エージェントを`agents:`記載順に単純ラウンドロビン。いずれかの返信に`stopKeyword`（既定
`<<DONE>>`）が単独行として出現するか`maxTurns`に達すると終了。

### `phased` — 開発特化・フェーズ型方式
実際の開発組織（PM・設計・実装・レビュー・セキュリティ）を模した3フェーズのループ。`team.yaml`の
`phases`ブロックで各エージェントIDを`manager` / `designer` / `workers: [...]` / `reviewers: [...]`
に割り当てる。

```
①設計 (manager ⇔ designer)
  managerが設計に納得したら <<DESIGN_APPROVED>> を単独行で返信
  + 人間が対話UIで /approve を入力（非対話モードでは自動的に満たされたものとして扱う）
  → 両方揃うまでmanagerとdesignerが交互に発言し続ける
      │
      ▼ 承認
②実装 (worker のラウンドロビン)
  各workerは担当分を実装しつつ他workerの投稿を簡易レビュー
  正常終了: いずれかの返信に stopKeyword（既定 <<DONE>>）が単独行で出現 → ③へ
  異常終了: maxTurns到達 / 同一worker3連続失敗 / onFailure:halt → ①へ差し戻し（サイクル消費）
      │
      ▼ 正常終了
③レビュー・セキュリティ監査 (reviewer + security-advisor を並列実行)
  互いの出力は見えない独立した監査。結果は常に①（manager）へ戻る
      │
      ▼
   ①へ戻って次サイクル … maxCycles到達 or 人間の /quit・Ctrl-C で終了
```

「workerに指示を出せるのはmanagerだけ」という現実の開発チームを模した設計で、`agentengine init`
既定チームでは判断系ロール（manager/designer/reviewer/security-advisor）をClaude Code(Opus)と
Codex CLIが、実装系ロール（worker-qwen/worker-pi/worker-opencode）をQwen Code/pi/opencodeが担当する。

- `maxTurns` はフェーズ①・②それぞれの1回あたりの上限。
- `maxCycles` は①→②→③の外周ループ全体の安全弁（異常終了で①へ差し戻された回もサイクル数として消費されるため無限ループしない）。
- `designApprovalKeyword`（既定`<<DESIGN_APPROVED>>`）はmanagerの設計承認シグナル。`stopKeyword`は
  ②のworkerが「自分の担当分が完了した」ことを示すシグナルとして再利用される。
- 停止キーワードの検出は**単独行として出現した場合のみ**（`hasControlLine`）。文中で言及しただけ
  （例: 「まだ`<<DONE>>`は出していません」）では誤検知しない。

対話UIでは入力ボックスに文章を打ってEnterで会話に割り込めます。`/quit`で強制終了、`phased`方式では
`/approve`で設計フェーズの人間承認を行います。

## デフォルトのチーム構成（人間の組織を模した2階層）

`agentengine init`が生成する既定の7エージェントは、以下の思想で構成されています:

- **品質・判断ティア**（推論力重視・少数精鋭）: `manager` / `designer` / `reviewer` / `security-advisor`
  — Claude Code（Opus）とCodex CLIが担当し、方針決定・設計・最終レビュー・セキュリティ監査を行う。
- **量産ティア**（ボリュームのある実作業）: `worker-qwen` / `worker-pi` / `worker-opencode`
  — Qwen Code / pi / opencode の3ハーネスがそれぞれ独立してコード生成・文書作成を担当し、
  各自のペルソナに「他の2人のWorkerの直近の投稿を簡単にレビューする」責務を持たせることで、
  ②のラウンドロビンの中で自然にWorker同士の相互レビューが起きるようにしてある。

役割・ハーネス・モデルの組み合わせ、`phases`ブロックのメンバー構成は`team.yaml`/`agents/*/AGENT.md`
で自由に編集できる。

## 設定ファイル

- **`team.yaml`**: エージェントの並び順とセッション全体の設定
  （`orchestration` / `maxTurns` / `maxCycles` / `stopKeyword` / `designApprovalKeyword` /
  `requireHumanApproval` / `perTurnTimeoutMs` / `onFailure: skip|halt` / `phases`）。
- **`agents/<role>/AGENT.md`**: 各エージェントの役割・ハーネス・モデル・ペルソナ本文。
  role/harness/model/toolsEnabled はここのfrontmatterが正であり、`team.yaml`側では二重管理しない。

```yaml
version: 1
orchestration: phased
maxTurns: 20
maxCycles: 5
stopKeyword: "<<DONE>>"
designApprovalKeyword: "<<DESIGN_APPROVED>>"
requireHumanApproval: true
onFailure: skip
phases:
  manager: manager
  designer: designer
  workers: [worker-qwen, worker-pi, worker-opencode]
  reviewers: [reviewer, security-advisor]
agents:
  - id: manager
    agentFile: agents/manager/AGENT.md
  # ...
```

```markdown
---
role: worker-qwen
harness: qwen
displayName: "Worker (Qwen Code)"
toolsEnabled: false   # true にするとファイル編集等のツール実行を許可（既定は安全なチャット専用モード）
---

あなたはこのチームのWorkerです。……
```

## セッションの保存先

`.agentengine/sessions/<timestamp>/` に以下を保存します（`.gitignore`済み）:
- `transcript.jsonl` — 1行1発言、クラッシュ耐性あり
- `transcript.md` — 人間可読なMarkdown版
- `meta.json` — タスク内容・チーム構成・各ハーネスの検出バージョン

## 既知の制約 / 動作確認済み事項

このマシン上で6ハーネス全てを実際に呼び出して検証済み:

- **Claude Code / Codex CLI / Agy**: 正常に動作を確認。JSON出力から本文・usage・コストを正しく抽出。
  Agyが検証中ずっと安定していたのは、プロバイダーがGoogleでその日の利用枠にまだ余裕があったため
  （後述の通り、原因を後日切り分けて判明）。
- **pi / opencode**: 正常に動作するが、検証時にタイムアウトが頻発した。原因はAgentEngine側の
  バグではなく、**両ハーネスが共有するバックエンドプロバイダー「OpenCodeGo」の月間利用枠が
  検証当日にちょうど100%へ到達していたこと**（ユーザー確認済み）。加えて一部ハーネスはローカルの
  Ollamaエンドポイントにフォールバックすることがあり、その場合はローカル推論由来の遅延も乗る。
  いずれもAgentEngine側のタイムアウト（`perTurnTimeoutMs`）＋`onFailure: skip`で正しく吸収
  されることは確認済み（該当ターンは`[ERROR] ... timed out`として記録され、セッションは継続する）。
  利用枠がリセットされた後に再検証すればより安定した結果になる見込み。NDJSON解析（opencode）・
  プレーンテキスト解析（pi）自体は正しく動作している。
- **Qwen Code**: コマンド自体は正しく動作するが、このマシンでは認証未設定
  （`401 Incorrect API key provided`）のためAPI呼び出しが失敗する。ツール側のバグではなく、
  DashScope等のAPIキー未設定によるもの。`qwen`の認証設定（環境変数でのAPIキー指定）を行えば
  解消する見込み（このセッションでは未検証）。エラーは`[ERROR]`として記録され、
  `onFailure: skip`のままなら他のエージェントの進行は妨げない。

`phased`方式は実機で以下を確認済み: 設計承認ループ、workerラウンドロビンと`<<DONE>>`検出、
異常終了時の①への差し戻しと`maxCycles`による強制終了、reviewer/security-advisorの並列実行
（開始タイムスタンプの近接と、宣言順での決定的な結果表示を確認）、Ink UI上でのフェーズ
バッジ・複数同時ステータス行の表示。

## 未実装（今後の拡張）

- ハーネス側のネイティブセッション継続（`--resume`等）を使った会話の再開
- 分割ペイン・コスト集計付きの本格ダッシュボード（`SessionBus`イベント経由で疎結合に
  拡張できる設計にしてある）
- `phased`方式のサイクルをまたいだ要約（現状は直近ターンの単純カットのみ）

優先順位や検討中の項目（CI/CD統合など）は [ROADMAP.md](./ROADMAP.md) を参照。

## ライセンス

[MIT](./LICENSE)
