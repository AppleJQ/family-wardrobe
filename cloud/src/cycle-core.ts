import { CyclePeriod, CyclePrediction, CycleProfile, CycleStatistics } from './cycle-model';

const DAY = 86400000;
const stamp = (date: string) => Date.parse(`${date}T00:00:00Z`);
const days = (start: string, end: string) => Math.round((stamp(end) - stamp(start)) / DAY);
const addDays = (date: string, count: number) => new Date(stamp(date) + count * DAY).toISOString().slice(0, 10);
const mean = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
type History = Pick<CycleProfile, 'periods' | 'settings'>;

export function cycleToday(now: number): string {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

function activePeriods(profile: History): CyclePeriod[] {
  return profile.periods.filter(row => row.deletedAt === null).sort((a, b) => a.start.localeCompare(b.start));
}

export function cycleStatistics(profile: History | null): CycleStatistics {
  const active = profile ? activePeriods(profile) : [];
  // A cycle is completed by the next actual start; the newest cycle is still open.
  const cycles = active.slice(0, -1).map((row, index) => ({ start: row.start, end: addDays(active[index + 1].start, -1), days: days(row.start, active[index + 1].start) })).slice(-6);
  const periods = active.filter(row => row.end).slice(-6).map(row => ({ start: row.start, end: row.end, days: days(row.start, row.end) + 1 }));
  const lengths = cycles.map(row => row.days);
  return { cycles, periods, averageCycle: mean(lengths), averagePeriod: mean(periods.map(row => row.days)),
    shortest: lengths.length ? Math.min(...lengths) : null, longest: lengths.length ? Math.max(...lengths) : null,
    difference: lengths.length >= 2 ? lengths[lengths.length - 1] - lengths[lengths.length - 2] : null };
}

export function cyclePrediction(profile: History | null, today: string): { prediction: CyclePrediction | null; predictionReason: string } {
  const absent = (predictionReason: string) => ({ prediction: null, predictionReason });
  if (!profile) return absent('请先创建经期档案');
  if (profile.settings.predictionPaused) return absent('已暂停预测，实际记录与统计继续保留');
  const active = activePeriods(profile);
  if (!active.length) return absent('请先记录一次实际经期开始日期');
  const stats = cycleStatistics(profile);
  // Keep every recorded interval in statistics. Select estimation samples
  // separately so one gap or unusually short interval does not hide all dates.
  // These are supported estimation bounds, not a health classification.
  const supported = (value: number | null, min: number, max: number): value is number =>
    value !== null && Number.isInteger(value) && value >= min && value <= max;
  const lengths = stats.cycles.map(row => row.days).filter(value => supported(value, 15, 60));
  const excluded = stats.cycles.length - lengths.length;
  const manualLength = supported(profile.settings.cycleLength, 15, 60) ? profile.settings.cycleLength : null;
  const length = mean(lengths) ?? manualLength;
  if (length === null) return absent('可参考周期记录不足，请继续记录或填写参考周期天数');
  const last = active[active.length - 1], start = addDays(last.start, length);
  const durations = stats.periods.map(row => row.days).filter(value => supported(value, 1, 20));
  const excludedPeriods = stats.periods.length - durations.length;
  const manualPeriod = supported(profile.settings.periodLength, 1, 20) ? profile.settings.periodLength : null;
  const periodLength = mean(durations) ?? manualPeriod;
  const end = periodLength === null ? '' : addDays(start, periodLength - 1);
  // An unfinished actual period covers only known days through today. It never
  // turns every future date into an actual day or advances an overdue estimate.
  if (active.some(row => row.start <= (end || start) && (row.end || today) >= start)) return absent('预测区间与已记录的实际经期重叠，请先核对实际记录');
  const variable = lengths.length >= 2 && Math.max(...lengths) - Math.min(...lengths) > 7;
  const preliminary = lengths.length < 3 || excluded > 0 || excludedPeriods > 0 || variable;
  const ovulation = addDays(start, -14), daysUntil = days(today, start);
  const prediction = { start, end, ovulation, fertileStart: addDays(ovulation, -5), fertileEnd: ovulation,
    preliminary, cycleDay: days(last.start, today) + 1, daysUntil };
  const timing = daysUntil < 0 ? '预计开始日期已过，等待新的实际记录；不会自动顺延预测' : '日期为估算，请以实际记录为准';
  const basis = lengths.length ? `按最近${lengths.length}个可参考周期平均${length}天估算` : `按填写的参考周期${length}天估算`;
  const notes = [basis];
  if (excluded) notes.push(`${excluded}个记录间隔超出本次估算范围，未用于估算，请核对是否漏记或日期有误`);
  if (excludedPeriods) notes.push(`${excludedPeriods}段经期持续记录未用于结束日期估算`);
  if (variable) notes.push('周期波动较大，日期、排卵及易孕期估算误差可能较大');
  if (preliminary) notes.push('当前为初步估算');
  notes.push(timing);
  if (!end) notes.push('经期天数资料不足，暂不预测结束日期');
  return { prediction, predictionReason: notes.join('；') };
}
