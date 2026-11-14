// The Feynman marks on a heading (feynman.js) and what tag code does with them.
// Run with:  node --test web_src/src/feynman.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { setFeynmanMarks, readFeynman, feynmanTip, feynmanDateStamp, micLabel } from './feynman.js'
import { tagMarksIn, addTagMarks, stripTagMarks } from './qbankTags.js'

const ANCHOR = '<!--ap:11111111-1111-1111-1111-111111111111-->'

test('marks go before the anchor, after question tags', () => {
  const line = setFeynmanMarks(`## HFrEF<!--uw::3252-->${ANCHOR}`, '11_13_2026', 66.7)
  assert.equal(line, `## HFrEF<!--uw::3252--><!--LastFeynmanDate::11_13_2026--><!--LastFeynmanScore::67%-->${ANCHOR}`)
})

test('a new session replaces the last one', () => {
  const once = setFeynmanMarks('## HFrEF', '11_13_2026', 50)
  const twice = setFeynmanMarks(once, '11_14_2026', 100)
  assert.equal(twice, '## HFrEF<!--LastFeynmanDate::11_14_2026--><!--LastFeynmanScore::100%-->')
})

test('read back with a readable date and the tooltip', () => {
  const info = readFeynman('## x<!--LastFeynmanDate::11_13_2026--><!--LastFeynmanScore::52%-->')
  assert.deepEqual(info, { score: 52, date: 'Nov 13, 2026', stamp: '11_13_2026' })
  assert.equal(feynmanTip(info), 'On your last recorded Feynman response (Nov 13, 2026), you scored 52%.')
  assert.equal(readFeynman('## x'), null)
})

test('date stamp is month_day_year', () => {
  assert.equal(feynmanDateStamp(new Date(2026, 0, 5)), '01_05_2026')
})

test('tag code never treats them as tags, and keeps them', () => {
  const line = '## HFrEF<!--uw::3252--><!--LastFeynmanDate::11_13_2026--><!--LastFeynmanScore::67%-->'
  assert.deepEqual(tagMarksIn(line), ['uw::3252'])
  assert.equal(addTagMarks(line, ['uw::4410']),
    '## HFrEF<!--uw::3252,4410--><!--LastFeynmanDate::11_13_2026--><!--LastFeynmanScore::67%-->')
  assert.equal(stripTagMarks(line), '## HFrEF')
})

test('microphone names: AirPods get their full name, the default says so', () => {
  const mac = ['Trevor Thompson’s AirPods Max', 'MacBook Pro Microphone', 'AudioBox USB 96']
  assert.equal(micLabel('AirPods', mac), 'Trevor Thompson’s AirPods Max')
  assert.equal(micLabel('- AirPods', mac, true), 'System default (Trevor Thompson’s AirPods Max)')
  assert.equal(micLabel('Default - MacBook Pro Microphone (Built-in)', mac, true), 'System default (MacBook Pro Microphone (Built-in))')
  assert.equal(micLabel('AudioBox USB 96 (194f:0303)', mac), 'AudioBox USB 96 (194f:0303)')
  // Two AirPods connected: can't tell which, so the short name stays.
  assert.equal(micLabel('AirPods', ['A’s AirPods Max', 'B’s AirPods Pro']), 'AirPods')
  assert.equal(micLabel('AirPods', []), 'AirPods')
  assert.equal(micLabel('', [], true), 'System default (microphone)')
})
