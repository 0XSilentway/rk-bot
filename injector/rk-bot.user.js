// ==UserScript==
// @name         rk-bot injector
// @namespace    rk-bot
// @version      0.1.0
// @description  WS proxy for rayrag Unity WebGL — pipes raw frames to local bot relay
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
  const outbox = []; // queue while relay disconnected

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
        // Phase 1: relay does not inject yet. Reserved for Phase 5+.
        console.log('[rk-bot] relay cmd (ignored in phase 1)', ev.data);
      });
    } catch (e) {
      console.warn('[rk-bot] relay connect failed', e);
      setTimeout(connectRelay, RECONNECT_MS);
    }
  };
  connectRelay();

  // --- WebSocket proxy ---
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
    if (data instanceof Blob) {
      return { kind: 'blob-pending', size: data.size, type: data.type };
    }
    return { kind: 'unknown', data: String(data) };
  };

  let wsId = 0;
  window.WebSocket = new Proxy(OrigWS, {
    construct(target, args) {
      const id = ++wsId;
      const url = args[0];
      console.log('[rk-bot] WS open', id, url);
      emit({ t: 'ws-open', id, url, ts: Date.now() });

      const ws = new target(...args);
      const origSend = ws.send.bind(ws);
      ws.send = data => {
        emit({ t: 'ws-send', id, ts: Date.now(), ...encodeFrame(data) });
        return origSend(data);
      };
      ws.addEventListener('message', async e => {
        let payload = e.data;
        if (payload instanceof Blob) {
          payload = await payload.arrayBuffer();
        }
        emit({ t: 'ws-recv', id, ts: Date.now(), ...encodeFrame(payload) });
      });
      ws.addEventListener('close', ev => {
        emit({ t: 'ws-close', id, code: ev.code, reason: ev.reason, ts: Date.now() });
      });
      return ws;
    }
  });

  console.log('%c[rk-bot] injector loaded — Phase 1 (observe only)', 'color:#0ff;font-weight:bold');
})();
