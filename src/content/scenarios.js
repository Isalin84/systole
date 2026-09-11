// scenarios.js — шесть сценариев: параметры таймлайна и цикла, проводимости и
// региональной механики, текст (3–5 предложений) и дополнительные события.
// Чистые данные; текст — функция от построенного цикла и карты активации,
// чтобы цифры в нём совпадали с тем, что показано.
import { VOLUMES, PRESSURES } from '../physiology.js';

const d2r = Math.PI / 180;
const ms = (x) => `${Math.round(x)} мс`;

export const SCENARIOS = [
  {
    key: 'rest', title: 'Покой, 65 уд/мин',
    timeline: { hr: 65, rhythm: 'sinus' }, cycle: {}, conduction: {}, mech: {},
    text: ({ c }) => `Синусовый ритм ${Math.round(c.hr)} в минуту, RR ${ms(c.rr)}. Конечно-диастолический объём (КДО) левого желудочка ${Math.round(c.lv.edv)} мл, конечно-систолический (КСО) ${Math.round(c.lv.esv)} мл, ударный объём ${Math.round(c.lv.sv)} мл, фракция выброса ${Math.round(c.lv.ef * 100)} %. Давление в ЛЖ ${PRESSURES.lvSystolic}/${PRESSURES.lvEDP}, в аорте ${PRESSURES.aoSystolic}/${PRESSURES.aoDiastolic} мм рт. ст. Изгнание длится ${ms(c.times.tAc - c.times.tAo)}, диастола от открытия до закрытия митрального клапана — ${ms(c.rr + c.times.tMc - c.times.tMo)}: быстрое наполнение, диастазис и систола предсердий, дающая около ${Math.round(VOLUMES.fillA * 100)} % наполнения. Это эталон, с которым сравниваются остальные сценарии.`,
    notes: () => [],
  },
  {
    key: 'exercise', title: 'Физическая нагрузка, 150 уд/мин',
    timeline: { hr: 150, rhythm: 'sinus' }, cycle: { lvESV: 40, aoSystolic: 150 }, conduction: {}, mech: {},
    text: ({ c }) => `ЧСС ${Math.round(c.hr)}, RR ${ms(c.rr)}. Изгнание укорачивается по Weissler до ${ms(c.times.tAc - c.times.tAo)}, а диастола — до ${ms(c.rr + c.times.tMc - c.times.tMo)}, то есть примерно втрое против покоя: систола отдаёт время неохотно, диастола — почти всё. E-волна и систола предсердий сливаются, диастазиса нет. Коронарный кровоток левого желудочка идёт в основном в диастолу, поэтому время перфузии сокращается непропорционально частоте. Сократимость выше: КСО ${Math.round(c.lv.esv)} мл, фракция выброса ${Math.round(c.lv.ef * 100)} %.`,
    notes: (c) => [{ t: c.times.tMo, key: 'note', label: `Диастола ${ms(c.rr + c.times.tMc - c.times.tMo)}` }],
  },
  {
    key: 'af', title: 'Фибрилляция предсердий',
    timeline: { hr: 95, rhythm: 'af', seed: 3 }, cycle: {}, conduction: {}, mech: {},
    text: ({ c }) => `Предсердия не сокращаются: нет зубца P и A-волны, желудочки отвечают нерегулярно (интервалы RR разбросаны, средняя ЧСС около ${Math.round(c.hr)}). Теряется предсердный вклад в наполнение: КДО падает со ${VOLUMES.lvEDV} до ${Math.round(c.lv.edv)} мл, ударный объём — с ${VOLUMES.lvEDV - VOLUMES.lvESV} до ${Math.round(c.lv.sv)} мл. Короткий интервал застаёт желудочек недонаполненным, длинный — переполненным. В ушке левого предсердия (auricula sinistra) без сокращения кровь стоит: частицы в нём неподвижны — субстрат тромбообразования.`,
    notes: () => [],
  },
  {
    key: 'hfref', title: 'Сердечная недостаточность со сниженной ФВ',
    timeline: { hr: 85, rhythm: 'sinus' }, cycle: { lvEDV: 200, lvESV: 140, aoSystolic: 105, aoDiastolic: 70 }, conduction: {}, mech: { wallThin: 0.25 },
    text: ({ c, sc }) => `Дилатационное ремоделирование: КДО ${Math.round(c.lv.edv)} мл, КСО ${Math.round(c.lv.esv)} мл, ударный объём ${Math.round(c.lv.sv)} мл, фракция выброса ${Math.round(c.lv.ef * 100)} %. Полость левого желудочка из конуса становится шаром, стенка растянута и тоньше (около 7–8 мм у основания вместо 10), митральное кольцо расширяется. Компенсация — ЧСС ${Math.round(c.hr)} и большой объём; систолическое давление ${sc.cycle.aoSystolic} мм рт. ст. Утолщение стенки в систолу едва заметно.`,
    notes: () => [],
  },
  {
    key: 'lad', title: 'Окклюзия передней межжелудочковой ветви',
    timeline: { hr: 80, rhythm: 'sinus' }, cycle: { lvESV: 70, aoSystolic: 110 }, conduction: {},
    mech: { zone: { thetaC: 75 * d2r, halfW: 45 * d2r, soft: 12 * d2r, vTop: 0.7, vApex: 0.25 }, hypo: 0.85, occlusion: true },
    text: ({ c }) => `Окклюзия проксимального сегмента передней межжелудочковой ветви (ramus interventricularis anterior) ниже отхождения первой диагональной. Обескровлены передняя стенка, передняя часть перегородки и верхушка левого желудочка: в зоне стенка не утолщается и полость не сужается, остальной миокард работает — на срезе это читается по толщине. КСО растёт до ${Math.round(c.lv.esv)} мл, фракция выброса ${Math.round(c.lv.ef * 100)} %, компенсаторно ЧСС ${Math.round(c.hr)}. Электрическая активация в модели не меняется: показан механический дефект, без подъёма сегмента ST.`,
    notes: () => [],
  },
  {
    key: 'lbbb', title: 'Блокада левой ножки пучка Гиса',
    timeline: { hr: 70, rhythm: 'sinus' }, cycle: { lvESV: 60 }, conduction: { lbbb: true },
    mech: { zone: { thetaC: 'lateral', halfW: 90 * d2r, soft: 60 * d2r, vTop: 1.2, vApex: -1 }, dyssync: true },
    text: ({ c, act }) => `Левая ножка не проводит: левый желудочек активируется через перегородку со стороны правого и дальше по рабочему миокарду, QRS расширяется до ${ms(act.stats.qrsDuration)}. Перегородка сокращается примерно на ${ms(act.stats.lateralDelay)} раньше боковой стенки, и часть её работы уходит на растяжение ещё не активированной стенки, а не на выброс. Это механическая несинхронность — субстрат для ресинхронизирующей терапии. Фракция выброса снижена умеренно: ${Math.round(c.lv.ef * 100)} %.`,
    notes: (c, act) => [{ t: act.stats.lateralDelay, key: 'note', label: 'Активация боковой стенки' }],
  },
];

export const scenarioByKey = (key) => SCENARIOS.find((s) => s.key === key) || SCENARIOS[0];
