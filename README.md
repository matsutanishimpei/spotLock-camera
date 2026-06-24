# spotLock-camera 📸

「その場所、その時間にユーザーがいたこと」を、**位置情報（GPS）を一切使わずに証明する** Android ネイティブカメラアプリです。

撮影した写真の `APP15` セグメント（独自のメタデータ領域）に、撮影日時のタイムスタンプと改ざん防止の暗号署名を直接書き込み、画像の完全性と撮影時間の真正性を担保します。

---

## 🛠️ コアロジックと仕組み

### 1. GPS情報の完全排除
本アプリは位置情報パーミッション（`ACCESS_FINE_LOCATION` 等）を一切要求せず、生成されるJPEGのExifメタデータにも位置情報を書き込みません。

### 2. 暗号署名の生成仕様
画像の改ざんやタイムスタンプの捏造を防ぐため、以下のデータを連結した値の SHA-256 ハッシュ値を生成し、署名とします。

$$\text{Signature} = \text{SHA-256}(\text{秘密鍵} + \text{タイムスタンプ文字列} + \text{元JPEG画像データの全バイナリ})$$

* **秘密鍵 (Secret Key)**: アプリ内部に難読化して保持される固有のシークレットキー。
* **タイムスタンプ**: 撮影完了の瞬間にアプリ内部で取得した正確なUNIX時間（ミリ秒）。
* **元JPEG画像データ**: カメラセンサーからキャプチャした生のJPEGバイナリ（署名挿入前）。画像データが1ピクセルでも変更されると署名検証が失敗します。

### 3. JPEGバイナリ埋め込み仕様（APP15）
JPEG標準のセグメント領域のうち、一般的なビューアからは無視される **`APP15` マーカー (`0xFFEF`)** を使用してデータを挿入します。

#### APP15 セグメントの構造 (Big Endian)

| オフセット | サイズ (Byte) | データ型 | 格納される値と説明 |
| :--- | :--- | :--- | :--- |
| `0` | `2` | `UInt16` | `0xFFEF` (APP15セグメントマーカー) |
| `2` | `2` | `UInt16` | セグメント長 (ヘッダー含む後続データの合計サイズ：`51`) |
| `4` | `8` | `ASCII` | 識別マジック文字列: `"SPOTLOCK"` |
| `12` | `1` | `Byte` | バージョン番号: `0x01` |
| `13` | `8` | `Int64` | UNIXタイムスタンプ（ミリ秒） |
| `21` | `32` | `Bytes` | SHA-256 デジタル署名 (32バイトバイナリ) |

このデータを、元のJPEGファイルの `SOI`（`0xFFD8`）および最初のセグメント（通常 `APP0`/`APP1`）の直後に**インサート（挿入）**します。画像自体のデータは上書きされず、後ろにスライドするだけであるため、画像は一切劣化・破損しません。

---

## 📱 アプリの使い方 (ビルドと実行)

### 必要要件
* Android Studio (Koala 以降を推奨)
* JDK 17+
* Android SDK 36 (Android 15 Preview / Android 16)
* 接続された実機（USBデバッグ有効）またはエミュレータ

### 手順
1. 本プロジェクトを Android Studio で開きます。
2. 上部メニューの `File` -> `Sync Project with Gradle Files` で Gradle 同期を実行します。
3. 実行デバイスを選択し、**「Run」ボタン（緑色の再生マーク `▶`）**をクリックします。
4. アプリ起動後、カメラの権限を許可し、シャッターボタンを押して写真を撮影します。
5. 撮影された写真は、スマートフォンのギャラリー（`Pictures/spotLock-camera` フォルダ）に `spotlock_<timestamp>.jpg` として保存されます。

---

## 🔍 画像の真正性検証（改ざんチェック）

撮影した画像に署名が正しく埋め込まれているか、また画像や撮影日時が改ざんされていないかを検証するためのPythonスクリプトが用意されています。

### 検証手順

1. スマートフォンから撮影した画像ファイルをPCに取得します。
   ```bash
   adb pull /sdcard/Pictures/spotLock-camera/ .
   ```

2. 付属の検証スクリプトを実行します。
   ```bash
   # 例: 
   python verify_signature.py spotlock_1719163200000.jpg
   ```

### 出力例 (検証成功時)
```text
Reading file: spotlock_1719163200000.jpg
[+] Found APP15 segment at offset: 20 (Length: 51 bytes)
--------------------------------------------------
Metadata Version:    1
Timestamp (UNIX):   1719163200000
Timestamp (Local):  2026-06-24 16:40:00.000000
Embedded Signature:  8f2a6f19...
Calculated Signature:8f2a6f19...
--------------------------------------------------
[SUCCESS] Signature is VALID. The photo's timestamp and image data are authentic and untampered.
```

※もし画像データを少しでも加工したり、ファイル内のタイムスタンプを書き換えたりした場合、署名計算が不一致となり **`[FAILURE] Signature is INVALID`** と警告されます。

---

## 📁 主要コード構成
* **[CameraScreen.kt](app/src/main/java/com/example/spotlockcamera/CameraScreen.kt)**: CameraXを用いた撮影インターフェース、MediaStoreへの保存処理。
* **[JpegSignatureEditor.kt](app/src/main/java/com/example/spotlockcamera/JpegSignatureEditor.kt)**: JPEGバイナリパーサー、カスタム `APP15` の作成、SHA-256デジタル署名の埋め込み処理。
* **[verify_signature.py](verify_signature.py)**: JPEGファイルから `APP15` 領域を復元・パースし、改ざん検証を行うPythonスクリプト。
