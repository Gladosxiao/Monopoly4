// 美术资源路径管理
// 当前使用静态资源目录约定，实际美术资源到位后按 key 替换即可，无需改动业务代码

export const ASSET_BASE_URL = '/assets';

export function getCardAssetUrl(assetKey: string): string {
  return `${ASSET_BASE_URL}/cards/${assetKey}.png`;
}

export function getItemAssetUrl(assetKey: string): string {
  return `${ASSET_BASE_URL}/items/${assetKey}.png`;
}

export function getSpiritAssetUrl(assetKey: string): string {
  return `${ASSET_BASE_URL}/spirits/${assetKey}.png`;
}

export function getCharacterAvatarUrl(characterId: string): string {
  return `${ASSET_BASE_URL}/characters/${characterId}.png`;
}

export function getTileIconUrl(tileType: string): string {
  return `${ASSET_BASE_URL}/tiles/${tileType}.png`;
}

// 占位方案：美术资源缺失时可返回 data URI 或纯色块
// 前端可据此渲染 emoji / 纯色矩形作为 fallback
export const ASSET_FALLBACK = {
  card: `${ASSET_BASE_URL}/cards/_fallback.png`,
  item: `${ASSET_BASE_URL}/items/_fallback.png`,
  spirit: `${ASSET_BASE_URL}/spirits/_fallback.png`,
  character: `${ASSET_BASE_URL}/characters/_fallback.png`,
  tile: `${ASSET_BASE_URL}/tiles/_fallback.png`,
};
