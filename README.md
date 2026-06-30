# spotLock-camera 📸

[![Android CI](https://github.com/matsutanishimpei/spotLock-camera/actions/workflows/ci.yml/badge.svg)](https://github.com/matsutanishimpei/spotLock-camera/actions/workflows/ci.yml)
[![Deploy Web Dashboard](https://github.com/matsutanishimpei/spotLock-camera/actions/workflows/deploy-web.yml/badge.svg)](https://github.com/matsutanishimpei/spotLock-camera/actions/workflows/deploy-web.yml)

「その場所、その時間にユーザーがいたこと」を、**位置情報（GPS）を一切使わずに証明する** Android ネイティブカメラアプリ、およびそのWeb検証ダッシュボードシステムです。

撮影した写真の `APP15` セグメント（独自のメタデータ領域）に、撮影日時のタイムスタンプと改ざん防止の暗号署名を直接書き込み、画像の完全性と撮影時間の真正性を担保します。

---

## 🎯 業務要件と設計背景（オフライン前提）

### 1. ネットワーク通信を行わない（スマホ時刻の採用）
本アプリは**「地下駅構内や改札口など、通信環境が不安定またはオフラインになりやすい場所での撮影」**を前提とした実業務要件に基づいています。そのため、撮影時に外部のタイムサーバー（NTP）への接続といったネットワーク通信は一切行わず、**スマートフォンのローカルシステム時間（端末時刻）をそのまま使用**して完結する設計を採用しています。

### 2. 主目的：画像と撮影日時の改ざん防止
通信に依存せず端末時刻を採用する特性上、撮影後に写真ファイルのメタデータを書き換えたり、時間を偽装したりするリスクが存在します。
本システムの主目的は、**「撮影の瞬間に、カメラ内部で取得した時刻と画像データ（ピクセル値）をセットで即座に暗号署名すること」**により、**写真撮影後の画像および撮影日時の後からの改ざん・捏造を完全に防ぐこと**にあります。

これにより、ユーザーが写真のタイムスタンプや画像バイナリを少しでも書き換えて「時間通りに駅に着いていた」と偽ろうとした場合、検証ダッシュボード側でデジタル署名の不一致（改ざん）が即座に検知され、不正が見破られます。

---

## 🛠️ コアロジックと仕組み


### 1. GPS情報の完全排除
本アプリは位置情報パーミッション（`ACCESS_FINE_LOCATION` 等）を一切要求せず、生成されるJPEGのExifメタデータにも位置情報を書き込みません。

### 2. 暗号署名の生成仕様 (ECDSA P-256)
画像の改ざんやタイムスタンプの捏造を防ぐため、アプリ内の秘密鍵を用いて非対称鍵署名（ECDSA）を行います。

$$\text{Signature} = \text{ECDSA-P256}(\text{秘密鍵}, \text{タイムスタンプ文字列} + \text{加工済みJPEG画像データの全バイナリ})$$

* **秘密鍵 (Private Key)**: `local.properties` に記述された EC P-256 秘密鍵（Base64 PKCS#8形式）。ビルド時にアプリ内部に安全に注入されます。
* **公開鍵 (Public Key)**: 検証ダッシュボード側で保持する検証用キー。ソースコードに直接公開されても安全です（署名の偽造は不可能です）。
* **タイムスタンプ**: 撮影完了の瞬間にアプリ内部で取得した正確なUNIX時間（ミリ秒）。
* **加工済みJPEG画像データ**: カメラセンサーからキャプチャした画像に対し、タイムスタンプの視覚的オーバーレイ（日時焼き込み）を施した後のJPEGバイナリ（APP15署名セグメント挿入前）。署名はこの加工済み画像全体に対して計算されるため、画像データが1ピクセルでも変更されると署名検証が失敗します。

### 3. JPEGバイナリ埋め込み仕様（APP15）
JPEG標準のセグメント領域のうち、一般的なビューアからは無視される **`APP15` マーカー (`0xFFEF`)** を使用してデータを挿入します。

#### APP15 セグメントの構造 (Big Endian)

| オフセット | サイズ (Byte) | データ型 | 格納される値と説明 |
| :--- | :--- | :--- | :--- |
| `0` | `2` | `UInt16` | `0xFFEF` (APP15セグメントマーカー) |
| `2` | `2` | `UInt16` | セグメント長 (ヘッダー含む後続データの合計サイズ：`83`) |
| `4` | `8` | `ASCII` | 識別マジック文字列: `"SPOTLOCK"` |
| `12` | `1` | `Byte` | バージョン番号: `0x01`（または後述のキーの世代番号） |
| `13` | `8` | `Int64` | UNIXタイムスタンプ（ミリ秒） |
| `21` | `64` | `Bytes` | ECDSA P-256 デジタル署名 (RAW形式: R \| S 各32バイト) |

このデータを、元のJPEGファイルの `SOI`（`0xFFD8`）および最初のセグメント（通常 `APP0`/`APP1`）の直後に**インサート（挿入）**します。

---

## 🏗️ Androidアプリ設計（モダンアーキテクチャ）

Androidアプリは保守性とテスタビリティを極限まで高めるため、クリーン設計に準拠したアーキテクチャを採用しています。

* **UIとビジネスロジックの分離 (ViewModel + StateFlow):**
  [CameraScreen.kt](app/src/main/java/com/example/spotlockcamera/CameraScreen.kt) (Compose UI) は描画に徹し、処理の流れは [CameraViewModel.kt](app/src/main/java/com/example/spotlockcamera/ui/CameraViewModel.kt) で管理します。
* **責任の抽出とインターフェース化 (手動DI):**
  画像処理（[ImageProcessor](app/src/main/java/com/example/spotlockcamera/core/image/ImageProcessor.kt)）、暗号署名（[ImageSigner](app/src/main/java/com/example/spotlockcamera/core/crypto/ImageSigner.kt)）、ストレージ保存（[ImageStorage](app/src/main/java/com/example/spotlockcamera/core/storage/ImageStorage.kt)）、鍵管理（[PrivateKeyProvider](app/src/main/java/com/example/spotlockcamera/core/crypto/PrivateKeyProvider.kt)）をすべて抽象化し、[CameraViewModelFactory](app/src/main/java/com/example/spotlockcamera/ui/CameraViewModelFactory.kt) 経由で依存関係をコンストラクタ注入する「手動DI」を導入しています。これによりローカルでのユニットテストが容易になりました。
* **Kotlin コルーチン (Coroutines) の導入:**
  非同期・並行処理（マルチスレッド処理）にはコルーチンを採用。画面のライフサイクルと連動する `viewModelScope` を用いて、メモリリークやクラッシュを防ぎ、安全なキャンセル制御を実現しています。
* **ガードレール ＆ 指数バックオフ再試行:**
  * **リトライ (`retryIO`):** ストレージ書き込み時の一時的な競合に備え、自動的かつ時間倍増待機（100ms➔200ms➔400ms）を伴う再試行を行います。
  * **エラーフォールバック:** メモリ不足（OutOfMemory）や画像データの異常が発生した際は、アプリを落とさずに「タイムスタンプ無しのオリジナル画像」を返して処理を続行させます。
  * **鍵検証:** 暗号エンジンのクラッシュを防ぐため、署名作成前に秘密鍵のデコード検証を行います。

---

## 🔍 Web検証ダッシュボード (Vite + React SPA)

Webの検証ツールは **Vite + React (JavaScript)** によるシングルページアプリケーション（SPA）として実装されています。

* **マルチデバイス対応の一本化:** 
  デスクトップ版ダッシュボード（`#/`）と、現場向けのモバイル検証画面（`#/mobile`）をハッシュルーティングで統合。1つのビルド成果物としてパッケージ化されるため、GitHub Pagesなどの静的ホスティングへ置くだけで両方の画面が一挙に利用可能になります。
* **洗練されたライトモード:**
  ソフトな影とガラスモーフィズム（Glassmorphism）効果をあしらった、清潔感のある高品質なライトテーマへとデザインを一新しました。
* **動作環境（重要）:** 
  Web Crypto API を用いた暗号署名の厳密な検証は、ブラウザのセキュリティ上の制約から**「セキュアコンテキスト（`https://` または `http://localhost/`）」下でのみフル動作**します。
  > [!WARNING]
  > ビルドされた `spotlock-verifier.html` などのHTMLファイルを、ブラウザのローカルファイル（`file://` スキーム）として直接ダブルクリックで開いた場合、暗号署名検証APIが動作せず、検証結果が「未検証（検証不可）」となります。本番運用や動作テストの際は、必ずHTTPSでホストされたサーバー上、またはローカル開発サーバー（localhost）上からアクセスしてください。


---

## 🔑 鍵の生成と管理

### 1. 鍵ペアの生成
本番運用の前や、鍵を新しく更新（ローテーション）したい場合は、以下のスクリプトを実行して新しい P-256 鍵ペアを生成します：

```bash
python generate_keys.py
```

実行すると、以下のように設定用の鍵が出力されます：
* **アプリ用の秘密鍵 (Base64形式)** ➔ `local.properties` に記述
* **ウェブ用の公開鍵 (Hex形式)** ➔ `web/src/utils/crypto.js` の `PUBLIC_KEYS` リストに追加

### 2. 秘密鍵の設定（Git管理外）
プロジェクトルートの `local.properties`（通常Git管理外）に生成した秘密鍵をセットします。

```properties
spotlock.privateKey=YOUR_GENERATED_PRIVATE_KEY_BASE64
```
*(※テンプレートとして `local.properties.example` がGit上に公開されています。新しい環境ではコピーして作成してください)*

---

## 💻 開発・テスト・ビルドコマンド

### Android アプリ

#### 必要要件
* Android Studio (Koala 以降を推奨)
* JDK 17+
* Android SDK 36

#### コマンド
* **単体テストの実行 (JUnit / コルーチンテスト):**
  実機を使わずにJVM上で、正常系・異常系・リトライ処理を含めたテスト（カバレッジ8割以上）を高速で実行します。
  ```bash
  .\gradlew testDebugUnitTest
  ```
* **テストを実行してビルド（推奨）:**
  すべての単体テストが正常にパスすることを確認した上で、デバッグ用APKファイルを生成します（テストが1件でも落ちるとビルドは中断されます）。
  ```bash
  .\gradlew build
  ```
* **テストをスキップしてAPK生成:**
  ```bash
  .\gradlew assembleDebug
  ```

---

### Web ダッシュボード (React)

#### 必要要件
* Node.js (v18+)

#### コマンド
* **依存関係のインストール:**
  ```bash
  cd web
  npm install
  ```
* **ローカル開発サーバーの起動 (`http://localhost:5173/`):**
  ```bash
  npm run dev
  ```
* **静的デプロイ用ビルドの生成:**
  `web/dist/` ディレクトリの中に、GitHub Pages等にアップロードするための相対パス解決済みアセット群を出力します。
  ```bash
  npm run build
  ```

---

## 🔄 鍵の更新（ローテーション）手順

アプリのセキュリティ維持のため、定期的に鍵を更新（ローテーション）してください。

### ⚙️ 正しいキー更新手順
1. **鍵の生成**: `python generate_keys.py` で新しいペアを作成します。
2. **ウェブ側の事前追加 (重要)**:
   * [web/src/utils/crypto.js](web/src/utils/crypto.js) 内の `PUBLIC_KEYS` リストに、**新しいバージョン番号**と生成した**新しい公開鍵**を追加します。
     ```javascript
     export const PUBLIC_KEYS = {
         1: "OLD_PUBLIC_KEY_HEX", // 過去の写真検証用（絶対消さない）
         2: "NEW_PUBLIC_KEY_HEX"  // ← 新しく追加！
     };
     ```
   * この状態でウェブサイトを**先にデプロイ（公開）**しておきます。
3. **アプリ側の更新とリリース**:
   * アプリ側の `local.properties` の `spotlock.privateKey` を**新しい秘密鍵**に書き換えます。
   * [SpotLockImageSigner.kt](app/src/main/java/com/example/spotlockcamera/core/crypto/SpotLockImageSigner.kt) で埋め込むバージョン番号（`payloadStream.write(0x02)` など）を、新しい鍵に対応する番号にインクリメントします。
   * 新しいアプリをビルド・配布します。

この順序（**「ウェブに新鍵追加」➔「アプリを新鍵でリリース」**）を守ることで、ユーザーの手元に古いアプリと新しいアプリが混在していても、どちらの写真も正常に検証し続けることができます。

---

## 📁 主要コード構成
* **[CameraScreen.kt](app/src/main/java/com/example/spotlockcamera/CameraScreen.kt)**: CameraXを用いたUIインターフェース。
* **[CameraViewModel.kt](app/src/main/java/com/example/spotlockcamera/ui/CameraViewModel.kt)**: コルーチン（非同期処理）およびUI状態（StateFlow）の管理。
* **[CaptureAndSignUseCase.kt](app/src/main/java/com/example/spotlockcamera/domain/usecase/CaptureAndSignUseCase.kt)**: 加工➔署名➔保存のビジネスロジックの総括。
* **[core/crypto/](app/src/main/java/com/example/spotlockcamera/core/crypto/)**: [SpotLockImageSigner.kt](app/src/main/java/com/example/spotlockcamera/core/crypto/SpotLockImageSigner.kt) (P-256署名およびAPP15埋め込み)、および [PrivateKeyProvider.kt](app/src/main/java/com/example/spotlockcamera/core/crypto/PrivateKeyProvider.kt)。
* **[core/image/](app/src/main/java/com/example/spotlockcamera/core/image/)**: [TimestampOverlayProcessor.kt](app/src/main/java/com/example/spotlockcamera/core/image/TimestampOverlayProcessor.kt) (レトロオレンジ文字の画像合成)。
* **[core/storage/](app/src/main/java/com/example/spotlockcamera/core/storage/)**: [MediaStoreImageStorage.kt](app/src/main/java/com/example/spotlockcamera/core/storage/MediaStoreImageStorage.kt) (MediaStoreへの保存および自動再試行)。
* **[web/src/App.jsx](web/src/App.jsx)**: ハッシュルーティングを用いたデスクトップとモバイルの統合。
* **[web/src/components/](web/src/components/)**: デスクトップダッシュボードおよびモバイル用個別ビューのUIコンポーネント。
* **[generate_keys.py](generate_keys.py)**: P-256の秘密鍵（Base64）および公開鍵（Hex）ペアを生成するユーティリティ。
