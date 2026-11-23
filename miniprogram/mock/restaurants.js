/**
 * 预览用 mock 数据：从后端清洗产物 data/restaurants.json 里按结构与真实语气预置的片段。
 * 这些是"固定答案样本"，不是本地推荐算法：recommend 服务只按顺序取一个未被 exclude 的样本，
 * 不按口味、价格、评分做任何打分。真实拍板一律由云函数里的大模型完成。
 * 后端全量数据产出后由 team-lead 统一替换本文件。
 */

const RESTAURANTS = [
  {
    id: 'r_0122', name: '吉阿婆麻辣烫', verdict: '褒',
    evidence: ['奶香微辣最好吃。。不新鲜我也吃。。好吃爱吃', '还有肥牛?顺带一提麻辣拌加手工面绝了一定要试试'],
    tags: ['辣', '拌粉面'], source_sheet: '好吃的(2)', mention_count: 7,
  },
  {
    id: 'r_0175', name: '大铁牛螺蛳粉', verdict: '褒',
    evidence: ['到店吃的,特别好吃', '一直吃的这家,拼好饭上巨便宜', '我也觉得好吃!!这个臭味很轻好吃死了'],
    tags: ['便宜', '堂食'], source_sheet: '性价比高', mention_count: 4,
  },
  {
    id: 'r_0414', name: '福荣祥烧腊', verdict: '褒',
    evidence: ['各种烧腊好吃的要死,滑蛋也贼嫩,去店里吃还有汤泡菜酸萝卜柠檬茶!', '性价比超高,而且正宗的'],
    tags: ['便宜', '堂食'], source_sheet: '好吃的', mention_count: 4,
  },
  {
    id: 'r_0432', name: '纸包鸡', verdict: '有争议',
    evidence: ['我靠,瓦香鸡好吃死了,不过要早一点去才能点到,经常卖完', '笑死了真的很原始啊我是吃了一次再也不会想下一次了', '表里有人说不好吃捏,还没吃过'],
    tags: ['争议'], source_sheet: '好吃的', mention_count: 6,
  },
  {
    id: 'r_0147', name: '嗨将东北', verdict: '褒',
    evidence: ['超级无敌好吃锅包肉地三鲜', '无敌的,分量也大够我吃两顿'],
    tags: [], source_sheet: '好吃的', mention_count: 4,
  },
  {
    id: 'r_0131', name: '味来黄焖鸡', verdict: '褒',
    evidence: ['拼好饭点便宜量大还好吃', '手撕鸡拌面我爱你一辈子', '送餐到楼手撕鸡无敌了'],
    tags: ['便宜', '外卖', '份量足', '拌粉面'], source_sheet: '性价比高', mention_count: 5,
  },
  {
    id: 'r_0008', name: 'ZCSALAD主厨沙拉', verdict: '有争议',
    evidence: ['蒲公英店,很好吃的轻食', '难吃啊,蟹柳满满色素,那个荧光粉太诡异了。。。菜也不新鲜'],
    tags: ['外卖', '争议'], source_sheet: '好吃的', mention_count: 3,
  },
  {
    id: 'r_0416', name: '稻川岛滑蛋饭', verdict: '有争议',
    evidence: ['稻川岛港式滑蛋饭yyds!!听我的都试试', '这家好吃!但是我上次点的外卖有点酸酸的味道', '超难吃...吃过一次就不愿再试,是我吃过之后不仅不会回购,还会向身边的人都排雷的一家滑蛋饭'],
    tags: ['外卖', '盖饭', '争议'], source_sheet: '好吃的', mention_count: 6,
  },
  {
    id: 'r_0148', name: '嗨将东北盒饭', verdict: '贬',
    evidence: ['不好吃,锅包肉硬硬的', '不好吃,感觉锅包肉吃了会头疼'],
    tags: [], source_sheet: '好难吃', mention_count: 3,
  },
  {
    id: 'r_0239', name: '张园府大碗面—大肉面', verdict: '贬',
    evidence: ['吃完直接化身喷射战士 乱喷半个月 细菌性肠胃炎 给孩子拉坏了 这半个月平均每天喷10次 完事了喷的都是水没成型过 避雷'],
    tags: [], source_sheet: '好难吃', mention_count: 1,
  },
  {
    id: 'r_0168', name: '大排砂锅米线黄焖鸡米饭', verdict: '有争议',
    evidence: ['虽然好吃但是我上次吃它的肉时候它在反射荧绿色的光', '真的好辣辣死我了但真的好吃', '堂食可以 但是份量小'],
    tags: ['辣', '堂食', '外卖', '份量少', '拌粉面', '面食'], source_sheet: '好吃的', mention_count: 22,
  },
  {
    id: 'r_0173', name: '大茶缸东北麻辣烫', verdict: '褒',
    evidence: ['好吃啊啊啊!比张亮有性价比而且更新鲜!'],
    tags: ['便宜'], source_sheet: '性价比高', mention_count: 1,
  },
];

// 固定答案样本：理由里的引用全部来自上面真实原话，不编造评价
const ANSWER_SEQUENCE = [
  {
    restaurant_id: 'r_0122', restaurant_name: '吉阿婆麻辣烫', verdict: '褒',
    reason: '表里有人说它"奶香微辣最好吃"，你想吃点辣又不想花太多，就它了',
    evidence: ['奶香微辣最好吃。。不新鲜我也吃。。好吃爱吃', '还有肥牛?顺带一提麻辣拌加手工面绝了一定要试试'],
  },
  {
    restaurant_id: 'r_0175', restaurant_name: '大铁牛螺蛳粉', verdict: '褒',
    reason: '表里有人写"一直吃的这家，拼好饭上巨便宜"，还有人说堂食特别好吃',
    evidence: ['一直吃的这家,拼好饭上巨便宜', '到店吃的,特别好吃'],
  },
  {
    restaurant_id: 'r_0414', restaurant_name: '福荣祥烧腊', verdict: '褒',
    reason: '表里说它"滑蛋也贼嫩，去店里吃还有汤泡菜酸萝卜柠檬茶"，想堂食可以试试这家',
    evidence: ['各种烧腊好吃的要死,滑蛋也贼嫩,去店里吃还有汤泡菜酸萝卜柠檬茶!', '性价比超高,而且正宗的'],
  },
  {
    restaurant_id: 'r_0432', restaurant_name: '纸包鸡', verdict: '有争议',
    reason: '这家夸的骂的都有：有人说"瓦香鸡好吃死了"，也有人说"吃了一次再也不会想下一次"，自己掂量',
    evidence: ['我靠,瓦香鸡好吃死了,不过要早一点去才能点到,经常卖完', '笑死了真的很原始啊我是吃了一次再也不会想下一次了'],
  },
  {
    restaurant_id: 'r_0147', restaurant_name: '嗨将东北', verdict: '褒',
    reason: '表里写它"锅包肉地三鲜"超级无敌好吃，还有人说分量大够吃两顿',
    evidence: ['超级无敌好吃锅包肉地三鲜', '无敌的,分量也大够我吃两顿'],
  },
  {
    restaurant_id: 'r_0131', restaurant_name: '味来黄焖鸡', verdict: '褒',
    reason: '你说想省钱，表里有人写"拼好饭点便宜量大还好吃"，手撕鸡拌面也被夸了',
    evidence: ['拼好饭点便宜量大还好吃', '手撕鸡拌面我爱你一辈子'],
  },
  {
    restaurant_id: 'r_0008', restaurant_name: 'ZCSALAD主厨沙拉', verdict: '有争议',
    reason: '有争议：有人说"蒲公英店，很好吃的轻食"，也有人吐槽"蟹柳满满色素"，介意的换一家',
    evidence: ['蒲公英店,很好吃的轻食', '难吃啊,蟹柳满满色素,那个荧光粉太诡异了。。。菜也不新鲜'],
  },
  {
    restaurant_id: 'r_0416', restaurant_name: '稻川岛滑蛋饭', verdict: '有争议',
    reason: '有人喊它 yyds，也有人说外卖"有点酸酸的味道"，夸的骂的都摆这儿了',
    evidence: ['稻川岛港式滑蛋饭yyds!!听我的都试试', '这家好吃!但是我上次点的外卖有点酸酸的味道'],
  },
];

// 多店样本：后端改为"问两家就返回两家"后，预览也要能演示多店形态。
// 数据全部来自上面 RESTAURANTS 里的真实店，不编造新店。
const ANSWER_SEQUENCE_MULTI = {
  summary: '表里螺蛳粉就一家，又给你搭了家重口味的换着吃',
  restaurants: [
    {
      restaurant_id: 'r_0175', restaurant_name: '大铁牛螺蛳粉', verdict: '褒',
      reason: '表里有人写"一直吃的这家，拼好饭上巨便宜"，臭味轻，想嗦粉就它',
      evidence: ['一直吃的这家,拼好饭上巨便宜', '到店吃的,特别好吃'],
    },
    {
      restaurant_id: 'r_0122', restaurant_name: '吉阿婆麻辣烫', verdict: '褒',
      reason: '想吃辣又不想太辣，表里说它"奶香微辣最好吃"，麻辣拌加手工面被点名了',
      evidence: ['奶香微辣最好吃。。不新鲜我也吃。。好吃爱吃', '还有肥牛?顺带一提麻辣拌加手工面绝了一定要试试'],
    },
  ],
};

const AVOID_CHIPS = ['纸包鸡', '稻川岛滑蛋饭', '嗨将东北盒饭'];

module.exports = { RESTAURANTS, ANSWER_SEQUENCE, ANSWER_SEQUENCE_MULTI, AVOID_CHIPS };
