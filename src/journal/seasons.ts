/**
 * The seventy-two seasons (七十二候) of the old Japanese calendar: each
 * about five days long, named for what is happening in nature then. Start
 * days are the usual ones; the real boundaries drift by a day from year to
 * year with the solar terms.
 */
export interface MicroSeason {
  /** Month (1–12) and day it begins. */
  month: number;
  day: number;
  kanji: string;
  english: string;
}

const SEASONS: readonly MicroSeason[] = [
  // 小寒 Lesser cold
  { month: 1, day: 5, kanji: '芹乃栄', english: 'Parsley flourishes' },
  { month: 1, day: 10, kanji: '水泉動', english: 'Springs thaw' },
  { month: 1, day: 15, kanji: '雉始雊', english: 'Pheasants start to call' },
  // 大寒 Greater cold
  { month: 1, day: 20, kanji: '款冬華', english: 'Butterburs bud' },
  { month: 1, day: 25, kanji: '水沢腹堅', english: 'Ice thickens on the streams' },
  { month: 1, day: 30, kanji: '鶏始乳', english: 'Hens start laying' },
  // 立春 Beginning of spring
  { month: 2, day: 4, kanji: '東風解凍', english: 'East wind melts the ice' },
  { month: 2, day: 9, kanji: '黄鶯睍睆', english: 'Bush warblers sing in the mountains' },
  { month: 2, day: 14, kanji: '魚上氷', english: 'Fish rise from the ice' },
  // 雨水 Rainwater
  { month: 2, day: 19, kanji: '土脉潤起', english: 'Rain moistens the soil' },
  { month: 2, day: 24, kanji: '霞始靆', english: 'Mist starts to linger' },
  { month: 3, day: 1, kanji: '草木萌動', english: 'Grass sprouts, trees bud' },
  // 啓蟄 Insects awaken
  { month: 3, day: 6, kanji: '蟄虫啓戸', english: 'Hibernating insects come out' },
  { month: 3, day: 11, kanji: '桃始笑', english: 'First peach blossoms' },
  { month: 3, day: 16, kanji: '菜虫化蝶', english: 'Caterpillars become butterflies' },
  // 春分 Spring equinox
  { month: 3, day: 21, kanji: '雀始巣', english: 'Sparrows start to nest' },
  { month: 3, day: 26, kanji: '桜始開', english: 'First cherry blossoms' },
  { month: 3, day: 31, kanji: '雷乃発声', english: 'Distant thunder' },
  // 清明 Pure and clear
  { month: 4, day: 5, kanji: '玄鳥至', english: 'Swallows return' },
  { month: 4, day: 10, kanji: '鴻雁北', english: 'Wild geese fly north' },
  { month: 4, day: 15, kanji: '虹始見', english: 'First rainbows' },
  // 穀雨 Grain rain
  { month: 4, day: 20, kanji: '葭始生', english: 'First reeds sprout' },
  { month: 4, day: 25, kanji: '霜止出苗', english: 'Last frost, rice seedlings grow' },
  { month: 4, day: 30, kanji: '牡丹華', english: 'Peonies bloom' },
  // 立夏 Beginning of summer
  { month: 5, day: 5, kanji: '蛙始鳴', english: 'Frogs start singing' },
  { month: 5, day: 10, kanji: '蚯蚓出', english: 'Worms surface' },
  { month: 5, day: 15, kanji: '竹笋生', english: 'Bamboo shoots sprout' },
  // 小満 Lesser ripening
  { month: 5, day: 21, kanji: '蚕起食桑', english: 'Silkworms feast on mulberry leaves' },
  { month: 5, day: 26, kanji: '紅花栄', english: 'Safflowers bloom' },
  { month: 5, day: 31, kanji: '麦秋至', english: 'Wheat ripens' },
  // 芒種 Grain in ear
  { month: 6, day: 6, kanji: '蟷螂生', english: 'Praying mantises hatch' },
  { month: 6, day: 11, kanji: '腐草為螢', english: 'Fireflies rise from the damp grass' },
  { month: 6, day: 16, kanji: '梅子黄', english: 'Plums turn yellow' },
  // 夏至 Summer solstice
  { month: 6, day: 21, kanji: '乃東枯', english: 'Self-heal withers' },
  { month: 6, day: 27, kanji: '菖蒲華', english: 'Irises bloom' },
  { month: 7, day: 2, kanji: '半夏生', english: 'Crow-dipper sprouts' },
  // 小暑 Lesser heat
  { month: 7, day: 7, kanji: '温風至', english: 'Warm winds blow' },
  { month: 7, day: 12, kanji: '蓮始開', english: 'First lotus blossoms' },
  { month: 7, day: 17, kanji: '鷹乃学習', english: 'Young hawks learn to fly' },
  // 大暑 Greater heat
  { month: 7, day: 23, kanji: '桐始結花', english: 'Paulownia trees set seed' },
  { month: 7, day: 29, kanji: '土潤溽暑', english: 'Damp earth, humid air' },
  { month: 8, day: 3, kanji: '大雨時行', english: 'Great rains sometimes fall' },
  // 立秋 Beginning of autumn
  { month: 8, day: 8, kanji: '涼風至', english: 'Cool winds blow' },
  { month: 8, day: 13, kanji: '寒蝉鳴', english: 'Evening cicadas sing' },
  { month: 8, day: 18, kanji: '蒙霧升降', english: 'Thick fog descends' },
  // 処暑 End of heat
  { month: 8, day: 23, kanji: '綿柎開', english: 'Cotton bolls open' },
  { month: 8, day: 28, kanji: '天地始粛', english: 'The heat starts to die down' },
  { month: 9, day: 2, kanji: '禾乃登', english: 'Rice ripens' },
  // 白露 White dew
  { month: 9, day: 8, kanji: '草露白', english: 'Dew glistens white on the grass' },
  { month: 9, day: 13, kanji: '鶺鴒鳴', english: 'Wagtails sing' },
  { month: 9, day: 18, kanji: '玄鳥去', english: 'Swallows leave' },
  // 秋分 Autumn equinox
  { month: 9, day: 23, kanji: '雷乃収声', english: 'Thunder falls quiet' },
  { month: 9, day: 28, kanji: '蟄虫坏戸', english: 'Insects close their doors' },
  { month: 10, day: 3, kanji: '水始涸', english: 'Fields are drained' },
  // 寒露 Cold dew
  { month: 10, day: 8, kanji: '鴻雁来', english: 'Wild geese return' },
  { month: 10, day: 13, kanji: '菊花開', english: 'Chrysanthemums bloom' },
  { month: 10, day: 18, kanji: '蟋蟀在戸', english: 'Crickets chirp by the door' },
  // 霜降 Frost falls
  { month: 10, day: 23, kanji: '霜始降', english: 'First frost' },
  { month: 10, day: 28, kanji: '霎時施', english: 'Light rains sometimes fall' },
  { month: 11, day: 2, kanji: '楓蔦黄', english: 'Maple leaves and ivy turn' },
  // 立冬 Beginning of winter
  { month: 11, day: 7, kanji: '山茶始開', english: 'Camellias bloom' },
  { month: 11, day: 12, kanji: '地始凍', english: 'The land starts to freeze' },
  { month: 11, day: 17, kanji: '金盞香', english: 'Daffodils bloom' },
  // 小雪 Lesser snow
  { month: 11, day: 22, kanji: '虹蔵不見', english: 'Rainbows hide' },
  { month: 11, day: 27, kanji: '朔風払葉', english: 'North wind strips the leaves' },
  { month: 12, day: 2, kanji: '橘始黄', english: 'Tachibana citrus turns yellow' },
  // 大雪 Greater snow
  { month: 12, day: 7, kanji: '閉塞成冬', english: 'Cold sets in, winter begins' },
  { month: 12, day: 12, kanji: '熊蟄穴', english: 'Bears settle into their dens' },
  { month: 12, day: 16, kanji: '鱖魚群', english: 'Salmon gather and swim upstream' },
  // 冬至 Winter solstice
  { month: 12, day: 21, kanji: '乃東生', english: 'Self-heal sprouts' },
  { month: 12, day: 26, kanji: '麋角解', english: 'Deer shed their antlers' },
  { month: 12, day: 31, kanji: '雪下出麦', english: 'Wheat sprouts under the snow' },
];

export const MICRO_SEASON_COUNT = SEASONS.length;

/** The micro-season a day falls in. */
export function microSeason(date: Date = new Date()): MicroSeason {
  const key = (date.getMonth() + 1) * 100 + date.getDate();
  let current = SEASONS[SEASONS.length - 1]!;
  for (const s of SEASONS) {
    if (s.month * 100 + s.day <= key) current = s;
    else break;
  }
  return current;
}
