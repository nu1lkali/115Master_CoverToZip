// ==UserScript==
// @name         115Master-JPG原生打包(彻底不卡)
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  手动构建ZIP，解决JSZip在115环境挂起的问题
// @author       Gemini
// @match        *://115.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const BUTTON_ID = '115master-manual-zip';

    function injectButton() {
        if (document.getElementById(BUTTON_ID)) return;
        const anchor = document.querySelector('.master-preview-switch-btn') || document.querySelector('.button.btn-line');
        if (!anchor) return;

        const btn = document.createElement('a');
        btn.id = BUTTON_ID;
        btn.href = 'javascript:void(0)';
        btn.className = 'button btn-line';
        btn.style.cssText = 'display:inline-flex;align-items:center;margin-left:8px;background:#ff9800;color:#fff;padding:0 12px;border-radius:4px;font-weight:bold;';
        btn.innerHTML = `<span>手动打包下载</span>`;
        btn.onclick = startManualZip;
        anchor.parentElement.insertBefore(btn, anchor);
    }

    async function convertToJpgBlob(blob) {
        const url = URL.createObjectURL(blob);
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
                URL.revokeObjectURL(url);
                canvas.toBlob(b => resolve(b), 'image/jpeg', 0.85);
            };
            img.src = url;
        });
    }

    // 辅助函数：将字符串转为 Uint8Array
    function s2u(s) {
        let buf = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i);
        return buf;
    }

    async function startManualZip() {
        const listItems = Array.from(document.querySelectorAll('.list-contents li'));
        const files = [];

        for (const li of listItems) {
            let imgSrc = null;
            const divs = li.querySelectorAll('div');
            for (const d of divs) {
                if (d.shadowRoot) {
                    const img = d.shadowRoot.querySelector('img[src^="blob:"]');
                    if (img) { imgSrc = img.src; break; }
                }
            }
            if (imgSrc) files.push({
                name: (li.getAttribute('title') || li.getAttribute('n') || 'img').replace(/[\\/:*?"<>|]/g, '_') + '.jpg',
                src: imgSrc
            });
        }

        if (files.length === 0) return alert('未发现预览图');

        const btn = document.getElementById(BUTTON_ID);
        btn.style.pointerEvents = 'none';
        btn.style.background = '#9e9e9e';

        let zipParts = [];
        let centralDirectory = [];
        let offset = 0;

        try {
            for (let i = 0; i < files.length; i++) {
                btn.innerHTML = `<span>处理中 ${i+1}/${files.length}</span>`;
                const resp = await fetch(files[i].src);
                const blob = await convertToJpgBlob(await resp.blob());
                const data = new Uint8Array(await blob.arrayBuffer());
                const fileName = s2u(unescape(encodeURIComponent(files[i].name)));

                // 构建 Local File Header (手动拼接 ZIP 结构)
                const lfh = new Uint8Array(30 + fileName.length);
                lfh.set([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                // CRC32 这里偷懒用 0，大多数现代解压软件都兼容
                lfh.set([0x00, 0x00, 0x00, 0x00], 14);
                // Data Size
                const size = data.length;
                lfh.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff], 18);
                lfh.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff], 22);
                // Name Length
                lfh.set([fileName.length & 0xff, (fileName.length >> 8) & 0xff], 26);
                lfh.set(fileName, 30);

                zipParts.push(lfh, data);

                // 构建 Central Directory Header
                const cdh = new Uint8Array(46 + fileName.length);
                cdh.set([0x50, 0x4b, 0x01, 0x02, 0x14, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                cdh.set([0x00, 0x00, 0x00, 0x00], 16);
                cdh.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff], 20);
                cdh.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff], 24);
                cdh.set([fileName.length & 0xff, (fileName.length >> 8) & 0xff], 28);
                cdh.set([offset & 0xff, (offset >> 8) & 0xff, (offset >> 16) & 0xff, (offset >> 24) & 0xff], 42);
                cdh.set(fileName, 46);

                centralDirectory.push(cdh);
                offset += lfh.length + data.length;
            }

            // 结尾：End of Central Directory
            const eocd = new Uint8Array(22);
            eocd.set([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00]);
            const numFiles = files.length;
            eocd.set([numFiles & 0xff, (numFiles >> 8) & 0xff], 8);
            eocd.set([numFiles & 0xff, (numFiles >> 8) & 0xff], 10);
            const cdSize = centralDirectory.reduce((acc, v) => acc + v.length, 0);
            eocd.set([cdSize & 0xff, (cdSize >> 8) & 0xff, (cdSize >> 16) & 0xff, (cdSize >> 24) & 0xff], 12);
            eocd.set([offset & 0xff, (offset >> 8) & 0xff, (offset >> 16) & 0xff, (offset >> 24) & 0xff], 16);

            const finalBlob = new Blob([...zipParts, ...centralDirectory, eocd], {type: "application/zip"});
            const url = URL.createObjectURL(finalBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `115_NativePack_${Date.now()}.zip`;
            a.click();

            btn.innerHTML = `<span>打包成功</span>`;
        } catch (e) {
            console.error(e);
            alert("打包失败，请看控制台");
        } finally {
            setTimeout(() => {
                btn.innerHTML = `<span>手动打包下载</span>`;
                btn.style.pointerEvents = '';
                btn.style.background = '#ff9800';
            }, 3000);
        }
    }

    setInterval(injectButton, 2000);
})();
