// General settings, backup / handoff to another manager, and data reset.
import { useRef, useState } from 'react';
import { commit, defaults, getState, normalize, useAppState } from '../../lib/store';
import { readThreeDayAvailability } from '../../lib/availability';
import { addDaysKey, fromKey, hm, toKey, todayKey, uid, whenShort, type DateKey } from '../../lib/time';
import { Icon } from '../icons';
import { Field, MenuItem, Sheet, Stepper } from '../primitives';
import { closeAllSheets, confirmDialog, openSheet, toast } from '../uiStore';
import { downloadFile, canShareFiles, copyText } from '../io';

const IMPORTED_AVAILABILITY_REASON = 'זמינות מקובץ';

async function importAvailability(file: File, startDate: DateKey) {
  let soldiers;
  try {
    soldiers = await readThreeDayAvailability(file, startDate);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'לא הצלחתי לקרוא את קובץ הזמינות');
    return;
  }
  if (!soldiers.length) { toast('לא נמצאו חיילים בקובץ'); return; }

  const byName = new Map(soldiers.map(soldier => [soldier.name.trim(), soldier]));
  const imported = [...byName.values()];
  const existingNames = new Set(getState().people.map(person => person.name.trim()));
  const added = imported.filter(soldier => !existingNames.has(soldier.name)).length;
  if (!(await confirmDialog({
    title: 'לטעון זמינות מהקובץ?',
    text: `${imported.length} חיילים, ${added} חדשים. הזמינות מ־${startDate} עד ${addDaysKey(startDate, 2)} תעודכן; אפשר לבטל מיד אחרי.`,
    ok: 'טען זמינות',
  }))) return;

  commit(draft => {
    for (const soldier of imported) {
      let person = draft.people.find(candidate => candidate.name.trim() === soldier.name);
      if (!person) {
        person = { id: uid(), name: soldier.name, rank: '', piece: '', team: '', quals: [], unavail: [], note: '' };
        draft.people.push(person);
      }

      const knownDays = soldier.days.filter(day => day.status !== 'unknown');
      person.unavail = person.unavail.filter(period => period.reason !== IMPORTED_AVAILABILITY_REASON ||
        !knownDays.some(day => period.start < fromKey(addDaysKey(day.date, 1)) && period.end > fromKey(day.date)));
      for (const day of knownDays) {
        const start = fromKey(day.date);
        const noon = fromKey(day.date, '12:00');
        const end = fromKey(addDaysKey(day.date, 1));
        const interval = day.status === 'home' ? [start, end]
          : day.status === 'leaving' ? [noon, end]
            : day.status === 'returning' ? [start, noon]
              : null;
        if (interval) person.unavail.push({ id: uid(), start: interval[0], end: interval[1], reason: IMPORTED_AVAILABILITY_REASON });
      }
    }
  });
  closeAllSheets();
  toast(`זמינות נטענה עבור ${imported.length} חיילים`, { undo: true });
}

export function SettingsSheet() {
  const s = useAppState();
  const [title, setTitle] = useState(s.settings.title);
  const [to, setTo] = useState('');
  const [handoff, setHandoff] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setSetting = (f: (st: typeof s.settings) => void) => commit(d => f(d.settings));
  const backup = () => JSON.stringify({ app: 'shavtzak', format: 3, exportedAt: Date.now(), to: handoff ? to.trim() : '', state: s });
  const fname = () => `shavtzak-${toKey(Date.now())}-${hm(Date.now()).replace(':', '')}.json`;
  const afterExport = () => {
    if (handoff && to.trim()) { commit(d => { d.settings.handedTo = { name: to.trim(), at: Date.now() }; }); toast(`הניהול סומן כמועבר ל${to.trim()}`, { undo: true }); }
  };
  const backupFile = () => new File([backup()], fname(), { type: 'application/json' });
  const exportFile = () => {
    downloadFile(backupFile());
    afterExport();
  };
  const exportShare = async () => {
    const f = backupFile();
    if (!canShareFiles([f])) { toast('המכשיר לא יודע לשלוח קבצים מכאן – השתמשו ב״שמור קובץ״'); return; }
    try { await navigator.share({ files: [f], title: 'גיבוי שבצ״ק' }); afterExport(); } catch (e) { if ((e as Error).name !== 'AbortError') toast('השליחה לא הצליחה – נסו ״שמור קובץ״'); }
  };

  return (
    <Sheet title="הגדרות" wide>
      <Field label="שם הלוח (מופיע בתמונה)"><input className="inp" value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title.trim() && title !== s.settings.title && setSetting(st => { st.title = title.trim(); })} /></Field>
      <div className="fld"><span className="fld-l">מנוחה מינימלית בין משמרות</span>
        <div className="row"><Stepper label="שעות מנוחה" value={s.settings.minRest} min={0} max={24} step={0.5} onChange={v => setSetting(st => { st.minRest = v; })} /><span className="muted">שעות · פחות מזה מסומן בצהוב. 0 מבטל.</span></div>
      </div>

      <div className="card">
        <h3>גיבוי והעברת ניהול</h3>
        <p>קובץ אחד עם כל החיילים, העמדות והשיבוצים. מנהל אחר טוען אותו אצלו וממשיך משם. אין סנכרון בין מכשירים – רק מנהל אחד עובד על הלוח בכל רגע.</p>
        <label className="check"><input type="checkbox" checked={handoff} onChange={e => setHandoff(e.target.checked)} /><span className="grow"><b>אני מעביר את הניהול</b><small>הלוח אצלך יסומן כ״הועבר״ כדי שלא תמשיך לערוך עותק ישן</small></span></label>
        {handoff ? <Field label="למי?"><input className="inp" value={to} onChange={e => setTo(e.target.value)} placeholder="שם המנהל הבא" /></Field> : null}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => void copyText(backup(), 'הגיבוי הועתק').then(ok => ok && afterExport())}><Icon n="copy" /> העתק</button>
          <button className="btn" onClick={exportFile}><Icon n="dl" /> שמור קובץ</button>
          <button className="btn" onClick={() => void exportShare()}><Icon n="share" /> שתף</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => fileRef.current?.click()}><Icon n="ul" /> טען מקובץ</button>
          <input ref={fileRef} type="file" accept=".json,application/json,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; if (f) f.text().then(importText); e.target.value = ''; }} />
          <button className="btn" onClick={() => openSheet(() => <PasteBackup />)}><Icon n="clip" /> הדבק גיבוי</button>
        </div>
        {s.settings.receivedFrom ? <p className="hint">הלוח נטען מקובץ{s.settings.receivedFrom.name ? ` של ${s.settings.receivedFrom.name}` : ''} ב־{whenShort(s.settings.receivedFrom.at)}.</p> : null}
      </div>

      <div className="card">
        <h3>מקרא</h3>
        <div className="legend">
          <div><span className="sw ok" />מאויש במלואו</div>
          <div><span className="sw bad" />מקום פנוי, חפיפה או חייל לא זמין</div>
          <div><span className="sw warn" />מנוחה קצרה מ־{s.settings.minRest} ש׳ – השעה על השם היא המנוחה בפועל</div>
          <div><span className="sw live" />משמרת שמתקיימת עכשיו</div>
        </div>
      </div>

      <div className="card">
        <h3>התקנה בטלפון</h3>
        <p>הנתונים נשמרים רק במכשיר הזה ולא נשלחים לשום מקום. אחרי ההתקנה האפליקציה נפתחת גם בלי קליטה.</p>
        <ol className="steps"><li><b>אייפון:</b> Safari ← שיתוף ← ״הוסף למסך הבית״</li><li><b>אנדרואיד:</b> Chrome ← ⋮ ← ״התקנת אפליקציה״</li></ol>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn btn-sm danger-t" onClick={async () => { if (await confirmDialog({ title: 'למחוק את כל הנתונים?', text: 'כל החיילים, העמדות והשיבוצים יימחקו מהמכשיר. כדאי לשמור גיבוי קודם.', ok: 'מחק הכל', danger: true })) { commit(d => { Object.assign(d, defaults()); }); closeAllSheets(); toast('כל הנתונים נמחקו', { undo: true }); } }}><Icon n="trash" size={18} /> מחק הכל</button>
      </div>
    </Sheet>
  );
}

export function AvailabilityImportMenuItem() {
  return <MenuItem icon="ul" label="טעינת זמינות" sub="קובץ Excel · בחירת תאריך" onClick={() => openSheet(() => <AvailabilityImportSheet />)} />;
}

function AvailabilityImportSheet() {
  const [startDate, setStartDate] = useState<DateKey>(todayKey());
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Sheet title="טעינת זמינות">
      <Field label="תאריך תחילת הזמינות">
        <input className="inp" type="date" value={startDate} onChange={e => setStartDate(e.target.value as DateKey)} />
      </Field>
      <button className="btn btn-primary" onClick={() => fileRef.current?.click()}><Icon n="ul" /> בחירת קובץ Excel</button>
      <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void importAvailability(file, startDate); e.target.value = ''; }} />
    </Sheet>
  );
}

function PasteBackup() {
  const [t, setT] = useState('');
  return (
    <Sheet title="הדבקת גיבוי" footer={<button className="btn btn-primary" onClick={() => importText(t)} disabled={!t.trim()}>טען</button>}>
      <textarea className="inp tall mono" value={t} onChange={e => setT(e.target.value)} placeholder='{"app":"shavtzak",…}' autoFocus />
    </Sheet>
  );
}

export async function importText(txt: string) {
  let o: any;
  try { o = JSON.parse(String(txt).trim()); } catch { toast('לא הצלחתי לקרוא את הקובץ – ודאו שזה גיבוי של שבצ״ק'); return; }
  const st = o?.app === 'shavtzak' ? o.state : o;
  if (!st || !Array.isArray(st.people)) { toast('זה לא קובץ גיבוי של שבצ״ק'); return; }
  const ok = await confirmDialog({
    title: 'לטעון את הלוח מהקובץ?',
    text: `${st.people.length} חיילים ו־${(st.posts ?? []).length} עמדות${o.exportedAt ? `, נשמר ${whenShort(o.exportedAt)}` : ''}. הלוח שבמכשיר יוחלף – אפשר לבטל מיד אחרי.`,
    ok: 'טען והחלף', danger: true,
  });
  if (!ok) return;
  commit(d => {
    const n = normalize(st);
    Object.assign(d, n);
    d.sample = false; d.settings.handedTo = null;
    d.settings.receivedFrom = { name: '', at: o.exportedAt ?? Date.now() };
  });
  closeAllSheets();
  toast('הלוח נטען', { undo: true });
}
