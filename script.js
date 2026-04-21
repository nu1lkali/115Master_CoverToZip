// ==UserScript==
// @name         115Master-跨页采集打包(重名提醒)
// @namespace    http://tampermonkey.net/
// @version      3.4
// @description  去掉编号还原原名，发现重名时在提示框和控制台告知
// @author       Gemini
// @match        *://115.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 全局存储清单
    let imageManifest = {};

    const CONTAINER_ID = '115master-tools-container';

    // --- 1. Toast 提示函数 ---
    function showToast(message, type = 'success', duration = 2000) {
        const toastId = '115master-toast';
        let toast = document.getElementById(toastId);
        if (!toast) {
            toast = document.createElement('div');
            toast.id = toastId;
            toast.style.cssText = `
                position: fixed; top: 20px; right: 20px; z-index: 999999;
                padding: 12px 20px; border-radius: 8px; color: #fff;
                font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                transition: opacity 0.3s, transform 0.3s; pointer-events: none;
                transform: translateY(-20px); opacity: 0;
            `;
            document.body.appendChild(toast);
        }
        toast.style.backgroundColor = type === 'success' ? '#4caf50' : (type === 'warn' ? '#ff9800' : '#f44336');
        toast.innerText = message;
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
        setTimeout(() => {
            toast.style.transform = 'translateY(-20px)';
            toast.style.opacity = '0';
        }, duration);
    }

    // --- 2. 注入 UI 界面 ---
    function injectUI() {
        const manifestLen = Object.keys(imageManifest).length;
        if (document.getElementById(CONTAINER_ID)) {
            const countEl = document.getElementById('115master-count');
            if (countEl) countEl.innerText = manifestLen;
            return;
        }
        const anchor = document.querySelector('.master-preview-switch-btn') || document.querySelector('.button.btn-line');
        if (!anchor) return;

        const container = document.createElement('div');
        container.id = CONTAINER_ID;
        container.style.cssText = 'display:inline-flex;align-items:center;margin-left:10px;gap:5px;';
        container.innerHTML = `
            <style>
                .master-btn { padding: 0 10px; height: 30px; line-height: 30px; border-radius: 4px; font-weight: bold; color: #fff; cursor: pointer; font-size: 12px; transition: all 0.2s; user-select: none; }
                #btn-add { background: #2196f3; }
                #btn-zip { background: #4caf50; }
                #btn-clear { background: #9e9e9e; }
                .master-btn:hover { opacity: 0.8; }
                .master-btn:active { transform: scale(0.95); }
                .master-count-tag { background: #fdfdfd; color: #333; padding: 2px 8px; border-radius: 10px; font-size: 11px; margin-right: 5px; border: 1px solid #ccc; }
            </style>
            <span class="master-count-tag">清单: <b id="115master-count">0</b></span>
            <div id="btn-add" class="master-btn">加入清单</div>
            <div id="btn-zip" class="master-btn">打包下载</div>
            <div id="btn-clear" class="master-btn">清空</div>
        `;
        anchor.parentElement.insertBefore(container, anchor);

        document.getElementById('btn-add').onclick = collectCurrentPage;
        document.getElementById('btn-zip').onclick = startManualZip;
        document.getElementById('btn-clear').onclick = () => {
            imageManifest = {};
            showToast('清单已清空', 'error');
        };
    }

    // --- 3. 转换函数 ---
    async function getReadyData(blobUrl) {
        try {
            const resp = await fetch(blobUrl);
            const rawBlob = await resp.blob();
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob(async b => {
                        const buffer = await b.arrayBuffer();
                        resolve(new Uint8Array(buffer));
                    }, 'image/jpeg', 0.85);
                };
                img.src = URL.createObjectURL(rawBlob);
            });
        } catch (e) { return null; }
    }

    // --- 4. 采集逻辑 (增加重名检测) ---
    async function collectCurrentPage() {
        const listItems = Array.from(document.querySelectorAll('.list-contents li'));
        const btnAdd = document.getElementById('btn-add');
        const oldText = btnAdd.innerText;

        btnAdd.innerText = "读取中...";
        btnAdd.style.pointerEvents = "none";

        let currentAdded = 0;
        let duplicateNames = [];

        for (const li of listItems) {
            let imgSrc = null;
            const divs = li.querySelectorAll('div');
            for (const d of divs) {
                if (d.shadowRoot) {
                    const img = d.shadowRoot.querySelector('img[src^="blob:"]');
                    if (img) { imgSrc = img.src; break; }
                }
            }

            if (imgSrc) {
                const rawTitle = li.getAttribute('title') || li.getAttribute('n') || 'img';
                const finalName = rawTitle.replace(/[\\/:*?"<>|]/g, '_') + '.jpg';

                // 检测是否重复
                if (imageManifest[finalName]) {
                    duplicateNames.push(finalName);
                    continue;
                }

                const fileData = await getReadyData(imgSrc);
                if (fileData) {
                    imageManifest[finalName] = fileData;
                    currentAdded++;
                }
            }
        }

        btnAdd.innerText = oldText;
        btnAdd.style.pointerEvents = "";
        document.getElementById('115master-count').innerText = Object.keys(imageManifest).length;

        // 提醒逻辑
        if (duplicateNames.length > 0) {
            console.warn(`[115Master] 发现 ${duplicateNames.length} 个重名项:`, duplicateNames);
            const msg = currentAdded > 0
                ? `新加 ${currentAdded} 张，但有 ${duplicateNames.length} 个重名已跳过`
                : `本页全部重名 (${duplicateNames.length}个)，未添加`;
            showToast(msg, 'warn', 3000);
        } else if (currentAdded > 0) {
            showToast(`成功添加 ${currentAdded} 张图片`);
        } else {
            showToast('未发现新图片', 'error');
        }
    }

    // --- 5. 打包逻辑 ---
    async function startManualZip() {
        const manifestKeys = Object.keys(imageManifest);
        if (manifestKeys.length === 0) {
            showToast('清单是空的', 'error');
            return;
        }
        const btn = document.getElementById('btn-zip');
        const oldText = btn.innerText;
        btn.innerText = '封包中...';

        let zipParts = [];
        let centralDirectory = [];
        let offset = 0;
        const encoder = new TextEncoder();

        try {
            for (const fileName of manifestKeys) {
                const fileNameBuf = encoder.encode(fileName);
                const data = imageManifest[fileName];
                const size = data.length;

                const lfh = new Uint8Array(30 + fileNameBuf.length);
                lfh.set([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                lfh.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff], 18);
                lfh.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff], 22);
                lfh.set([fileNameBuf.length & 0xff, (fileNameBuf.length >> 8) & 0xff], 26);
                lfh.set(fileNameBuf, 30);
                zipParts.push(lfh, data);

                const cdh = new Uint8Array(46 + fileNameBuf.length);
                cdh.set([0x50, 0x4b, 0x01, 0x02, 0x14, 0x00, 0x0a, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                cdh.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff], 20);
                cdh.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff], 24);
                cdh.set([fileNameBuf.length & 0xff, (fileNameBuf.length >> 8) & 0xff], 28);
                cdh.set([offset & 0xff, (offset >> 8) & 0xff, (offset >> 16) & 0xff, (offset >> 24) & 0xff], 42);
                cdh.set(fileNameBuf, 46);
                centralDirectory.push(cdh);

                offset += lfh.length + data.length;
            }

            const cdSize = centralDirectory.reduce((acc, v) => acc + v.length, 0);
            const eocd = new Uint8Array(22);
            eocd.set([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00]);
            const num = centralDirectory.length;
            eocd.set([num & 0xff, (num >> 8) & 0xff], 8);
            eocd.set([num & 0xff, (num >> 8) & 0xff], 10);
            eocd.set([cdSize & 0xff, (cdSize >> 8) & 0xff, (cdSize >> 16) & 0xff, (cdSize >> 24) & 0xff], 12);
            eocd.set([offset & 0xff, (offset >> 8) & 0xff, (offset >> 16) & 0xff, (offset >> 24) & 0xff], 16);

            const finalBlob = new Blob([...zipParts, ...centralDirectory, eocd], {type: "application/zip"});
            const a = document.createElement('a');
            a.href = URL.createObjectURL(finalBlob);
            a.download = `115_NativePack_${Date.now()}.zip`;
            a.click();
            showToast('下载已开始');
        } catch (e) {
            showToast('打包失败', 'error');
        } finally {
            btn.innerText = oldText;
        }
    }

    setInterval(injectUI, 1000);
})();
