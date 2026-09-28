const test = require('node:test');
const assert = require('node:assert/strict');
const { renderReport } = require('../main/generation-service');

test('report highlights are short, separated, emphasized, and escaped', () => {
  const html = renderReport({
    report:{ title:'Test report', executive_summary:'A long unstructured model summary should not dominate the page.', sections:[{ title:'Agents', items:[
      { headline:'First <signal>', summary:'Important result. Secondary detail that belongs in the full item.', source_ids:['S1'] },
      { headline:'Second signal', summary:'Another result.', source_ids:['S1'] }
    ] }] },
    sources:[{ id:'S1', url:'https://example.org/paper', source:'Research', title:'Paper', publishedAt:'2026-09-24' }],
    model:'glm-5.3', generatedAt:'2026-09-24', collection:{}
  });
  assert.match(html,/<section class="highlights"><h2>本期要点<\/h2><ul>/);
  assert.match(html,/<li class="key-point"><small>Agents<\/small><strong>First &lt;signal&gt;<\/strong><span>Important result\.<\/span><\/li>/);
  assert.match(html,/<li class="key-point"><small>Agents<\/small><strong>Second signal<\/strong>/);
  assert.doesNotMatch(html,/A long unstructured model summary/);
  assert.match(html,/<section data-topic-id=""><h2>Agents<\/h2>/);
});

test('new English reports use English document labels', () => {
  const html = renderReport({
    report:{ title:'AI Daily', sections:[{ title:'Agents', items:[{ headline:'New checkpoint API', summary:'The runtime now stores recovery points.', source_ids:['S1'] }] }] },
    sources:[{ id:'S1', url:'https://example.org/news', source:'Vendor', title:'News', publishedAt:'2026-09-24' }],
    model:'glm-5.3', generatedAt:'2026-09-24', collection:{}, language:'en-US'
  });
  assert.match(html,/<html lang="en">/);
  assert.match(html,/<h2>Key takeaways<\/h2>/);
  assert.match(html,/<h2>Original sources<\/h2>/);
  assert.doesNotMatch(html,/本期要点|原始来源|为什么重要/);
});
