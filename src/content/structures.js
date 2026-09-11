// structures.js — указатель структур: группы, названия с латынью, описания,
// якоря подписей (координаты покоя сердца + глубина/регион для деформации)
// и меши для наведения/подсветки. Цифры берутся из physiology.js.
// targets(engine) → [{ mesh, regions }]: regions — какие значения aRegion
// принадлежат структуре у общих мешей (эндокард/эпикард ЛЖ), null — весь меш.
import { GEOMETRY as G, VOLUMES as V, PRESSURES as P, CONDUCTION as C, TIMING, MECHANICS as M } from '../physiology.js';
import { endoPoint, epiPoint, offsetPoint, lvWall, rvWidth, REGION } from '../geometry/lvshape.js';
import { MITRAL, TRICUSPID, AORTIC, PULMONARY, LA, RA, LAA_PATH, RAA_PATH, L } from '../geometry/layout.js';
import { NODES } from '../conduction.js';

const d2r = Math.PI / 180;
const mm = (cm) => Math.round(cm * 10);
const thMid = (G.rvTheta0 + G.rvTheta1) / 2;
const on = (name, ...regions) => (e) => [{ mesh: e.ventricles.meshes[name], regions }];
const vessel = (...names) => (e) => names.flatMap((n) => e.vessels.meshes[n].children.map((m) => ({ mesh: m, regions: null })));
const tree = (...names) => (e) => names.map((n) => ({ mesh: e.conductionTree.group.getObjectByName(n), regions: null })).filter((t) => t.mesh);
const coronary = (...names) => (e) => names.map((n) => ({ mesh: e.coronaries.group.getObjectByName(n), regions: null }));
const atrium = (name) => (e) => Object.values(e.atria.parts[name].meshes).map((m) => ({ mesh: m, regions: null }));
const valveLeaflets = (name) => (e) => e.valves.valves[name].group.children.filter((m) => m.name.startsWith(name + '-')).map((m) => ({ mesh: m, regions: null }));
const vesselMid = (e, name, t = 0.5) => { const p = e.vessels.meshes[name].userData.curve.getPointAt(t); return [p.x, p.y, p.z]; };

export const GROUPS = ['Левые отделы', 'Правые отделы', 'Клапаны', 'Крупные сосуды', 'Коронарные артерии', 'Проводящая система'];

export const STRUCTURES = [
  // --- Левые отделы -------------------------------------------------------------
  {
    id: 'lv', group: 0, name: 'Левый желудочек', latin: 'ventriculus sinister', label: true,
    desc: `Конус с закруглённой верхушкой, ось от верхушки к основанию ${G.lvLength} см. Стенка ${mm(G.lvWallBase)} мм у основания и ${mm(G.lvWallApex)} мм у верхушки, в систолу утолщается примерно в полтора раза. Конечно-диастолический объём ${V.lvEDV} мл, конечно-систолический ${V.lvESV} мл, ударный объём ${V.lvEDV - V.lvESV} мл, фракция выброса ${Math.round((V.lvEDV - V.lvESV) / V.lvEDV * 100)} %. Давление ${P.lvSystolic}/${P.lvEDP} мм рт. ст. Сокращение складывается из продольного укорочения (основание идёт к неподвижной верхушке), радиального утолщения и скручивания на ${M.twistDeg}°.`,
    anchor: () => ({ p: epiPoint(330 * d2r, 0.45, 0.05), d: 1, region: REGION.LV }),
    targets: (e) => [...on('lvEndo', REGION.LV)(e), ...on('epi', REGION.LV)(e)],
  },
  {
    id: 'septum', group: 0, name: 'Межжелудочковая перегородка', latin: 'septum interventriculare', label: false,
    desc: `Общая стенка двух желудочков, по толщине и строению принадлежит левому: ${mm(G.lvWallBase)}–${mm(G.lvWallApex)} мм, выпукла в сторону правого желудочка. В систолу утолщается вместе со свободной стенкой ЛЖ. Активируется первой: левая ножка пучка Гиса прорывается на её левой поверхности, и возбуждение идёт слева направо. При блокаде левой ножки порядок обратный, и перегородка сокращается раньше боковой стенки.`,
    anchor: () => ({ p: offsetPoint(thMid, 0.55, lvWall(0.55) * 0.5), d: 0.5, region: REGION.SEPTUM }),
    targets: (e) => [...on('lvEndo', REGION.SEPTUM)(e), ...on('rvEndo', REGION.SEPTUM)(e)],
  },
  {
    id: 'la', group: 0, name: 'Левое предсердие', latin: 'atrium sinistrum', label: true,
    desc: `Тонкостенная камера (${mm(G.atrialWall)} мм) позади аорты, принимает четыре лёгочные вены. Объём ${V.laMax} мл перед открытием митрального клапана и ${V.laMin} мл после сокращения. Работает как резервуар в систолу желудочков, как проводник в раннюю диастолу и как насос в конце диастолы: систола предсердий даёт около ${Math.round(V.fillA * 100)} % наполнения ЛЖ. Среднее давление ${P.laMean} мм рт. ст.`,
    anchor: () => ({ p: [LA.center[0], LA.center[1] + G.laAxes[1] * 0.9, LA.center[2]], d: 0, region: REGION.LA, va: 0.95 }),
    targets: atrium('la'),
  },
  {
    id: 'laa', group: 0, name: 'Ушко левого предсердия', latin: 'auricula sinistra', label: true,
    desc: `Слепой вырост предсердия с трабекулами, лежит на передне-боковой поверхности рядом с лёгочным стволом. Опорожняется сокращением предсердия. При фибрилляции предсердий сокращения нет, кровь в ушке застаивается: это главное место образования тромбов при этой аритмии.`,
    anchor: () => ({ p: LAA_PATH[2], d: 0, region: REGION.LA, va: 0.5 }),
    targets: atrium('laa'),
  },
  {
    id: 'pv', group: 0, name: 'Лёгочные вены', latin: 'venae pulmonales', label: true,
    desc: `Четыре вены, по две от каждого лёгкого, впадают в заднюю стенку левого предсердия и несут артериальную кровь. Клапанов нет, поэтому давление в предсердии передаётся в лёгочные капилляры: подъём давления ЛП при недостаточности ЛЖ — причина одышки. Устья вен — источник эктопической активности при фибрилляции предсердий.`,
    anchor: (e) => ({ p: vesselMid(e, 'lspv', 0.6), d: 1, region: REGION.LA, va: 1 }),
    targets: vessel('rspv', 'ripv', 'lspv', 'lipv'),
  },
  // --- Правые отделы -------------------------------------------------------------
  {
    id: 'rv', group: 1, name: 'Правый желудочек', latin: 'ventriculus dexter', label: true,
    desc: `Обхватывает левый желудочек серпом в поперечнике, стенка ${mm(G.rvWall)} мм. Объём ${V.rvEDV} мл в конце диастолы; ударный объём тот же, что у левого желудочка, фракция выброса ниже — около ${Math.round((V.rvEDV - V.rvESV) / V.rvEDV * 100)} %. Давление ${P.rvSystolic}/${P.rvEDP} мм рт. ст., в пять раз ниже левого: лёгочное русло короткое и податливое. Сокращается преимущественно продольно, «мехами», а не радиально.`,
    anchor: () => ({ p: offsetPoint(150 * d2r, 0.55, lvWall(0.55) + rvWidth(150 * d2r, 0.55) + G.rvWall + 0.05), d: 1, region: REGION.RV }),
    targets: (e) => [...on('rvEndo', REGION.RV)(e), ...on('epi', REGION.RV)(e)],
  },
  {
    id: 'rvot', group: 1, name: 'Выносящий тракт правого желудочка', latin: 'conus arteriosus', label: false,
    desc: `Гладкостенная часть правого желудочка, ведущая к клапану лёгочной артерии; отделена от притока наджелудочковым гребнем. Активируется последней в правом желудочке, поэтому именно здесь заканчивается QRS в норме. При обструкции тракта возникает градиент давления между полостью и лёгочной артерией.`,
    anchor: (e) => ({ p: vesselMid(e, 'rvot', 0.5), d: 1, region: REGION.RV }),
    targets: vessel('rvot'),
  },
  {
    id: 'ra', group: 1, name: 'Правое предсердие', latin: 'atrium dextrum', label: true,
    desc: `Принимает верхнюю и нижнюю полые вены и коронарный синус. Стенка ${mm(G.atrialWall)} мм, объём ${V.raMax}–${V.raMin} мл, среднее давление ${P.raMean} мм рт. ст. — самое низкое в сердце, отражает венозный возврат. В крыше у устья верхней полой вены лежит синусовый узел, у перегородочной части трикуспидального кольца — атриовентрикулярный.`,
    anchor: () => ({ p: [RA.center[0], RA.center[1] + G.raAxes[1] * 0.9, RA.center[2]], d: 0, region: REGION.RA, va: 0.95 }),
    targets: atrium('ra'),
  },
  {
    id: 'raa', group: 1, name: 'Ушко правого предсердия', latin: 'auricula dextra', label: false,
    desc: `Широкий треугольный вырост предсердия с гребенчатыми мышцами, прикрывает корень аорты спереди. В отличие от левого ушка, широкое устье не даёт крови застаиваться, и тромбы здесь образуются редко.`,
    anchor: () => ({ p: RAA_PATH[1], d: 0, region: REGION.RA, va: 0.5 }),
    targets: atrium('raa'),
  },
  {
    id: 'svc', group: 1, name: 'Верхняя полая вена', latin: 'vena cava superior', label: true,
    desc: `Собирает кровь от головы, шеи и рук и впадает в крышу правого предсердия. Клапана нет; давление в ней равно давлению в предсердии, поэтому пульсация яремных вен повторяет кривую давления ПП (волны a, c, v).`,
    anchor: (e) => ({ p: vesselMid(e, 'svc', 0.4), d: 1, region: REGION.RA, va: 1 }),
    targets: vessel('svc'),
  },
  {
    id: 'ivc', group: 1, name: 'Нижняя полая вена', latin: 'vena cava inferior', label: true,
    desc: `Самая крупная вена, несёт около двух третей венозного возврата. Входит в правое предсердие снизу, у устья — рудиментарная евстахиева заслонка. Диаметр и спадение на вдохе используют для оценки давления в правом предсердии.`,
    anchor: (e) => ({ p: vesselMid(e, 'ivc', 0.35), d: 1, region: REGION.RA, va: 1 }),
    targets: vessel('ivc'),
  },
  // --- Клапаны -------------------------------------------------------------------
  {
    id: 'mitral', group: 2, name: 'Митральный клапан', latin: 'valva mitralis', label: true,
    desc: `Две створки: передняя длинная (${mm(G.amlLength)} мм) и задняя короткая (${mm(G.pmlLength)} мм), кольцо ${mm(G.mitralA * 2)}×${mm(G.mitralB * 2)} мм. Открывается, когда давление в ЛЖ падает ниже давления ЛП (${TIMING.ivrtRest} мс после закрытия аортального клапана), и закрывается в начале систолы желудочков — это первый тон. Хорды и папиллярные мышцы держат створки в систолу, чтобы они не пролабировали в предсердие.`,
    anchor: () => ({ p: [MITRAL.center[0], MITRAL.center[1] + 0.3, MITRAL.center[2]], d: 0, region: REGION.LV }),
    targets: valveLeaflets('mitral'),
  },
  {
    id: 'tricuspid', group: 2, name: 'Трикуспидальный клапан', latin: 'valva tricuspidalis', label: true,
    desc: `Три створки: передняя, задняя и перегородочная; кольцо крупнее митрального и лежит ближе к верхушке. Закрывается на ${TIMING.tvCloseOffset} мс позже митрального, открывается раньше — отсюда физиологическое расщепление первого тона. Перегородочная створка соседствует с АВ-узлом и пучком Гиса.`,
    anchor: () => ({ p: [TRICUSPID.center[0], TRICUSPID.center[1] + 0.3, TRICUSPID.center[2]], d: 0, region: REGION.RV }),
    targets: valveLeaflets('tricuspid'),
  },
  {
    id: 'chordae', group: 2, name: 'Папиллярные мышцы и хорды', latin: 'musculi papillares, chordae tendineae', label: false,
    desc: `Две папиллярные мышцы ЛЖ (передне-боковая и задне-медиальная) и три в ПЖ сокращаются вместе с желудочком и через хорды натягивают створки. Задне-медиальная мышца кровоснабжается из одного источника (обычно задней межжелудочковой ветви), поэтому при нижнем инфаркте её разрыв даёт острую митральную недостаточность.`,
    anchor: () => ({ p: endoPoint(300 * d2r, 0.4), d: 0, region: REGION.LV }),
    targets: (e) => ['mitral', 'tricuspid'].flatMap((n) => e.valves.valves[n].group.children.filter((m) => m.name === 'chordae' || m.name === 'papillary').map((m) => ({ mesh: m, regions: null }))),
  },
  {
    id: 'aortic', group: 2, name: 'Аортальный клапан', latin: 'valva aortae', label: true,
    desc: `Три полулунные створки в корне аорты, за ними синусы Вальсальвы с устьями коронарных артерий. Открывается, когда давление ЛЖ превышает диастолическое аорты (${P.aoDiastolic} мм рт. ст.), закрывается на инцизуре — это аортальный компонент второго тона. Раскрытие следует за потоком, а не за временем: при снижении сократимости створки открываются не полностью.`,
    anchor: () => ({ p: [AORTIC.center[0] + AORTIC.axis[0] * 0.5, AORTIC.center[1] + AORTIC.axis[1] * 0.5, AORTIC.center[2] + AORTIC.axis[2] * 0.5], d: 1, region: REGION.LV }),
    targets: valveLeaflets('aortic'),
  },
  {
    id: 'pulmonary', group: 2, name: 'Клапан лёгочной артерии', latin: 'valva trunci pulmonalis', label: true,
    desc: `Три полулунные створки, самый передний и верхний клапан сердца. Открывается раньше аортального (давление в ПЖ достигает диастолического лёгочной артерии, ${P.paDiastolic} мм рт. ст., быстрее) и закрывается позже — пульмональный компонент второго тона; на вдохе расщепление растёт.`,
    anchor: () => ({ p: [PULMONARY.center[0] + PULMONARY.axis[0] * 0.5, PULMONARY.center[1] + PULMONARY.axis[1] * 0.5, PULMONARY.center[2] + PULMONARY.axis[2] * 0.5], d: 1, region: REGION.RV }),
    targets: valveLeaflets('pulmonary'),
  },
  // --- Сосуды ------------------------------------------------------------------------
  {
    id: 'aorta', group: 3, name: 'Аорта', latin: 'aorta', label: true,
    desc: `Корень с синусами, восходящая часть, дуга и нисходящая аорта. Диаметр у корня около ${mm(G.aorticR * 2)} мм, стенка ${mm(G.vesselWall)} мм. Давление ${P.aoSystolic}/${P.aoDiastolic} мм рт. ст.; эластичность стенки сглаживает пульсовую волну и поддерживает диастолическое давление, от которого зависит коронарная перфузия.`,
    anchor: (e) => ({ p: vesselMid(e, 'aorta', 0.42), d: 1, region: REGION.LV }),
    targets: vessel('aorta'),
  },
  {
    id: 'archBranches', group: 3, name: 'Ветви дуги аорты', latin: 'truncus brachiocephalicus, a. carotis communis sinistra, a. subclavia sinistra', label: false,
    desc: `Три ветви от выпуклой стороны дуги: плечеголовной ствол, левая общая сонная и левая подключичная артерии. Кровоснабжают голову, шею и руки; в модели уносят около четверти сердечного выброса.`,
    anchor: (e) => ({ p: vesselMid(e, 'leftCarotid', 0.5), d: 1, region: REGION.LV }),
    targets: vessel('brachiocephalic', 'leftCarotid', 'leftSubclavian'),
  },
  {
    id: 'pulmonaryTrunk', group: 3, name: 'Лёгочный ствол', latin: 'truncus pulmonalis', label: true,
    desc: `Выходит из правого желудочка кпереди от аорты, перекрещивает её и делится на правую и левую лёгочные артерии. Несёт венозную кровь под давлением ${P.paSystolic}/${P.paDiastolic} мм рт. ст. Стенка тоньше аортальной — сосуд низкого давления.`,
    anchor: (e) => ({ p: vesselMid(e, 'pulmonaryTrunk', 0.55), d: 1, region: REGION.RV }),
    targets: vessel('pulmonaryTrunk'),
  },
  {
    id: 'pulmonaryArteries', group: 3, name: 'Лёгочные артерии', latin: 'aa. pulmonales dextra et sinistra', label: false,
    desc: `Правая идёт позади восходящей аорты и верхней полой вены, левая — короче, к воротам левого лёгкого. Единственные артерии с венозной кровью. Здесь застревают эмболы из вен ног — тромбоэмболия лёгочной артерии.`,
    anchor: (e) => ({ p: vesselMid(e, 'rightPA', 0.6), d: 1, region: REGION.RV }),
    targets: vessel('rightPA', 'leftPA'),
  },
  // --- Коронарные артерии ------------------------------------------------------------
  {
    id: 'leftMain', group: 4, name: 'Ствол левой коронарной артерии', latin: 'a. coronaria sinistra', label: false,
    desc: `Отходит от левого коронарного синуса, идёт 5–15 мм и делится на переднюю межжелудочковую и огибающую ветви. Кровоснабжает большую часть левого желудочка; стеноз ствола — самая опасная локализация.`,
    anchor: () => ({ p: epiPoint(63 * d2r, 0.96, 0.12), d: 1, region: REGION.LV }),
    targets: coronary('leftMain'),
  },
  {
    id: 'lad', group: 4, name: 'Передняя межжелудочковая ветвь', latin: 'r. interventricularis anterior', label: true,
    desc: `Идёт по передней межжелудочковой борозде к верхушке, отдаёт диагональные ветви к передней стенке и перегородочные — к передним двум третям перегородки. Кровоснабжает около половины массы ЛЖ. Окклюзия даёт передний инфаркт с акинезией передней стенки, перегородки и верхушки.`,
    anchor: () => ({ p: epiPoint(70 * d2r, 0.5, 0.12), d: 1, region: REGION.LV }),
    targets: coronary('lad', 'diagonal'),
  },
  {
    id: 'cx', group: 4, name: 'Огибающая ветвь', latin: 'r. circumflexus', label: true,
    desc: `Идёт по левой части атриовентрикулярной борозды, отдаёт ветви тупого края к боковой стенке ЛЖ. При левом типе кровоснабжения даёт и заднюю межжелудочковую ветвь. Инфаркт её бассейна часто «немой» на стандартной ЭКГ.`,
    anchor: () => ({ p: epiPoint(345 * d2r, 0.94, 0.12), d: 1, region: REGION.LV }),
    targets: coronary('circumflex', 'obtuseMarginal'),
  },
  {
    id: 'rca', group: 4, name: 'Правая коронарная артерия', latin: 'a. coronaria dextra', label: true,
    desc: `От правого коронарного синуса по правой части атриовентрикулярной борозды к задней межжелудочковой борозде. Кровоснабжает правый желудочек, нижнюю стенку ЛЖ, заднюю треть перегородки и, у большинства людей, синусовый и АВ-узлы — отсюда брадикардия и блокады при нижнем инфаркте.`,
    anchor: () => ({ p: epiPoint(160 * d2r, 0.96, 0.12), d: 1, region: REGION.RV }),
    targets: coronary('rca', 'pda', 'acuteMarginal'),
  },
  // --- Проводящая система -------------------------------------------------------------
  {
    id: 'sa', group: 5, name: 'Синусовый узел', latin: 'nodus sinuatrialis', label: true,
    desc: `Водитель ритма в крыше правого предсердия у устья верхней полой вены. Импульс расходится по предсердиям со скоростью около ${C.vAtrial * 10} м/с, к левому предсердию — по пучку Бахмана. Возбуждение предсердий — это зубец P: правое предсердие светится раньше левого.`,
    anchor: () => ({ p: NODES.sa, d: 0, region: REGION.RA, va: 1 }),
    targets: (e) => [...tree('sa', 'internodal')(e)],
  },
  {
    id: 'av', group: 5, name: 'Атриовентрикулярный узел', latin: 'nodus atrioventricularis', label: true,
    desc: `Единственный электрический путь из предсердий в желудочки. Задерживает импульс примерно на ${C.avDelay} мс, чтобы предсердия успели сократить и наполнить желудочки; эта задержка — большая часть интервала PQ (${TIMING.pq} мс в покое). При фибрилляции предсердий узел фильтрует хаотичные импульсы, и желудочки отвечают нерегулярно.`,
    anchor: () => ({ p: NODES.av, d: 0, region: REGION.RA, va: 0 }),
    targets: tree('av'),
  },
  {
    id: 'his', group: 5, name: 'Пучок Гиса и ножки', latin: 'fasciculus atrioventricularis, crura dextrum et sinistrum', label: false,
    desc: `Пучок проходит через фиброзный скелет в перепончатую часть перегородки и делится на правую ножку и левую с передней и задней ветвями. Проводит со скоростью около ${C.vBundle * 10} м/с. Блокада левой ножки меняет порядок активации: левый желудочек возбуждается через перегородку со стороны правого, QRS шире ${120} мс, желудочки сокращаются несинхронно.`,
    anchor: () => ({ p: NODES.his, d: 0.5, region: REGION.SEPTUM }),
    targets: tree('his', 'lbb', 'rbb', 'lafb', 'lpfb', 'moderator'),
  },
  {
    id: 'purkinje', group: 5, name: 'Волокна Пуркинье', latin: 'rami subendocardiales', label: false,
    desc: `Субэндокардиальная сеть, которая доставляет импульс к рабочему миокарду обоих желудочков за 30–40 мс. Активация идёт от эндокарда к эпикарду и от верхушки к основанию, поэтому QRS в норме короче ${TIMING.qrs} мс, а основание и выносящий тракт возбуждаются последними.`,
    anchor: () => ({ p: endoPoint(260 * d2r, 0.25), d: 0, region: REGION.LV }),
    targets: tree('purkLa', 'purkLb', 'purkPa', 'purkPb', 'purkRa', 'purkRb', 'purkRc'),
  },
];

export const structureById = (id) => STRUCTURES.find((s) => s.id === id);
