import React, { useState, useRef, useEffect } from 'react';
import { verifySpotLockPhoto, getRelativeTimeString, toHexString } from '../utils/crypto';

export default function MobileVerifier() {
    const [detailedPhotoInfo, setDetailedPhotoInfo] = useState(null);
    const [detailedLoading, setDetailedLoading] = useState(false);
    const fileInputRef = useRef(null);

    // Apply specific body class for mobile styling
    useEffect(() => {
        document.body.classList.add('mobile-view');
        return () => {
            document.body.classList.remove('mobile-view');
        };
    }, []);

    const handleFileChange = async (file) => {
        setDetailedLoading(true);
        setDetailedPhotoInfo(null);

        try {
            const verif = await verifySpotLockPhoto(file);
            setDetailedPhotoInfo({
                verif,
                formattedDate: new Date(verif.timestamp).toLocaleString('ja-JP', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    fractionalSecondDigits: 3
                })
            });
        } catch (error) {
            console.error(error);
            setDetailedPhotoInfo({
                error: error.message || error
            });
        } finally {
            setDetailedLoading(false);
        }
    };

    const handleReset = () => {
        setDetailedPhotoInfo(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <div className="container">
            <header>
                <h1>SpotLock Verifier</h1>
                <p className="subtitle">写真の検証（モバイル版）</p>
            </header>
            
            <main className="panel">
                {/* Upload zone */}
                {!detailedPhotoInfo && !detailedLoading && (
                    <div 
                        className="drop-zone"
                        onClick={() => fileInputRef.current.click()}
                        onTouchStart={(e) => e.currentTarget.classList.add('dragover')}
                        onTouchEnd={(e) => e.currentTarget.classList.remove('dragover')}
                    >
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept="image/jpeg,image/jpg"
                            onChange={(e) => {
                                if (e.target.files.length > 0) {
                                    handleFileChange(e.target.files[0]);
                                }
                            }}
                            style={{ display: 'none' }}
                        />
                        <svg className="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                        </svg>
                        <div>
                            <p className="upload-text">タップして写真を選択</p>
                            <p className="upload-hint">JPEGファイルのみ (検証結果に画像は表示されません)</p>
                        </div>
                    </div>
                )}

                {detailedLoading && <div className="spinner" style={{ display: 'block' }}></div>}

                {/* Verification Results */}
                {detailedPhotoInfo && (
                    <div className="result-container" style={{ display: 'block' }}>
                        {detailedPhotoInfo.error ? (
                            <div className="result-header">
                                <div className="status-badge error">
                                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'currentColor' }}></span>
                                    エラー
                                </div>
                                <h2 style={{ fontSize: '1.15rem', fontWeight: 600, lineHeight: 1.4, color: 'var(--error-color)' }}>
                                    ファイルの読み込み・検証中にエラーが発生しました
                                </h2>
                            </div>
                        ) : (
                            <div className="result-header">
                                <div className={`status-badge ${!detailedPhotoInfo.verif.cryptoSupported ? 'error' : detailedPhotoInfo.verif.isValid ? 'success' : 'error'}`}>
                                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'currentColor', marginRight: '4px' }}></span>
                                    {!detailedPhotoInfo.verif.cryptoSupported ? '検証不可' : detailedPhotoInfo.verif.isValid ? '有効な署名' : '検証失敗'}
                                </div>
                                <h2 style={{ fontSize: '1.15rem', fontWeight: 600, lineHeight: 1.4, color: !detailedPhotoInfo.verif.cryptoSupported ? '#f59e0b' : detailedPhotoInfo.verif.isValid ? 'var(--success-color)' : 'var(--error-color)' }}>
                                    {!detailedPhotoInfo.verif.cryptoSupported ? '暗号署名の検証をスキップしました' : detailedPhotoInfo.verif.isValid ? '写真の真正性が検証されました' : '署名の検証に失敗しました'}
                                </h2>
                            </div>
                        )}

                        <div className="details-box">
                            {detailedPhotoInfo.error ? (
                                <div className="detail-item" style={{ borderLeft: '3px solid var(--error-color)' }}>
                                    <div className="detail-label">エラー詳細</div>
                                    <div style={{ color: 'var(--error-color)' }}>{detailedPhotoInfo.error}</div>
                                </div>
                            ) : (
                                <>
                                    <div className="detail-item">
                                        <div className="detail-label">撮影時間 (デジタル署名証明)</div>
                                        <div className="detail-value time">{detailedPhotoInfo.formattedDate}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                            {getRelativeTimeString(detailedPhotoInfo.verif.timestamp)}
                                        </div>
                                    </div>

                                    <div className="detail-item" style={{ borderLeft: `3px solid ${!detailedPhotoInfo.verif.cryptoSupported ? '#f59e0b' : detailedPhotoInfo.verif.isValid ? 'var(--success-color)' : 'var(--error-color)'}` }}>
                                        <div className="detail-label">暗号署名検証</div>
                                        {!detailedPhotoInfo.verif.cryptoSupported ? (
                                            <div style={{ fontSize: '0.9rem' }}>
                                                <span style={{ color: '#f59e0b', fontWeight: 600 }}>⚠ 検証不可（非セキュア環境）</span> ブラウザの制限により、ローカルファイル(file://)やHTTP接続では署名検証APIが動作しません。localhostで実行するか、HTTPS環境をご利用ください。
                                            </div>
                                        ) : detailedPhotoInfo.verif.isValid ? (
                                            <div style={{ fontSize: '0.9rem' }}>
                                                <span style={{ color: 'var(--success-color)', fontWeight: 600 }}>✓ 署名が一致します。</span> タイムスタンプと画像データは改ざんされておらず本物です。
                                            </div>
                                        ) : (
                                            <div style={{ fontSize: '0.9rem' }}>
                                                <span style={{ color: 'var(--error-color)', fontWeight: 600 }}>✗ 署名が一致しません！</span> 画像データまたはタイムスタンプが改ざんされています。
                                            </div>
                                        )}
                                        <div style={{ marginTop: '0.5rem' }}>
                                            <span className="detail-label" style={{ fontSize: '0.7rem' }}>埋め込み署名</span>
                                            <div className="code-box">{toHexString(detailedPhotoInfo.verif.embeddedSigBytes)}</div>
                                        </div>
                                    </div>

                                    <div className="detail-item" style={{ opacity: 0.9 }}>
                                        <div className="detail-label">セグメント詳細</div>
                                        <div style={{ fontSize: '0.85rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 0.75rem' }}>
                                            <span style={{ color: 'var(--text-muted)' }}>メタデータバージョン:</span>
                                            <span>v{detailedPhotoInfo.verif.version}</span>
                                            <span style={{ color: 'var(--text-muted)' }}>タイムスタンプ値:</span>
                                            <span>{detailedPhotoInfo.verif.timestamp} ms</span>
                                        </div>
                                    </div>
                                </>
                            )}

                            <div className="button-group">
                                <button className="btn btn-secondary" onClick={handleReset}>別の写真を検証</button>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            <footer>
                <p>&copy; 2026 SpotLock Camera. All rights reserved.</p>
            </footer>
        </div>
    );
}
