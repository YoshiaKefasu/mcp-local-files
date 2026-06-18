# Local Files MCP

[English](README.md) | 日本語

ChatGPT / Codex から、ローカルPC上の **1つの許可フォルダだけ** を安全に読み書きするための小さな MCP サーバーです。

OpenAI Secure MCP Tunnel 経由で動きます。サーバー本体は stdio で動き、公開対象フォルダは `root-dir.txt` で管理します。`C:\` 全体やユーザープロファイル全体を勝手に公開する設計ではありません。

## できること

```text
list_files       ROOT_DIR 内のファイル一覧
read_file        UTF-8 テキストファイルの読み取り
search_files     テキストファイル検索
write_file       UTF-8 テキストファイルの作成・上書き
replace_in_file  テキストの完全一致置換
read_binary_file_base64  バイナリファイルを base64 で読み取り
write_base64_file        base64 をデコードしてバイナリ書き込み
```

画像、PDF、ZIP などは `read_binary_file_base64` / `write_base64_file` で扱えます。

## ファイル構成

```text
server.js       MCP stdio サーバー本体
cli.js          npm CLI、ROOT_DIR helper、tunnel-client downloader
package.json    Node.js package metadata
run-mcp.cmd     root-dir.txt を読んで server.js を起動
mcp-here.cmd    今いるフォルダを root-dir.txt に書く補助コマンド
root-dir.txt    現在公開しているフォルダ
AGENTS.md       エージェント向け作業ルール
```

## インストール

```powershell
cd %USERPROFILE%\mcp-local-files
npm install
```

CLI の確認:

```powershell
mcp-local-files --help
```

## 初回セットアップ

```powershell
mcp-local-files setup
```

このコマンドは以下を行います。

```text
OpenAI tunnel-client を必要なら自動ダウンロード
OpenAI Tunnels ページを開く
OpenAI Runtime API keys ページを開く
tunnel_id と Runtime API key を入力してもらう
tunnel-client profile を作成
Runtime API key をこのリポジトリ外に保存
```

開くページ:

```text
https://platform.openai.com/settings/organization/tunnels
https://platform.openai.com/settings/organization/api-keys
```

setup 画面で最初に出るデフォルト profile 名:

```text
local-files
```

Runtime API key の保存先:

```text
%USERPROFILE%\.mcp-local-files\secrets.json
```

このファイルはリポジトリ外です。Git に入れないでください。

setup 後は、いま作った profile が CLI の既定 profile として保存されます。つまり `mcp-local-files --tunnel-here` は、`--profile` を付けなくても直近で作った profile を自動で使います。古いCLIでsetup済みの場合も、保存済み profile が1つだけならそれを自動で使います。

非対話で profile / tunnel_id だけ指定する場合:

```powershell
mcp-local-files setup --profile local-files --tunnel-id tunnel_xxx --no-open
```

Runtime API key はシェル履歴に残さないため、引き続き対話入力です。

Windows で profile に保存されるデフォルト MCP command:

```text
cmd /d /s /c "%USERPROFILE%/mcp-local-files/run-mcp.cmd"
```

`run-mcp.cmd` は `root-dir.txt` から `ROOT_DIR` を読んだあと、`endlocal & set` トリックで cmd のローカルスコープを抜けて子プロセス `node` まで環境変数を届けます。`server.js` 側では `ROOT_DIR` を次の順で解決します:

1. `process.env.ROOT_DIR`
2. `process.argv[2]`
3. `%USERPROFILE%\mcp-local-files\root-dir.txt`

このおかげで、`run-mcp.cmd` は tunnel-client の起動先と、ローカル動作確認用のどちらにも使えます。`cd` してから呼ぶ必要はありません。

## 公開フォルダを切り替える

アクセスさせたいフォルダへ `cd` してから実行します。

```powershell
cd C:\path\to\your-project
mcp-local-files --tunnel-here
```

内部では以下を行います。

```text
1. 現在のフォルダを root-dir.txt に保存
2. tunnel-client がなければ公式ReleaseからDL
3. SHA256SUMS.txt で検証
4. 直近の setup で作った profile で tunnel-client run
```

別 profile を使う場合:

```powershell
mcp-local-files --tunnel-here --profile local-files
```

旧式の補助コマンドも使えます。

```powershell
cd C:\path\to\your-project
%USERPROFILE%\mcp-local-files\mcp-here.cmd
```

この場合は tunnel-client を再起動してください。

## MCPサーバーを直接起動する

ローカル確認:

```powershell
cmd /d /s /c "%USERPROFILE%/mcp-local-files/run-mcp.cmd"
```

正常なら待機状態になります。止める時は `Ctrl+C`。

CLIから直接起動する場合:

```powershell
mcp-local-files --root C:\path\to\folder
```

## OpenAI Tunnel 経由で使う

通常:

```powershell
mcp-local-files tunnel run --profile local-files
```

既存の `tunnel-client.exe` を使いたい場合:

```powershell
mcp-local-files --tunnel-client C:\path\to\tunnel-client.exe tunnel run --profile local-files
```

診断:

```powershell
mcp-local-files tunnel doctor --profile local-files --explain
```

初回実行時、CLI は OpenAI 公式 `openai/tunnel-client` GitHub Release から対象OS用 zip と `SHA256SUMS.txt` を取得し、SHA256検証後にユーザーキャッシュへ展開します。

```text
Windows: %USERPROFILE%\.cache\mcp-local-files\tunnel-client
macOS/Linux: ~/.cache/mcp-local-files/tunnel-client
```

`tunnel-client` バイナリはこのパッケージに同梱しません。

## バイナリファイルの扱い

読み取り例:

```json
{
  "path": "images/example.png",
  "maxBytes": 10000000
}
```

返り値には `path`, `size`, `base64`, `encoding: "base64"`, `mimeType` が含まれます。`maxBytes` を超える場合は途中で切らずにエラーにします。

書き込み例:

```json
{
  "path": "images/example.png",
  "base64": "iVBORw0KGgo...",
  "overwrite": false
}
```

既存ファイルは `overwrite: true` を明示しない限り上書きしません。書き込みサイズ上限は 25MB です。

## 安全モデル

このサーバーは **1つの ROOT_DIR の中だけ** を対象にします。

ブロックするもの:

```text
絶対パス
.. による ROOT_DIR 外への脱出
許可していない拡張子のテキスト読み取り
2MB超の巨大テキスト検索
maxBytes を超えるバイナリ読み取り
上限を超えるバイナリ書き込み
```

ディレクトリ探索では以下をスキップします。

```text
node_modules
.git
.venv
```

`C:\` 全体、ユーザープロファイル全体、秘密情報を含むフォルダを公開対象にしないでください。

## トラブルシュート

ChatGPT 側で connector 作成に失敗し、tunnel log に `file already closed` が出る場合、ローカル MCP プロセスがすぐ終了していることが多いです。

まずこれを確認してください。

```powershell
cmd /d /s /c "%USERPROFILE%/mcp-local-files/run-mcp.cmd"
```

`ROOT_DIR is required` が出る場合は、`run-mcp.cmd` と `root-dir.txt` を確認してください。

Node の依存が見つからない場合:

```powershell
cd %USERPROFILE%\mcp-local-files
npm install
```

## 注意

`server.js` は MCP stdio サーバーです。通常ログを stdout に出さないでください。stdout は MCP プロトコル用です。必要なエラーだけ stderr に出します。

OpenAI Runtime API key、GitHub token、cookie、SSH秘密鍵などをこのリポジトリに保存しないでください。
