import { createPreviewIcon } from './app-icons.mjs';

const el = (document, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const icon = (document, name, size) => createPreviewIcon({ document, name, size });
import { renderAppEmptyState, renderInlineNotice } from './app-empty-state.mjs';
const emptyState = (document, text) => renderAppEmptyState({ document, app: 'health', title: text, compact: true });

function latestByMetric(items) { const map = new Map(); for (const item of items || []) if (!map.has(item.metric)) map.set(item.metric, item); return map; }

export function renderHealth({ document, items = [], activeTab = 'summary', authorizationGranted = true, error = null }) {
  const root = el(document, 'section'); root.className = 'tmrw-v3-health';
  if (!authorizationGranted) { root.append(emptyState(document, 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); return root; }
  if (error) { root.append(renderInlineNotice({ document, tone:'error', title:'เปิด Health ยังไม่สำเร็จ', detail:'ข้อมูลเดิมยังอยู่ ลองกลับเข้ามาใหม่อีกครั้ง' })); return root; }
  const byMetric = latestByMetric(items);
  const steps = byMetric.get('steps') || null;

  const heading = el(document, 'section'); heading.className = 'tmrw-phone-health-heading'; heading.append(el(document, 'h1', 'วันนี้'), el(document, 'time', items[0]?.observedAt || 'ยังไม่มีเวลาที่บันทึก')); root.append(heading);

  const observation = metric => byMetric.get(metric) || null;
  const metricValue = (metric, fallback = '—') => observation(metric) ? String(Number(observation(metric).value)) : fallback;
  const metricUnit = (metric, fallback = '') => observation(metric)?.unit || fallback;
  const realList = metrics => { const list=el(document,'div');list.className='tmrw-phone-health-list';for(const [metric,label,iconName] of metrics){const row=el(document,'button');row.type='button';row.disabled=true;row.dataset.healthMetric=metric;const mark=el(document,'i');mark.append(icon(document,iconName,19));const copy=el(document,'span');const item=observation(metric);copy.append(el(document,'strong',label),el(document,'small',item?`${Number(item.value)} ${item.unit||''}${item.observedAt?` · ${item.observedAt}`:''}`:'ยังไม่มีข้อมูล'));row.append(mark,copy);list.append(row);}return list;};

  if (activeTab === 'activity') {
    const focus=el(document,'section');focus.className='tmrw-phone-health-focus';const mark=el(document,'i');mark.append(icon(document,'runner',30));const copy=el(document,'span');copy.append(el(document,'small','กิจกรรมวันนี้'),el(document,'strong',observation('exercise-minutes')?`${metricValue('exercise-minutes')} ${metricUnit('exercise-minutes','นาที')}`:'—'),el(document,'em',steps?`${Number(steps.value).toLocaleString()} ${steps.unit||'steps'}`:'ยังไม่มีข้อมูลก้าว'));focus.append(mark,copy);root.append(focus);
    const trend=el(document,'section');trend.className='tmrw-phone-health-trend is-large';const h=el(document,'header');h.append(el(document,'h2','การเคลื่อนไหว 7 วัน'),el(document,'small','ยังไม่มีข้อมูลสรุปรายสัปดาห์'));trend.append(h);const bars=el(document,'div');bars.className='tmrw-phone-health-bars';for(const day of ['จ','อ','พ','พฤ','ศ','ส','อา']){const span=el(document,'span');const bar=el(document,'i');bar.style.height='0%';span.append(bar,el(document,'small',day));bars.append(span);}trend.append(bars,emptyState(document,'ไม่สร้างแนวโน้มจากข้อมูลที่ไม่มีอยู่จริง'));root.append(trend,realList([['steps','ก้าว','runner'],['calories','พลังงานที่ใช้','flame'],['exercise-minutes','เวลาออกกำลัง','runner']]));return root;
  }

  if (activeTab === 'sleep') {
    const sleep=observation('sleep-minutes');const card=el(document,'section');card.className='tmrw-phone-health-sleep';const copy=el(document,'div');copy.append(el(document,'small','ล่าสุด'),el(document,'strong',sleep?`${Number(sleep.value)} ${sleep.unit||'นาที'}`:'—'),el(document,'span',sleep?'ข้อมูลการนอนที่บันทึกจริง':'ยังไม่มีข้อมูลการนอน'));const moon=el(document,'i');moon.append(icon(document,'moon',42));card.append(copy,moon);root.append(card);
    const chart=el(document,'section');chart.className='tmrw-phone-health-sleep-chart';const h=el(document,'header');h.append(el(document,'h2','ช่วงเวลาการนอน'),el(document,'small','ไม่มีข้อมูลช่วงการนอน'));chart.append(h);const track=el(document,'div');chart.append(track,emptyState(document,'ไม่มีข้อมูล sleep stages จึงไม่สร้างช่วงหลับปลอม'));root.append(chart,realList([['sleep-minutes','การนอน','moon']]));return root;
  }

  if (activeTab === 'vitals') {
    const heart=observation('heart-rate');const hero=el(document,'section');hero.className='tmrw-phone-health-vital-hero';const mark=el(document,'i');mark.append(icon(document,'pulse',36));const copy=el(document,'span');copy.append(el(document,'small','อัตราการเต้นหัวใจล่าสุด'),el(document,'strong',heart?String(Number(heart.value)):'—'));if(heart)copy.append(el(document,'b',heart.unit||'bpm'));copy.append(el(document,'em',heart?.observedAt||'ยังไม่มีข้อมูลชีพจร'));hero.append(mark,copy);root.append(hero);
    const chart=el(document,'section');chart.className='tmrw-phone-health-pulse-chart';const bars=el(document,'span');for(let i=0;i<24;i+=1){const bar=el(document,'i');bar.style.height='0%';bars.append(bar);}chart.append(bars,el(document,'small','—'),el(document,'small','ล่าสุด'),emptyState(document,'ไม่มี time-series จึงไม่สร้างกราฟชีพจรปลอม'));root.append(chart,realList([['heart-rate','ชีพจร','heart']]));return root;
  }

  const ringCard = el(document, 'section'); ringCard.className = 'tmrw-phone-health-ring-card'; const ring = el(document, 'div'); ring.className = 'tmrw-phone-health-ring'; ring.style.setProperty?.('--health-progress','0%'); const ringCopy = el(document, 'span'); ringCopy.append(el(document, 'strong', steps ? Number(steps.value).toLocaleString() : '—'), el(document, 'small', steps ? ` ${steps.unit || 'steps'}` : ' ไม่มีข้อมูล')); ring.append(ringCopy); ringCard.append(ring, el(document, 'p', steps ? 'จำนวนก้าวล่าสุดที่บันทึกจริง' : 'ยังไม่มีข้อมูลก้าว')); root.append(ringCard);
  const metrics = el(document, 'section'); metrics.className = 'tmrw-phone-health-metrics';
  for (const [metric, iconName, label, fallbackUnit] of [['calories','flame','แคลอรี','kcal'],['exercise-minutes','runner','ออกกำลัง','นาที'],['sleep-minutes','moon','การนอน','นาที'],['heart-rate','heart','ชีพจร','bpm']]) { const item=observation(metric); const card=el(document,'button');card.type='button';card.disabled=true;card.dataset.healthMetric=metric;const mark=el(document,'i');mark.append(icon(document,iconName,18));const copy=el(document,'span');copy.append(el(document,'small',label),el(document,'strong',item?String(Number(item.value)):'—'),el(document,'em',item?(item.unit||fallbackUnit):'ไม่มีข้อมูล'));card.append(mark,copy);metrics.append(card); } root.append(metrics);
  const trend=el(document,'section');trend.className='tmrw-phone-health-trend';const trendHeader=el(document,'header');trendHeader.append(el(document,'h2','แนวโน้ม'),el(document,'small','ยังไม่มีข้อมูลสรุปรายสัปดาห์'));trend.append(trendHeader);const trendBars=el(document,'div');trendBars.className='tmrw-phone-health-bars';for(const day of ['จ','อ','พ','พฤ','ศ','ส','อา']){const span=el(document,'span');const bar=el(document,'i');bar.style.height='0%';span.append(bar,el(document,'small',day));trendBars.append(span);}trend.append(trendBars,emptyState(document,'ไม่สร้างแนวโน้มจากข้อมูลที่ไม่มีอยู่จริง'));root.append(trend);
  if(items.length===0)root.append(emptyState(document,'ยังไม่มีข้อมูลสุขภาพ'));return root;
}
