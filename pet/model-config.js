// 斯卡蒂 桌宠 模型配置
// 来源: https://prts.wiki/w/斯卡蒂#干员模型 (PRTS 干员模型页, torappu.prts.wiki/assets/char_spine/char_263_skadi/meta.json)
// base 相对 pet/ 目录; 每个条目是 assets 下相对路径, 文件为 <file>.skel / <file>.atlas / <file>.png
window.SKADI_CONFIG = {
  name: "斯卡蒂",
  charId: "char_263_skadi",
  base: "../assets/",
  skins: {
    "默认": {
      "正面": "defaultskin/front/char_263_skadi",
      "基建": "defaultskin/build/build_char_263_skadi",
      "背面": "defaultskin/back/char_263_skadi"
    },
    "驭浪 WR04": {
      "正面": "char_263_skadi_summer_3/front/char_263_skadi_summer_3",
      "基建": "char_263_skadi_summer_3/build/build_char_263_skadi_summer_3",
      "背面": "char_263_skadi_summer_3/back/char_263_skadi_summer_3"
    },
    "下一顿午茶": {
      "正面": "char_263_skadi_marthe_5/front/char_263_skadi_marthe_5",
      "基建": "char_263_skadi_marthe_5/build/build_char_263_skadi_marthe_5",
      "背面": "char_263_skadi_marthe_5/back/char_263_skadi_marthe_5"
    }
  }
};
