/*!
 * Harvey UI — hui.js
 * Frontend templating engine. Loads .hui template files into <hui> tags.
 *
 * Homepage : https://harveyui.rth1.xyz
 * License  : Available License (https://license.kscm.top/available.md)
 *
 * 中文: 前端模板化引擎，通过 <hui src="..."> 标签把 .hui 模板渲染进页面，
 *       支持待填项(placeholder)与直连 JavaScript(事件="js:路径:函数()")。
 */
(function (global) {
  'use strict';

  var HUI_DECL = /^<is\s+harvey>/i;
  var STYLE_ID_PREFIX = 'hui-style-';
  var styleCount = 0;
  var codeCache = {};

  // Native DOM events that Harvey UI treats as direct-JS / raw-JS binding candidates.
  // 原生事件名 -> 1。文档示例用裸事件名（如 click），而非 on* 形式。
  var NATIVE_EVENTS = {
    click: 1, dblclick: 1, mousedown: 1, mouseup: 1, mousemove: 1,
    mouseenter: 1, mouseleave: 1, mouseover: 1, mouseout: 1,
    contextmenu: 1, wheel: 1, keydown: 1, keyup: 1, keypress: 1,
    input: 1, change: 1, submit: 1, reset: 1, focus: 1, blur: 1,
    load: 1, error: 1, scroll: 1, drag: 1, dragstart: 1, dragend: 1,
    drop: 1, touchstart: 1, touchend: 1, touchmove: 1
  };

  // Attributes reserved by the engine (never treated as placeholder fills).
  var RESERVED = { src: 1 };

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  function cssEscape(s) {
    if (global.CSS && global.CSS.escape) return global.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function unquote(s) {
    s = String(s).trim();
    if ((s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') ||
        (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'")) {
      return s.slice(1, -1);
    }
    return s;
  }

  // Split `key="value"; key2="value2"` respecting quoted strings (handles ; and newlines).
  function splitAssignments(text) {
    var out = [], cur = '', inStr = false, q = '';
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inStr) {
        cur += c;
        if (c === q) inStr = false;
      } else if (c === '"' || c === "'") {
        inStr = true; q = c; cur += c;
      } else if (c === ';' || c === '\n' || c === '\r') {
        if (cur.trim()) out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    if (cur.trim()) out.push(cur);
    return out;
  }

  // Parse inline fills written between <hui> and </hui> (e.g. text="张三";text2="...").
  function parseInlineFills(innerText) {
    var map = {}, entries = splitAssignments(innerText || '');
    for (var i = 0; i < entries.length; i++) {
      var eq = entries[i].indexOf('=');
      if (eq === -1) continue;
      var key = entries[i].slice(0, eq).trim();
      var val = unquote(entries[i].slice(eq + 1));
      if (key && /^[\w-]+$/.test(key)) map[key] = val;
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Parsing (.hui content -> structured object)
  // ---------------------------------------------------------------------------
  function parseHui(content) {
    if (typeof content !== 'string') {
      throw new Error('HUI: .hui content must be a string.');
    }
    var trimmed = content.replace(/^﻿/, '').trim();
    if (!HUI_DECL.test(trimmed)) {
      throw new Error('HUI: missing "<is harvey>" declaration at the top of the .hui file.');
    }
    // 禁止套娃: .hui 文件内不得出现 <hui> 标签。
    if (/<hui[\s>\/]/i.test(content)) {
      throw new Error('HUI: ".hui cannot be nested!" A <hui> tag was found inside the .hui file.');
    }

    // <style> blocks
    var style = '', styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi, m;
    while ((m = styleRe.exec(content)) !== null) style += m[1] + '\n';

    // <body>...</body>
    var bodyRe = /<body[^>]*>([\s\S]*?)<\/body>/i;
    var bodyMatch = bodyRe.exec(content);
    var body;
    if (bodyMatch) {
      body = bodyMatch[1];
    } else {
      // 嵌套语法可能省略 <body> 包裹：取 <is harvey> 之后、<style> 之外的内容。
      body = content.replace(/<is\s+harvey>/i, '').replace(styleRe, '').trim();
    }

    var placeholders = detectPlaceholders(body);
    return { valid: true, style: style, body: body, placeholders: placeholders };
  }

  // Detect placeholders: elements with an `id` and empty text content.
  function detectPlaceholders(bodyHtml) {
    var tmp = document.createElement('div');
    tmp.innerHTML = bodyHtml;
    var found = [], all = tmp.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.id && el.textContent.trim() === '') found.push(el.id);
    }
    return found;
  }

  // ---------------------------------------------------------------------------
  // JS loading / execution
  // ---------------------------------------------------------------------------
  function loadCode(path) {
    if (codeCache[path]) return Promise.resolve(codeCache[path]);
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error('HUI: failed to load JS "' + path + '" (' + r.status + ')');
      return r.text();
    }).then(function (t) { codeCache[path] = t; return t; });
  }

  // Append classic script -> runs in global scope (top-level function declarations become global).
  function runGlobal(code) {
    var s = document.createElement('script');
    s.textContent = code;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------------
  // Event binding
  // ---------------------------------------------------------------------------
  // 格式A: js:path/file.js:funcName()  -> 加载脚本并调用函数
  // 格式B: js:path/file.js             -> 触发时运行文件全部代码
  function bindJsEvent(el, eventName, value) {
    var rest = value.slice(3); // strip "js:"
    var path, func = null;
    var lastColon = rest.lastIndexOf(':');
    if (lastColon > -1) {
      var maybe = rest.slice(lastColon + 1).trim();
      if (/^[A-Za-z_$][\w$]*\(\)?$/.test(maybe)) {
        path = rest.slice(0, lastColon);
        func = maybe.replace(/\(\)\s*$/, '');
      } else {
        path = rest; // 冒号属于路径（如 http://），整体当作路径
      }
    } else {
      path = rest;
    }

    var handler = function () {
      loadCode(path).then(function (code) {
        runGlobal(code);
        if (func) {
          var fn = global[func];
          if (typeof fn === 'function') fn();
          else console.error('HUI: function "' + func + '" not found in ' + path);
        }
      }).catch(function (e) { console.error(e); });
    };
    el.addEventListener(eventName, handler);
  }

  // 格式C（官方不推荐）: 裸 JS，如 btn.addEventListener('click', () => {...})
  function bindRawEvent(el, eventName, value) {
    var fn;
    try { fn = new Function('btn', 'el', value); }
    catch (e) { console.error('HUI: invalid raw event JS:', e); return; }
    el.addEventListener(eventName, function () {
      try { fn.call(el, el, el); }
      catch (e) { console.error('HUI raw event error:', e); }
    });
  }

  // ---------------------------------------------------------------------------
  // Render a single <hui> element
  // ---------------------------------------------------------------------------
  function processElement(huiEl) {
    if (!huiEl || huiEl.__huiProcessed) return Promise.resolve();
    huiEl.__huiProcessed = true;

    var src = huiEl.getAttribute('src');
    if (!src) {
      console.error('HUI: <hui> missing src attribute.');
      return Promise.resolve();
    }

    return fetch(src).then(function (r) {
      if (!r.ok) throw new Error('HUI: failed to load "' + src + '" (' + r.status + ')');
      return r.text();
    }).then(function (content) {
      var parsed = parseHui(content);

      var container = document.createElement('div');
      container.className = 'hui-rendered';
      container.innerHTML = parsed.body;

      // 1) Build fill map: inline content first, then tag attributes override.
      var fills = parseInlineFills(huiEl.textContent);
      for (var i = 0; i < huiEl.attributes.length; i++) {
        var a = huiEl.attributes[i];
        if (RESERVED[a.name] || a.value.indexOf('js:') === 0 || NATIVE_EVENTS[a.name]) continue;
        if (parsed.placeholders.indexOf(a.name) !== -1) fills[a.name] = a.value;
      }

      // 2) Apply fills (plain text -> textContent, safe & predictable).
      parsed.placeholders.forEach(function (id) {
        if (fills[id] === undefined) return;
        var node = container.querySelector('#' + cssEscape(id));
        if (node) node.textContent = fills[id];
      });

      // 3) Inject <style>.
      if (parsed.style) {
        var st = document.createElement('style');
        st.id = STYLE_ID_PREFIX + (++styleCount);
        st.textContent = parsed.style;
        document.head.appendChild(st);
      }

      // 4) Bind events.
      for (var j = 0; j < huiEl.attributes.length; j++) {
        var ev = huiEl.attributes[j];
        if (ev.value.indexOf('js:') === 0) bindJsEvent(container, ev.name, ev.value);
        else if (NATIVE_EVENTS[ev.name]) bindRawEvent(container, ev.name, ev.value);
      }

      // 5) Replace the <hui> element with the rendered container.
      if (huiEl.parentNode) huiEl.parentNode.replaceChild(container, huiEl);
      return container;
    }).catch(function (err) {
      console.error(err);
      var box = document.createElement('pre');
      box.className = 'hui-error';
      box.style.color = '#e00';
      box.textContent = '[Harvey UI] ' + err.message;
      if (huiEl.parentNode) huiEl.parentNode.replaceChild(box, huiEl);
    });
  }

  // Scan and render every <hui> tag in `root` (default: document).
  function processAll(root) {
    root = root || document;
    var nodes = root.querySelectorAll('hui');
    var list = Array.prototype.slice.call(nodes);
    return Promise.all(list.map(processElement));
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  var api = {
    version: '1.0.0',
    parseHui: parseHui,
    processElement: processElement,
    processAll: processAll
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.HarveyUI = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { processAll(document); });
    } else {
      processAll(document);
    }
  }
})(typeof window !== 'undefined' ? window : this);