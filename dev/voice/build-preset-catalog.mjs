import fs from 'node:fs/promises';
import path from 'node:path';

const [malePath, femalePath, addendumPath, outputPath] = process.argv.slice(2);
if (![malePath, femalePath, addendumPath, outputPath].every(Boolean)) {
  throw new Error('Usage: node build-preset-catalog.mjs <male.md> <female.md> <male-addendum.md> <output.json>');
}

const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clean = value => value.replaceAll('**', '').replaceAll('`', '').trim();
const number = value => Number(String(value).replace(/[+*]/g, '').trim());

function tableAfter(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing table marker: ${marker}`);
  const lines = source.slice(start).split(/\r?\n/).filter(line => line.startsWith('|'));
  const width = lines[0].split('|').length;
  return lines.slice(0, lines.findIndex((line, index) => index > 1 && line.split('|').length !== width));
}

function parseParameters(source, marker) {
  const lines = tableAfter(source, marker);
  const names = lines[0].split('|').slice(2, -1).map(clean);
  const records = Object.fromEntries(names.map(name => [name, {}]));
  for (const line of lines.slice(2)) {
    const cells = line.split('|').slice(1, -1).map(clean);
    const axis = cells.shift();
    cells.forEach((cell, index) => {
      const match = cell.match(/([+-]?\d+)\s*\[([+-]?\d+)…([+-]?\d+)\]/u);
      if (!match) throw new Error(`Invalid parameter cell: ${axis} / ${cell}`);
      records[names[index]][axis] = Object.freeze({ value: number(match[1]), min: number(match[2]), max: number(match[3]) });
    });
  }
  return records;
}

function parseSelector(source, marker) {
  const lines = tableAfter(source, marker);
  const rows = {};
  for (const line of lines.slice(2)) {
    const cells = line.split('|').slice(1, -1).map(clean);
    const [name, descriptionEn, tagsEn, descriptionTh, tagsTh, age] = cells;
    rows[name] = {
      description: { en: descriptionEn, th: descriptionTh },
      tags: { en: tagsEn.split('·').map(value => value.trim()), th: tagsTh.split('·').map(value => value.trim()) },
      apparentAge: age,
    };
  }
  return rows;
}

const [male, female, addendum] = await Promise.all([malePath, femalePath, addendumPath].map(file => fs.readFile(file, 'utf8')));
const maleParameters = parseParameters(male, '| Parameter | Soft Youth |');
const femaleParameters = parseParameters(female, '| Parameter | Gentle Soft |');
const maleSelector = parseSelector(male, '| Preset | English | English tags | Thai |');
const femaleSelector = parseSelector(female, '| Preset | English one-line description | EN tags |');

maleSelector['Clever Charmer'] = {
  description: { en: 'Warm, clever and socially agile, with relaxed confidence and a playful edge that never becomes cartoonish.', th: 'อบอุ่น ฉลาด ไหวพริบดี มั่นใจแบบสบายๆ และขี้เล่นอย่างมีชั้นเชิงโดยไม่กลายเป็นเสียงการ์ตูน' },
  tags: { en: ['Clever', 'Warm', 'Charming'], th: ['ฉลาด', 'อบอุ่น', 'มีเสน่ห์'] },
  apparentAge: '22–34',
};
maleParameters['Clever Charmer'] = {};
for (const line of tableAfter(addendum, '| `PITCH_CENTER` | **+4** |').slice(0, 18)) {
  const cells = line.split('|').slice(1, -1).map(clean);
  const match = cells.slice(1, 4).map(number);
  maleParameters['Clever Charmer'][cells[0]] = { value: match[0], min: match[1], max: match[2] };
}

const preview = {
  en: 'I am here. Take your time, and tell me what happened from the beginning.',
  ja: 'ここにいるよ。焦らなくていいから、最初からゆっくり話して。',
};
const rows = [];
for (const [family, selector, parameters] of [['male', maleSelector, maleParameters], ['female', femaleSelector, femaleParameters]]) {
  let order = 0;
  for (const [name, presentation] of Object.entries(selector)) {
    rows.push({
      id: `${family}-${slug(name)}`,
      family,
      order: ++order,
      name,
      ...presentation,
      preview,
      parameters: parameters[name],
      baseProfile: family === 'male' ? 'tmrw-male-core' : 'tmrw-female-core',
    });
  }
}

const catalog = {
  schema: 'tmrw-voice-presets-v1',
  version: 1,
  stableVariation: 'sha256(presetId + characterInstanceId + schemaVersion)',
  languages: ['en', 'ja'],
  presets: rows,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`Wrote ${rows.length} presets to ${outputPath}`);
