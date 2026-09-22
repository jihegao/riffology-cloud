import {readFile} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
const root=new URL('../',import.meta.url),files=['services/web/index.html','services/web/admin.html'];
const source=await readFile(new URL('../services/web/i18n.js',import.meta.url),'utf8');
for(const file of files){const html=await readFile(new URL('../'+file,import.meta.url),'utf8');for(const key of Array.from(html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g),match=>match[1])){assert.match(source,new RegExp(`['\"]${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}['\"]`),`${file} uses an untranslated key: ${key}`);}}
console.log('i18n shared-shell key coverage passed');
