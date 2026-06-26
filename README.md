# spotLock-camera 📸

「その場所、その時間にユーザーがいたこと」を、**位置情報（GPS）を一切使わずに証明する** Android ネイティブカメラアプリ、およびその検証システムです。

撮影した写真の `APP15` セグメント（独自のメタデータ領域）に、撮影日時のタイムスタンプと改ざん防止の暗号署名を直接書き込み、画像の完全性と撮影時間の真正性を担保します。

---

## 🛠️ コアロジックと仕組み

### 1. GPS情報の完全排除
本アプリは位置情報パーミッション（`ACCESS_FINE_LOCATION` 等）を一切要求せず、生成されるJPEGのExifメタデータにも位置情報を書き込みません。

### 2. 暗号署名の生成仕様 (ECDSA P-256)
画像の改ざんやタイムスタンプの捏造を防ぐため、アプリ内の秘密鍵を用いて非対称鍵署名（ECDSA）を行います。

$$\text{Signature} = \text{ECDSA-P256}(\text{秘密鍵}, \text{タイムスタンプ文字列} + \text{元JPEG画像データの全バイナリ})$$

* **秘密鍵 (Private Key)**: `local.properties` に記述された EC P-256 秘密鍵（Base64 PKCS#8形式）。ビルド時にアプリ内部に安全に注入されます。
* **公開鍵 (Public Key)**: 検証サイトや検証ツール側で保持する検証用キー。ソースコードに直接公開されても安全です（署名の偽造は不可能です）。
* **タイムスタンプ**: 撮影完了の瞬間にアプリ内部で取得した正確なUNIX時間（ミリ秒）。
* **元JPEG画像データ**: カメラセンサーからキャプチャした生のJPEGバイナリ（署名挿入前）。画像データが1ピクセルでも変更されると署名検証が失敗します。

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

## 🔑 鍵の生成と管理

### 1. 鍵ペアの生成
本番運用の前や、鍵を新しく更新（ローテーション）したい場合は、以下のスクリプトを実行して新しい P-256 鍵ペアを生成します：

```bash
python generate_keys.py
```

実行すると、以下のように設定用の鍵が出力されます：
* **アプリ用の秘密鍵 (Base64形式)** ➔ `local.properties` に記述
* **ウェブ用の公開鍵 (Hex形式)** ➔ `web/index.html` の `PUBLIC_KEYS` リストに追加

### 2. 秘密鍵の設定（Git管理外）
プロジェクトルートの `local.properties`（通常Git管理外）に生成した秘密鍵をセットします。

```properties
spotlock.privateKey=YOUR_GENERATED_PRIVATE_KEY_BASE64
```
*(※テンプレートとして `local.properties.example` がGit上に公開されています。新しい環境ではこちらをコピーして作成してください)*

---

## 📱 アプリの使い方 (ビルドと実行)

### 必要要件
* Android Studio (Koala 以降を推奨)
* JDK 17+
* Android SDK 36
* 接続された実機（USBデバッグ有効）またはエミュレータ

### 手順
1. 本プロジェクトを Android Studio で開きます。
2. `local.properties` に秘密鍵が設定されていることを確認します。
3. `File` -> `Sync Project with Gradle Files` で Gradle 同期を実行します。
4. 実行デバイスを選択し、**「Run」ボタン（緑色の再生マーク `▶`）**をクリックします。
5. 撮影された写真は、スマートフォンの `Pictures/spotLock-camera` フォルダに `spotlock_<timestamp>.jpg` として保存されます。

---

## 🔍 画像の真正性検証（改ざんチェック）

撮影した画像が本物のアプリで撮影され、改ざんされていないかを検証するために、ウェブ版およびコマンドライン版のツールが用意されています。

### 方法A: ウェブ検証サイトを使う（一番簡単）
本プロジェクトの `web/index.html` は、Cloudflare Pages 等で静的に配信可能な検証ツールです。
1. [web/index.html](web/index.html) をブラウザで直接開きます。
2. 撮影した写真をドラッグ＆ドロップします。
3. 自動的に撮影時の「時刻」と「真正性」の検証結果が表示されます。

### 方法B: Pythonスクリプトを使う
1. 接続したエミュレータや実機から画像を取り出します：
   ```bash
   adb pull /sdcard/Pictures/spotLock-camera/ .
   ```
2. 検証スクリプトを実行します（※ `cryptography` ライブラリが必要です）：
   ```bash
   python verify_signature.py spotlock_xxxxxxxxxxxxx.jpg
   ```

---

## 🔄 鍵の更新（ローテーション）手順とベストプラクティス

アプリのセキュリティ維持や、秘密鍵の漏洩が疑われる場合は、定期的に鍵を更新（ローテーション）してください。

### 🚨 鍵を更新する際の重要な注意点
アプリ側とウェブ側の鍵の更新にはタイミングのズレが生じるため、以下の「**2段階の更新**」を行う必要があります。これを怠ると、**古いアプリで撮影した写真や、新しいアプリで撮影した写真のどちらかが検証エラー**になってしまいます。

### ⚙️ 正しいキー更新手順
1. **鍵の生成**: `python generate_keys.py` で新しいペアを作成します。
2. **ウェブ側の事前追加 (重要)**:
   * [web/index.html](web/index.html) 内の `PUBLIC_KEYS` リストに、**新しいバージョン番号**と生成した**新しい公開鍵**を追加します。
     ```javascript
     const PUBLIC_KEYS = {
         1: "OLD_PUBLIC_KEY_HEX", // 過去の写真検証用（絶対消さない）
         2: "NEW_PUBLIC_KEY_HEX"  // ← 新しく追加！
     };
     ```
   * この状態のウェブサイトを**先にデプロイ（公開）**しておきます。
3. **アプリ側の更新とリリース**:
   * アプリ側の `local.properties` の `spotlock.privateKey` を**新しい秘密鍵**に書き換えます。
   * [JpegSignatureEditor.kt](app/src/main/java/com/example/spotlockcamera/JpegSignatureEditor.kt) で埋め込むバージョン番号（`payloadStream.write(0x02)` など）を、新しい鍵に対応する番号（例：`0x02`）にインクリメントします。
   * 新しいアプリをビルド・配布します。

この順序（**「ウェブに新鍵追加・公開」➔「アプリを新鍵でビルド・公開」**）を守ることで、ユーザーの手元に古いアプリと新しいアプリが混在していても、どちらの写真も正常に検証し続けることができます。

---

## 📁 主要コード構成
* **[CameraScreen.kt](app/src/main/java/com/example/spotlockcamera/CameraScreen.kt)**: CameraXを用いた撮影インターフェース、MediaStoreへの保存。
* **[JpegSignatureEditor.kt](app/src/main/java/com/example/spotlockcamera/JpegSignatureEditor.kt)**: JPEGバイナリパーサー、カスタム `APP15` 領域の作成、ECDSA署名の生成と埋め込み（RAW-64バイト化）。
* **[web/index.html](web/index.html)**: ブラウザの Web Crypto API を使用して、ECDSA署名の検証を行うドラッグ＆ドロップ型検証サイト。
* **[verify_signature.py](verify_signature.py)**: JPEGファイルから `APP15` をパースし、ECDSA検証を行うPythonスクリプト。
* **[generate_keys.py](generate_keys.py)**: P-256の秘密鍵（Base64）および公開鍵（Hex）ペアを生成するユーティリティ。
