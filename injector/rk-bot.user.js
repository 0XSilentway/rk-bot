// ==UserScript==
// @name         rk-bot injector
// @namespace    rk-bot
// @version      0.3.0
// @description  WS proxy + injector for rayrag Unity WebGL — pipes raw frames to local bot relay and injects commands back
// @match        https://websea01.rayrag.com/*
// @match        https://*.rayrag.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const RELAY_URL = 'ws://localhost:9000';
  const RECONNECT_MS = 2000;

  let relay = null;
  let relayReady = false;
  const outbox = [];
  const wsByPageId = new Map(); // page-side ws id -> real WebSocket

  const flush = () => {
    if (!relayReady) return;
    while (outbox.length) relay.send(JSON.stringify(outbox.shift()));
  };
  const emit = obj => {
    outbox.push(obj);
    if (outbox.length > 10_000) outbox.splice(0, outbox.length - 10_000);
    flush();
  };

  const connectRelay = () => {
    try {
      relay = new WebSocket(RELAY_URL);
      relay.binaryType = 'arraybuffer';
      relay.addEventListener('open', () => {
        relayReady = true;
        console.log('%c[rk-bot] relay connected', 'color:#0f0;font-weight:bold');
        emit({ t: 'hello', ua: navigator.userAgent, href: location.href, ts: Date.now() });
        flush();
      });
      relay.addEventListener('close', () => {
        relayReady = false;
        console.warn('[rk-bot] relay closed, retry in', RECONNECT_MS, 'ms');
        setTimeout(connectRelay, RECONNECT_MS);
      });
      relay.addEventListener('error', e => console.warn('[rk-bot] relay error', e));
      relay.addEventListener('message', ev => {
        let cmd;
        try { cmd = JSON.parse(ev.data); } catch { return; }
        if (cmd.t === 'inject') {
          const target = wsByPageId.get(cmd.wsId);
          if (!target || target.readyState !== 1) {
            console.warn('[rk-bot] inject skipped: ws not open', cmd.wsId);
            return;
          }
          try {
            const bin = atob(cmd.data);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            target.send(u8.buffer);
          } catch (e) {
            console.warn('[rk-bot] inject decode failed', e);
          }
        }
      });
    } catch (e) {
      console.warn('[rk-bot] relay connect failed', e);
      setTimeout(connectRelay, RECONNECT_MS);
    }
  };
  connectRelay();

  // ---------------- WebSocket proxy ----------------
  const OrigWS = window.WebSocket;
  const encodeFrame = data => {
    if (typeof data === 'string') return { kind: 'text', data };
    if (data instanceof ArrayBuffer) {
      return { kind: 'binary', data: btoa(String.fromCharCode(...new Uint8Array(data))) };
    }
    if (ArrayBuffer.isView(data)) {
      const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return { kind: 'binary', data: btoa(String.fromCharCode(...u8)) };
    }
    if (data instanceof Blob) return { kind: 'blob-pending', size: data.size, type: data.type };
    return { kind: 'unknown', data: String(data) };
  };

  let wsId = 0;
  window.WebSocket = new Proxy(OrigWS, {
    construct(target, args) {
      const url = args[0];
      // don't recursively proxy our own relay connection
      if (typeof url === 'string' && url.startsWith(RELAY_URL)) {
        return new target(...args);
      }
      const id = ++wsId;
      console.log('[rk-bot] WS open', id, url);
      emit({ t: 'ws-open', id, url, ts: Date.now() });

      const ws = new target(...args);
      wsByPageId.set(id, ws);
      const origSend = ws.send.bind(ws);
      ws.send = data => {
        emit({ t: 'ws-send', id, ts: Date.now(), ...encodeFrame(data) });
        return origSend(data);
      };
      ws.addEventListener('message', async e => {
        let payload = e.data;
        if (payload instanceof Blob) payload = await payload.arrayBuffer();
        emit({ t: 'ws-recv', id, ts: Date.now(), ...encodeFrame(payload) });
      });
      ws.addEventListener('close', ev => {
        emit({ t: 'ws-close', id, code: ev.code, reason: ev.reason, ts: Date.now() });
        wsByPageId.delete(id);
      });
      return ws;
    }
  });

  console.log('%c[rk-bot] injector loaded v0.3 (Phase 3+4)', 'color:#0ff;font-weight:bold');
})();
