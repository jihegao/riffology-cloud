import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PROJECT_VIEW_FRAME_HTML,PROJECT_VIEW_FRAME_SHA256} from '../../services/project-views/frame.mjs';
import {generatedProjectViewFrameModule,projectViewFrameHtml} from '../../scripts/m3/build-project-view-frame.mjs';

test('checked-in frame bytes match the readable bootstrap source and exact declared digest',async()=>{
 assert.equal(await readFile(new URL('../../services/project-views/frame-html.mjs',import.meta.url),'utf8'),generatedProjectViewFrameModule());
 assert.equal(PROJECT_VIEW_FRAME_HTML,projectViewFrameHtml());
 assert.equal(createHash('sha256').update(PROJECT_VIEW_FRAME_HTML).digest('hex'),PROJECT_VIEW_FRAME_SHA256);
});
