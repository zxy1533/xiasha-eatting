/**
 * 把源文件内联成单文件 index.html。
 * 发布网关会对不带 sharecode 的静态资源请求返回 403，所以 CSS/JS 必须内联。
 * 用法：node build.js   （在 server/web 目录下）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const tpl = read('index.template.html');
const css = read('css/app.css');
// 顺序即依赖顺序：carousel 提供 ui 扩展，需在 views 之前；app 最后启动。
const jsFiles = [
  'js/api.js',
  'js/store.js',
  'js/toast.js',
  'js/components.js',
  'js/carousel.js',
  'js/views.js',
  'js/app.js',
];

const scriptTags = jsFiles.map((f) => {
  return '  <script>\n' + read(f) + '\n  </script>';
}).join('\n');

const html = tpl
  .replace('/*__CSS__*/', css)
  .replace('/*__SCRIPTS__*/', scriptTags);

fs.writeFileSync(path.join(ROOT, 'index.html'), html, 'utf8');
console.log('built index.html:', Buffer.byteLength(html), 'bytes');
console.log('scripts inlined:', jsFiles.length);
if (html.indexOf('__CSS__') >= 0 || html.indexOf('__SCRIPTS__') >= 0) {
  console.error('ERROR: unresolved placeholder left in output');
  process.exit(1);
}
